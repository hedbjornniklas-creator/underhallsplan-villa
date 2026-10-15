'use client'

import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { Check, FileCheck2, RefreshCw, X } from 'lucide-react'
import { useToast } from '@/components/ui/AppToastProvider'
import { comparableObAssignmentValue, formatObAssignmentValue, getObAssignmentChanges, obAssignmentFieldLabels } from '@/lib/ob/assignmentWorkflow'
import type { TuAssignmentWorkflow } from '@/lib/tu/assignmentWorkflow'
import { allowTuAssignmentNavigation, tuActionButton } from './TuAssignmentActions'

export default function TuAssignmentWorkflowBoundary({ initialWorkflow, inspectionId, orgId, children }: {
  initialWorkflow: TuAssignmentWorkflow | null; inspectionId: string; orgId: string; children: ReactNode
}) {
  const [workflow, setWorkflow] = useState(initialWorkflow)
  const [comparison, setComparison] = useState<TuAssignmentWorkflow | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false)
  const dialog = useRef<HTMLDialogElement>(null)
  const heading = useId()
  const toast = useToast()
  const endpoint = `/api/tu/investigations/${encodeURIComponent(inspectionId)}/assignment-workflow?orgId=${encodeURIComponent(orgId)}`
  useEffect(() => {
    const prevent = (event: Event) => { if (inFlight.current) event.preventDefault() }
    window.addEventListener('hushub:before-organization-switch', prevent)
    return () => window.removeEventListener('hushub:before-organization-switch', prevent)
  }, [])

  async function update(openComparison = false, review = false) {
    if (inFlight.current || !allowTuAssignmentNavigation() || (review && (!comparison || !confirmed))) return
    inFlight.current = true; setBusy(true)
    try {
      const response = await fetch(endpoint, review ? {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmed, reviewToken: comparison!.reviewToken }),
      } : { cache: 'no-store' })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload.error || 'Uppdragsstatus kunde inte hämtas.')
      const next = payload.workflow as TuAssignmentWorkflow | null
      setWorkflow(next)
      if (review) {
        dialog.current?.close()
        window.dispatchEvent(new CustomEvent('tu:assignment-workflow-updated'))
        toast.success('Uppdraget är avstämt. Dina texter och fältposter är oförändrade.', { appearance: 'dark' })
      } else if (openComparison && next?.acceptedAt && next.bookedAt && !next.paused && !next.inspectionLocked) {
        setComparison(next); setConfirmed(false); dialog.current?.showModal()
      }
    } catch (error) { toast.error(error, { appearance: 'dark' }) }
    finally { inFlight.current = false; setBusy(false) }
  }

  const changed = comparison ? getObAssignmentChanges(comparison.initialSnapshot, comparison.currentSnapshot) : []
  const fields = comparison ? Object.keys(obAssignmentFieldLabels).filter(key =>
    changed.includes(key) || (comparison.inspectionSnapshot && key in comparison.inspectionSnapshot &&
      comparableObAssignmentValue(key, comparison.inspectionSnapshot[key]) !== comparableObAssignmentValue(key, comparison.currentSnapshot[key]))) : []

  return <>
    {workflow && <section className={`mx-auto mb-4 max-w-7xl rounded-md border p-4 text-slate-900 print:block ${workflow.canDeliver ? 'border-emerald-200 bg-emerald-50' : 'border-amber-300 bg-amber-50'}`} aria-label="Uppdragets godkännande">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base font-semibold">{workflow.canDeliver ? 'Uppdraget är godkänt och avstämt' : workflow.acceptedAt ? 'Kunden har godkänt uppdraget' : 'Startad före kundens godkännande'}</h2>
          {workflow.reason && <p className="mt-1 text-sm">{workflow.reason} Slutleveransen är spärrad.</p>}
        </div>
        <div className="flex flex-wrap gap-2 print:hidden">
          <a href={`/tu/assignments/${encodeURIComponent(workflow.assignmentId)}?orgId=${encodeURIComponent(orgId)}`} className={tuActionButton}
            onClick={event => { if (!allowTuAssignmentNavigation()) event.preventDefault() }}><FileCheck2 size={16} aria-hidden />Uppdragsbekräftelse</a>
          <button type="button" className={tuActionButton} disabled={busy} onClick={() => void update()}><RefreshCw size={16} className={busy ? 'animate-spin' : ''} aria-hidden />Uppdatera status</button>
          {workflow.acceptedAt && workflow.bookedAt && !workflow.paused && !workflow.inspectionLocked && <button type="button" className={tuActionButton} disabled={busy} onClick={() => void update(true)}><Check size={16} aria-hidden />Stäm av uppdraget</button>}
        </div>
      </div>
    </section>}
    <div inert={workflow?.paused || undefined} className={workflow?.paused ? 'opacity-60' : undefined}>{children}</div>
    <dialog ref={dialog} aria-labelledby={heading} onCancel={event => { if (busy) event.preventDefault() }}
      className="m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-4xl overflow-y-auto rounded-lg border border-slate-300 bg-white p-5 text-slate-900 shadow-xl backdrop:bg-black/40">
      <div className="flex items-start justify-between gap-3"><h2 id={heading} className="text-lg font-semibold">Stäm av godkänt uppdrag</h2>
        <button type="button" className={tuActionButton} aria-label="Stäng" disabled={busy} onClick={() => dialog.current?.close()}><X size={18} aria-hidden /></button></div>
      <p className="my-4 text-sm">Kontrollera att utredningen stämmer med kundens godkända uppdrag. Avstämningen ändrar inte uppgifter eller rapporttexter.</p>
      {fields.length ? <div className="space-y-4">{fields.map(key => <div key={key} className="border-b border-slate-200 pb-3">
        <h3 className="mb-2 text-sm font-semibold">{obAssignmentFieldLabels[key]}</h3>
        <dl className="grid gap-3 text-sm sm:grid-cols-3">
          {[['Vid start', comparison?.initialSnapshot[key]], ['Kundens godkända uppgift', comparison?.currentSnapshot[key]], ['Utredningens grunduppgifter', comparison?.inspectionSnapshot?.[key]]].map(([label, value]) =>
            <div key={String(label)} className="min-w-0"><dt className="text-slate-500">{String(label)}</dt><dd className="mt-1 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{formatObAssignmentValue(value ?? null)}</dd></div>)}
        </dl>
      </div>)}</div> : <p className="text-sm">Inga skillnader i de jämförda uppgifterna.</p>}
      <label className="mt-5 flex items-start gap-2 text-sm"><input type="checkbox" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)} className="mt-1" />
        <span>Jag har kontrollerat uppdraget och hanterat eventuella skillnader i utredningen och utlåtandet.</span></label>
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <button type="button" className={tuActionButton} disabled={busy} onClick={() => dialog.current?.close()}>Tillbaka till utredningen</button>
        <button type="button" className={tuActionButton} disabled={busy || !confirmed} onClick={() => void update(false, true)}><Check size={16} aria-hidden />{busy ? 'Sparar…' : 'Bekräfta avstämning'}</button>
      </div>
    </dialog>
  </>
}
