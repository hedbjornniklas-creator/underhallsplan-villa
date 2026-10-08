'use client'

import { useState } from 'react'
import { ArrowDown, ArrowUp, Download, Plus, Trash2, X } from 'lucide-react'
import type { ActionCaseItemView } from '@/lib/action-cases/contracts'
import { money, type CustomerOfferItem } from '@/lib/action-cases/customerOffers'
import { importableCustomerPrice } from '@/lib/action-cases/offerImport'
import { importContractParts, type ContractImportSource } from '@/lib/action-cases/contractImport'
import { useToast } from '@/components/ui/AppToastProvider'
import ProjectEditorRow from './ProjectEditorRow'
import PriceInput from './CustomerOfferPriceInput'

const field = 'mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm'
export default function CustomerContractWorkParts({ items, projectItems, offerItems, itemized, blocked, importBlocked = false, onChange }: {
  items: CustomerOfferItem[]; projectItems: ActionCaseItemView[]; offerItems: CustomerOfferItem[]
  itemized: boolean; blocked: boolean; onChange: (items: CustomerOfferItem[]) => void
  importBlocked?: boolean
}) {
  const [expanded, setExpanded] = useState<string | null>(null)
  const [source, setSource] = useState<'project' | 'offer' | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [prices, setPrices] = useState(false)
  const [removeId, setRemoveId] = useState<string | null>(null)
  const [selectedRows, setSelectedRows] = useState<string[]>([])
  const [bulkAction, setBulkAction] = useState<{ kind: 'remove' | 'included' | 'excluded'; ids: string[] } | null>(null)
  const toast = useToast()
  const selectedItems = items.filter((row) => selectedRows.includes(row.id))
  const pendingItems = items.filter((row) => bulkAction?.ids.includes(row.id))
  const pendingLabel = `${pendingItems.length} ${pendingItems.length === 1 ? 'arbetsdel' : 'arbetsdelar'}`
  const rowsBlocked = blocked || Boolean(bulkAction)
  const sources: ContractImportSource[] = source === 'offer' ? offerItems.filter((row) => row.kind !== 'option').map((row) => ({ ...row, id: row.sourceItemId ?? row.id }))
    : projectItems.map((row) => ({ id: row.id, title: row.title, scope: row.scope ?? '',
      scopeConditions: row.scopeConditions ?? '', scopeExclusions: row.scopeExclusions ?? '', scopeAdvice: row.scopeAdvice ?? '',
      amountOre: importableCustomerPrice(row), kind: 'included' }))
  const patch = (id: string, values: Partial<CustomerOfferItem>) => onChange(items.map((row) => row.id === id ? { ...row, ...values } : row))
  function move(index: number, delta: number) {
    const next = [...items], other = index + delta
    if (other < 0 || other >= items.length) return
    ;[next[index], next[other]] = [next[other], next[index]]
    onChange(next)
  }
  function selectRow(id: string, checked: boolean) {
    if (rowsBlocked) return
    setSelectedRows(checked ? [...selectedItems.map((row) => row.id), id] : selectedRows.filter((selectedId) => selectedId !== id))
  }
  function requestBulkAction(kind: 'remove' | 'included' | 'excluded') {
    if (rowsBlocked || !selectedItems.length) return
    setRemoveId(null)
    setBulkAction({ kind, ids: selectedItems.map((row) => row.id) })
  }
  function confirmBulkAction() {
    if (blocked || !bulkAction || !pendingItems.length) return
    const ids = new Set(pendingItems.map((row) => row.id))
    if (bulkAction.kind === 'remove') {
      onChange(items.filter((row) => !ids.has(row.id)))
      if (expanded && ids.has(expanded)) setExpanded(null)
      setSelectedRows(selectedRows.filter((id) => !ids.has(id)))
    } else {
      const kind = bulkAction.kind
      onChange(items.map((row) => ids.has(row.id) ? {
        ...row, kind, amountOre: kind === 'excluded' ? null : row.amountOre,
        ...(row.optionGroup === undefined ? {} : { optionGroup: null }),
      } : row))
    }
    toast.success(`${pendingLabel} ${bulkAction.kind === 'remove' ? 'har tagits bort från avtalsutkastet' : 'har ändrats i avtalsutkastet'}.`)
    setBulkAction(null)
  }
  return <section className="gizmo-contract-parts" aria-label="Arbetsdelar och avgränsningar">
    <div className="flex flex-wrap items-center justify-between gap-3 py-4">
      <h3 className="font-semibold">Arbetsdelar och avgränsningar</h3>
      <div className="flex flex-wrap gap-2">
        {(['project', 'offer'] as const).map((key) => <button key={key} type="button" className="gizmo-button" disabled={rowsBlocked || importBlocked}
          onClick={() => { setSource(source === key ? null : key); setSelected([]); setPrices(false) }}><Download size={17} />{key === 'project' ? 'Hämta från Projektarbete' : 'Hämta från Offert'}</button>)}
      </div>
    </div>
    {source && <fieldset disabled={rowsBlocked || importBlocked} className="mb-4 border-y border-slate-300 py-3">
      <div className="flex items-center justify-between gap-2"><strong className="text-sm">{source === 'project' ? 'Projektarbete' : 'Offert'}</strong>
        <button type="button" className="gizmo-button" title="Stäng import" aria-label="Stäng import" onClick={() => setSource(null)}><X size={17} /></button></div>
      <label className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" className="h-5 w-5" checked={sources.length > 0 && sources.every((row) => selected.includes(row.id))}
        onChange={(event) => setSelected(event.target.checked ? sources.map((row) => row.id) : [])} />Välj alla</label>
      {sources.map((row) => <label key={row.id} className="flex min-h-11 items-center gap-3 border-t border-slate-200 text-sm"><input type="checkbox" className="h-5 w-5 shrink-0" checked={selected.includes(row.id)}
        onChange={(event) => setSelected(event.target.checked ? [...selected, row.id] : selected.filter((id) => id !== row.id))} /><span className="min-w-0 flex-1">{row.title}</span><span>{row.kind === 'excluded' ? 'Ingår inte' : money(row.amountOre)}</span></label>)}
      {!sources.length && <p className="py-3 text-sm">Inga arbetsdelar att hämta.</p>}
      <label className="mt-3 flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" className="h-5 w-5" checked={prices} onChange={(event) => setPrices(event.target.checked)} />Hämta även kundpriser</label>
      <button type="button" className="gizmo-button gizmo-button-primary mt-2" disabled={!selected.length} onClick={() => {
        try { onChange(importContractParts(items, sources, selected, prices)); setSource(null); setSelected([]); toast.success('Valda texter har hämtats till avtalet.') }
        catch (error) { toast.error(error, 'Texterna kunde inte hämtas.') }
      }}><Download size={17} />Hämta valda ({selected.length}) och ersätt texter</button>
    </fieldset>}
    <fieldset disabled={blocked} className="gizmo-contract-parts-bulk" aria-label="Hantera valda arbetsdelar">
      <span className="gizmo-contract-parts-count" role="status">{selectedItems.length} valda</span>
      <button type="button" className="gizmo-button" title="Rensa markering" aria-label="Rensa markering" disabled={!selectedItems.length || Boolean(bulkAction)}
        onClick={() => { if (!rowsBlocked) setSelectedRows([]) }}><X size={17} /></button>
      <select className="gizmo-contract-parts-kind" aria-label="Ändra Ingår som för valda arbetsdelar" value="" disabled={!selectedItems.length || Boolean(bulkAction)}
        onChange={(event) => { if (event.target.value === 'included' || event.target.value === 'excluded') requestBulkAction(event.target.value) }}>
        <option value="" disabled>Ändra Ingår som…</option><option value="included">Grundåtagande</option><option value="excluded">Avgränsning</option>
      </select>
      <button type="button" className="gizmo-button text-rose-700" title="Ta bort valda arbetsdelar" aria-label="Ta bort valda arbetsdelar"
        disabled={!selectedItems.length || Boolean(bulkAction)} onClick={() => requestBulkAction('remove')}><Trash2 size={17} /></button>
    </fieldset>
    {bulkAction && <fieldset disabled={blocked} className="gizmo-contract-parts-confirm" aria-label="Bekräfta massändring">
      <div role="alert">
        <p className="font-semibold">{bulkAction.kind === 'remove' ? 'Ta bort' : 'Ändra'} {pendingLabel} {bulkAction.kind === 'remove' ? 'från avtalet' : `till ${bulkAction.kind === 'included' ? 'grundåtagande' : pendingItems.length === 1 ? 'avgränsning' : 'avgränsningar'}`}?</p>
        <p className="mt-1 text-sm">{pendingItems.slice(0, 5).map((row) => row.title || 'Ny arbetsdel').join(', ')}{pendingItems.length > 5 ? ` och ${pendingItems.length - 5} till` : ''}.</p>
        {bulkAction.kind === 'remove' ? <p className="mt-1 text-sm">Projektarbete och Offert behålls.</p>
          : bulkAction.kind === 'excluded' ? <p className="mt-1 text-sm">Arbetsdelarna ingår inte i grundåtagandet. Deras kundpriser tas bort.</p>
          : <p className="mt-1 text-sm">Arbetsdelarna blir en del av grundåtagandet. Saknade kundpriser behöver fyllas i.</p>}
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="gizmo-button gizmo-button-primary" disabled={!pendingItems.length} onClick={confirmBulkAction}>
          {bulkAction.kind === 'remove' ? <Trash2 size={17} /> : null}{bulkAction.kind === 'remove' ? 'Ta bort från avtalet' : 'Bekräfta ändring'}</button>
        <button type="button" className="gizmo-button" onClick={() => setBulkAction(null)}><X size={17} />Avbryt</button>
      </div>
    </fieldset>}
    <div className="gizmo-contract-parts-heading">
      <label className="gizmo-contract-part-select" title="Välj alla arbetsdelar"><input type="checkbox" className="h-5 w-5" aria-label="Välj alla arbetsdelar"
        checked={items.length > 0 && selectedItems.length === items.length} disabled={rowsBlocked || !items.length}
        ref={(node) => { if (node) node.indeterminate = selectedItems.length > 0 && selectedItems.length < items.length }}
        onChange={(event) => { if (!rowsBlocked) setSelectedRows(event.target.checked ? items.map((row) => row.id) : []) }} /></label>
      <span>Arbetsdel</span><span>{itemized ? 'Kundpris inkl. moms' : 'Omfattning'}</span>
    </div>
    <fieldset disabled={rowsBlocked} className="min-w-0">
      {items.map((item, index) => <div key={item.id} className="gizmo-contract-part-row" data-selected={selectedRows.includes(item.id)}>
        <label className="gizmo-contract-part-select" title={`Välj ${item.title || 'arbetsdel'}`}><input type="checkbox" className="h-5 w-5"
          aria-label={`Välj arbetsdel ${index + 1}: ${item.title || 'Ny arbetsdel'}`} checked={selectedRows.includes(item.id)}
          onChange={(event) => selectRow(item.id, event.target.checked)} /></label>
        <ProjectEditorRow title={item.title || 'Ny arbetsdel'} summary={item.scope.trim().slice(0, 90) || 'Omfattning saknas'}
        amount={item.kind === 'excluded' ? 'Ingår inte' : itemized ? money(item.amountOre) : 'Ingår'} open={expanded === item.id} onToggle={() => setExpanded(expanded === item.id ? null : item.id)}>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {([-1, 1] as const).map((delta) => <button type="button" key={delta} className="gizmo-button" disabled={delta < 0 ? index === 0 : index === items.length - 1}
            title={delta < 0 ? 'Flytta upp' : 'Flytta ned'} aria-label={`${delta < 0 ? 'Flytta upp' : 'Flytta ned'} ${item.title}`} onClick={() => move(index, delta)}>{delta < 0 ? <ArrowUp size={17} /> : <ArrowDown size={17} />}</button>)}
          <button type="button" className="gizmo-button text-rose-700" title="Ta bort arbetsdel" aria-label={`Ta bort ${item.title}`} onClick={() => setRemoveId(item.id)}><Trash2 size={17} /></button>
        </div>
        {removeId === item.id && <div role="alert" className="my-3 border-l-4 border-amber-500 p-3 text-sm"><p>Ta bort {item.title || 'arbetsdelen'} från avtalet?</p><div className="mt-3 flex gap-2">
          <button type="button" className="gizmo-button" onClick={() => { onChange(items.filter((row) => row.id !== item.id)); setSelectedRows(selectedRows.filter((id) => id !== item.id)); setRemoveId(null); setExpanded(null) }}><Trash2 size={17} />Ta bort från avtalet</button>
          <button type="button" className="gizmo-button" onClick={() => setRemoveId(null)}><X size={17} />Avbryt</button></div></div>}
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <label className="text-sm">Rubrik<input className={field} maxLength={250} value={item.title} onChange={(event) => patch(item.id, { title: event.target.value })} /></label>
          <label className="text-sm">Ingår som<select className={field} value={item.kind} onChange={(event) => patch(item.id, { kind: event.target.value as CustomerOfferItem['kind'] })}><option value="included">Grundåtagande</option><option value="excluded">Avgränsning</option>{item.kind === 'option' && <option value="option">Tillval (behöver flyttas)</option>}</select></label>
        </div>
        {([['scope', 'Arbetets omfattning'], ['scopeConditions', 'Förutsättningar'], ['scopeExclusions', 'Ingår inte'], ['scopeAdvice', 'Avrådan']] as const).map(([key, label]) => <label key={key} className="mt-4 block text-sm">{label}
          <textarea className={field} rows={3} maxLength={key === 'scope' ? 12000 : 6000} value={item[key] ?? ''} onChange={(event) => patch(item.id, { [key]: event.target.value })} /></label>)}
        {itemized && item.kind === 'included' && <div className="mt-4"><PriceInput label="Kundpris inkl. moms (kr)" value={item.amountOre} onChange={(amountOre) => patch(item.id, { amountOre })} /></div>}
        </ProjectEditorRow>
      </div>)}
      {!items.length && <p className="py-4 text-sm">Inga arbetsdelar i avtalet.</p>}
      <button type="button" className="gizmo-button mt-4" disabled={items.length >= 200} onClick={() => {
        const id = crypto.randomUUID(); onChange([...items, { id, title: '', scope: '', scopeConditions: '', scopeExclusions: '', scopeAdvice: '', kind: 'included', amountOre: null }]); setExpanded(id)
      }}><Plus size={17} />Lägg till arbetsdel</button>
    </fieldset>
  </section>
}
