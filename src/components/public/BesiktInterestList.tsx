'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { INTEREST_STATUSES, TRACKING_PAGE_SIZE, type InterestStatus, type TrackedInterest } from '@/lib/besiktapp/interestTrackingContracts'

const fieldClass = 'w-full rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm'
function RequestEditor({ item, onSaved }: { item: TrackedInterest; onSaved: (item: TrackedInterest) => void }) {
  const [status, setStatus] = useState(item.status)
  const [owner, setOwner] = useState(item.owner_name)
  const [date, setDate] = useState(item.follow_up_on ?? '')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const inFlight = useRef(false)
  async function save(event: FormEvent) {
    event.preventDefault()
    if (inFlight.current) return
    inFlight.current = true; setBusy(true); setError(''); setMessage('')
    try {
      const response = await fetch('/api/admin/besiktapp-interest', { method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.id, status, owner_name: owner, follow_up_on: date || null, revision: item.revision }) })
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || 'Kunde inte spara.')
      onSaved(result.item); setMessage('Sparat.')
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Kunde inte spara.') }
    finally { inFlight.current = false; setBusy(false) }
  }
  return (
    <article className="rounded-xl border border-stone-200 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 className="text-lg font-semibold">{item.name}</h2><p className="text-sm text-stone-600">{item.company || 'Företag ej angivet'}</p></div>
        <p className="text-sm text-stone-600">Inkommen {new Date(item.created_at).toLocaleDateString('sv-SE')}</p>
      </div>
      <p className="mt-3 break-all"><a className="text-blue-800 underline" href={`mailto:${item.email}`}>{item.email}</a></p>
      {item.phone && <p className="text-sm">Telefon: {item.phone}</p>}
      {item.message && <p className="mt-3 whitespace-pre-wrap break-words text-sm text-stone-700">{item.message}</p>}
      {item.notification_state !== 'accepted' && <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{item.notification_state === 'failed' ? 'Mejlaviseringen misslyckades. Förfrågan är sparad här och kan följas upp.' : 'Mejlaviseringen är inte bekräftad. Förfrågan är sparad här.'}</p>}
      <form onSubmit={save} className="mt-4 border-t border-stone-200 pt-4">
        <fieldset disabled={busy} className="grid gap-3 sm:grid-cols-3">
          <label className="text-sm">Status<select className={fieldClass} value={status} onChange={event => setStatus(event.target.value as InterestStatus)}>{Object.entries(INTEREST_STATUSES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
          <label className="text-sm">Ansvarig hos oss<input className={fieldClass} value={owner} maxLength={120} onChange={event => setOwner(event.target.value)} /></label>
          <label className="text-sm">Följ upp den<input type="date" className={fieldClass} value={date} onChange={event => setDate(event.target.value)} /></label>
        </fieldset>
        <p className="mt-2 text-xs text-stone-500">Status är en intern anteckning. Den skapar inget konto, ger ingen behörighet och skickar inget mejl.</p>
        <button disabled={busy} className="mt-3 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Sparar…' : 'Spara uppföljning'}</button>
        {error && <p role="alert" className="mt-2 text-sm text-red-800">{error}</p>}
        {message && <p role="status" className="mt-2 text-sm text-green-800">{message}</p>}
      </form>
    </article>
  )
}

export default function BesiktInterestList() {
  const [filter, setFilter] = useState('new')
  const [page, setPage] = useState(0)
  const [reload, setReload] = useState(0)
  const [items, setItems] = useState<TrackedInterest[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    async function load() {
      setLoading(true); setError('')
      try {
        const response = await fetch(`/api/admin/besiktapp-interest?status=${filter}&page=${page}`, { signal: controller.signal, cache: 'no-store' })
        const result = await response.json()
        if (!response.ok) throw new Error(result.error || 'Kunde inte läsa listan.')
        if (!controller.signal.aborted) { setItems(result.items); setTotal(result.total) }
      } catch (failure) {
        if (!controller.signal.aborted) { setItems([]); setError(failure instanceof Error ? failure.message : 'Kunde inte läsa listan.') }
      } finally { if (!controller.signal.aborted) setLoading(false) }
    }
    void load()
    return () => controller.abort()
  }, [filter, page, reload])
  return (
    <main className="mx-auto max-w-5xl px-5 py-8 text-stone-900">
      <Link href="/admin/access" className="text-sm underline">Till accesshanteringen</Link>
      <h1 className="mt-5 text-3xl font-semibold">Intresse för BesiktApp</h1>
      <p className="mt-3 text-stone-600">Följ upp nya kontakter. Konton och tillgång till tjänsten hanteras separat.</p>
      <div className="my-6 flex flex-wrap items-end gap-4">
        <label className="text-sm">Visa status<select value={filter} className={fieldClass} onChange={event => { setFilter(event.target.value); setPage(0) }}><option value="all">Alla</option>{Object.entries(INTEREST_STATUSES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        <button className="rounded-lg border border-stone-300 px-4 py-2 text-sm" onClick={() => setReload(value => value + 1)}>Hämta listan igen</button>
      </div>
      {loading ? <p role="status">Hämtar förfrågningar…</p> : error ? <p role="alert" className="rounded-xl bg-amber-50 p-5">{error}</p> : <>
        <p className="mb-3 text-sm text-stone-600">Antal med valt filter: {total}. Sparade statusändringar syns i filtret nästa gång listan hämtas.</p>
        {items.length === 0 ? <p>Inga förfrågningar på den här sidan.</p> : <div className="grid gap-4">{items.map(item => <RequestEditor key={item.id} item={item} onSaved={updated => setItems(previous => previous.map(row => row.id === updated.id ? updated : row))} />)}</div>}
        <nav aria-label="Sidor i intresselistan" className="mt-5 flex items-center gap-4">
          <button disabled={page === 0} onClick={() => setPage(value => value - 1)} className="rounded-lg border px-3 py-2 disabled:opacity-40">Föregående</button>
          <span>Sida {page + 1}</span>
          <button disabled={(page + 1) * TRACKING_PAGE_SIZE >= total} onClick={() => setPage(value => value + 1)} className="rounded-lg border px-3 py-2 disabled:opacity-40">Nästa</button>
        </nav>
      </>}
    </main>
  )
}
