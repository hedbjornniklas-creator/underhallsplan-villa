'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, Check, RefreshCw } from 'lucide-react'
import { formatObAssignmentValue, getObAssignmentChanges, getObAssignmentTransferRows, obAssignmentFieldLabels, obAssignmentTransferFields, type ObAssignmentTransferField, type ObAssignmentWorkflow } from '@/lib/ob/assignmentWorkflow'
import { ObGrunddataWriteError, waitForObGrunddataWrites } from '@/lib/ob/grunddataWrites'

export default function ObAssignmentWorkflowBoundary({ inspectionId, children, onStatusChange, showStatus = true }: {
  inspectionId: string
  children?: ReactNode
  onStatusChange?: (workflow: ObAssignmentWorkflow) => void
  showStatus?: boolean
}) {
  const [workflow, setWorkflow] = useState<ObAssignmentWorkflow | null>()
  const [error, setError] = useState<string | null>(null)
  const [writeError, setWriteError] = useState<string | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [saving, setSaving] = useState(false)
  const [reviewOpen, setReviewOpen] = useState(false)
  const [showUnchanged, setShowUnchanged] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [selected, setSelected] = useState<ObAssignmentTransferField[]>([])
  const [selectionToken, setSelectionToken] = useState<string>()
  const [success, setSuccess] = useState<string | null>(null)
  const posting = useRef(false)
  const requestSequence = useRef(0)
  const load = useCallback(async () => {
    if (posting.current) return
    const sequence = ++requestSequence.current
    setRefreshing(true)
    try {
      try {
        await waitForObGrunddataWrites(inspectionId)
        if (sequence === requestSequence.current) setWriteError(null)
      } catch (failure) {
        if (!(failure instanceof ObGrunddataWriteError)) throw failure
        if (sequence === requestSequence.current) { setWriteError(failure.message); setConfirmed(false) }
        // Still refresh approval/paused state. Failed local saves only block an
        // import, not the user's ability to close the comparison and retry editing.
      }
      if (sequence !== requestSequence.current || posting.current) return
      const response = await fetch(`/api/ob/inspections/${inspectionId}/assignment-workflow`, { cache: 'no-store' })
      const body = await response.json()
      if (sequence !== requestSequence.current) return
      if (!response.ok) throw new Error(body.error)
      setWorkflow(body.workflow)
      setError(null)
      if (body.workflow) onStatusChange?.(body.workflow)
    } catch (failure) {
      if (sequence === requestSequence.current) {
        if (failure instanceof ObGrunddataWriteError) { setWriteError(failure.message); setConfirmed(false) }
        else setError(failure instanceof Error ? failure.message : 'Kunde inte läsa uppdragsstatus.')
      }
    } finally { if (sequence === requestSequence.current) setRefreshing(false) }
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
  useEffect(() => {
    setConfirmed(false)
    setSelected(workflow ? getObAssignmentTransferRows(workflow).filter(row => row.preselected).map(row => row.key) : [])
    setSelectionToken(workflow?.reconciliationToken)
    // Selection is bound to both the customer's version and saved Grunddata.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workflow?.reviewToken, workflow?.reconciliationToken])
  const transferReady = Boolean(workflow?.inspectionSnapshot && workflow.reconciliationToken)
  const reviewDisabled = !transferReady || !confirmed || saving || refreshing || Boolean(error || writeError) ||
    !workflow?.bookedAt || workflow.paused || workflow.inspectionLocked || selectionToken !== workflow.reconciliationToken
  const review = async () => {
    if (!workflow || reviewDisabled || posting.current) return
    const fields = [...selected]
    posting.current = true
    setSaving(true)
    setSuccess(null)
    requestSequence.current += 1
    try {
      await waitForObGrunddataWrites(inspectionId)
      const response = await fetch(`/api/ob/inspections/${inspectionId}/assignment-workflow`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reviewToken: workflow.reviewToken, reconciliationToken: workflow.reconciliationToken, fields, confirmed: true }),
      })
      const body = await response.json()
      if (!response.ok) throw new Error(body.error)
      setWorkflow(body.workflow)
      setError(null)
      setConfirmed(false)
      setReviewOpen(false)
      setSuccess(fields.length ? `${fields.length} ${fields.length === 1 ? 'uppgift har förts' : 'uppgifter har förts'} över till Grunddata. Avstämningen är bekräftad.` : 'Avstämningen är bekräftad. Grunddata har inte ändrats.')
      window.dispatchEvent(new CustomEvent('ob-assignment-reconciled', { detail: { workflow: body.workflow, fields } }))
      window.dispatchEvent(new Event('ob-assignment-workflow-updated'))
      onStatusChange?.(body.workflow)
    } catch (failure) {
      setConfirmed(false)
      if (failure instanceof ObGrunddataWriteError) setWriteError(failure.message)
      else setError(failure instanceof Error ? failure.message : 'Kunde inte spara avstämningen.')
    } finally { posting.current = false; setSaving(false); setRefreshing(false) }
  }
  const changes = workflow ? getObAssignmentChanges(workflow.initialSnapshot, workflow.currentSnapshot) : []
  const rows = workflow ? getObAssignmentTransferRows(workflow) : []
  const manualFields = Object.keys(obAssignmentFieldLabels).filter(key => !(obAssignmentTransferFields as readonly string[]).includes(key))
  return <>
    {workflow === undefined && !error ? <p role="status" className="mb-3 text-sm text-slate-600">Kontrollerar uppdragsstatus...</p> : null}
    {error || writeError ? <div role="alert" className="mb-3 flex items-center gap-2 border-l-4 border-rose-500 bg-rose-50 p-3 text-sm text-rose-800">
      {error || writeError}<button type="button" onClick={() => void load()} disabled={saving || refreshing} title="Uppdatera uppdragsstatus" aria-label="Uppdatera uppdragsstatus" className="ml-auto p-2"><RefreshCw size={18} /></button>
    </div> : null}
    {workflow && showStatus ? <div className={`mb-4 border-l-4 p-3 text-sm ${workflow.canDeliver ? 'border-emerald-600 bg-emerald-50 text-emerald-900' : 'border-amber-500 bg-amber-50 text-amber-950'}`}>
      <div className="flex flex-wrap items-center gap-2">
        {workflow.canDeliver ? <Check size={18} /> : <AlertTriangle size={18} />}
        <strong>{workflow.canDeliver ? 'Uppdrag godkänt och avstämt' : workflow.reason}</strong>
        <Link className="ml-auto underline" href={`/ob/assignments/${workflow.assignmentId}`}>Uppdragsbekräftelse</Link>
      </div>
      <p className="mt-1">Startad före godkännande {new Date(workflow.startedAt).toLocaleString('sv-SE')}. {workflow.startReason}</p>
      {!workflow.canDeliver ? <p className="mt-1">Slutmarkering, låsning och slutligt utlåtande är spärrade.</p> : null}
      {success ? <p role="status" className="mt-2">{success}</p> : null}
      {workflow.acceptedAt ? <details open={reviewOpen} className="mt-3">
        <summary className="cursor-pointer font-medium" onClick={event => {
          event.preventDefault()
          if (saving) return
          setReviewOpen(!reviewOpen)
          if (!reviewOpen) { setSuccess(null); void load() }
        }}>{workflow.needsReview ? `Stäm av kundens uppgifter (${changes.length} ändrade sedan start)` : 'Jämför kundens uppgifter med Grunddata'}</summary>
        <p className="mt-3">Välj vilka kunduppgifter som ska föras över. Tomma fält i Grunddata är förvalda. Befintliga värden behålls om du inte väljer dem.</p>
        {refreshing ? <p role="status" className="mt-2">Hämtar aktuell jämförelse...</p> : null}
        {!transferReady ? <p className="mt-3 rounded bg-white p-3">Överföringen är inte aktiverad på servern ännu. Inga uppgifter kan föras över eller bekräftas här förrän uppdateringen är installerad.</p> : <>
          <div className="mt-3 hidden grid-cols-4 gap-3 px-2 py-1 text-xs font-semibold sm:grid" aria-hidden="true">
            <span>Uppgift</span><span>Grunddata nu</span><span>Kundens uppgift</span><span>Val</span>
          </div>
          <dl className="mt-2 divide-y divide-emerald-200 text-sm sm:mt-0">
            {rows.filter(row => row.differs || showUnchanged).map(row => <div key={row.key} className={`grid grid-cols-2 gap-3 p-3 sm:grid-cols-4 ${row.differs ? 'bg-white/75' : ''}`}>
              <dt className="col-span-2 min-w-0 font-semibold [overflow-wrap:anywhere] sm:col-span-1">{obAssignmentFieldLabels[row.key]}</dt>
              <dd className="min-w-0 [overflow-wrap:anywhere]"><span className="block text-xs font-medium sm:sr-only">Grunddata nu: </span>{formatObAssignmentValue(row.before)}</dd>
              <dd className="min-w-0 [overflow-wrap:anywhere]"><span className="block text-xs font-medium sm:sr-only">Kundens uppgift: </span>{formatObAssignmentValue(row.after)}</dd>
              <dd className="col-span-2 min-w-0 sm:col-span-1">{row.canTransfer ? <label className="flex min-h-11 cursor-pointer items-center gap-2">
                <input type="checkbox" aria-label={`Använd kundens uppgift: ${obAssignmentFieldLabels[row.key]}`} checked={selected.includes(row.key)}
                  disabled={saving || refreshing || Boolean(error) || workflow.inspectionLocked || workflow.paused}
                  onChange={event => { setConfirmed(false); setSelected(current => event.target.checked ? [...current, row.key] : current.filter(key => key !== row.key)) }} />
                <span>Använd kundens uppgift<span className="block text-xs">{selected.includes(row.key) ? 'Förs över när du bekräftar' : 'Grunddata behålls'}</span></span>
              </label> : <span className="text-xs">{row.differs ? 'Ingen kunduppgift att föra över' : 'Samma uppgift'}</span>}</dd>
            </div>)}
          </dl>
          {!rows.some(row => row.differs) ? <p className="mt-2">Grunddata stämmer redan överens med kundens uppgifter.</p> : null}
          {rows.some(row => !row.differs) ? <label className="mt-2 flex min-h-11 cursor-pointer items-center gap-2 text-xs">
            <input type="checkbox" checked={showUnchanged} onChange={event => setShowUnchanged(event.target.checked)} />
            Visa oförändrade uppgifter ({rows.filter(row => !row.differs).length})
          </label> : null}
        </>}
        <h3 className="mt-5 font-semibold">Omfattning, pris och villkor</h3>
        <p className="mt-1">Uppgifterna nedan förs inte över till Grunddata. Kontrollera särskilt omfattning och tillägg mot besiktningen och hantera eventuella skillnader där innan du bekräftar.</p>
        <dl className="mt-2 divide-y divide-emerald-200 text-xs">
          {manualFields.map(key => <div key={key} className={`grid gap-2 p-2 sm:grid-cols-3 ${changes.includes(key) ? 'bg-amber-100' : ''}`}>
            <dt className="font-semibold">{obAssignmentFieldLabels[key]}</dt>
            <dd className="min-w-0 [overflow-wrap:anywhere]">Vid start: {formatObAssignmentValue(workflow.initialSnapshot[key])}</dd>
            <dd className="min-w-0 [overflow-wrap:anywhere]">Aktuell: {formatObAssignmentValue(workflow.currentSnapshot[key])}</dd>
          </div>)}
        </dl>
        {selected.includes('preferred_date') ? <p className="mt-3">Uppdragsnumret anpassas till den valda besiktningsdagen om det inte redan stämmer med datumet.</p> : null}
        {workflow.inspectionLocked ? <p className="mt-3 font-medium">Besiktningen är låst eller slutmarkerad. Grunddata kan inte uppdateras här.</p> : null}
        <label className="mt-4 flex min-h-11 items-center gap-2"><input type="checkbox" aria-label="Bekräfta avstämningen" checked={confirmed} onChange={event => setConfirmed(event.target.checked)}
          disabled={saving || refreshing || Boolean(error || writeError) || !transferReady || workflow.inspectionLocked || workflow.paused} />
          Jag har granskat mina val och stämt av omfattning och tillägg. Endast markerade uppgifter ska uppdateras i Grunddata.
        </label>
        <button type="button" onClick={() => void review()} disabled={reviewDisabled}
          className="mt-3 inline-flex min-h-11 max-w-full items-center gap-2 rounded-lg border border-emerald-700 bg-emerald-700 px-3 py-2 text-left font-medium text-white hover:bg-emerald-800 disabled:border-emerald-200 disabled:bg-emerald-50 disabled:text-emerald-800">
          <Check size={16} className="shrink-0" />{saving ? 'Sparar...' : selected.length ? 'Uppdatera Grunddata och bekräfta avstämning' : 'Bekräfta avstämning'}
        </button>
      </details> : null}
    </div> : null}
    {children ? <fieldset className="min-w-0 border-0 p-0" disabled={workflow === undefined || Boolean(error) || workflow?.paused || saving || (showStatus && reviewOpen)}>{children}</fieldset> : null}
  </>
}
