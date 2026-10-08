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
  const toast = useToast()
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
  return <section className="gizmo-contract-parts" aria-label="Arbetsdelar och avgränsningar">
    <div className="flex flex-wrap items-center justify-between gap-3 py-4">
      <h3 className="font-semibold">Arbetsdelar och avgränsningar</h3>
      <div className="flex flex-wrap gap-2">
        {(['project', 'offer'] as const).map((key) => <button key={key} type="button" className="gizmo-button" disabled={blocked || importBlocked}
          onClick={() => { setSource(source === key ? null : key); setSelected([]); setPrices(false) }}><Download size={17} />{key === 'project' ? 'Hämta från Projektarbete' : 'Hämta från Offert'}</button>)}
      </div>
    </div>
    {source && <fieldset disabled={blocked || importBlocked} className="mb-4 border-y border-slate-300 py-3">
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
    <div className="gizmo-contract-parts-heading"><span>Arbetsdel</span><span>{itemized ? 'Kundpris inkl. moms' : 'Omfattning'}</span></div>
    <fieldset disabled={blocked} className="min-w-0">
      {items.map((item, index) => <ProjectEditorRow key={item.id} title={item.title || 'Ny arbetsdel'} summary={item.scope.trim().slice(0, 90) || 'Omfattning saknas'}
        amount={item.kind === 'excluded' ? 'Ingår inte' : itemized ? money(item.amountOre) : 'Ingår'} open={expanded === item.id} onToggle={() => setExpanded(expanded === item.id ? null : item.id)}>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {([-1, 1] as const).map((delta) => <button type="button" key={delta} className="gizmo-button" disabled={delta < 0 ? index === 0 : index === items.length - 1}
            title={delta < 0 ? 'Flytta upp' : 'Flytta ned'} aria-label={`${delta < 0 ? 'Flytta upp' : 'Flytta ned'} ${item.title}`} onClick={() => move(index, delta)}>{delta < 0 ? <ArrowUp size={17} /> : <ArrowDown size={17} />}</button>)}
          <button type="button" className="gizmo-button text-rose-700" title="Ta bort arbetsdel" aria-label={`Ta bort ${item.title}`} onClick={() => setRemoveId(item.id)}><Trash2 size={17} /></button>
        </div>
        {removeId === item.id && <div role="alert" className="my-3 border-l-4 border-amber-500 p-3 text-sm"><p>Ta bort {item.title || 'arbetsdelen'} från avtalet?</p><div className="mt-3 flex gap-2">
          <button type="button" className="gizmo-button" onClick={() => { onChange(items.filter((row) => row.id !== item.id)); setRemoveId(null); setExpanded(null) }}><Trash2 size={17} />Ta bort från avtalet</button>
          <button type="button" className="gizmo-button" onClick={() => setRemoveId(null)}><X size={17} />Avbryt</button></div></div>}
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <label className="text-sm">Rubrik<input className={field} maxLength={250} value={item.title} onChange={(event) => patch(item.id, { title: event.target.value })} /></label>
          <label className="text-sm">Ingår som<select className={field} value={item.kind} onChange={(event) => patch(item.id, { kind: event.target.value as CustomerOfferItem['kind'] })}><option value="included">Grundåtagande</option><option value="excluded">Avgränsning</option>{item.kind === 'option' && <option value="option">Tillval (behöver flyttas)</option>}</select></label>
        </div>
        {([['scope', 'Arbetets omfattning'], ['scopeConditions', 'Förutsättningar'], ['scopeExclusions', 'Ingår inte'], ['scopeAdvice', 'Avrådan']] as const).map(([key, label]) => <label key={key} className="mt-4 block text-sm">{label}
          <textarea className={field} rows={3} maxLength={key === 'scope' ? 12000 : 6000} value={item[key] ?? ''} onChange={(event) => patch(item.id, { [key]: event.target.value })} /></label>)}
        {itemized && item.kind === 'included' && <div className="mt-4"><PriceInput label="Kundpris inkl. moms (kr)" value={item.amountOre} onChange={(amountOre) => patch(item.id, { amountOre })} /></div>}
      </ProjectEditorRow>)}
      {!items.length && <p className="py-4 text-sm">Inga arbetsdelar i avtalet.</p>}
      <button type="button" className="gizmo-button mt-4" disabled={items.length >= 200} onClick={() => {
        const id = crypto.randomUUID(); onChange([...items, { id, title: '', scope: '', scopeConditions: '', scopeExclusions: '', scopeAdvice: '', kind: 'included', amountOre: null }]); setExpanded(id)
      }}><Plus size={17} />Lägg till arbetsdel</button>
    </fieldset>
  </section>
}
