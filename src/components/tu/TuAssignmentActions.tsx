'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { Archive, ArchiveRestore, Ban, Check, CopyPlus, Loader2, Mail, MoreHorizontal, Play, X } from 'lucide-react'
import { useToast } from '@/components/ui/AppToastProvider'
import { canStartTuBeforeApproval, canTuAssignmentAction, TU_ACTION_LABELS, tuSendLabel, type TuAssignmentAction, type TuProgressAssignment } from '@/lib/tu/assignmentProgress'

export const tuActionButton = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50'
export function allowTuAssignmentNavigation() {
  return window.dispatchEvent(new CustomEvent('hushub:before-organization-switch', { cancelable: true }))
}

type ActionAssignment = TuProgressAssignment & { org_id: string; updated_at: string; customer_email: string; customer_name?: string | null }
const icons = { send: Mail, book: Check, receipt: Mail, bookingReceipt: Mail, reissue: CopyPlus, cancel: Ban, archive: Archive, restore: ArchiveRestore }
const actionOrder: TuAssignmentAction[] = ['send', 'book', 'receipt', 'bookingReceipt', 'reissue', 'cancel', 'archive', 'restore']

export function tuActionConfirmation(action: TuAssignmentAction, assignment: ActionAssignment) {
  const recipient = assignment.customer_email
  switch (action) {
    case 'send': return assignment.status === 'draft'
      ? `Skicka uppdragsbekräftelsen till ${recipient} för kundens godkännande?`
      : `Skicka uppdragsbekräftelsen till ${recipient} med en ny godkännandelänk? Den tidigare oanvända länken slutar fungera.`
    case 'book': return `Acceptera uppdraget och skicka en bekräftelse till ${recipient}? Kundens godkännande finns redan registrerat.`
    case 'receipt': return `Skicka bekräftelsen på kundens godkännande till ${recipient} igen? Inget nytt godkännande begärs och uppdragets status ändras inte.`
    case 'bookingReceipt': return `Meddela ${recipient} igen att besiktningsmannen har accepterat uppdraget? Uppdragets status ändras inte.`
    case 'reissue': return 'Skapa ett nytt redigerbart utkast? Den tidigare uppdragsbekräftelsen avbokas och dess oanvända länk stängs. Tidigare godkännande finns kvar i historiken men gäller inte det nya utkastet. Inget mejl skickas förrän du väljer att skicka den nya versionen.' +
      (assignment.progress?.earlyStarted ? ' Utredningen och allt arbetsmaterial behålls. Arbetet pausas tills den nya bekräftelsen har skickats.' : '')
    case 'cancel': return 'Avboka uppdraget och flytta bekräftelsen till arkivet? Kundens oanvända godkännandelänk stängs. En befintlig utredning eller rapport raderas inte. Inget kundmejl skickas; meddela kunden separat.'
    case 'archive': return 'Flytta uppdragsbekräftelsen till arkivet? Ingen utredning eller rapport raderas.'
    case 'restore': return 'Återför bekräftelsen till listan? En tidigare avbokning ändras inte och ingen kundlänk öppnas igen.'
  }
}

export default function TuAssignmentActions({ assignment, compact = false, disabled = false, onChanged, onNavigate, onStart }: {
  assignment: ActionAssignment; compact?: boolean; disabled?: boolean
  onChanged: () => void | Promise<void>; onNavigate: (path: string) => void; onStart?: () => void
}) {
  const toast = useToast()
  const dialog = useRef<HTMLDialogElement>(null)
  const heading = useId()
  const [selected, setSelected] = useState<TuAssignmentAction | null>(null)
  const [busy, setBusy] = useState(false)
  const inFlight = useRef(false)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => {
    if (!busy) return
    const prevent = (event: Event) => event.preventDefault()
    window.addEventListener('hushub:before-organization-switch', prevent)
    return () => window.removeEventListener('hushub:before-organization-switch', prevent)
  }, [busy])
  const allowed = actionOrder.filter(action => canTuAssignmentAction(assignment, action))
  const label = (action: TuAssignmentAction) => action === 'send' ? tuSendLabel(assignment) : TU_ACTION_LABELS[action]
  const open = (action: TuAssignmentAction | null) => {
    if (disabled || inFlight.current || !allowTuAssignmentNavigation()) return
    setSelected(action)
    dialog.current?.showModal()
  }
  const close = () => { if (!inFlight.current) { dialog.current?.close(); setSelected(null) } }
  const execute = async () => {
    if (!selected || inFlight.current || !canTuAssignmentAction(assignment, selected) || !allowTuAssignmentNavigation()) return
    inFlight.current = true
    setBusy(true)
    let destination: string | null = null
    try {
      const response = await fetch(`/api/tu/assignments/${encodeURIComponent(assignment.id)}/actions?orgId=${encodeURIComponent(assignment.org_id)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: selected, expectedUpdatedAt: assignment.updated_at }),
      }).catch(() => { throw new Error('Kunde inte bekräfta resultatet. Uppdatera status och kontrollera utskicken innan du försöker igen.') })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(payload.error || 'Åtgärden kunde inte slutföras. Uppdatera status.')
      if (!mounted.current) return
      if (payload.warning) toast.warning(payload.message, { appearance: 'dark' })
      else toast.success(payload.message, { appearance: 'dark' })
      if (typeof payload.draftId === 'string') destination = `/tu/assignments/${encodeURIComponent(payload.draftId)}?orgId=${encodeURIComponent(assignment.org_id)}`
    } catch (error) { if (mounted.current) toast.error(error, { appearance: 'dark' }) }
    finally {
      inFlight.current = false
      if (mounted.current) {
        setBusy(false)
        dialog.current?.close()
        setSelected(null)
        if (destination) onNavigate(destination)
        else await onChanged()
      }
    }
  }
  const buttons = (inDialog = false) => <div className="flex flex-wrap gap-2">
    {onStart && <button type="button" className={tuActionButton} disabled={disabled || busy} onClick={() => { close(); if (allowTuAssignmentNavigation()) onStart() }}><Play size={16} aria-hidden />{canStartTuBeforeApproval(assignment) ? 'Starta före godkännande' : 'Starta utredning'}</button>}
    {allowed.map(action => {
      const Icon = icons[action]
      return <button key={action} type="button" className={`${tuActionButton} ${action === 'send' || action === 'book' ? '!border-violet-600 !bg-violet-600 !text-white' : ''}`}
        disabled={disabled || busy} onClick={() => inDialog ? setSelected(action) : open(action)}><Icon size={16} aria-hidden />{label(action)}</button>
    })}
  </div>
  return <>
    {compact ? <button type="button" className={`${tuActionButton} !w-11 !px-0`} disabled={disabled || busy} title="Hantera uppdragsbekräftelse" aria-label={`Hantera uppdragsbekräftelse: ${assignment.customer_name || assignment.customer_email}`} onClick={() => open(null)}><MoreHorizontal size={20} aria-hidden /></button> : buttons()}
    <dialog ref={dialog} aria-labelledby={heading} onCancel={event => { if (busy) event.preventDefault(); else setSelected(null) }} className="m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-lg overflow-auto whitespace-normal rounded-lg border border-slate-300 bg-white p-5 text-slate-900 shadow-xl backdrop:bg-black/40">
      <div className="mb-4 flex items-start justify-between gap-3"><h2 id={heading} className="text-lg font-semibold">{selected ? label(selected) : 'Hantera uppdragsbekräftelse'}</h2><button type="button" className={tuActionButton} onClick={close} disabled={busy} aria-label="Stäng"><X size={18} aria-hidden /></button></div>
      {selected ? <><p className="break-words text-sm leading-6 [overflow-wrap:anywhere]">{tuActionConfirmation(selected, assignment)}</p>
        <div className="mt-5 flex flex-wrap justify-end gap-2"><button type="button" className={tuActionButton} disabled={busy} onClick={close}>Avbryt</button><button type="button" className={`${tuActionButton} !border-violet-600 !bg-violet-600 !text-white`} disabled={busy} onClick={() => void execute()}>{busy ? <Loader2 size={16} className="animate-spin" aria-hidden /> : <Check size={16} aria-hidden />}{busy ? 'Pågår…' : 'Bekräfta'}</button></div>
      </> : buttons(true)}
    </dialog>
  </>
}
