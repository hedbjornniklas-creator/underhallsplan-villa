'use client'

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { Check, ChevronDown, Headset, Info, LoaderCircle, RefreshCw, X } from 'lucide-react'
import { CONSULTANT_REVIEW_MAX_MESSAGE, CONSULTANT_REVIEW_PRICE_LABEL, CONSULTANT_REVIEW_PRICE_ORE, type ConsultantReviewOrder as Order } from '@/lib/renoapp/consultantReview'

function ConsultantReviewScope() {
  return (
    <details className="group mt-3 min-w-0 text-sm">
      <summary className="flex min-h-9 w-fit cursor-pointer list-none items-center gap-2 font-semibold text-sky-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-700 [&::-webkit-details-marker]:hidden">
        <Info size={18} className="shrink-0" aria-hidden="true" />
        <span>Vad ingår i priset?</span>
        <ChevronDown size={16} className="shrink-0 transition-transform group-open:rotate-180" aria-hidden="true" />
      </summary>
      <div className="mt-2 border-l-2 border-sky-300 bg-sky-50 px-4 py-3 leading-6 text-stone-800 [overflow-wrap:anywhere]">
        <p className="font-semibold">Byggkonsulten hjälper styrelsen med:</p>
        <ul className="mt-2 list-disc space-y-2 pl-5">
          <li>En genomgång av renoveringsansökan och de underlag som har skickats in.</li>
          <li>Råd om hur styrelsen kan gå vidare med ansökan, till exempel vilka frågor som behöver redas ut eller om ytterligare underlag behövs.</li>
        </ul>
        <p className="mt-3">Granskningen är ett stöd för styrelsen. Beslutet om ansökan fattas alltid av styrelsen.</p>
      </div>
    </details>
  )
}

export default function ConsultantReviewOrder({ caseId, brfName, isDraft }: { caseId: string; brfName: string | null; isDraft: boolean }) {
  const [order, setOrder] = useState<Order | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const sendingRef = useRef(false)
  const dialog = useRef<HTMLDialogElement>(null)
  const titleId = useId(), priceId = useId()
  const endpoint = `/api/renoapp/app/cases/${caseId}/consultant-review`

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true)
    setLoadError(null)
    try {
      const response = await fetch(endpoint, { cache: 'no-store', signal })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error)
      if (!signal?.aborted) setOrder(payload.order)
    } catch {
      if (!signal?.aborted) setLoadError('Kunde inte läsa beställningsstatus.')
    } finally { if (!signal?.aborted) setLoading(false) }
  }, [endpoint])

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load])

  async function submit(retry = false) {
    if (sendingRef.current) return
    sendingRef.current = true
    setSending(true)
    setError(null)
    try {
      const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(retry ? { retry: true } : { message, confirmedPriceOre: CONSULTANT_REVIEW_PRICE_ORE }) })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Beställningen kunde inte skickas.')
      setOrder(payload.order)
      dialog.current?.close()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Beställningen kunde inte skickas. Försök igen.')
    } finally {
      sendingRef.current = false
      setSending(false)
    }
  }

  return (
    <section className="min-w-0 border-y border-stone-300 bg-white px-5 py-6 sm:px-6" aria-label="Granskning av byggkonsult">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-lg font-semibold text-stone-950"><Headset size={22} className="shrink-0 text-emerald-700" aria-hidden="true" />Granskning av byggkonsult</h2>
          <p className="mt-1 text-sm text-stone-600">Granskning av ansökan och inskickade underlag.</p>
          <p className="mt-2 text-base font-semibold text-stone-950">Fast pris: {CONSULTANT_REVIEW_PRICE_LABEL}</p>
        </div>
        {!order && !loadError ? <button type="button" disabled={loading || isDraft} onClick={() => { setError(null); dialog.current?.showModal() }}
          className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-md border border-emerald-800 px-4 py-2 text-sm font-semibold text-emerald-900 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50">
          <Headset size={18} aria-hidden="true" />{loading ? 'Läser beställningsstatus...' : 'Få hjälp av byggkonsult'}
        </button> : null}
      </div>
      <ConsultantReviewScope />
      {isDraft ? <p className="mt-3 text-sm text-stone-600">Granskning kan beställas när ansökan har skickats in.</p> : null}
      {loadError ? <div role="alert" className="mt-3 flex flex-wrap items-center gap-3 text-sm text-rose-800"><p>{loadError}</p><button type="button" onClick={() => void load()} className="inline-flex items-center gap-2 font-semibold underline"><RefreshCw size={16} />Försök igen</button></div> : null}
      {order ? <div role="status" className="mt-4 border-t border-stone-200 pt-4 text-sm">
        <p className="flex items-center gap-2 font-semibold text-emerald-800"><Check size={18} aria-hidden="true" />Granskning beställd</p>
        <p className="mt-1 break-words text-stone-600">{new Date(order.createdAt).toLocaleString('sv-SE')} av {order.requesterName}</p>
        {order.message ? <p className="mt-2 whitespace-pre-wrap break-words text-stone-700">{order.message}</p> : null}
        {order.deliveryStatus !== 'sent' ? <div className="mt-3 border-l-4 border-amber-400 pl-3 text-amber-950">
          <p>Beställningen är sparad, men mejlet till HusHub är inte bekräftat. Ett nytt försök skapar ingen ny beställning.</p>
          <button type="button" disabled={sending} onClick={() => void submit(true)} className="mt-2 inline-flex min-h-10 items-center gap-2 font-semibold underline disabled:opacity-50"><RefreshCw size={16} />{sending ? 'Skickar...' : 'Försök skicka mejlet igen'}</button>
        </div> : <p className="mt-2 text-stone-700">Beställningen har skickats till HusHub.</p>}
        {error ? <p role="alert" className="mt-2 text-rose-800">{error}</p> : null}
      </div> : null}

      <dialog ref={dialog} aria-labelledby={titleId} aria-describedby={priceId} onCancel={event => { if (sending) event.preventDefault() }}
        className="fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-lg border border-stone-200 bg-white p-0 text-stone-900 shadow-xl backdrop:bg-black/40">
        <form onSubmit={event => { event.preventDefault(); void submit() }} className="p-5 sm:p-6">
          <div className="flex items-start justify-between gap-3">
            <h2 id={titleId} className="text-xl font-semibold">Beställ granskning av byggkonsult</h2>
            <button type="button" autoFocus disabled={sending} aria-label="Stäng" title="Stäng" onClick={() => dialog.current?.close()} className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md hover:bg-stone-100 disabled:opacity-50"><X size={20} /></button>
          </div>
          <p className="mt-3 break-words text-sm text-stone-700">Granskning av ansökan och inskickade underlag för {brfName || 'föreningen'}. Styrelsen fattar fortsatt beslut om ansökan.</p>
          <div className="my-5 border-y border-stone-200 py-4">
            <p id={priceId} className="text-xl font-semibold">Fast pris: {CONSULTANT_REVIEW_PRICE_LABEL}</p>
            <ConsultantReviewScope />
          </div>
          <label className="grid gap-2 text-sm font-semibold">Meddelande till byggkonsulten <span className="font-normal text-stone-500">Frivilligt</span>
            <textarea value={message} onChange={event => setMessage(event.target.value)} maxLength={CONSULTANT_REVIEW_MAX_MESSAGE} rows={4} disabled={sending}
              className="w-full resize-y rounded-md border border-stone-300 px-3 py-2 font-normal focus:outline-2 focus:outline-emerald-700" />
          </label>
          <p className="mt-4 text-sm text-stone-600">Genom att beställa godkänner du kostnaden för föreningens räkning.</p>
          {error ? <p role="alert" className="mt-3 text-sm text-rose-800">{error}</p> : null}
          <div className="mt-5 flex flex-wrap justify-end gap-3 border-t border-stone-200 pt-4">
            <button type="button" disabled={sending} onClick={() => dialog.current?.close()} className="min-h-11 rounded-md border border-stone-300 px-4 py-2 text-sm font-semibold disabled:opacity-50">Avbryt</button>
            <button type="submit" disabled={sending} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-emerald-800 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-900 disabled:opacity-60">
              {sending ? <LoaderCircle size={18} className="animate-spin" aria-hidden="true" /> : <Check size={18} aria-hidden="true" />}{sending ? 'Skickar beställning...' : 'Beställ granskning'}
            </button>
          </div>
        </form>
      </dialog>
    </section>
  )
}
