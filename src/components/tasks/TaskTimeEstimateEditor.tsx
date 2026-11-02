'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, Clock3, Pencil, RefreshCw, X } from 'lucide-react'
import type { TaskView } from '@/lib/tasks/contracts'
import { parseTaskEstimate, taskEstimateLabel } from '@/lib/tasks/timeEstimate'
import TaskTimeEstimateInput from './TaskTimeEstimateInput'

export default function TaskTimeEstimateEditor({ task, busy, onSave, onDirtyChange, onReload }: {
  task: TaskView; busy: boolean; onSave: (minutes: number | null, estimateVersion: number, taskVersion: number) => Promise<void>
  onDirtyChange: (dirty: boolean) => void; onReload?: () => Promise<void>
}) {
  const [editing, setEditing] = useState(false), [raw, setRaw] = useState(''), [error, setError] = useState('')
  const saving = useRef(false)
  const [version, setVersion] = useState(0), [taskVersion, setTaskVersion] = useState(task.version)
  const original = task.estimatedMinutes == null ? '' : String(task.estimatedMinutes)
  const dirty = editing && raw !== original
  useEffect(() => { onDirtyChange(dirty); return () => onDirtyChange(false) }, [dirty, onDirtyChange])
  const start = () => { setRaw(original); setVersion(task.estimateVersion ?? 0); setTaskVersion(task.version); setError(''); setEditing(true) }
  let invalid = false
  try { parseTaskEstimate(raw) } catch { invalid = true }
  const save = async () => {
    if (busy || invalid || saving.current || !task.canEditEstimate) return
    saving.current = true
    setError('')
    try { await onSave(parseTaskEstimate(raw), version, taskVersion); setEditing(false) }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Tidsuppskattningen kunde inte sparas.') }
    finally { saving.current = false }
  }
  return <section className="mt-4 border-y border-slate-200 py-4" aria-label="Uppgiftens tidsuppskattning">
    <div className="flex items-center gap-2"><Clock3 size={17} className="shrink-0 text-[#596368]" /><h3 className="min-w-0 flex-1 text-sm font-semibold">Uppskattad tidsåtgång</h3>
      {!editing && <span className="text-sm">{taskEstimateLabel(task.estimatedMinutes)}</span>}
      {!editing && task.canEditEstimate && <button type="button" className="gizmo-button gizmo-icon-button" title="Ändra tidsuppskattning" aria-label="Ändra tidsuppskattning" disabled={busy} onClick={start}><Pencil size={17} /></button>}
    </div>
    {editing && <div className="mt-3 space-y-3">
      <TaskTimeEstimateInput value={raw} onChange={setRaw} disabled={busy || !task.canEditEstimate} hideLegend />
      {error && <p role="alert" className="text-sm text-[#A52E42]">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button type="button" className="gizmo-button gizmo-icon-button" title="Spara tidsuppskattning" aria-label="Spara tidsuppskattning" disabled={busy || invalid || !dirty || !task.canEditEstimate} onClick={() => void save()}><Check size={18} /></button>
        <button type="button" className="gizmo-button gizmo-icon-button" title="Avbryt tidsändring" aria-label="Avbryt tidsändring" disabled={busy} onClick={() => { setEditing(false); setError('') }}><X size={18} /></button>
        {error && onReload && <button type="button" className="gizmo-button" disabled={busy} onClick={async () => { try { await onReload(); setEditing(false); setError('') } catch { /* Keep the draft until a successful read. */ } }}><RefreshCw size={17} />Hämta sparad uppgift</button>}
      </div>
    </div>}
  </section>
}
