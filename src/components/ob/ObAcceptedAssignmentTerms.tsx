'use client'

import { useEffect, useRef, useState } from 'react'
import { Download, RefreshCw, Send } from 'lucide-react'
import ActionButton from '@/components/ui/ActionButton'
import { useToast } from '@/components/ui/AppToastProvider'
import type { AcceptedObTerms } from '@/lib/assignments/acceptedObTerms'

type TermsResponse = AcceptedObTerms & {
  confirmationDelivery?: 'sent' | 'failed' | 'pending' | 'not_sent' | 'unknown'
  canRetryDelivery?: boolean
}
type State = { loading: boolean; data: TermsResponse | null; error: string | null }

const unavailableText = {
  not_accepted: 'Kundens godkännande är inte registrerat för denna uppdragsbekräftelse.',
  missing_reference:
    'Det sparade godkännandet saknar villkorsversion eller kontrollsumma. Därför kan rätt villkorstext inte verifieras. Kontrollera kundens bekräftelsekopia. Godkännandet har inte ändrats.',
  unavailable_version:
    'Den godkända villkorstexten finns inte i programmets tillgängliga versioner. Nyare villkor visas inte som ersättning. Kontrollera kundens bekräftelsekopia. Godkännandet har inte ändrats.',
}

export default function ObAcceptedAssignmentTerms({ assignmentId }: { assignmentId: string }) {
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<State>({ loading: true, data: null, error: null })
  const [downloading, setDownloading] = useState(false)
  const downloadRequest = useRef<AbortController | null>(null)
  const resendRequest = useRef(false)
  const [resending, setResending] = useState(false)
  const toast = useToast()

  useEffect(() => () => { downloadRequest.current?.abort() }, [])

  async function retryDelivery() {
    if (resendRequest.current) return
    resendRequest.current = true
    setResending(true)
    try {
      const response = await fetch(`/api/ob/assignments/${encodeURIComponent(assignmentId)}/confirmation`, { method: 'POST' })
      if (!response.ok) throw new Error('SEND_FAILED')
      toast.success('Bekräftelsemejlet har skickats till beställaren.')
    } catch {
      toast.error('Bekräftelsemejlet kunde inte skickas. Godkännandet och den låsta kopian finns kvar.')
    } finally {
      resendRequest.current = false
      setResending(false)
      setAttempt(value => value + 1)
    }
  }

  async function downloadPdf() {
    if (downloadRequest.current) return
    const controller = new AbortController()
    downloadRequest.current = controller
    setDownloading(true)
    let failureMessage = 'PDF-kopian kunde inte hämtas. Försök igen.'
    try {
      const response = await fetch(`/api/ob/assignments/${encodeURIComponent(assignmentId)}/pdf`, {
        cache: 'no-store', signal: controller.signal,
      })
      if (!response.ok) {
        const payload = await response.json().catch(() => null)
        if (typeof payload?.error === 'string') failureMessage = payload.error
        throw new Error(failureMessage)
      }
      if (!response.headers.get('content-type')?.startsWith('application/pdf')) throw new Error(failureMessage)
      const blob = await response.blob()
      if (controller.signal.aborted) return
      if (!blob.size) throw new Error(failureMessage)
      const objectUrl = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = objectUrl
      link.download = response.headers.get('content-disposition')?.match(/filename="([a-z0-9._-]+)"/i)?.[1] ?? 'Uppdragsbekraftelse-OB.pdf'
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000)
      toast.success('PDF-kopian är klar för nedladdning.')
    } catch {
      if (!controller.signal.aborted) toast.error(failureMessage)
    } finally {
      downloadRequest.current = null
      if (!controller.signal.aborted) setDownloading(false)
    }
  }

  useEffect(() => {
    const controller = new AbortController()
    let active = true
    async function load() {
      setState(previous => ({ loading: true, data: null, error: previous.error }))
      let errorMessage = 'Villkoren kunde inte hämtas. Försök igen.'
      try {
        const response = await fetch(`/api/ob/assignments/${encodeURIComponent(assignmentId)}/terms`, {
          cache: 'no-store',
          signal: controller.signal,
        })
        if (!response.ok) {
          if (response.status === 401) errorMessage = 'Logga in igen för att läsa villkoren.'
          throw new Error(errorMessage)
        }
        const data = await response.json() as TermsResponse
        if (active) setState({ loading: false, data, error: null })
      } catch {
        if (active) setState({
          loading: false, data: null,
          error: errorMessage,
        })
      }
    }
    void load()
    return () => { active = false; controller.abort() }
  }, [assignmentId, attempt])

  return (
    <section id="approved-terms" aria-labelledby="approved-terms-title"
      className="min-w-0 scroll-mt-24 space-y-4 border-t border-gray-200 bg-white px-4 py-5 text-gray-900 md:px-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="approved-terms-title" className="text-lg font-semibold">Godkända villkor</h2>
        {state.data ? <ActionButton tone="secondary" busy={downloading} busyLabel="Hämtar PDF..."
          icon={<Download className="h-4 w-4" aria-hidden="true" />} onClick={() => void downloadPdf()}
          title="Hämta den arkiverade originalfilen utan ändringar"
          className="min-h-11 rounded-md px-3 py-2 text-sm">Ladda ner PDF</ActionButton> : null}
      </div>
      {state.data?.confirmationDelivery ? (
        <div className="space-y-2 text-sm" role="status">
          {state.data.confirmationDelivery === 'sent' ? <p className="text-gray-600">Bekräftelsemejlet med PDF har skickats till beställaren.</p> : null}
          {state.data.confirmationDelivery === 'pending' ? <p className="text-gray-600">Bekräftelsemejlet har ännu inte fått en utskicksbekräftelse.</p> : null}
          {state.data.confirmationDelivery === 'unknown' ? <p className="text-amber-900">Mejlets utskicksstatus kunde inte kontrolleras.</p> : null}
          {['failed', 'not_sent'].includes(state.data.confirmationDelivery) ?
            <p className="text-amber-900">Godkännandet är sparat, men utskicket av bekräftelsemejlet med PDF kunde inte bekräftas.</p> : null}
          {['failed', 'not_sent', 'pending'].includes(state.data.confirmationDelivery) && state.data.canRetryDelivery ?
            <ActionButton tone="secondary" busy={resending} busyLabel="Skickar..."
              icon={<Send className="h-4 w-4" aria-hidden="true" />} onClick={() => void retryDelivery()}
              className="min-h-11 rounded-md px-3 py-2 text-sm">Försök skicka igen</ActionButton> : null}
        </div>
      ) : null}
      {state.loading && !state.error ? <p role="status" className="text-sm text-gray-600">Hämtar villkor...</p> : null}
      {state.error ? (
        <div className="space-y-2">
          {!state.loading ? <p role="alert" className="text-sm text-red-800">{state.error}</p> : null}
          <ActionButton tone="secondary" busy={state.loading} busyLabel="Hämtar villkor..."
            icon={<RefreshCw className="h-4 w-4" aria-hidden="true" />}
            className="min-h-11 rounded-md px-3 py-2 text-sm" onClick={() => {
              setState(previous => ({ ...previous, loading: true }))
              setAttempt(value => value + 1)
            }}>Försök igen</ActionButton>
        </div>
      ) : null}
      {state.data?.available === false ? (
        <div className="space-y-2 text-sm">
          {state.data.version ? <p>Villkorsversion: {state.data.version}</p> : null}
          <p role="status" className="text-amber-900">{unavailableText[state.data.reason]}</p>
        </div>
      ) : null}
      {state.data?.available ? (
        <>
          <p className="text-sm text-gray-600">
            Godkända av kunden {new Date(state.data.acceptedAt).toLocaleString('sv-SE', { timeZone: 'Europe/Stockholm' })}
            {' · '}Version {state.data.document.version}
          </p>
          <div tabIndex={0} role="region" aria-label="Godkänd villkorstext"
            className="max-h-[36rem] overflow-y-auto whitespace-pre-wrap break-words border-y border-gray-200 py-4 text-sm leading-6 focus-visible:outline-2 focus-visible:outline-blue-700">
            {state.data.document.text}
          </div>
        </>
      ) : null}
    </section>
  )
}
