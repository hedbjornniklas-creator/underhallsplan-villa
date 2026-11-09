'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { CalendarClock, Check, Pencil, RefreshCw, X } from 'lucide-react'
import type { TaskView } from '@/lib/tasks/contracts'
import { formatTaskDateTime, taskDateTimeInputToIso, taskIsoToDateTimeInput, taskTimeZoneLabel } from '@/lib/tasks/dateTime'

const field = 'min-h-11 min-w-0 w-full rounded-md border border-[#D5DCDD] bg-white px-2 py-2 text-base outline-none focus:border-[#206961] sm:text-sm'
const iconButton = 'inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-md border border-[#D5DCDD] bg-white text-[#252A2D] hover:bg-[#EDF3F2] focus-visible:outline-2 focus-visible:outline-[#206961] disabled:opacity-50 sm:h-11 sm:w-11'

export default function TaskDueDateEditor({ task, busy, onSave, onDirtyChange, onReload }: {
  task: TaskView
  busy: boolean
  onSave: (dueAt: string | null, version: number) => Promise<void>
  onDirtyChange: (dirty: boolean) => void
  onReload?: () => Promise<void>
}) {
  const [editing, setEditing] = useState(false)
  const [date, setDate] = useState('')
  const [time, setTime] = useState('16:00')
  const [withoutDate, setWithoutDate] = useState(false)
  const [original, setOriginal] = useState({ date: '', time: '16:00', withoutDate: false })
  const [version, setVersion] = useState(task.version)
  const [error, setError] = useState('')
  const saving = useRef(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const dirty = editing && (withoutDate !== original.withoutDate || (!withoutDate && (date !== original.date || time !== original.time)))
  useEffect(() => { onDirtyChange(dirty); return () => onDirtyChange(false) }, [dirty, onDirtyChange])
  useEffect(() => { if (editing && !withoutDate) inputRef.current?.focus() }, [editing, withoutDate])

  const start = () => {
    const value = taskIsoToDateTimeInput(task.dueAt, task.dueTimeZone)
    const initial = { date: value?.date ?? '', time: value?.time ?? '16:00', withoutDate: task.dueAt === null }
    setOriginal(initial)
    setDate(initial.date)
    setTime(initial.time)
    setWithoutDate(initial.withoutDate)
    setVersion(task.version)
    setError('')
    setEditing(true)
  }
  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (busy || saving.current || !dirty || !task.canEditDueDate) return
    const dueAt = withoutDate ? null : taskDateTimeInputToIso(date, time, task.dueTimeZone)
    if (!withoutDate && !dueAt) { setError('Ange ett giltigt datum och klockslag.'); return }
    if (withoutDate && !task.canRemoveDueDate) { setError('Uppgiften behöver ett slutdatum.'); return }
    saving.current = true
    setError('')
    try { await onSave(dueAt, version); setEditing(false) }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Slutdatumet kunde inte sparas.') }
    finally { saving.current = false }
  }

  return <div className={`${editing ? 'col-span-2' : ''} rounded-2xl border border-slate-200 bg-white p-3.5`}>
    <dt className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-normal text-slate-500">
      <CalendarClock size={14} /><span className="min-w-0 flex-1">Ska vara klart</span>
      {!editing && task.canEditDueDate && <button type="button" className={iconButton} title="Ändra slutdatum" aria-label="Ändra slutdatum" disabled={busy} onClick={start}><Pencil size={16} /></button>}
    </dt>
    <dd className="mt-2 text-sm font-semibold leading-5 text-slate-900">
      {!editing ? formatTaskDateTime(task.dueAt, task.dueTimeZone) : <form onSubmit={event => void save(event)} className="space-y-3" aria-label="Ändra uppgiftens slutdatum">
        {task.canRemoveDueDate && <label className="flex min-h-9 items-center gap-2 font-normal"><input type="checkbox" checked={withoutDate} disabled={busy} onChange={event => setWithoutDate(event.target.checked)} />Utan datum</label>}
        {!withoutDate && <div className="grid min-w-0 gap-2 sm:grid-cols-2">
          <label className="min-w-0 text-xs">Datum<input ref={inputRef} aria-label="Nytt slutdatum" type="date" required value={date} disabled={busy} onChange={event => setDate(event.target.value)} className={`${field} mt-1`} /></label>
          <label className="min-w-0 text-xs">Klockslag<input type="time" required value={time} disabled={busy} onChange={event => setTime(event.target.value)} className={`${field} mt-1`} /></label>
        </div>}
        {error && <p role="alert" className="break-words text-sm font-normal text-[#A52E42]">{error}</p>}
        <div className="flex flex-wrap gap-2">
          <button type="submit" className={iconButton} title="Spara slutdatum" aria-label="Spara slutdatum" disabled={busy || !dirty || !task.canEditDueDate}><Check size={18} /></button>
          <button type="button" className={iconButton} title="Avbryt datumändring" aria-label="Avbryt datumändring" disabled={busy} onClick={() => { setEditing(false); setError('') }}><X size={18} /></button>
          {error && onReload && <button type="button" className="inline-flex min-h-12 items-center gap-2 rounded-md border border-[#D5DCDD] px-3 text-sm" disabled={busy} onClick={async () => { try { await onReload(); setEditing(false); setError('') } catch { /* Keep the draft on read failure. */ } }}><RefreshCw size={16} />Hämta sparad uppgift</button>}
        </div>
      </form>}
    </dd>
    {(task.dueAt || editing && !withoutDate) && <dd className="mt-1 text-xs text-slate-500">{taskTimeZoneLabel(task.dueTimeZone)}</dd>}
  </div>
}
