'use client'

import { useCallback, useEffect, useRef, useState, type SetStateAction } from 'react'
import { ArrowDown, ArrowUp, Download, Eye, EyeOff, ListX, Loader2, Pencil, Plus, RefreshCw, Undo2 } from 'lucide-react'
import { useToast } from '@/components/ui/AppToastProvider'
import { importScheduleRows, normalizeScheduleRows, scheduleStatuses, type ProjectSchedule, type ProjectScheduleRow } from '@/lib/action-cases/projectSchedule'
import { retainNewerDraft } from '@/lib/action-cases/draftSave'
import { useProjectScheduleAutosave } from './useProjectScheduleAutosave'
import { scheduleDateLabel, scheduleDays } from '@/lib/action-cases/scheduleTimeline'
import ProjectScheduleGantt from './ProjectScheduleGantt'
import ProjectScheduleRowEditor from './ProjectScheduleRowEditor'
import './project-schedule.css'

const button = 'gizmo-schedule-button'
const icon = 'gizmo-schedule-icon'
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

export default function ProjectScheduleEditor({ caseId, items, onDirty, onShared, customerRefresh = 0 }: {
  caseId: string; items: { id: string; title: string }[]
  onDirty: (dirty: boolean) => void
  onShared: (rows: ProjectScheduleRow[]) => void
  customerRefresh?: number
}) {
  const [saved, setSaved] = useState<ProjectSchedule | null>(null)
  const [rows, setRowsState] = useState<ProjectScheduleRow[]>([])
  const [busy, setBusy] = useState('load'), [error, setError] = useState(false)
  const [showImport, setShowImport] = useState(false), [selected, setSelected] = useState<string[]>([])
  const [shareConfirm, setShareConfirm] = useState(false)
  const [discardConfirm, setDiscardConfirm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null), [selectedId, setSelectedId] = useState<string | null>(null)
  const rowNodes = useRef(new Map<string, HTMLTableRowElement>())
  const [removed, setRemoved] = useState<{ row: ProjectScheduleRow; index: number } | null>(null)
  const running = useRef(false), toast = useToast()
  const currentRows = useRef(rows), currentSaved = useRef(saved), loadedRefresh = useRef<number | null>(null)
  const [saveError, setSaveError] = useState('')
  const autosave = useProjectScheduleAutosave({
    save: async (submitted, revision) => {
      const response = await fetch(`/api/action-cases/${caseId}/schedule`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(45000), body: JSON.stringify({ operation: 'save', rows: normalizeScheduleRows(submitted), revision }) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Tidsplanen kunde inte sparas. Dina ändringar är kvar.')
      return data as ProjectSchedule
    },
    onSaved: (data, submitted) => {
      currentSaved.current = data; setSaved(data)
      const next = retainNewerDraft(currentRows.current, submitted, data.rows)
      currentRows.current = next; setRowsState(next); onShared(data.sharedRows); setSaveError('')
    },
    onError: error => setSaveError(error instanceof Error ? error.message : 'Tidsplanen kunde inte sparas.'),
  })
  const saveRef = useRef(autosave); saveRef.current = autosave
  function setRows(value: SetStateAction<ProjectScheduleRow[]>) {
    const next = typeof value === 'function' ? value(currentRows.current) : value
    currentRows.current = next; setRowsState(next); setShareConfirm(false)
    let valid = true
    try { normalizeScheduleRows(next) } catch { valid = false }
    autosave.change(next, valid)
  }
  const dirty = Boolean(saved && JSON.stringify(rows) !== JSON.stringify(saved.rows))
  const refresh = useCallback(async (signal?: AbortSignal, discard = false) => {
    if (!discard && (saveRef.current.isPending() || JSON.stringify(currentRows.current) !== JSON.stringify(currentSaved.current?.rows ?? []))) return
    const before = JSON.stringify(currentRows.current)
    setBusy('load'); setError(false)
    try {
      const response = await fetch(`/api/action-cases/${caseId}/schedule`, { signal })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Tidsplanen kunde inte hämtas.')
      if (signal?.aborted || before !== JSON.stringify(currentRows.current) || saveRef.current.isSaving) return
      currentSaved.current = data; currentRows.current = data.rows
      setSaved(data); setRowsState(data.rows); onShared(data.sharedRows); saveRef.current.reset(data.revision); setSaveError('')
      loadedRefresh.current = customerRefresh
    } catch (e) {
      if (!signal?.aborted) { setError(true); toast.error(e, 'Tidsplanen kunde inte hämtas.') }
    } finally { if (!signal?.aborted) setBusy('') }
  }, [caseId, onShared, toast, customerRefresh])
  useEffect(() => {
    if (loadedRefresh.current === customerRefresh || dirty || saveRef.current.isPending()) return
    const controller = new AbortController(); void refresh(controller.signal); return () => controller.abort()
  }, [refresh, customerRefresh, dirty, autosave.state])
  useEffect(() => { onDirty(dirty || saveRef.current.isPending() || Boolean(busy && busy !== 'load')) }, [dirty, busy, onDirty, autosave.state])
  useEffect(() => {
    if (!dirty && !saveRef.current.isPending()) return
    const prevent = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', prevent)
    return () => window.removeEventListener('beforeunload', prevent)
  }, [dirty, autosave.state])
  async function write(operation: 'share' | 'unshare') {
    if (running.current || !saved) return
    try { normalizeScheduleRows(rows, operation === 'share') } catch { toast.error('Kontrollera rubriker och datum. Slutdatum får inte ligga före startdatum.'); return }
    if (autosave.isPending() || (operation === 'share' && (!shareConfirm || dirty))) return
    running.current = true; setBusy(operation)
    try {
      const response = await fetch(`/api/action-cases/${caseId}/schedule`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ operation, rows: currentRows.current, revision: autosave.getRevision(), confirmed: operation === 'share' }) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Tidsplanen kunde inte sparas.')
      currentSaved.current = data; currentRows.current = data.rows
      setSaved(data); setRowsState(data.rows); autosave.reset(data.revision); onShared(data.sharedRows)
      setShareConfirm(false)
      toast.success(operation === 'share' ? 'Tidsplanen visas för beställaren.' : 'Tidsplanen är nu intern.')
    } catch (e) { toast.error(e, 'Tidsplanen kunde inte sparas. Dina ändringar finns kvar.') }
    finally { running.current = false; setBusy('') }
  }
  function patch(id: string, value: Partial<ProjectScheduleRow>) { setRows((current) => current.map((r) => r.id === id ? { ...r, ...value } : r)) }
  function move(id: string, delta: number) {
    const current = currentRows.current, index = current.findIndex(row => row.id === id), target = index + delta
    if (index < 0 || target < 0 || target >= current.length) return
    const next = [...current]; [next[index], next[target]] = [next[target], next[index]]; setRows(next)
  }
  function importSelectedRows() {
    const current = currentRows.current
    const sources = items.filter(item => selected.includes(item.id) && !current.some(row => row.sourceItemId === item.id))
    if (!sources.length || sources.length > 200 - current.length) return
    setRows(importScheduleRows(current, sources, () => crypto.randomUUID())); setSelected([]); setShowImport(false)
  }
  function addRow() {
    const row: ProjectScheduleRow = { id: crypto.randomUUID(), title: '', phase: '', startDate: '', endDate: '', status: 'planned', sourceItemId: null }
    setRows([...currentRows.current, row]); setEditingId(row.id); setSelectedId(row.id)
  }
  function selectRow(id: string) {
    setSelectedId(id)
    const node = rowNodes.current.get(id); node?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); node?.focus({ preventScroll: true })
  }
  const available = items.filter((i) => !rows.some((r) => r.sourceItemId === i.id))
  const importCount = available.filter(item => selected.includes(item.id)).length
  const allImportSelected = available.length > 0 && importCount === available.length
  const importCapacity = 200 - rows.length
  const editingIndex = rows.findIndex(row => row.id === editingId), editingRow = rows[editingIndex]
  const saveStatus = busy === 'load' ? 'Hämtar…' : busy ? 'Uppdaterar delning…' : saveError ? 'Kunde inte spara' : autosave.state?.status === 'invalid' ? 'Komplettera moment och datum · Inte sparat' : autosave.isSaving ? 'Sparar…' : dirty ? 'Osparade ändringar' : saved?.available ? 'Sparat internt' : ''
  return <section className="gizmo-project-schedule border-t border-slate-200 py-5" aria-label="Produktionsplanering">
    <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="text-lg">Produktionsplanering</h3>
      <div className="flex min-h-8 flex-wrap items-center gap-3"><span role="status" className="text-sm text-slate-600">{saveStatus}</span>
        {saveError && <button type="button" className={button} disabled={Boolean(busy) || autosave.isSaving} onClick={() => void autosave.retry()}><RefreshCw size={17} />Försök igen</button>}
        <button className={icon} title="Hämta sparad tidsplan" aria-label="Hämta sparad tidsplan" disabled={Boolean(busy) || autosave.isSaving} onClick={() => { if (dirty) setDiscardConfirm(true); else void refresh() }}><RefreshCw size={17} /></button></div>
    </div>
    {discardConfirm && <div role="alert" className="gizmo-schedule-confirm"><strong>Ersätta dina osparade tidsplaneändringar?</strong><p>Det lokala utkastet ersätts först när den sparade tidsplanen har hämtats.</p><div><button className={button} disabled={Boolean(busy)} onClick={() => setDiscardConfirm(false)}>Avbryt hämtning</button><button className={button} disabled={Boolean(busy) || autosave.isSaving} onClick={() => { setDiscardConfirm(false); void refresh(undefined, true) }}>Ersätt med sparad tidsplan</button></div></div>}
    {error && <p role="alert" className="py-4 text-sm">Tidsplanen kunde inte hämtas. Försök igen med uppdateringsknappen.</p>}
    {saveError && <p role="alert" className="py-2 text-sm text-rose-700">{saveError}</p>}
    {saved && !saved.available && <p className="py-4 text-sm">Tidsplaneringen behöver aktiveras av administratören.</p>}
    {saved?.available && <>
      <fieldset className="min-w-0" disabled={Boolean(busy)}>
        <ProjectScheduleGantt rows={rows} selectedId={selectedId} onSelect={selectRow} />
        <div className="gizmo-schedule-toolbar gizmo-schedule-table-toolbar"><div className="gizmo-schedule-heading"><h4>Moment och datum</h4><span>{rows.filter(row => scheduleDays(row) !== null).length} datumsatta</span></div><div className="gizmo-schedule-tools">
          <button className={button} disabled={!available.length || rows.length >= 200} onClick={() => setShowImport(!showImport)} aria-expanded={showImport}><Download size={17} /> Hämta från projektarbete</button>
          <button className={button} disabled={rows.length >= 200} onClick={addRow}><Plus size={17} /> Lägg till moment</button>
          {removed && <button className={button} disabled={rows.length >= 200 || rows.some((r) => r.sourceItemId && r.sourceItemId === removed.row.sourceItemId)} onClick={() => { const next = [...rows]; next.splice(Math.min(removed.index, next.length), 0, removed.row); setRows(next); setRemoved(null) }}><Undo2 size={17} /> Ångra borttagning</button>}
        </div></div>
        {showImport && <section className="gizmo-schedule-import" aria-label="Hämta moment från projektarbete">
          <div className="gizmo-schedule-import-tools"><label><input type="checkbox" aria-label="Välj alla moment för import" disabled={!available.length} checked={allImportSelected} ref={node => { if (node) node.indeterminate = importCount > 0 && !allImportSelected }} onChange={event => setSelected(event.target.checked ? available.map(item => item.id) : [])} />Välj alla</label><span role="status">{importCount} av {available.length} valda</span><button type="button" className={button} disabled={!importCount} onClick={() => setSelected([])}><ListX size={16} />Avmarkera alla</button></div>
          <div className="gizmo-schedule-import-items">{available.map(item => <label key={item.id}><input type="checkbox" checked={selected.includes(item.id)} onChange={event => setSelected(current => event.target.checked ? [...current, item.id] : current.filter(id => id !== item.id))} />{item.title}</label>)}{!available.length && <p>Alla projektmoment finns redan i tidsplanen.</p>}</div>
          {importCount > importCapacity && <p role="alert" className="gizmo-schedule-warning">Det finns plats för {importCapacity} moment till. Avmarkera {importCount - importCapacity} moment för att hämta de valda.</p>}
          <button type="button" className={button} disabled={!importCount || importCount > importCapacity} onClick={importSelectedRows}><Plus size={17} />Lägg till valda moment ({importCount})</button>
        </section>}
        <div className="gizmo-schedule-table-scroll" role="region" aria-label="Moment och datum" tabIndex={0}><table className="gizmo-schedule-table"><colgroup><col /><col style={{ width: 145 }} /><col style={{ width: 145 }} /><col style={{ width: 70 }} /><col style={{ width: 110 }} /><col style={{ width: 'var(--schedule-actions-width)' }} /></colgroup><thead><tr><th>Moment</th><th>Start</th><th>Slut</th><th title="Kalenderdagar, inklusive start- och slutdag">Dagar</th><th>Status</th><th><span className="sr-only">Ordning och redigering</span></th></tr></thead><tbody>{rows.map((row, index) => <tr key={row.id} tabIndex={-1} ref={node => { if (node) rowNodes.current.set(row.id, node); else rowNodes.current.delete(row.id) }} className={selectedId === row.id ? 'is-selected' : undefined}>
          <td><button type="button" className="gizmo-schedule-title" title={[row.title || 'Nytt moment', row.phase].filter(Boolean).join(' · ')} onClick={() => { setEditingId(row.id); setSelectedId(row.id) }}><span>{index + 1}</span><strong>{row.title || 'Nytt moment'}</strong>{row.phase && <small>{row.phase}</small>}</button></td>
          <td>{scheduleDateLabel(row.startDate)}</td><td>{scheduleDateLabel(row.endDate)}</td><td>{scheduleDays(row) ?? '–'}</td><td><span className={`gizmo-schedule-status is-${row.status}`}>{scheduleStatuses[row.status]}</span></td><td><div className="gizmo-schedule-order-actions"><button type="button" className={icon} title="Flytta upp" aria-label={`Flytta upp ${row.title || 'moment'}`} disabled={index === 0} onClick={() => move(row.id, -1)}><ArrowUp size={16} /></button><button type="button" className={icon} title="Flytta ned" aria-label={`Flytta ned ${row.title || 'moment'}`} disabled={index === rows.length - 1} onClick={() => move(row.id, 1)}><ArrowDown size={16} /></button><button type="button" className={icon} title={`Redigera ${row.title || 'moment'}`} aria-label={`Redigera ${row.title || 'moment'}`} onClick={() => { setEditingId(row.id); setSelectedId(row.id) }}><Pencil size={16} /></button></div></td>
        </tr>)}</tbody></table>{!rows.length && <p className="gizmo-schedule-empty">Inga moment planerade.</p>}</div>
      </fieldset>
      {editingRow && <ProjectScheduleRowEditor key={editingRow.id} row={editingRow} index={editingIndex} count={rows.length} disabled={Boolean(busy)} saveStatus={saveStatus} saveError={saveError} onRetry={() => void autosave.retry()} onPatch={value => patch(editingRow.id, value)} onMove={delta => move(editingRow.id, delta)} onRemove={() => { setRemoved({ row: editingRow, index: editingIndex }); setRows(current => current.filter(row => row.id !== editingRow.id)); setEditingId(null) }} onClose={() => setEditingId(null)} />}
      <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-slate-200 pt-4">
        <button className={button} disabled={Boolean(busy) || autosave.isPending() || dirty || !rows.length || JSON.stringify(saved.rows) === JSON.stringify(saved.sharedRows)} onClick={() => setShareConfirm(!shareConfirm)} aria-expanded={shareConfirm}><Eye size={17} /> Visa för beställaren</button>
        {saved.sharedRows.length > 0 && <button className={button} disabled={Boolean(busy) || autosave.isPending() || dirty} onClick={() => void write('unshare')}><EyeOff size={17} /> Dölj för beställaren</button>}
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
