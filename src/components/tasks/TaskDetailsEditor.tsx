'use client'

import { useEffect, useState, type FormEvent } from 'react'
import { Loader2, Save, X } from 'lucide-react'
import type { TaskView, TaskWorkspace } from '@/lib/tasks/contracts'
import { taskDateTimeInputToIso, taskIsoToDateTimeInput, taskTimeZoneLabel } from '@/lib/tasks/dateTime'

type Props = { task: TaskView; workspace: TaskWorkspace; busy: boolean; onDirtyChange: (value: boolean) => void; onCancel: () => void; onSave: (payload: Record<string, unknown>) => Promise<void> }
const input = 'min-h-11 w-full rounded-md border border-[#D5DCDD] bg-white px-3 py-2 text-sm'

export default function TaskDetailsEditor({ task, workspace, busy, onDirtyChange, onCancel, onSave }: Props) {
  const [base] = useState(task)
  const initialRef = `${base.assignee.kind}:${base.assignee.id}`
  const initialDue = taskIsoToDateTimeInput(base.dueAt, base.dueTimeZone)
  const initialFollowup = taskIsoToDateTimeInput(base.nextFollowupAt, base.dueTimeZone)
  const [title, setTitle] = useState(base.title), [description, setDescription] = useState(base.description ?? ''), [contextLabel, setContextLabel] = useState(base.contextLabel ?? '')
  const [assigneeRef, setAssigneeRef] = useState(initialRef), [confirmed, setConfirmed] = useState(false)
  const [dueDate, setDueDate] = useState(initialDue?.date ?? ''), [dueTime, setDueTime] = useState(initialDue?.time ?? '16:00')
  const [followupDate, setFollowupDate] = useState(initialFollowup?.date ?? ''), [followupTime, setFollowupTime] = useState(initialFollowup?.time ?? '09:00')
  const [primary, setPrimary] = useState(base.primaryChannel), [fallback, setFallback] = useState(base.fallbackChannel ?? '')
  const [error, setError] = useState<string | null>(null), [saving, setSaving] = useState(false)
  const recipientChanged = assigneeRef !== initialRef
  const scheduleChanged = dueDate !== (initialDue?.date ?? '') || dueTime !== (initialDue?.time ?? '16:00') || followupDate !== (initialFollowup?.date ?? '') || followupTime !== (initialFollowup?.time ?? '09:00')
  const dirty = title !== base.title || description !== (base.description ?? '') || contextLabel !== (base.contextLabel ?? '') || recipientChanged || scheduleChanged || primary !== base.primaryChannel || fallback !== (base.fallbackChannel ?? '')
  useEffect(() => { onDirtyChange(dirty); return () => onDirtyChange(false) }, [dirty, onDirtyChange])
  const people = workspace.people.some(p => `${p.kind}:${p.id}` === initialRef) ? workspace.people : [base.assignee, ...workspace.people]
  const mayBeUndated = assigneeRef === `profile:${base.issuerId}` && !base.parentTaskId && base.taskKind === 'simple'
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (busy || saving || !dirty || (recipientChanged && !confirmed)) return
    const dueAt = dueDate === initialDue?.date && dueTime === initialDue.time ? base.dueAt : dueDate ? taskDateTimeInputToIso(dueDate, dueTime, base.dueTimeZone) : null
    const nextFollowupAt = followupDate === initialFollowup?.date && followupTime === initialFollowup.time ? base.nextFollowupAt : followupDate ? taskDateTimeInputToIso(followupDate, followupTime, base.dueTimeZone) : null
    if ((dueDate && !dueAt) || (followupDate && !nextFollowupAt)) { setError('Kontrollera datum och klockslag. Tiden måste finnas i angiven tidszon.'); return }
    if (dueAt && (!nextFollowupAt || Date.parse(nextFollowupAt) > Date.parse(dueAt))) { setError('Uppföljningen måste ligga senast vid slutdatumet.'); return }
    setSaving(true); setError(null)
    try { await onSave({ taskId: base.id, version: base.version, title, description, contextLabel, assigneeRef, dueAt, nextFollowupAt, primaryChannel: primary, fallbackChannel: fallback || null, confirmRecipientChange: confirmed }) }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Ändringarna kunde inte sparas. Din text är kvar.') }
    finally { setSaving(false) }
  }
  return <form onSubmit={submit} className="mb-5 border-b border-[#D5DCDD] pb-5" aria-label="Redigera uppgift">
    <h3 className="mb-4 text-base font-semibold">Grunduppgifter</h3>
    <fieldset disabled={busy || saving} className="grid gap-3">
      <label className="text-sm">Rubrik<input className={`${input} mt-1`} required maxLength={500} value={title} onChange={e => setTitle(e.target.value)} autoFocus /></label>
      <label className="text-sm">Beskrivning<textarea className={`${input} mt-1`} rows={4} maxLength={20000} value={description} onChange={e => setDescription(e.target.value)} /></label>
      <label className="text-sm">Projekt / sammanhang<input className={`${input} mt-1`} maxLength={500} value={contextLabel} onChange={e => setContextLabel(e.target.value)} /></label>
      <label className="text-sm">Mottagare<select className={`${input} mt-1`} value={assigneeRef} onChange={e => { setAssigneeRef(e.target.value); setConfirmed(false) }} required>
        {(['profile', 'contact'] as const).map(kind => <optgroup key={kind} label={kind === 'profile' ? 'Interna personer' : 'Externa kontakter'}>{people.filter(p => p.kind === kind && (p.isActive || `${p.kind}:${p.id}` === initialRef)).map(p => <option key={`${p.kind}:${p.id}`} value={`${p.kind}:${p.id}`}>{p.name}{p.companyName ? ` – ${p.companyName}` : ''}{p.email ? ` · ${p.email}` : ''}</option>)}</optgroup>)}
      </select></label>
      {recipientChanged ? <div className="border-l-3 border-[#206961] bg-[#F1F6F5] p-3 text-sm">
        <p>Den gamla mottagarens personliga länk spärras när du sparar. Status, underuppgifter och tidigare historik behålls. Inget mejl skickas förrän du väljer Skicka uppdraget.</p>
        <label className="mt-2 flex items-start gap-2"><input type="checkbox" className="mt-1" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />Jag bekräftar bytet av mottagare.</label>
      </div> : null}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">Slutdatum<input className={`${input} mt-1`} type="date" required={!mayBeUndated} value={dueDate} onChange={e => { setDueDate(e.target.value); if (!e.target.value) setFollowupDate('') }} /></label>
        <label className="text-sm">Klockslag för slutdatum<input className={`${input} mt-1`} type="time" required={Boolean(dueDate)} value={dueTime} onChange={e => setDueTime(e.target.value)} /></label>
        <label className="text-sm">Nästa interna uppföljning<input className={`${input} mt-1`} type="date" required={Boolean(dueDate)} value={followupDate} onChange={e => setFollowupDate(e.target.value)} /></label>
        <label className="text-sm">Klockslag för uppföljning<input className={`${input} mt-1`} type="time" required={Boolean(followupDate)} value={followupTime} onChange={e => setFollowupTime(e.target.value)} /></label>
      </div>
      <p className="text-xs text-[#596368]">{taskTimeZoneLabel(base.dueTimeZone)}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">Primär kanal<select className={`${input} mt-1`} value={primary} onChange={e => setPrimary(e.target.value as TaskView['primaryChannel'])}>{String(base.primaryChannel) === 'in_app' ? <option value="in_app">I Gizmo (befintligt val)</option> : null}<option value="email">E-post</option><option value="whatsapp">WhatsApp</option></select></label>
        <label className="text-sm">Reservkanal<select className={`${input} mt-1`} value={fallback} onChange={e => setFallback(e.target.value as TaskView['primaryChannel'] | '')}><option value="">Ingen</option>{String(base.fallbackChannel) === 'in_app' ? <option value="in_app">I Gizmo (befintligt val)</option> : null}<option value="email">E-post</option><option value="whatsapp">WhatsApp</option></select></label>
      </div>
      {error ? <p role="alert" className="text-sm text-[#A52E42]">{error}</p> : null}
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={!dirty || (recipientChanged && !confirmed)} className="inline-flex min-h-11 items-center gap-2 rounded-md bg-[#252A2D] px-4 text-sm font-semibold text-white disabled:opacity-50">{saving ? <Loader2 size={17} className="animate-spin" /> : <Save size={17} />}Spara ändringar</button>
        <button type="button" onClick={onCancel} className="inline-flex min-h-11 items-center gap-2 rounded-md border border-[#D5DCDD] bg-white px-4 text-sm"><X size={17} />Avbryt</button>
      </div>
    </fieldset>
  </form>
}
