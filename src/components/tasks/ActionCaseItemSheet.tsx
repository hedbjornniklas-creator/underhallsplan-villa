'use client'

import { Fragment, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Calculator, Check, ClipboardList, ListChecks, Loader2, Mail, MoreHorizontal, Pencil, Plus, Save, Settings2, Sparkles, Trash2, X } from 'lucide-react'
import type { ActionCaseCostLineView, ActionCaseCostSuggestion, ActionCaseItemView, ActionCaseView } from '@/lib/action-cases/contracts'
import { actionCaseCostCoverage, calculateActionCaseCostTotals } from '@/lib/action-cases/domain'
import { normalizeCostLine } from '@/lib/action-cases/costing'
import ActionCaseWorkQuotes from './ActionCaseWorkQuotes'
import ActionCaseAttachmentPicker from './ActionCaseAttachmentPicker'
import ActionCaseLumpSumEditor from './ActionCaseLumpSumEditor'
import { scopeAttachmentIds } from '@/lib/action-cases/scopeAttachments'
import { ActionCaseWorkParts, ActionCaseWorkSelection, getWorkPartId, UNASSIGNED_WORK } from './ActionCaseWorkParts'
import { coveringQuoteForLine, groupPriceForLine } from './actionCaseGroupPricing'
import { actionScopeDraft, type ActionScopeDraft } from '@/lib/action-cases/scopeDraft'
import type { ScopeSaveState } from './useActionScopeAutosave'
import './action-case-costs.css'

type Props = {
  item: ActionCaseItemView
  caseId?: string
  attachments?: ActionCaseView['attachments']
  participants?: ActionCaseView['participants']
  initialCostLineId?: string
  onRequest?: (costLineIds: string[]) => void
  onOpenRequest?: (requestId: string) => void
  busy: boolean
  onClose: () => void
  onSave: (payload: Record<string, unknown>) => Promise<boolean>
  scopeSave?: ScopeSaveState
  scopeBlocked: boolean
  onScopeChange: (draft: ActionScopeDraft) => void
  onScopeFlush: () => void
  onScopeRetry: () => void
  onDirtyChange?: (dirty: boolean) => void
  onDelete?: () => Promise<boolean>
  onCostAction: (action: string, payload: Record<string, unknown>) => Promise<boolean>
}
const inputClass = 'mt-1 min-h-11 w-full min-w-0 rounded-lg border border-slate-300 bg-white px-3 text-sm font-normal text-slate-950 focus:border-violet-500 focus:outline-none focus:ring-2 focus:ring-violet-100'
const secondary = 'inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40'
const primary = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-violet-700 px-4 text-sm font-semibold text-white hover:bg-violet-800 disabled:opacity-40'
const money = new Intl.NumberFormat('sv-SE', { style: 'currency', currency: 'SEK', maximumFractionDigits: 2 })
const amount = (value: number | null) => value === null ? 'Ej komplett' : money.format(value)
const basisLabels = { provided: 'Angiven', calculated: 'Beräknad', estimated: 'Uppskattad', unknown: 'Mängd saknas' }
const categoryLabels = { own_labor: 'Eget arbete', material: 'Material', subcontractor: 'Underentreprenör', waste: 'Avfall', transport: 'Transport', other: 'Övrigt' }
const sourceLabels = { manual: 'Manuellt pris', beijer: 'Beijer', subcontractor: 'UE-offert', price_book: 'Prislista', ai_suggestion: 'AI-förslag', other: 'Annan källa' }
const groups = [
  { key: 'own_labor', title: 'Arbete', categories: ['own_labor', 'subcontractor'], ready: 'ownLaborReady' },
  { key: 'material', title: 'Material', categories: ['material'], ready: 'materialPriceReady' },
  { key: 'other', title: 'Övrigt', categories: ['waste', 'transport', 'other'], ready: 'wasteSolutionReady' },
] as const

function CostLineForm({ initial, category, busy, onSave, onCancel }: {
  initial?: ActionCaseCostLineView; category: string; busy: boolean
  onSave: (payload: Record<string, unknown>) => Promise<boolean>; onCancel: () => void
}) {
  const [newId] = useState(() => crypto.randomUUID())
  const [method, setMethod] = useState<'direct' | 'quotes'>('direct')
  const [cost, setCost] = useState({
    category: initial?.category ?? category, description: initial?.description ?? '',
    quantity: initial?.quantity?.toString() ?? '', unit: initial?.unit ?? (category === 'own_labor' ? 'tim' : 'st'),
    unitCost: initial?.unitCost?.toString() ?? '', markupPercent: initial?.markupPercent?.toString() ?? '20',
    priceSource: initial?.priceSource ?? 'manual', sourceUrl: initial?.sourceUrl ?? '',
    quantityBasis: initial?.quantityBasis ?? 'provided', notes: initial?.notes ?? '', verified: initial?.verified ?? false,
  })
  const set = (key: string, value: string | boolean) => setCost((current) => ({
    ...current, [key]: value, verified: key === 'verified' ? Boolean(value) : false,
    ...(key === 'quantity' ? { quantityBasis: !value ? 'unknown' : current.quantityBasis === 'unknown' ? 'provided' : current.quantityBasis } : {}),
    ...(key === 'unitCost' && current.priceSource === 'ai_suggestion' && String(value).trim() ? { priceSource: 'manual' } : {}),
  }))
  let valid = false
  try { normalizeCostLine(cost); valid = true } catch { /* Keep the form open until valid. */ }
  const field = (key: 'description' | 'quantity' | 'unit' | 'unitCost' | 'markupPercent' | 'sourceUrl', label: string, type = 'text') => (
    <label className="min-w-0 text-xs font-semibold text-slate-600">{label}<input name={key} autoFocus={key === 'description'} className={inputClass} type={type} step={type === 'number' ? 'any' : undefined} value={cost[key]} onChange={(e) => set(key, e.target.value)} /></label>
  )
  return <form className="space-y-4 border-y border-violet-200 bg-violet-50/30 py-4" onSubmit={(e) => {
    e.preventDefault(); if (!valid || busy) return
    void onSave({ ...cost, pricingMethod: method, costLineId: initial?.id ?? (method === 'quotes' ? newId : undefined) }).then((saved) => { if (saved) onCancel() })
  }}>
    <h4 className="font-semibold">{initial ? 'Redigera kalkylrad' : 'Ny kalkylrad'}</h4>
    <fieldset disabled={busy} className="grid min-w-0 gap-3 sm:grid-cols-2">
      {field('description', 'Beskrivning *')}
      <label className="text-xs font-semibold text-slate-600">Kategori<select className={inputClass} value={cost.category} onChange={(e) => { set('category', e.target.value); if (!['own_labor', 'subcontractor'].includes(e.target.value)) setMethod('direct') }}>{Object.entries(categoryLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      {!initial && ['own_labor', 'subcontractor'].includes(cost.category) ? <div className="grid grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1 sm:col-span-2">{([['direct', 'Timmar / eget pris'], ['quotes', 'Ta in offerter']] as const).map(([key, label]) => <button type="button" key={key} className={`min-h-11 rounded-md text-sm font-semibold ${method === key ? 'bg-white text-violet-800 shadow-sm' : 'text-slate-600'}`} aria-pressed={method === key} onClick={() => setMethod(key)}>{label}</button>)}</div> : null}
      {method === 'quotes' ? <>{field('markupPercent', 'Påslag, %', 'number')}</> : <>
      <div className="grid min-w-0 grid-cols-2 gap-2">{field('quantity', 'Mängd', 'number')}{field('unit', 'Enhet *')}</div>
      <div className="grid min-w-0 grid-cols-2 gap-2">{field('unitCost', 'Kostnad/enhet, kr', 'number')}{field('markupPercent', 'Påslag, %', 'number')}</div>
      <label className="text-xs font-semibold text-slate-600">Mängdunderlag<select className={inputClass} value={cost.quantity ? cost.quantityBasis : 'unknown'} disabled={!cost.quantity} onChange={(e) => set('quantityBasis', e.target.value)}>{Object.entries(basisLabels).filter(([key]) => key !== 'unknown' || !cost.quantity).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <label className="text-xs font-semibold text-slate-600">Priskälla<select className={inputClass} value={cost.priceSource} onChange={(e) => set('priceSource', e.target.value)}>{Object.entries(sourceLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      {field('sourceUrl', 'Källänk', 'url')}
      <label className="text-xs font-semibold text-slate-600 sm:col-span-2">Antaganden och underlag<textarea rows={2} className={`${inputClass} py-2`} value={cost.notes} onChange={(e) => set('notes', e.target.value)} /></label>
      </>}
    </fieldset>
    <div className="flex justify-end gap-2"><button type="button" className={secondary} disabled={busy} onClick={onCancel}>Avbryt</button><button type="submit" className={primary} disabled={busy || !valid}>{busy ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />} Spara rad</button></div>
  </form>
}

function Proposal({ proposal, stale, busy, onApply }: {
  proposal: ActionCaseCostSuggestion; stale: boolean; busy: boolean; onApply: (ids: string[]) => Promise<boolean>
}) {
  const [selected, setSelected] = useState<string[]>([])
  return <section className="mt-4 border-y border-violet-200 py-4">
    <h3 className="font-semibold text-slate-950">AI-förslag att granska</h3>
    <p className="mt-1 text-sm text-slate-500">{proposal.lines.length} föreslagna rader · Priser ej inhämtade</p>
    {stale ? <p role="status" className="mt-3 text-sm text-amber-800">Underlaget har ändrats. Skapa ett nytt förslag.</p> : null}
    {proposal.warnings.map((warning, index) => <p key={index} className="mt-2 text-sm text-amber-800">{warning}</p>)}
    {!proposal.lines.length ? <p className="mt-3 text-sm text-slate-600">Inga ytterligare kalkylrader föreslogs.</p> : <>
      <label className="mt-4 flex items-center gap-2 text-sm font-medium"><input type="checkbox" className="h-4 w-4 accent-violet-600" disabled={busy || stale} checked={selected.length === proposal.lines.length} onChange={(e) => setSelected(e.target.checked ? proposal.lines.map((line) => line.id) : [])} />Välj alla</label>
      <div className="mt-2 divide-y divide-slate-200">{proposal.lines.map((line) => <label key={line.id} className="flex items-start gap-3 py-3 text-sm">
        <input type="checkbox" className="mt-1 h-4 w-4 shrink-0 accent-violet-600" disabled={busy || stale} checked={selected.includes(line.id)} onChange={(e) => setSelected((ids) => e.target.checked ? [...ids, line.id] : ids.filter((id) => id !== line.id))} />
        <span className="min-w-0 break-words"><strong className="block">{line.description}</strong><span className="mt-1 block text-xs text-slate-500">{categoryLabels[line.category]} · {line.quantity ?? '?'} {line.unit} · {basisLabels[line.quantityBasis]}</span>{line.notes ? <span className="mt-1 block text-slate-600">{line.notes}</span> : null}</span>
      </label>)}</div>
      <button type="button" disabled={busy || stale || !selected.length} className={`${primary} mt-3`} onClick={() => void onApply(selected)}>{busy ? <Loader2 className="animate-spin" size={16} /> : <Plus size={16} />} Lägg till valda ({selected.length})</button>
    </>}
  </section>
}

export default function ActionCaseItemSheet({ item, caseId, attachments = [], participants = [], initialCostLineId, onRequest, onOpenRequest, busy, onClose, onSave, scopeSave, scopeBlocked, onScopeChange, onScopeFlush, onScopeRetry, onDirtyChange, onDelete, onCostAction }: Props) {
  const dialog = useRef<HTMLDivElement>(null)
  const backdropPress = useRef(false)
  const tabId = useId()
  const deleteConfirmation = useRef<HTMLElement>(null)
  const inFlight = useRef(false)
  const [tab, setTab] = useState<'scope' | 'cost'>(initialCostLineId ? 'cost' : 'scope')
  const draft = scopeSave?.draft ?? actionScopeDraft(item, scopeAttachmentIds(item, attachments))
  const { title, scope, scopeConditions = '', scopeExclusions = '', scopeAdvice = '', scopeAttachmentIds: selectedFiles } = draft
  const changeScope = (patch: Partial<ActionScopeDraft>) => onScopeChange({ ...draft, ...patch })
  const [editing, setEditing] = useState<{ category: string; line?: ActionCaseCostLineView } | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [pending, setPending] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  useEffect(() => {
    if (confirmDelete) { deleteConfirmation.current?.scrollIntoView({ block: 'nearest' }); deleteConfirmation.current?.focus({ preventScroll: true }) }
  }, [confirmDelete])
  const [quoteLineId, setQuoteLineId] = useState<string | null>(initialCostLineId ?? null)
  const [quoteEditing, setQuoteEditing] = useState(false)
  const [selectMode, setSelectMode] = useState(false)
  const [advanced, setAdvanced] = useState<'parts' | 'categories' | 'pricing' | null>(null)
  const tools = useRef<HTMLDetailsElement>(null)
  const [partFilter, setPartFilter] = useState('')
  const [partEditing, setPartEditing] = useState(false)
  const [bulkEditing, setBulkEditing] = useState(false)
  const [lumpDirty, setLumpDirty] = useState(false)
  const [selectedLineIds, setSelectedLineIds] = useState<string[]>([])
  const selectedLines = item.costLines.filter((line) => selectedLineIds.includes(line.id))
  const parts = [...(item.workParts ?? [])].sort((a, b) => a.sortOrder - b.sortOrder || a.title.localeCompare(b.title, 'sv'))
  const activePartFilter = partFilter === UNASSIGNED_WORK || parts.some((part) => part.id === partFilter) ? partFilter : ''
  const filterParts = (id: string) => { setPartFilter(id); setQuoteLineId(null) }
  const selectLines = (lineIds: string[], checked: boolean) => setSelectedLineIds((ids) => checked ? [...new Set([...ids, ...lineIds])] : ids.filter((id) => !lineIds.includes(id)))
  const working = busy || pending
  const costDirty = Boolean(editing) || quoteEditing || partEditing || bulkEditing || lumpDirty
  useEffect(() => { onDirtyChange?.(costDirty); return () => onDirtyChange?.(false) }, [costDirty, onDirtyChange])
  const dirty = scopeBlocked
  const totals = item.lumpSum ?? calculateActionCaseCostTotals(item.costLines)
  const coverage = actionCaseCostCoverage(item.costLines)
  const stale = Boolean(item.costSuggestion && item.costSuggestion.sourceUpdatedAt !== item.updatedAt)
  const visibleLines = item.costLines.filter((line) => !['own_labor', 'subcontractor'].includes(line.category) || !activePartFilter || (activePartFilter === UNASSIGNED_WORK ? !getWorkPartId(line) : getWorkPartId(line) === activePartFilter))
  const columns = selectMode ? 7 : 6
  const tool = (action: () => void) => { tools.current?.removeAttribute('open'); action() }
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    dialog.current?.focus()
    return () => { document.body.style.overflow = overflow; previous?.focus() }
  }, [])
  const run = async (work: () => Promise<boolean>) => {
    if (busy || inFlight.current) return false
    inFlight.current = true; setPending(true)
    try { return await work() } finally { inFlight.current = false; setPending(false) }
  }
  const close = () => {
    if (working) return
    if (costDirty && !window.confirm('Stäng utan att spara kalkyländringarna?')) return
    onClose()
  }
  const selectTab = (next: 'scope' | 'cost') => {
    if (next === tab || costDirty || working) return
    onScopeFlush(); setTab(next)
  }
  const generate = () => void run(async () => {
    setGenerating(true)
    try { return await onCostAction('generate_cost_suggestions', {}) } finally { setGenerating(false) }
  })
  if (typeof document === 'undefined') return null
  return createPortal(<div className="uppdrag-scope gizmo-dialog-scope fixed inset-0 z-50 flex justify-end bg-black/40" data-testid="action-item-backdrop"
    onPointerDown={(event) => { backdropPress.current = event.target === event.currentTarget && event.button === 0 }}
    onPointerCancel={() => { backdropPress.current = false }}
    onClick={(event) => {
      // Releasing a text selection outside the sheet must not close it.
      const outside = backdropPress.current && event.target === event.currentTarget
      backdropPress.current = false
      if (outside) close()
    }}>
    <div ref={dialog} role="dialog" aria-modal="true" tabIndex={-1} aria-labelledby="action-item-title" className={`h-dvh w-full max-w-3xl bg-white text-slate-950 shadow-2xl outline-none ${tab === 'cost' ? 'gizmo-cost-sheet' : ''}`} onKeyDown={(event) => {
      if (event.key === 'Escape') { event.preventDefault(); close() }
      if (event.key !== 'Tab') return
      const controls = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]') ?? []).filter((node) => node.tabIndex >= 0 && node.getClientRects().length)
      const first = controls[0], last = controls.at(-1)
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }}>
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-200 px-4 py-4 sm:px-6">
        <div className="min-w-0"><p className="text-xs font-semibold text-violet-700">Åtgärd</p><h2 id="action-item-title" className="mt-1 break-words text-xl font-semibold">{item.title}</h2></div>
        <div className="flex shrink-0 gap-2">
          {onDelete && <button type="button" className={`${secondary} h-11 w-11 px-0 text-rose-700`} aria-label="Ta bort åtgärd" title="Ta bort åtgärd" disabled={working || costDirty || dirty} onClick={() => setConfirmDelete(true)}><Trash2 size={18} /></button>}
          <button type="button" className={`${secondary} h-11 w-11 px-0`} aria-label="Stäng åtgärd" title="Stäng" disabled={working} onClick={close}><X size={20} /></button>
        </div>
      </header>
      <div role="tablist" aria-label="Åtgärdens innehåll" className="gizmo-register-tabs" onKeyDown={(event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
        event.preventDefault()
        const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]:not(:disabled)'))
        const index = tabs.indexOf(document.activeElement as HTMLButtonElement)
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowLeft' ? -1 : 1) + tabs.length) % tabs.length
        tabs[next]?.focus(); tabs[next]?.click()
      }}>
        {([['scope', 'Omfattning', ClipboardList], ['cost', 'Kalkyl', Calculator]] as const).map(([key, label, Icon]) => <button key={key} type="button" role="tab" id={`${tabId}-${key}`} aria-controls={`${tabId}-panel`} aria-selected={tab === key} tabIndex={tab === key ? 0 : -1} disabled={(costDirty || working) && tab !== key} onClick={() => selectTab(key)} className="gizmo-register-tab"><Icon size={17} aria-hidden="true" />{label}</button>)}
      </div>
      <div role="tabpanel" id={`${tabId}-panel`} aria-labelledby={`${tabId}-${tab}`} className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
        {confirmDelete && onDelete && <section ref={deleteConfirmation} tabIndex={-1} role="alert" aria-label="Bekräfta borttagning" className="mb-5 border-b border-rose-200 pb-5 outline-none">
          <h3 className="font-semibold">Ta bort {item.title}?</h3>
          <p className="mt-2 text-sm leading-6">Åtgärden och dess kalkyl tas bort. Projektets bilder och dokument behålls. Det går inte att ångra.</p>
          {dirty && <p className="mt-2 text-sm">Osparade ändringar i åtgärden kastas.</p>}
          <div className="mt-3 flex flex-wrap gap-2"><button type="button" className={secondary} disabled={working} onClick={() => setConfirmDelete(false)}>Avbryt</button><button type="button" className={`${secondary} text-rose-700`} disabled={working} onClick={() => void run(onDelete)}>{working ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}Ta bort permanent</button></div>
        </section>}
        {tab === 'scope' ? <fieldset disabled={working} className="space-y-5">
          <label className="block text-sm font-semibold">Rubrik *<input className={inputClass} value={title} onChange={(e) => changeScope({ title: e.target.value })} /></label>
          <label className="block text-sm font-semibold">Arbetets omfattning<textarea className={`${inputClass} py-3 leading-6`} rows={5} value={scope} onChange={(e) => changeScope({ scope: e.target.value })} /></label>
          <label className="block text-sm font-semibold">Förutsättningar (valfritt)<textarea className={`${inputClass} py-3 leading-6`} rows={3} maxLength={6000} disabled={!item.scopeConditionsAvailable} value={scopeConditions} onChange={(e) => changeScope({ scopeConditions: e.target.value })} /></label>
          {!item.scopeConditionsAvailable && <p role="status" className="text-sm text-slate-600">Fältet Förutsättningar behöver aktiveras av administratören.</p>}
          <label className="block text-sm font-semibold">Ingår inte (valfritt)<textarea className={`${inputClass} py-3 leading-6`} rows={3} maxLength={6000} disabled={!item.scopeNotesAvailable} value={scopeExclusions} onChange={(e) => changeScope({ scopeExclusions: e.target.value })} /></label>
          <label className="block text-sm font-semibold">Avrådan (valfritt)<textarea className={`${inputClass} py-3 leading-6`} rows={3} maxLength={6000} disabled={!item.scopeNotesAvailable} value={scopeAdvice} onChange={(e) => changeScope({ scopeAdvice: e.target.value })} /></label>
          {!item.scopeNotesAvailable && <p role="status" className="text-sm text-slate-600">Fälten Ingår inte och Avrådan behöver aktiveras av administratören.</p>}
          <section className="border-t border-slate-200 pt-4" aria-label="Åtgärdens underlag">
            <h3 className="font-semibold">Bilder och dokument <span className="ml-2 text-sm font-normal text-slate-500">{selectedFiles.length} valda</span></h3>
            <ActionCaseAttachmentPicker caseId={caseId} files={attachments} selectedIds={selectedFiles} inputName="scopeAttachment" selectionLabel="Använd i åtgärden" disabled={working} onChange={(id, checked) => changeScope({ scopeAttachmentIds: checked ? [...new Set([...selectedFiles, id])] : selectedFiles.filter((value) => value !== id) })} />
            {selectedFiles.some((id) => !attachments.some((file) => file.id === id)) ? <p role="status" className="mt-3 text-sm text-amber-800">En vald fil finns inte längre. <button type="button" className="underline" onClick={() => changeScope({ scopeAttachmentIds: selectedFiles.filter((id) => attachments.some((file) => file.id === id)) })}>Ta bort otillgängliga val</button></p> : null}
          </section>
        </fieldset> : <>
          {item.lumpSumAvailable && (item.lumpSum || advanced === 'pricing') && <ActionCaseLumpSumEditor key={JSON.stringify(item.lumpSum)} value={item.lumpSum ?? null} busy={working || dirty || Boolean(editing) || quoteEditing || bulkEditing || partEditing || !['scope_needed', 'pricing_needed', 'waiting_subcontractor', 'ready_for_quote'].includes(item.status)} onDirty={setLumpDirty} onSave={(lumpSum) => run(async () => { const saved = await onSave({ lumpSum }); if (saved) setSelectedLineIds([]); return saved })} />}
          {!item.lumpSum && <>
          <div className="gizmo-cost-toolbar"><div><h3>Kalkyl</h3><p>Exklusive moms</p></div><div className="gizmo-cost-commands">
            <button type="button" className={primary} disabled={working || dirty || costDirty} onClick={() => { setQuoteLineId(null); setEditing({ category: 'own_labor' }) }}><Plus size={17} />Lägg till rad</button>
            <details ref={tools} className="gizmo-cost-tools"><summary className={`${secondary} h-11 w-11 px-0`} title="Fler verktyg" aria-label="Fler verktyg"><MoreHorizontal size={20} /></summary><div>
              <button type="button" disabled={working || dirty || costDirty} onClick={() => tool(() => { setSelectMode(!selectMode); setSelectedLineIds([]) })}><ListChecks size={17} />{selectMode ? 'Avsluta markering' : 'Markera rader'}</button>
              <button type="button" disabled={working || dirty || costDirty} onClick={() => tool(() => { setAdvanced(advanced === 'parts' ? null : 'parts'); setPartFilter('') })}><Settings2 size={17} />Arbetsdelar</button>
              <button type="button" disabled={working || dirty || costDirty} onClick={() => tool(() => { setAdvanced(advanced === 'categories' ? null : 'categories'); setPartFilter('') })}><Settings2 size={17} />Kostnadsslag</button>
              {item.lumpSumAvailable && <button type="button" disabled={working || dirty || costDirty} onClick={() => tool(() => { setAdvanced(advanced === 'pricing' ? null : 'pricing'); setPartFilter('') })}><Calculator size={17} />Prisunderlag</button>}
              <button type="button" disabled={working || dirty || !scope.trim() || costDirty} onClick={() => tool(generate)}><Sparkles size={17} />{item.costSuggestion ? 'Nytt AI-förslag' : 'Föreslå kalkyl med AI'}</button>
            </div></details>
          </div></div>
          {dirty ? <p className="mt-3 text-sm text-slate-600">Kalkylen kan ändras när omfattningen har sparats.</p> : !scope.trim() ? <p className="mt-3 text-sm text-amber-800">Arbetets omfattning saknas.</p> : null}
          {generating ? <p role="status" aria-live="polite" className="mt-3 flex items-center gap-2 text-sm text-violet-800"><Loader2 size={16} className="shrink-0 animate-spin" />AI bearbetar omfattningen. Befintliga kalkylrader är oförändrade.</p> : null}
          {item.costSuggestion && !generating ? <Proposal key={item.costSuggestion.id} proposal={item.costSuggestion} stale={stale || dirty} busy={working || costDirty} onApply={(lineIds) => run(() => onCostAction('apply_cost_suggestions', { suggestionId: item.costSuggestion!.id, lineIds }))} /> : null}
          {advanced === 'parts' && <div className="gizmo-cost-advanced"><ActionCaseWorkParts parts={parts} expectedUpdatedAt={item.updatedAt} busy={working || dirty || Boolean(editing) || quoteEditing || bulkEditing} filter={activePartFilter} onFilter={filterParts} onEditing={setPartEditing} onAction={(payload) => run(() => onCostAction('work_part', payload))} /></div>}
          {advanced === 'categories' && <fieldset className="gizmo-cost-advanced gizmo-cost-readiness" disabled={working || dirty || costDirty}><legend>Kostnadsslag</legend>{groups.map((group) => item.costLines.some(line => (group.categories as readonly string[]).includes(line.category)) ? <span key={group.key}>{group.title}: finns i kalkylen</span> : <label key={group.key}><input type="checkbox" checked={item[group.ready]} onChange={(e) => void run(() => onSave(group.key === 'own_labor' ? { ownLaborReady: e.target.checked, requiresSubcontractor: false } : { [group.ready]: e.target.checked }))} />{group.title}: ej aktuellt</label>)}</fieldset>}
          {selectMode && <ActionCaseWorkSelection lines={visibleLines.filter(line => ['own_labor', 'subcontractor'].includes(line.category))} selectedIds={selectedLineIds} parts={parts} expectedUpdatedAt={item.updatedAt} busy={working || dirty || Boolean(editing) || quoteEditing || partEditing} onSelect={(ids) => setSelectedLineIds(current => [...current.filter(id => !visibleLines.some(line => ['own_labor', 'subcontractor'].includes(line.category) && line.id === id)), ...ids])} onEditing={setBulkEditing} onAction={(payload) => run(() => onCostAction('work_part', payload))} />}
          <table className="gizmo-cost-table" aria-label="Kalkylrader"><colgroup>{selectMode && <col data-column="select" />}<col data-column="done" /><col /><col data-column="cost" /><col data-column="markup" /><col data-column="price" /><col data-column="edit" /></colgroup>
            <thead><tr>{selectMode && <th className="gizmo-cost-check"><label><input type="checkbox" aria-label="Markera alla synliga kalkylrader" disabled={working || dirty || costDirty || !visibleLines.length} checked={Boolean(visibleLines.length) && visibleLines.every(line => selectedLineIds.includes(line.id))} ref={node => { if (node) node.indeterminate = visibleLines.some(line => selectedLineIds.includes(line.id)) && !visibleLines.every(line => selectedLineIds.includes(line.id)) }} onChange={e => selectLines(visibleLines.map(line => line.id), e.target.checked)} /></label></th>}<th scope="col" className="gizmo-cost-check">Klar</th><th scope="col">Kalkylrad</th><th scope="col" data-number>Kostnad</th><th scope="col" data-number>Påslag</th><th scope="col" data-number>Kundpris</th><th scope="col"><span className="sr-only">Redigera</span></th></tr></thead>
            <tbody>{!visibleLines.length && <tr><td colSpan={columns} className="gizmo-cost-empty">Inga kalkylrader.</td></tr>}{visibleLines.map((line) => {
                const groupQuote = groupPriceForLine(line, item)
                const coveringQuote = coveringQuoteForLine(line, item)
                const requestId = (groupQuote ?? coveringQuote)?.requestId
                const deleteLocked = Boolean(groupQuote || line.coveredByQuoteId || line.quotes?.some((quote) => quote.deliveryStatus !== 'draft'))
                const rowTotals = calculateActionCaseCostTotals([line])
                const open = editing?.line?.id === line.id || quoteLineId === line.id
                const quotePriced = Boolean(groupQuote || coveringQuote || line.pricingMethod === 'quotes' || line.selectedQuoteId || line.coveredByQuoteId)
                const completeLocked = working || dirty || costDirty || quotePriced || !['scope_needed', 'pricing_needed', 'waiting_subcontractor', 'ready_for_quote'].includes(item.status) || (!line.verified && (line.quantity === null || line.unitCost === null))
                return <Fragment key={line.id}><tr data-select-mode={selectMode} data-open={open} data-selected={selectedLineIds.includes(line.id)}>
                  {selectMode && <td className="gizmo-cost-check"><label><input type="checkbox" name="costLineSelection" aria-label={`Markera ${line.description}`} checked={selectedLineIds.includes(line.id)} disabled={working || dirty || costDirty} onChange={e => selectLines([line.id], e.target.checked)} /></label></td>}
                  <td className="gizmo-cost-check gizmo-cost-done"><label title={quotePriced ? 'Styrs av valt offertunderlag' : line.quantity === null || line.unitCost === null ? 'Ange mängd och pris' : 'Klar'}><input type="checkbox" aria-label={`Klar: ${line.description}`} checked={line.verified || Boolean(line.coveredByQuoteId)} disabled={completeLocked} onChange={e => void run(() => onCostAction('set_cost_line_complete', { costLineId: line.id, complete: e.target.checked, expectedUpdatedAt: item.updatedAt }))} /></label></td>
                  <td className="gizmo-cost-name"><strong>{line.description}</strong>{line.coveredByQuoteId ? <small>Ingår i vald offert</small> : groupQuote ? <small>Grupppris</small> : line.quantity === null ? <small>Mängd saknas</small> : line.unitCost === null ? <small>Pris saknas</small> : null}</td>
                  <td data-number data-label="Kostnad">{line.coveredByQuoteId ? 'Ingår' : amount(rowTotals.internalCost)}</td>
                  <td data-number data-label="Påslag">{line.coveredByQuoteId ? 'Ingår' : `${line.markupPercent.toLocaleString('sv-SE')} %`}</td>
                  <td data-number data-label="Kundpris">{line.coveredByQuoteId ? 'Ingår' : amount(rowTotals.customerPrice)}</td>
                  <td className="gizmo-cost-edit"><button type="button" className={`${secondary} h-11 w-11 px-0`} disabled={working || dirty || costDirty} title="Redigera kalkylrad" aria-label={`Redigera ${line.description}`} aria-expanded={open} onClick={() => { setDeleting(null); if (groupQuote || coveringQuote || line.pricingMethod === 'quotes') { setEditing(null); setQuoteLineId(quoteLineId === line.id ? null : line.id) } else { setQuoteLineId(null); setEditing({ category: line.category, line }) } }}><Pencil size={16} /></button></td>
                </tr>{open && <tr className="gizmo-cost-detail"><td colSpan={columns}>
                  {editing?.line?.id === line.id && <CostLineForm key={line.id} initial={line} category={line.category} busy={working || dirty} onCancel={() => setEditing(null)} onSave={payload => run(() => onCostAction('update_cost_line', payload))} />}
                  {quoteLineId === line.id && (groupQuote || coveringQuote) ? <button type="button" className={secondary} disabled={working || costDirty || dirty || !requestId || !onOpenRequest} onClick={() => { if (requestId) onOpenRequest?.(requestId) }}><Mail size={16} />Öppna offertförfrågan</button> : quoteLineId === line.id ? <ActionCaseWorkQuotes key={line.id} line={line} item={item} caseId={caseId} attachments={attachments} participants={participants} busy={working || dirty || partEditing || bulkEditing} onEditing={setQuoteEditing} onRequest={onRequest} onOpenRequest={onOpenRequest} onAction={(name, payload) => run(() => onCostAction(name, payload))} /> : null}
                  <div className="gizmo-cost-detail-actions">
                    {line.sourceUrl && /^https?:\/\//i.test(line.sourceUrl) && <a className={secondary} href={line.sourceUrl} target="_blank" rel="noreferrer">Öppna priskälla</a>}
                    {editing?.line?.id === line.id && ['own_labor', 'subcontractor'].includes(line.category) && <button type="button" className={secondary} disabled={working || dirty} onClick={() => { if (window.confirm('Öppna prisunderlaget utan att spara radens ändringar?')) { setEditing(null); setQuoteLineId(line.id) } }}>Prisunderlag</button>}
                    {quoteLineId === line.id && <button type="button" className={secondary} disabled={working || quoteEditing} onClick={() => setQuoteLineId(null)}>Stäng detaljer</button>}
                    {!deleteLocked && <button type="button" className={`${secondary} text-rose-700`} disabled={working || dirty || quoteEditing} onClick={() => setDeleting(line.id)}><Trash2 size={16} />Ta bort rad</button>}
                  </div>
                  {deleting === line.id && !deleteLocked && <div className="gizmo-cost-detail-actions"><span>Ta bort raden och osparade ändringar?</span><button type="button" disabled={working} className={secondary} onClick={() => setDeleting(null)}>Avbryt</button><button type="button" disabled={working || dirty} className={`${secondary} text-rose-700`} onClick={() => void run(() => onCostAction('delete_cost_line', { costLineId: line.id })).then(saved => { if (saved) { setDeleting(null); setEditing(null); selectLines([line.id], false); setQuoteLineId(null) } })}>Ta bort</button></div>}
                </td></tr>}</Fragment>
              })}</tbody>
            <tfoot><tr><td colSpan={selectMode ? 3 : 2}>{activePartFilter ? 'Summa hela åtgärden' : 'Summa'}</td><td data-number data-label="Kostnad">{amount(totals.internalCost)}</td><td className="gizmo-cost-total-spacer" /><td data-number data-label="Kundpris">{amount(totals.customerPrice)}</td><td className="gizmo-cost-total-spacer" /></tr></tfoot>
          </table>
          {editing && !editing.line && <div className="mt-4"><CostLineForm key={`new-${editing.category}`} category={editing.category} busy={working || dirty} onCancel={() => setEditing(null)} onSave={payload => run(async () => { const saved = await onCostAction('create_cost_line', payload); if (saved && payload.pricingMethod === 'quotes') setQuoteLineId(String(payload.costLineId)); return saved })} /></div>}
          </>}
        </>}
      </div>
      <footer className="shrink-0 border-t border-slate-200 bg-white px-4 py-3 pb-[max(12px,env(safe-area-inset-bottom))] sm:px-6">
        <div role="status" aria-live="polite" aria-atomic="true" data-testid="scope-save-status" className={`${tab === 'cost' ? 'mb-2 ' : ''}flex h-8 min-w-0 items-center gap-2 text-xs text-slate-600`}>
          {scopeSave?.status === 'error' ? <><span className="min-w-0 truncate" title={scopeSave.error}>Kunde inte spara</span><button type="button" className="h-8 shrink-0 underline" onClick={onScopeRetry}>Försök igen</button></> : !title.trim() ? <span className="truncate">Rubrik saknas. Inte sparat.</span> : scopeSave && scopeSave.status !== 'saved' ? <><Loader2 size={14} className="shrink-0 animate-spin" />Sparar omfattning…</> : <><Check size={14} className="shrink-0" />Omfattning sparad</>}
        </div>
        {tab === 'cost' && <>
          {item.lumpSum && <div className="grid grid-cols-2 gap-3"><div><span className="text-xs text-slate-500">Intern kostnad, exkl. moms</span><strong className="block text-lg">{totals.internalCost === null ? 'Ej angiven' : amount(totals.internalCost)}</strong></div><div><span className="text-xs text-slate-500">Kundpris, exkl. moms</span><strong className="block text-lg">{amount(totals.customerPrice)}</strong></div></div>}
          <p role="status" className="mt-1 text-xs text-slate-600">{item.lumpSum ? item.lumpSum.verified ? 'Klar' : item.lumpSum.customerPrice === null ? 'Pris saknas' : 'Inte klar' : !item.costLines.length ? 'Kalkyl saknas' : [`${item.costLines.filter(line => line.verified || line.coveredByQuoteId).length} av ${item.costLines.length} rader klara`, coverage.missingQuantity ? `${coverage.missingQuantity} saknar mängd` : '', coverage.missingPrice ? `${coverage.missingPrice} saknar pris` : ''].filter(Boolean).join(' · ')}</p>
          {!item.lumpSum && totals.internalCost === null && coverage.knownTotals.internalCost !== null ? <p className="mt-1 text-xs text-slate-500">Prissatt del: {money.format(coverage.knownTotals.internalCost)} intern kostnad</p> : null}
          {selectedLines.length > 30 && onRequest ? <p role="status" className="mt-2 text-xs text-amber-800">{selectedLines.length} valda. Välj högst 30 kalkylrader per offertförfrågan.</p> : null}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {selectedLines.length > 0 && onRequest ? <>
              <button type="button" className={`${primary} min-w-0 flex-1 py-2`} disabled={working || dirty || costDirty || selectedLines.length > 30} onClick={() => { if (!working && !dirty && !costDirty && selectedLines.length <= 30) onRequest(selectedLines.map((line) => line.id)) }}><Mail size={17} className="shrink-0" /><span>Begär offert för valda ({selectedLines.length})</span></button>
              <button type="button" className={`${secondary} h-11 w-11 px-0`} title="Rensa val" aria-label="Rensa valda kalkylrader" disabled={working || dirty || costDirty} onClick={() => setSelectedLineIds([])}><X size={17} /></button>
            </> : null}
            <button type="button" className={`${secondary} ${selectedLines.length && onRequest ? 'w-full sm:w-auto' : 'w-full'}`} disabled={working} onClick={close}><Check size={16} /> Stäng åtgärd</button>
          </div>
        </>}
      </footer>
    </div>
    </div>
  </div>, document.body)
}
