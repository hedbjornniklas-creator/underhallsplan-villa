'use client'

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ArrowRight, Check, Hammer, Loader2, Mail, Package, Pencil, Plus, Save, Sparkles, Trash2, Truck, X } from 'lucide-react'
import type { ActionCaseCostLineView, ActionCaseCostSuggestion, ActionCaseItemView, ActionCaseView } from '@/lib/action-cases/contracts'
import { actionCaseCostCoverage, calculateActionCaseCostTotals } from '@/lib/action-cases/domain'
import { normalizeCostLine } from '@/lib/action-cases/costing'
import ActionCaseWorkQuotes from './ActionCaseWorkQuotes'

type Props = {
  item: ActionCaseItemView
  caseId?: string
  attachments?: ActionCaseView['attachments']
  participants?: ActionCaseView['participants']
  busy: boolean
  onClose: () => void
  onSave: (payload: Record<string, unknown>) => Promise<boolean>
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
  { key: 'own_labor', title: 'Arbete', icon: Hammer, categories: ['own_labor', 'subcontractor'], ready: 'ownLaborReady' },
  { key: 'material', title: 'Material', icon: Package, categories: ['material'], ready: 'materialPriceReady' },
  { key: 'other', title: 'Övrigt', icon: Truck, categories: ['waste', 'transport', 'other'], ready: 'wasteSolutionReady' },
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
      <label className="flex items-center gap-2 text-sm sm:col-span-2"><input type="checkbox" className="h-4 w-4 accent-violet-600" disabled={!cost.quantity.trim() || !cost.unitCost.trim()} checked={cost.verified} onChange={(e) => set('verified', e.target.checked)} />Jag har kontrollerat mängden och priset</label>
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

export default function ActionCaseItemSheet({ item, caseId, attachments = [], participants = [], busy, onClose, onSave, onCostAction }: Props) {
  const dialog = useRef<HTMLDivElement>(null)
  const inFlight = useRef(false)
  const [tab, setTab] = useState<'scope' | 'cost'>('scope')
  const [title, setTitle] = useState(item.title)
  const [scope, setScope] = useState(item.scope ?? '')
  const [editing, setEditing] = useState<{ category: string; line?: ActionCaseCostLineView } | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [generating, setGenerating] = useState(false)
  const [pending, setPending] = useState(false)
  const [quoteLineId, setQuoteLineId] = useState<string | null>(null)
  const [quoteEditing, setQuoteEditing] = useState(false)
  const working = busy || pending
  const dirty = title !== item.title || scope !== (item.scope ?? '')
  const totals = calculateActionCaseCostTotals(item.costLines)
  const coverage = actionCaseCostCoverage(item.costLines)
  const stale = Boolean(item.costSuggestion && item.costSuggestion.sourceUpdatedAt !== item.updatedAt)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    dialog.current?.focus()
    return () => { document.body.style.overflow = overflow; previous?.focus() }
  }, [])
  const run = async (work: () => Promise<boolean>) => {
    if (inFlight.current) return false
    inFlight.current = true; setPending(true)
    try { return await work() } finally { inFlight.current = false; setPending(false) }
  }
  const close = () => {
    if (working) return
    if ((dirty || editing || quoteEditing) && !window.confirm('Stäng utan att spara ändringarna?')) return
    onClose()
  }
  const generate = () => void run(async () => {
    setGenerating(true)
    try { return await onCostAction('generate_cost_suggestions', {}) } finally { setGenerating(false) }
  })
  if (typeof document === 'undefined') return null
  return createPortal(<div className="fixed inset-0 z-50 flex justify-end bg-black/40">
    <div ref={dialog} role="dialog" aria-modal="true" tabIndex={-1} aria-labelledby="action-item-title" className="h-dvh w-full max-w-3xl bg-white text-slate-950 shadow-2xl outline-none" onKeyDown={(event) => {
      if (event.key === 'Escape') { event.preventDefault(); close() }
      if (event.key !== 'Tab') return
      const controls = Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href]') ?? []).filter((node) => node.getClientRects().length)
      const first = controls[0], last = controls.at(-1)
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }}>
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-200 px-4 py-4 sm:px-6">
        <div className="min-w-0"><p className="text-xs font-semibold text-violet-700">Åtgärd</p><h2 id="action-item-title" className="mt-1 break-words text-xl font-semibold">{item.title}</h2></div>
        <button type="button" className={`${secondary} h-11 w-11 px-0`} aria-label="Stäng åtgärd" title="Stäng" disabled={working} onClick={close}><X size={20} /></button>
      </header>
      <nav aria-label="Åtgärdens innehåll" className="grid shrink-0 grid-cols-2 gap-1 border-b border-slate-200 p-2">
        {([['scope', 'Omfattning'], ['cost', 'Kalkyl']] as const).map(([key, label]) => <button key={key} type="button" aria-pressed={tab === key} disabled={(Boolean(editing) || quoteEditing || working) && tab !== key} onClick={() => setTab(key)} className={`min-h-11 rounded-md text-sm font-semibold disabled:opacity-40 ${tab === key ? 'bg-violet-50 text-violet-800' : 'text-slate-600 hover:bg-slate-50'}`}>{label}</button>)}
      </nav>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
        {tab === 'scope' ? <fieldset disabled={working} className="space-y-5">
          <label className="block text-sm font-semibold">Rubrik *<input className={inputClass} value={title} onChange={(e) => setTitle(e.target.value)} /></label>
          <label className="block text-sm font-semibold">Arbetets omfattning<textarea className={`${inputClass} py-3 leading-6`} rows={8} value={scope} onChange={(e) => setScope(e.target.value)} /></label>
        </fieldset> : <>
          <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-semibold">Kalkylunderlag</h3><button type="button" className={primary} disabled={working || dirty || !scope.trim() || Boolean(editing)} onClick={generate}>{generating ? <Loader2 size={17} className="animate-spin" /> : <Sparkles size={17} />}{generating ? 'Skapar förslag…' : item.costSuggestion ? 'Nytt AI-förslag' : 'Föreslå kalkyl med AI'}</button></div>
          {dirty ? <p className="mt-3 text-sm text-amber-800">Omfattningen har osparade ändringar.</p> : !scope.trim() ? <p className="mt-3 text-sm text-amber-800">Arbetets omfattning saknas.</p> : null}
          {generating ? <p role="status" aria-live="polite" className="mt-3 flex items-center gap-2 text-sm text-violet-800"><Loader2 size={16} className="shrink-0 animate-spin" />AI bearbetar omfattningen. Befintliga kalkylrader är oförändrade.</p> : null}
          {item.costSuggestion && !generating ? <Proposal key={item.costSuggestion.id} proposal={item.costSuggestion} stale={stale || dirty} busy={working || Boolean(editing) || quoteEditing} onApply={(lineIds) => run(() => onCostAction('apply_cost_suggestions', { suggestionId: item.costSuggestion!.id, lineIds }))} /> : null}
          <div className="mt-5 space-y-6">{groups.map((group) => {
            const lines = item.costLines.filter((line) => (group.categories as readonly string[]).includes(line.category))
            const Icon = group.icon
            const groupTotals = calculateActionCaseCostTotals(lines)
            const isEditing = editing && (group.categories as readonly string[]).includes(editing.category)
            const noNeed = item[group.ready]
            return <section key={group.key} className="border-t border-slate-200 pt-4">
              <header className="flex flex-wrap items-center gap-2"><Icon size={18} className="text-slate-500" /><h3 className="mr-auto font-semibold">{group.title} <span className="font-normal text-slate-400">{lines.length}</span></h3>
                {lines.length > 0 ? <span className="text-xs text-slate-600">{lines.every((line) => line.coveredByQuoteId) ? 'Ingår i offert' : `Kostnad ${amount(groupTotals.internalCost)}`}</span> : <label className="flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" disabled={working || dirty} className="h-4 w-4 accent-violet-600" checked={noNeed} onChange={(e) => void run(() => onSave(group.key === 'own_labor' ? { ownLaborReady: e.target.checked, requiresSubcontractor: false } : { [group.ready]: e.target.checked }))} />Ej aktuellt</label>}
                <button type="button" className={`${secondary} h-11 w-11 px-0`} disabled={working || Boolean(editing) || quoteEditing} aria-label={`Lägg till ${group.title.toLowerCase()}`} title={`Lägg till ${group.title.toLowerCase()}`} onClick={() => setEditing({ category: group.key })}><Plus size={17} /></button>
              </header>
              {!lines.length && !isEditing ? <p className="py-3 text-sm text-slate-400">{noNeed ? 'Ej aktuellt' : 'Inga kalkylrader'}</p> : null}
              <div className="divide-y divide-slate-100">{lines.map((line) => <div key={line.id} className="py-3">
                <div className="flex items-start gap-2"><div className="min-w-0 flex-1 break-words"><strong className="text-sm">{line.description}</strong>{line.coveredByQuoteId ? <p className="mt-1 text-xs font-semibold text-violet-700">Ingår i vald offert · räknas inte separat</p> : null}<p className="mt-1 text-xs text-slate-500">{line.quantity ?? '?'} {line.unit} × {line.unitCost === null ? 'Pris saknas' : money.format(line.unitCost)} · {line.markupPercent} % påslag</p><p className={`mt-1 text-xs ${line.verified ? 'text-emerald-700' : 'text-amber-800'}`}>{line.verified ? 'Kontrollerad' : 'Ej kontrollerad'} · {basisLabels[line.quantityBasis]} · {sourceLabels[line.priceSource]}</p></div>
                  <button type="button" className={`${secondary} h-11 w-11 px-0`} disabled={working || Boolean(editing) || quoteEditing || Boolean(line.coveredByQuoteId)} title={line.coveredByQuoteId ? "Ingår i vald offert" : "Redigera kalkylrad"} aria-label={`Redigera ${line.description}`} onClick={() => line.pricingMethod === 'quotes' ? setQuoteLineId(line.id) : setEditing({ category: line.category, line })}><Pencil size={16} /></button>
                  <button type="button" className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-700 disabled:opacity-40" disabled={working || Boolean(editing) || quoteEditing || Boolean(line.coveredByQuoteId) || Boolean(line.quotes?.some((q) => q.deliveryStatus !== 'draft'))} title={line.coveredByQuoteId ? "Ingår i vald offert" : line.quotes?.some((q) => q.deliveryStatus !== 'draft') ? "Har en påbörjad offertförfrågan" : "Ta bort kalkylrad"} aria-label={`Ta bort ${line.description}`} onClick={() => setDeleting(line.id)}><Trash2 size={16} /></button>
                </div>
                {['own_labor', 'subcontractor'].includes(line.category) ? <button type="button" className={`${secondary} mt-3`} disabled={working || Boolean(editing) || quoteEditing || dirty} aria-expanded={quoteLineId === line.id} onClick={() => setQuoteLineId(quoteLineId === line.id ? null : line.id)}><Mail size={16} />{quoteLineId === line.id ? 'Dölj prisunderlag' : 'Timmar / offerter'}</button> : null}
                {quoteLineId === line.id ? <ActionCaseWorkQuotes key={line.id} line={line} item={item} caseId={caseId} attachments={attachments} participants={participants} busy={working || dirty} onEditing={setQuoteEditing} onAction={(name, payload) => run(() => onCostAction(name, payload))} /> : null}
                {line.notes ? <p className="mt-2 break-words text-xs leading-5 text-slate-600">{line.notes}</p> : null}
                {line.sourceUrl && /^https?:\/\//i.test(line.sourceUrl) ? <a href={line.sourceUrl} target="_blank" rel="noreferrer" className="mt-1 inline-block text-xs text-violet-700 underline">Öppna priskälla</a> : null}
                {deleting === line.id ? <div className="mt-3 flex flex-wrap items-center gap-2 text-sm"><span>Ta bort raden?</span><button type="button" disabled={working} className={secondary} onClick={() => setDeleting(null)}>Avbryt</button><button type="button" disabled={working} className={`${secondary} text-rose-700`} onClick={() => void run(() => onCostAction('delete_cost_line', { costLineId: line.id })).then((saved) => { if (saved) setDeleting(null) })}>{working ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />} Ta bort</button></div> : null}
              </div>)}</div>
              {isEditing ? <CostLineForm key={editing.line?.id ?? `new-${editing.category}`} initial={editing.line} category={editing.category} busy={working} onCancel={() => setEditing(null)} onSave={(payload) => run(async () => { const saved = await onCostAction(editing.line ? 'update_cost_line' : 'create_cost_line', payload); if (saved && payload.pricingMethod === 'quotes') setQuoteLineId(String(payload.costLineId)); return saved })} /> : null}
            </section>
          })}</div>
        </>}
      </div>
      <footer className="shrink-0 border-t border-slate-200 bg-white px-4 py-3 pb-[max(12px,env(safe-area-inset-bottom))] sm:px-6">
        {tab === 'scope' ? <button type="button" className={`${primary} w-full`} disabled={working || !title.trim()} onClick={() => void run(async () => {
          if (dirty && !await onSave({ title, scope })) return false
          setTab('cost'); return true
        })}>{working ? <Loader2 size={16} className="animate-spin" /> : <ArrowRight size={16} />} {dirty ? 'Spara och gå till kalkyl' : 'Gå till kalkyl'}</button> : <>
          <div className="grid grid-cols-2 gap-3"><div><span className="text-xs text-slate-500">Intern kostnad, exkl. moms</span><strong className="block text-lg">{amount(totals.internalCost)}</strong></div><div><span className="text-xs text-slate-500">Kundpris, exkl. moms</span><strong className="block text-lg">{amount(totals.customerPrice)}</strong></div></div>
          <p role="status" className={`mt-1 text-xs ${coverage.complete ? 'text-emerald-700' : 'text-amber-800'}`}>{coverage.complete ? 'Alla kalkylrader är kontrollerade' : !item.costLines.length ? 'Kalkyl saknas' : `${coverage.missingQuantity} saknar mängd · ${coverage.missingPrice} saknar pris · ${coverage.unchecked} att kontrollera`}</p>
          {totals.internalCost === null && coverage.knownTotals.internalCost !== null ? <p className="mt-1 text-xs text-slate-500">Prissatt del: {money.format(coverage.knownTotals.internalCost)} intern kostnad</p> : null}
          <button type="button" className={`${secondary} mt-3 w-full`} disabled={working} onClick={close}><Check size={16} /> Stäng åtgärd</button>
        </>}
      </footer>
    </div>
    </div>
  </div>, document.body)
}
