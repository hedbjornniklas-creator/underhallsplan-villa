'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { Loader2, Play } from 'lucide-react'
import { useToast } from '@/components/ui/AppToastProvider'
import type { TuReportTemplateOption } from '@/lib/tu/server'
import { allowTuAssignmentNavigation, tuActionButton } from './TuAssignmentActions'

export default function TuAssignmentStartDialog({ assignmentId, organizationId, templates, onStarted, onChanged, early = false }: {
  assignmentId: string; organizationId: string; templates: TuReportTemplateOption[]
  early?: boolean
  onStarted: (path: string) => void; onChanged: () => void | Promise<void>
}) {
  const toast = useToast()
  const dialog = useRef<HTMLDialogElement>(null)
  const heading = useId()
  const [template, setTemplate] = useState('')
  const [busy, setBusy] = useState(false)
  const [reason, setReason] = useState('')
  const [confirmed, setConfirmed] = useState(false)
  const inFlight = useRef(false)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => {
    if (!busy) return
    const prevent = (event: Event) => event.preventDefault()
    window.addEventListener('hushub:before-organization-switch', prevent)
    return () => window.removeEventListener('hushub:before-organization-switch', prevent)
  }, [busy])
  const start = async () => {
    if (inFlight.current || !template || (early && (!confirmed || reason.trim().length < 5 || reason.trim().length > 1000))) return
    inFlight.current = true; setBusy(true)
    try {
      const encodedId = encodeURIComponent(assignmentId)
      const response = await fetch(`/api/tu/assignments/${encodedId}/convert`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId: organizationId, reportTemplateKey: template, ...(early ? { earlyStartReason: reason.trim(), confirmEarlyStart: confirmed } : {}) }),
      }).catch(() => { throw new Error('Kunde inte bekräfta att utredningen startades. Uppdatera status innan du försöker igen.') })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || !payload.inspectionId) throw new Error(payload.error || 'Kunde inte starta utredningen.')
      if (!mounted.current) return
      dialog.current?.close()
      onStarted(`/tu/investigations/${encodeURIComponent(payload.inspectionId)}?orgId=${encodeURIComponent(organizationId)}`)
    } catch (error) { if (mounted.current) { toast.error(error, { appearance: 'dark' }); dialog.current?.close(); await onChanged() } }
    finally { inFlight.current = false; if (mounted.current) setBusy(false) }
  }
  return <>
    <button type="button" className={tuActionButton} onClick={() => { if (allowTuAssignmentNavigation()) dialog.current?.showModal() }}><Play size={16} aria-hidden />{early ? 'Starta före godkännande' : 'Starta utredning'}</button>
    <dialog ref={dialog} aria-labelledby={heading} onCancel={event => { if (busy) event.preventDefault() }} className="m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-lg border border-slate-300 bg-white p-5 text-slate-900 shadow-xl backdrop:bg-black/40">
      <h2 id={heading} className="mb-4 text-lg font-semibold">{early ? 'Starta före godkännande' : 'Starta utredning'}</h2>
      <label className="block text-sm">Mall för utlåtandet<select value={template} disabled={busy} onChange={event => setTemplate(event.target.value)} className="mt-1 min-h-11 w-full rounded-md border border-slate-300 bg-white px-3"><option value="">Välj mall</option>{templates.map(item => <option key={item.key} value={item.key}>{item.title}</option>)}</select></label>
      {!templates.length && <p className="mt-2 text-sm text-amber-800">Inga aktiva mallar kunde hämtas. Uppdatera sidan.</p>}
      {early && <div className="mt-4 space-y-3 text-sm">
        <label className="block">Anledning<textarea value={reason} disabled={busy} maxLength={1000} onChange={event => setReason(event.target.value)} className="mt-1 min-h-24 w-full rounded-md border border-slate-300 p-3" /></label>
        <label className="flex items-start gap-2"><input type="checkbox" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)} className="mt-1" /><span>Jag startar arbetet utan kundens godkännande. Utlåtandet får inte fastställas eller skickas förrän godkännande, uppdragsaccept och avstämning är klara.</span></label>
      </div>}
      <div className="mt-5 flex flex-wrap justify-end gap-2"><button type="button" className={tuActionButton} disabled={busy} onClick={() => dialog.current?.close()}>Avbryt</button><button type="button" className={`${tuActionButton} !border-violet-600 !bg-violet-600 !text-white`} disabled={!template || busy || (early && (!confirmed || reason.trim().length < 5))} onClick={() => void start()}>{busy ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Play size={16} aria-hidden />}{busy ? 'Startar…' : early ? 'Starta före godkännande' : 'Starta utredning'}</button></div>
    </dialog>
  </>
}
