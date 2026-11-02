'use client'

import { useEffect, useId, useRef } from 'react'
import { ArrowDown, ArrowUp, RefreshCw, Trash2, X } from 'lucide-react'
import { schedulePhases, scheduleStatuses, type ProjectScheduleRow } from '@/lib/action-cases/projectSchedule'

export default function ProjectScheduleRowEditor({ row, index, count, disabled, saveStatus, saveError, onRetry, onPatch, onMove, onRemove, onClose }: {
  row: ProjectScheduleRow; index: number; count: number; disabled: boolean; saveStatus: string; saveError: string; onRetry: () => void
  onPatch: (value: Partial<ProjectScheduleRow>) => void; onMove: (delta: number) => void; onRemove: () => void; onClose: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null), title = useRef<HTMLInputElement>(null), id = useId()
  useEffect(() => {
    const node = dialog.current, previous = document.activeElement as HTMLElement | null
    node?.showModal(); title.current?.focus()
    return () => { node?.close(); if (previous?.isConnected) previous.focus({ preventScroll: true }) }
  }, [])
  const invalid = Boolean(row.startDate && row.endDate && row.endDate < row.startDate)
  return <dialog ref={dialog} className="gizmo-schedule-dialog" aria-labelledby={`${id}-heading`} onKeyDown={event => event.stopPropagation()} onCancel={event => { event.preventDefault(); onClose() }}>
    <header><div><span>Moment {index + 1} av {count}</span><h3 id={`${id}-heading`}>{row.title || 'Nytt moment'}</h3></div><button type="button" className="gizmo-schedule-icon" title="Stäng moment" aria-label="Stäng moment" onClick={onClose}><X size={19} /></button></header>
    <div className="gizmo-schedule-dialog-body"><fieldset disabled={disabled}>
      <label>Moment *<input ref={title} value={row.title} maxLength={250} onChange={event => onPatch({ title: event.target.value })} /></label>
      <label>Del av projektet<input list={`${id}-phases`} value={row.phase} maxLength={100} onChange={event => onPatch({ phase: event.target.value })} /></label>
      <datalist id={`${id}-phases`}>{schedulePhases.map(phase => <option key={phase} value={phase} />)}</datalist>
      <div className="gizmo-schedule-date-fields"><label>Startdatum<input type="date" value={row.startDate} onChange={event => onPatch({ startDate: event.target.value })} /></label><label>Slutdatum<input type="date" min={row.startDate || undefined} value={row.endDate} aria-invalid={invalid || undefined} onChange={event => onPatch({ endDate: event.target.value })} /></label></div>
      {invalid && <p role="alert" className="gizmo-schedule-warning">Slutdatum ligger före startdatum. Ändringen är inte sparad.</p>}
      <label>Status<select value={row.status} onChange={event => onPatch({ status: event.target.value as ProjectScheduleRow['status'] })}>{Object.entries(scheduleStatuses).map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select></label>
      <div className="gizmo-schedule-row-actions"><button type="button" className="gizmo-schedule-icon" title="Flytta upp" aria-label="Flytta moment upp" disabled={index === 0} onClick={() => onMove(-1)}><ArrowUp size={17} /></button><button type="button" className="gizmo-schedule-icon" title="Flytta ned" aria-label="Flytta moment ned" disabled={index === count - 1} onClick={() => onMove(1)}><ArrowDown size={17} /></button><button type="button" className="gizmo-schedule-button" onClick={onRemove}><Trash2 size={17} />Ta bort moment</button></div>
    </fieldset>{saveError && <p role="alert" className="gizmo-schedule-warning">{saveError}</p>}</div>
    <footer><span role="status">{saveStatus}</span>{saveError && <button type="button" className="gizmo-schedule-button" disabled={disabled || saveStatus === 'Sparar…'} onClick={onRetry}><RefreshCw size={16} />Försök igen</button>}<button type="button" className="gizmo-schedule-button" onClick={onClose}>Stäng</button></footer>
  </dialog>
}
