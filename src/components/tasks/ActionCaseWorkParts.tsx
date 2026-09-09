'use client'

import { useState } from 'react'
import { FolderInput, Loader2, Mail, Pencil, Plus, RotateCcw, Save, Settings2, Trash2, X } from 'lucide-react'
import type { ActionCaseCostLineView, ActionCaseWorkPart } from '@/lib/action-cases/contracts'
import { MAX_WORK_PART_LINES } from '@/lib/action-cases/workParts'
import { canEditDirectWork, isHourlyWork } from './ActionCaseDirectCostFields'

export const getWorkPartId = (line: ActionCaseCostLineView) => line.workPartId ?? null
export const UNASSIGNED_WORK = '__unassigned'
const input = 'mt-1 min-h-11 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 text-sm font-normal text-slate-950 focus:outline-none focus:ring-2 focus:ring-violet-200'
const button = 'inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40'
const iconButton = `${button} h-11 w-11 px-0`
type ActionProps = {
  parts: ActionCaseWorkPart[]; expectedUpdatedAt: string; busy: boolean
  onEditing: (editing: boolean) => void
  onAction: (payload: Record<string, unknown>) => Promise<boolean>
}

export function ActionCaseWorkParts({ parts, expectedUpdatedAt, busy, filter, onFilter, onEditing, onAction }: ActionProps & {
  filter: string; onFilter: (id: string) => void
}) {
  const [managing, setManaging] = useState(false)
  const [draft, setDraft] = useState<{ partId?: string; title: string; scope: string; expectedUpdatedAt: string } | null>(null)
  const [deleting, setDeleting] = useState<{ partId: string; expectedUpdatedAt: string } | null>(null)
  const edit = (part?: ActionCaseWorkPart) => {
    setDraft({ partId: part?.id, title: part?.title ?? '', scope: part?.scope ?? '', expectedUpdatedAt })
    setDeleting(null); setManaging(true); onEditing(true)
  }
  const cancel = () => { setDraft(null); setDeleting(null); onEditing(false) }
  return <div className="mt-3 border-b border-slate-100 pb-3">
    <div className="flex min-w-0 flex-wrap items-end gap-2">
      {parts.length ? <label className="min-w-0 flex-1 text-xs font-semibold text-slate-600">Arbetsdel<select className={input} value={filter} disabled={busy || Boolean(draft || deleting)} onChange={(event) => onFilter(event.target.value)}><option value="">Alla arbeten</option><option value={UNASSIGNED_WORK}>Utan arbetsdel</option>{parts.map((part) => <option key={part.id} value={part.id}>{part.title}</option>)}</select></label> : <span className="mr-auto self-center text-sm text-slate-500">Arbetsdelar</span>}
      <button className={iconButton} type="button" disabled={busy || Boolean(draft || deleting)} aria-label="Lägg till arbetsdel" title="Lägg till arbetsdel" onClick={() => edit()}><Plus size={16} /></button>
      {parts.length ? <button className={iconButton} type="button" disabled={busy || Boolean(draft || deleting)} aria-label="Hantera arbetsdelar" title="Hantera arbetsdelar" aria-expanded={managing} onClick={() => setManaging(!managing)}><Settings2 size={16} /></button> : null}
    </div>
    {filter && filter !== UNASSIGNED_WORK && parts.find((part) => part.id === filter)?.scope ? <p className="mt-2 whitespace-pre-wrap break-words text-sm text-slate-600">{parts.find((part) => part.id === filter)?.scope}</p> : null}
    {managing ? <div className="mt-3">
      {!draft ? <ul className="divide-y divide-slate-100">{parts.map((part) => <li key={part.id} className="py-2">
        <div className="flex items-start gap-2"><div className="min-w-0 flex-1"><strong className="block break-words text-sm">{part.title}</strong>{part.scope ? <p className="mt-1 whitespace-pre-wrap break-words text-xs text-slate-500">{part.scope}</p> : null}</div>
          <button className={iconButton} type="button" disabled={busy || Boolean(deleting)} title="Redigera arbetsdel" aria-label={`Redigera arbetsdelen ${part.title}`} onClick={() => edit(part)}><Pencil size={16} /></button>
          <button className={iconButton} type="button" disabled={busy || Boolean(deleting)} title="Ta bort arbetsdel" aria-label={`Ta bort arbetsdelen ${part.title}`} onClick={() => { setDeleting({ partId: part.id, expectedUpdatedAt }); onEditing(true) }}><Trash2 size={16} /></button>
        </div>
        {deleting?.partId === part.id ? <div className="mt-2 flex flex-wrap items-center gap-2"><p className="basis-full text-sm text-amber-800">Ta bort arbetsdelen? Arbetena behålls utan arbetsdel.</p><button className={button} type="button" disabled={busy} onClick={cancel}>Avbryt</button><button className={button} type="button" disabled={busy} onClick={() => void onAction({ operation: 'delete', ...deleting }).then((ok) => { if (ok) { cancel(); if (filter === part.id) onFilter('') } })}>{busy ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}Ta bort</button></div> : null}
      </li>)}</ul> : <form className="space-y-3" onSubmit={(event) => {
        event.preventDefault()
        if (busy || !draft.title.trim() || draft.title.trim().length > 200 || draft.scope.trim().length > 10000) return
        void onAction({ operation: 'save', ...draft, title: draft.title.trim(), scope: draft.scope.trim() || null }).then((ok) => { if (ok) cancel() })
      }}>
        <fieldset disabled={busy} className="space-y-3">
          <label className="block text-xs font-semibold text-slate-600">Arbetsdelens namn *<input autoFocus required maxLength={200} className={input} placeholder="Snickeri" value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label>
          <label className="block text-xs font-semibold text-slate-600">Omfattning<textarea maxLength={10000} rows={2} className={`${input} py-2`} value={draft.scope} onChange={(event) => setDraft({ ...draft, scope: event.target.value })} /></label>
        </fieldset>
        <div className="flex flex-wrap justify-end gap-2"><button className={button} type="button" disabled={busy} onClick={cancel}>Avbryt</button><button className={button} type="submit" disabled={busy || !draft.title.trim()}>{busy ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}Spara arbetsdel</button></div>
      </form>}
    </div> : null}
  </div>
}

export function ActionCaseWorkSelection({ lines, selectedIds, parts, expectedUpdatedAt, busy, onSelect, onEditing, onAction, onRequest }: ActionProps & {
  lines: ActionCaseCostLineView[]; selectedIds: string[]; onSelect: (ids: string[]) => void
  onRequest?: (costLineIds: string[]) => void
}) {
  const [rateDraft, setRateDraft] = useState<{ value: string; expectedUpdatedAt: string } | null>(null)
  const [moveDraft, setMoveDraft] = useState<{ partId: string | null; expectedUpdatedAt: string } | null>(null)
  const selected = lines.filter((line) => selectedIds.includes(line.id))
  const validBatch = selected.length > 0 && selected.length <= MAX_WORK_PART_LINES
  const eligible = selected.length > 0 && selected.every((line) => canEditDirectWork(line) && isHourlyWork(line))
  const rateValid = Boolean(rateDraft?.value.trim()) && Number.isFinite(Number(rateDraft?.value)) && Number(rateDraft?.value) >= 0 && Number(rateDraft?.value) <= 999999999999.99
  const drafting = Boolean(rateDraft || moveDraft)
  const cancel = () => { setRateDraft(null); setMoveDraft(null); onEditing(false) }
  const save = async (payload: Record<string, unknown>) => {
    if (busy || !validBatch) return
    const ok = await onAction({ ...payload, costLineIds: selected.map((line) => line.id) })
    if (ok) { cancel(); onSelect([]) }
  }
  if (!lines.length && !drafting) return null
  return <div className="border-b border-slate-200 py-2">
    <div className="flex flex-wrap items-center gap-2">
      <label className="mr-auto flex min-h-11 items-center gap-2 text-sm font-medium"><input type="checkbox" className="h-4 w-4 shrink-0 accent-violet-600" disabled={busy || drafting || !lines.length} checked={lines.length > 0 && selected.length === lines.length} ref={(node) => { if (node) node.indeterminate = selected.length > 0 && selected.length < lines.length }} onChange={(event) => onSelect(event.target.checked ? lines.map((line) => line.id) : [])} />{selected.length ? `${selected.length} valda` : 'Välj alla arbeten'}</label>
      {selected.length ? <>
        <button className={button} type="button" disabled={busy || drafting || !onRequest || selected.length > 30} title={selected.length > 30 ? 'Högst 30 arbeten per förfrågan' : 'Skapa en förfrågan för valda arbeten'} onClick={() => onRequest?.(selected.map((line) => line.id))}><Mail size={16} />Begär offert ({selected.length})</button>
        <button className={iconButton} type="button" disabled={busy || drafting} title="Rensa val" aria-label="Rensa valda arbeten" onClick={() => onSelect([])}><X size={16} /></button>
      </> : null}
    </div>
    {selected.length > 30 ? <p role="status" className="pb-2 text-xs text-amber-800">{selected.length} valda. Högst 30 arbeten per offertförfrågan.</p> : null}
    {selected.length > MAX_WORK_PART_LINES ? <p role="status" className="pb-2 text-xs text-amber-800">Högst {MAX_WORK_PART_LINES} arbeten per flytt eller prisändring.</p> : null}
    {selected.length || drafting ? <div className="grid min-w-0 gap-3 pb-2 sm:grid-cols-2">
      {parts.length ? <form className="flex min-w-0 flex-wrap items-end gap-2" onSubmit={(event) => { event.preventDefault(); if (!busy && moveDraft) void save({ operation: 'move_lines', ...moveDraft }) }}>
        <label className="min-w-0 flex-1 text-xs font-semibold text-slate-600">Flytta till arbetsdel<select className={input} disabled={busy || !validBatch || Boolean(rateDraft)} value={moveDraft ? moveDraft.partId ?? UNASSIGNED_WORK : ''} onChange={(event) => {
          if (!event.target.value) { cancel(); return }
          setMoveDraft({ partId: event.target.value === UNASSIGNED_WORK ? null : event.target.value, expectedUpdatedAt: moveDraft?.expectedUpdatedAt ?? expectedUpdatedAt }); onEditing(true)
        }}><option value="">Välj arbetsdel</option><option value={UNASSIGNED_WORK}>Utan arbetsdel</option>{parts.map((part) => <option key={part.id} value={part.id}>{part.title}</option>)}</select></label>
        <button className={iconButton} type="submit" disabled={busy || !validBatch || !moveDraft} title="Flytta valda arbeten" aria-label="Flytta valda arbeten"><FolderInput size={16} /></button>
      </form> : null}
      <form className="flex min-w-0 flex-wrap items-end gap-2" onSubmit={(event) => { event.preventDefault(); if (!busy && eligible && rateDraft && rateValid) void save({ operation: 'bulk_update', unitCost: Number(rateDraft.value), expectedUpdatedAt: rateDraft.expectedUpdatedAt }) }}>
        <label className="min-w-0 flex-1 text-xs font-semibold text-slate-600">Timkostnad för valda, kr<input className={input} disabled={busy || !eligible || !validBatch || Boolean(moveDraft)} type="number" min="0" max="999999999999.99" step="any" value={rateDraft?.value ?? ''} onChange={(event) => {
          setRateDraft(event.target.value ? { value: event.target.value, expectedUpdatedAt: rateDraft?.expectedUpdatedAt ?? expectedUpdatedAt } : null); onEditing(Boolean(event.target.value))
        }} /></label>
        <button className={iconButton} type="submit" disabled={busy || !eligible || !validBatch || !rateValid || Boolean(moveDraft)} title="Spara timkostnad för valda arbeten" aria-label="Spara timkostnad för valda arbeten"><Save size={16} /></button>
      </form>
      {!eligible ? <p className="text-xs text-slate-500 sm:col-span-2">Gemensam timkostnad kräver att alla valda arbeten har egen timkalkyl.</p> : null}
      {drafting ? <div className="flex items-center justify-between gap-2 sm:col-span-2"><p role="status" className="text-xs text-amber-800">Osparad {rateDraft ? 'timkostnad' : 'flytt'}</p><button type="button" className={iconButton} disabled={busy} title="Återställ osparad ändring" aria-label="Återställ massändring" onClick={cancel}><RotateCcw size={16} /></button></div> : null}
    </div> : null}
  </div>
}
