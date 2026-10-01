'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Download, Eye, EyeOff, Loader2, Plus, RefreshCw, Save, Trash2, Undo2 } from 'lucide-react'
import { useToast } from '@/components/ui/AppToastProvider'
import { importScheduleRows, normalizeScheduleRows, schedulePhases, scheduleStatuses, type ProjectSchedule, type ProjectScheduleRow } from '@/lib/action-cases/projectSchedule'
import { retainNewerDraft } from '@/lib/action-cases/draftSave'

const button = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-slate-300 px-3 text-sm font-semibold disabled:opacity-40'
const field = 'min-h-11 w-full min-w-0 rounded-md border border-slate-300 bg-white px-2 text-sm'
const icon = `${button} w-11 shrink-0 px-0`
export function ProjectScheduleDocument({ rows }: { rows: ProjectScheduleRow[] }) {
  return <section className="mt-5">
    <h3 className="font-semibold">Planerade moment</h3>
    <p className="mt-2 text-sm text-slate-600">Produktionsplanering · Ändrar inte avtalade tider.</p>
    <ol className="mt-3 divide-y divide-slate-200">{rows.map((r) => <li key={r.id} className="flex flex-wrap justify-between gap-3 py-3 text-sm">
      <div><strong>{r.title}</strong><p className="mt-1 text-slate-600">{[r.phase, scheduleStatuses[r.status]].filter(Boolean).join(' · ')}</p></div>
      <span>{r.startDate || 'Start ej planerad'} / {r.endDate || 'Slut ej planerat'}</span>
    </li>)}</ol>
  </section>
}

export default function ProjectScheduleEditor({ caseId, items, onDirty, onShared }: {
  caseId: string; items: { id: string; title: string }[]
  onDirty: (dirty: boolean) => void
  onShared: (rows: ProjectScheduleRow[]) => void
}) {
  const [saved, setSaved] = useState<ProjectSchedule | null>(null)
  const [rows, setRows] = useState<ProjectScheduleRow[]>([])
  const [busy, setBusy] = useState('load'), [error, setError] = useState(false)
  const [showImport, setShowImport] = useState(false), [selected, setSelected] = useState<string[]>([])
  const [shareConfirm, setShareConfirm] = useState(false)
  const [removed, setRemoved] = useState<{ row: ProjectScheduleRow; index: number } | null>(null)
  const running = useRef(false), toast = useToast()
  const dirty = Boolean(saved && JSON.stringify(rows) !== JSON.stringify(saved.rows))
  const refresh = useCallback(async (signal?: AbortSignal) => {
    setBusy('load'); setError(false)
    try {
      const response = await fetch(`/api/action-cases/${caseId}/schedule`, { signal })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Tidsplanen kunde inte hämtas.')
      setSaved(data); setRows(data.rows); onShared(data.sharedRows)
    } catch (e) {
      if (!signal?.aborted) { setError(true); toast.error(e, 'Tidsplanen kunde inte hämtas.') }
    } finally { if (!signal?.aborted) setBusy('') }
  }, [caseId, onShared, toast])
  useEffect(() => { const controller = new AbortController(); void refresh(controller.signal); return () => controller.abort() }, [refresh])
  useEffect(() => { onDirty(dirty || Boolean(busy && busy !== 'load')) }, [dirty, busy, onDirty])
  useEffect(() => {
    if (!dirty && busy !== 'save') return
    const prevent = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', prevent)
    return () => window.removeEventListener('beforeunload', prevent)
  }, [dirty, busy])
  async function write(operation: 'save' | 'share' | 'unshare') {
    if (running.current || !saved) return
    try { normalizeScheduleRows(rows, operation === 'share') } catch { toast.error('Kontrollera rubriker och datum. Slutdatum får inte ligga före startdatum.'); return }
    if (operation === 'share' && (!shareConfirm || dirty)) return
    running.current = true; setBusy(operation)
    try {
      const response = await fetch(`/api/action-cases/${caseId}/schedule`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operation, rows, revision: saved.revision, confirmed: operation === 'share' }) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Tidsplanen kunde inte sparas.')
      setSaved(data); setRows((current) => retainNewerDraft(current, rows, data.rows)); onShared(data.sharedRows)
      setShareConfirm(false)
      toast.success(operation === 'save' ? 'Tidsplanen sparades internt.' : operation === 'share' ? 'Tidsplanen visas för beställaren.' : 'Tidsplanen är nu intern.')
    } catch (e) { toast.error(e, 'Tidsplanen kunde inte sparas. Dina ändringar finns kvar.') }
    finally { running.current = false; setBusy('') }
  }
  function patch(id: string, value: Partial<ProjectScheduleRow>) { setRows((current) => current.map((r) => r.id === id ? { ...r, ...value } : r)) }
  function move(index: number, delta: number) { setRows((current) => { const next = [...current], target = index + delta; if (target < 0 || target >= next.length) return current; [next[index], next[target]] = [next[target], next[index]]; return next }) }
  const available = items.filter((i) => !rows.some((r) => r.sourceItemId === i.id))
  return <section className="border-t border-slate-200 py-5" aria-label="Produktionsplanering">
    <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-lg">Moment och datum</h3>
      <div className="flex items-center gap-3"><span role="status" className="text-sm text-slate-600">{busy === 'load' ? 'Hämtar…' : busy === 'save' ? 'Sparar…' : busy ? 'Uppdaterar delning…' : dirty ? 'Osparade ändringar' : saved?.available ? 'Sparat internt' : ''}</span>
        <button className={icon} title="Hämta sparad tidsplan" aria-label="Hämta sparad tidsplan" disabled={Boolean(busy)} onClick={() => { if (!dirty || window.confirm('Ersätta dina osparade ändringar med den sparade tidsplanen?')) void refresh() }}><RefreshCw size={17} /></button></div>
    </div>
    {error && <p role="alert" className="py-4 text-sm">Tidsplanen kunde inte hämtas. Försök igen med uppdateringsknappen.</p>}
    {saved && !saved.available && <p className="py-4 text-sm">Tidsplaneringen behöver aktiveras av administratören.</p>}
    {saved?.available && <>
      <fieldset className="min-w-0" disabled={Boolean(busy) && busy !== 'save'}>
        <ol className="mt-4 divide-y divide-slate-200">{rows.map((r, index) => <li key={r.id} className="py-3">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-[minmax(100px,1.5fr)_minmax(80px,1fr)_140px_140px_110px]">
            <label className="text-xs text-slate-600">Moment *<input className={`${field} mt-1`} maxLength={250} value={r.title} onChange={(e) => patch(r.id, { title: e.target.value })} /></label>
            <label className="text-xs text-slate-600">Del av projektet<input className={`${field} mt-1`} list="schedule-phases" maxLength={100} value={r.phase} onChange={(e) => patch(r.id, { phase: e.target.value })} /></label>
            <label className="text-xs text-slate-600">Startdatum<input className={`${field} mt-1`} type="date" value={r.startDate} onChange={(e) => patch(r.id, { startDate: e.target.value })} /></label>
            <label className="text-xs text-slate-600">Slutdatum<input className={`${field} mt-1`} type="date" min={r.startDate || undefined} value={r.endDate} onChange={(e) => patch(r.id, { endDate: e.target.value })} /></label>
            <label className="text-xs text-slate-600">Status<select className={`${field} mt-1`} value={r.status} onChange={(e) => patch(r.id, { status: e.target.value as ProjectScheduleRow['status'] })}>{Object.entries(scheduleStatuses).map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select></label>
          </div>
          <div className="mt-2 flex items-center justify-end gap-1">
            {r.startDate && r.endDate && r.endDate < r.startDate && <span role="alert" className="mr-auto text-sm text-red-700">Slutdatum ligger före startdatum.</span>}
            <button className={icon} title="Flytta upp" aria-label={`Flytta upp ${r.title || 'moment'}`} disabled={!index} onClick={() => move(index, -1)}><ArrowUp size={16} /></button>
            <button className={icon} title="Flytta ned" aria-label={`Flytta ned ${r.title || 'moment'}`} disabled={index === rows.length - 1} onClick={() => move(index, 1)}><ArrowDown size={16} /></button>
            <button className={icon} title="Ta bort moment" aria-label={`Ta bort ${r.title || 'moment'}`} onClick={() => { setRemoved({ row: r, index }); setRows(rows.filter((v) => v.id !== r.id)) }}><Trash2 size={16} /></button>
          </div>
        </li>)}</ol>
        {!rows.length && <p className="py-5 text-sm text-slate-600">Inga moment planerade.</p>}
        <datalist id="schedule-phases">{[...new Set([...schedulePhases, ...rows.map((r) => r.phase).filter(Boolean)])].map((phase) => <option key={phase} value={phase} />)}</datalist>
        <div className="flex flex-wrap gap-2 py-3">
          <button className={button} disabled={rows.length >= 200} onClick={() => setRows([...rows, { id: crypto.randomUUID(), title: '', phase: '', startDate: '', endDate: '', status: 'planned', sourceItemId: null }])}><Plus size={17} /> Lägg till moment</button>
          <button className={button} disabled={!available.length || rows.length >= 200} onClick={() => setShowImport(!showImport)} aria-expanded={showImport}><Download size={17} /> Hämta från projektarbete</button>
          {removed && <button className={button} disabled={rows.length >= 200 || rows.some((r) => r.sourceItemId && r.sourceItemId === removed.row.sourceItemId)} onClick={() => { const next = [...rows]; next.splice(Math.min(removed.index, next.length), 0, removed.row); setRows(next); setRemoved(null) }}><Undo2 size={17} /> Ångra borttagning</button>}
        </div>
        {showImport && <div className="border-y border-slate-200 py-4">
          {available.map((item) => <label key={item.id} className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" checked={selected.includes(item.id)} onChange={(e) => setSelected(e.target.checked ? [...selected, item.id] : selected.filter((id) => id !== item.id))} />{item.title}</label>)}
          <button className={`${button} mt-3`} disabled={!selected.some((id) => available.some((i) => i.id === id))} onClick={() => { setRows(importScheduleRows(rows, available.filter((i) => selected.includes(i.id)), () => crypto.randomUUID())); setSelected([]); setShowImport(false) }}><Plus size={17} /> Lägg till valda moment</button>
        </div>}
      </fieldset>
      <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-slate-200 pt-4">
        <button className={`${button} bg-slate-950 text-white`} disabled={Boolean(busy) || !dirty} onClick={() => void write('save')}>{busy === 'save' ? <Loader2 size={17} className="animate-spin" /> : <Save size={17} />} Spara tidsplan</button>
        <button className={button} disabled={Boolean(busy) || dirty || !rows.length || JSON.stringify(saved.rows) === JSON.stringify(saved.sharedRows)} onClick={() => setShareConfirm(!shareConfirm)} aria-expanded={shareConfirm}><Eye size={17} /> Visa för beställaren</button>
        {saved.sharedRows.length > 0 && <button className={button} disabled={Boolean(busy) || dirty} onClick={() => void write('unshare')}><EyeOff size={17} /> Dölj för beställaren</button>}
        <span className="text-sm text-slate-600">{saved.sharedRows.length ? `${saved.sharedRows.length} moment delade${JSON.stringify(saved.rows) !== JSON.stringify(saved.sharedRows) ? ' · Nyare intern plan finns' : ''}` : 'Planeringen är intern'}</span>
      </div>
      {shareConfirm && <div className="mt-4 border-t border-slate-200 pt-4">
        <p className="text-sm">Den sparade tidsplanen blir synlig för beställaren. Grundavtalets tider ändras inte.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button className={`${button} bg-slate-950 text-white`} disabled={Boolean(busy) || dirty} onClick={() => void write('share')}>{busy === 'share' ? <Loader2 size={17} className="animate-spin" /> : <Eye size={17} />} Bekräfta delning</button>
          <button className={button} disabled={Boolean(busy)} onClick={() => setShareConfirm(false)}>Avbryt</button>
        </div>
      </div>}
    </>}
  </section>
}
