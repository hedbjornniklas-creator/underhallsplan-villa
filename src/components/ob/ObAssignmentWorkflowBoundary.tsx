'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, Check, RefreshCw } from 'lucide-react'
import { formatObAssignmentValue, getObAssignmentChanges, obAssignmentFieldLabels, type ObAssignmentWorkflow } from '@/lib/ob/assignmentWorkflow'

export default function ObAssignmentWorkflowBoundary({ inspectionId, children, onStatusChange }: {
  inspectionId: string
  children?: ReactNode
  onStatusChange?: (workflow: ObAssignmentWorkflow) => void
}) {
  const [workflow, setWorkflow] = useState<ObAssignmentWorkflow | null>()
  const [error, setError] = useState<string | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [saving, setSaving] = useState(false)
  const requestSequence = useRef(0)
  const load = useCallback(async () => {
    const sequence = ++requestSequence.current
    try {
      const response = await fetch(`/api/ob/inspections/${inspectionId}/assignment-workflow`, { cache: 'no-store' })
      const body = await response.json()
      if (sequence !== requestSequence.current) return
      if (!response.ok) throw new Error(body.error)
      setWorkflow(body.workflow)
      setError(null)
      if (body.workflow) onStatusChange?.(body.workflow)
    } catch (failure) {
      if (sequence === requestSequence.current) setError(failure instanceof Error ? failure.message : 'Kunde inte läsa uppdragsstatus.')
    }
  }, [inspectionId, onStatusChange])
  useEffect(() => {
    void load()
    const refresh = () => { if (document.visibilityState === 'visible') void load() }
    window.addEventListener('focus', refresh)
    window.addEventListener('ob-assignment-workflow-updated', refresh)
    const timer = window.setInterval(refresh, 30000)
    return () => {
      requestSequence.current += 1
      window.removeEventListener('focus', refresh)
      window.removeEventListener('ob-assignment-workflow-updated', refresh)
      window.clearInterval(timer)
    }
  }, [load])
  useEffect(() => { setConfirmed(false) }, [workflow?.reviewToken])
  const review = async () => {
    if (!workflow || !confirmed || saving) return
    setSaving(true)
    requestSequence.current += 1
    try {
      const response = await fetch(`/api/ob/inspections/${inspectionId}/assignment-workflow`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewToken: workflow.reviewToken, confirmed: true }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error)
      setWorkflow(body.workflow)
      setError(null)
      window.dispatchEvent(new Event('ob-assignment-workflow-updated'))
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Kunde inte spara avstämningen.') }
    finally { setSaving(false) }
  }
  const changes = workflow ? getObAssignmentChanges(workflow.initialSnapshot, workflow.currentSnapshot) : []
  return <>
    {workflow === undefined && !error ? <p role="status" className="mb-3 text-sm text-slate-600">Kontrollerar uppdragsstatus...</p> : null}
    {error ? <div role="alert" className="mb-3 flex items-center gap-2 border-l-4 border-rose-500 bg-rose-50 p-3 text-sm text-rose-800">
      {error}<button type="button" onClick={() => void load()} title="Uppdatera uppdragsstatus" aria-label="Uppdatera uppdragsstatus" className="ml-auto p-2"><RefreshCw size={18} /></button>
    </div> : null}
    {workflow ? <div className={`mb-4 border-l-4 p-3 text-sm ${workflow.canDeliver ? 'border-emerald-600 bg-emerald-50 text-emerald-900' : 'border-amber-500 bg-amber-50 text-amber-950'}`}>
      <div className="flex flex-wrap items-center gap-2">
        {workflow.canDeliver ? <Check size={18} /> : <AlertTriangle size={18} />}
        <strong>{workflow.canDeliver ? 'Uppdrag godkänt och avstämt' : workflow.reason}</strong>
        <Link className="ml-auto underline" href={`/ob/assignments/${workflow.assignmentId}`}>Uppdragsbekräftelse</Link>
      </div>
      <p className="mt-1">Startad före godkännande {new Date(workflow.startedAt).toLocaleString('sv-SE')}. {workflow.startReason}</p>
      {!workflow.canDeliver ? <p className="mt-1">Slutmarkering, låsning och slutligt utlåtande är spärrade.</p> : null}
      {workflow.acceptedAt && workflow.needsReview ? <details className="mt-3">
        <summary className="cursor-pointer font-medium">Stäm av kundens uppgifter ({changes.length} ändrade fält)</summary>
        <div className="mt-2 hidden grid-cols-3 gap-3 px-2 py-1 text-xs font-semibold sm:grid" aria-hidden="true">
          <span>Uppgift</span><span>Vid start</span><span>Aktuell uppdragsbekräftelse</span>
        </div>
        <dl className="mt-2 divide-y divide-amber-200 text-xs sm:mt-0">
          {Object.entries(obAssignmentFieldLabels).map(([key, label]) => <div key={key}
            className={`grid grid-cols-2 gap-2 p-2 sm:grid-cols-3 sm:gap-3 ${changes.includes(key) ? 'bg-amber-100' : ''}`}>
            <dt className="col-span-2 min-w-0 font-semibold [overflow-wrap:anywhere] sm:col-span-1">{label}</dt>
            <dd className="min-w-0 [overflow-wrap:anywhere]"><span className="block font-medium sm:sr-only">Vid start: </span>{formatObAssignmentValue(workflow.initialSnapshot[key])}</dd>
            <dd className="min-w-0 [overflow-wrap:anywhere]"><span className="block font-medium sm:sr-only">Aktuell: </span>{formatObAssignmentValue(workflow.currentSnapshot[key])}</dd>
          </div>)}
        </dl>
        <label className="mt-3 flex items-start gap-2"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} disabled={saving} />
          Jag har stämt av kundens uppgifter, omfattning och tillägg mot besiktningen och hanterat eventuella skillnader.
        </label>
        <button type="button" onClick={() => void review()} disabled={!confirmed || saving || !workflow.bookedAt || workflow.paused}
          className="mt-3 inline-flex items-center gap-2 rounded-lg border border-emerald-700 bg-emerald-700 px-3 py-2 font-medium text-white hover:bg-emerald-800 disabled:border-emerald-200 disabled:bg-emerald-50 disabled:text-emerald-800">
          <Check size={16} />{saving ? 'Sparar...' : 'Bekräfta avstämning'}
        </button>
      </details> : null}
    </div> : null}
    {children ? <fieldset className="min-w-0 border-0 p-0" disabled={workflow === undefined || Boolean(error) || workflow?.paused}>{children}</fieldset> : null}
  </>
}
