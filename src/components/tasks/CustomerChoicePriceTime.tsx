'use client'

import { Plus, Trash2 } from 'lucide-react'
import type { ChoiceOffer } from '@/lib/action-cases/choiceOffer'
import type { ContractPricing } from '@/lib/action-cases/contractPricing'
import { contractFixedAmount } from '@/lib/action-cases/contractPricing'
import { money } from '@/lib/action-cases/customerOffers'
import PriceInput from './CustomerOfferPriceInput'

const input = 'mt-1 block min-h-11 w-full min-w-0 rounded-md border border-[#D5DCDD] bg-white px-3 py-2 text-base sm:text-sm'
const button = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-[#D5DCDD] px-3 py-2 text-sm font-semibold'

export default function CustomerChoicePriceTime({ value, onChange }: { value: ChoiceOffer; onChange: (value: ChoiceOffer) => void }) {
  const p = value.pricing
  const patch = (change: Partial<ChoiceOffer>) => onChange({ ...value, ...change })
  const price = (change: Partial<ContractPricing>) => patch({ pricing: { ...p, ...change } })
  const running = (change: Partial<ContractPricing['running']>) => price({ running: { ...p.running, ...change } })
  const updateRow = (id: string, change: Partial<ContractPricing['rows'][number]>) => price({ rows: p.rows.map(row => row.id === id ? { ...row, ...change } : row) })
  const modeOptions = [['fixed', 'Fast pris'], ['running', 'Löpande räkning'], ['mixed', 'Fast + löpande']] as const
  return <div className="space-y-5">
    <label className="block text-sm">Typ av underlag<select className={input} value={value.kind} onChange={event => patch({ kind: event.target.value as ChoiceOffer['kind'] })}><option value="selection">Val</option><option value="option">Tillval</option><option value="change">Ändrings- och tilläggsarbete (ÄTA)</option></select></label>
    <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" className="h-4 w-4 accent-[#206961]" checked={value.priceNeutral} onChange={event => patch({ priceNeutral: event.target.checked })} />Ingår utan prisändring</label>
    {!value.priceNeutral && <>
      <fieldset><legend className="mb-2 text-sm font-semibold">Prisform</legend><div className="gizmo-price-modes">{modeOptions.map(([mode, title]) => <label key={mode} className={p.mode === mode ? 'selected' : ''}><input type="radio" name="choice-price-form" checked={p.mode === mode} onChange={() => price({ mode })} />{title}</label>)}</div></fieldset>
      {p.mode !== 'running' && <section className="space-y-4 border-y border-[#D5DCDD] py-4" aria-label="Fast pris för tillvalet">
        <label className="block text-sm">Prisgrund<select className={input} value={value.priceSource} onChange={event => patch({ priceSource: event.target.value as ChoiceOffer['priceSource'] })}><option value="manual">Ange kundpris</option><option value="calculation">Beräkna från kalkylen</option></select></label>
        <label className="block text-sm">Redovisning för beställaren<select className={input} value={p.display} onChange={event => price({ display: event.target.value as ContractPricing['display'] })}><option value="total">Enbart totalsumma</option><option value="unpriced">Delmoment utan delpris + totalsumma</option><option value="priced" disabled={value.priceSource === 'manual' && p.basis === 'total'}>Delmoment med pris + totalsumma</option></select></label>
        {value.priceSource === 'manual' && <>
          <div className="grid gap-4 sm:grid-cols-2"><label className="text-sm">Beräkning<select className={input} value={p.basis} onChange={event => price({ basis: event.target.value as ContractPricing['basis'], ...(event.target.value === 'total' ? { display: p.display === 'priced' ? 'total' as const : p.display } : {}) })}><option value="total">Fast klumpsumma</option><option value="rows">Summan av prisraderna</option></select></label>
          <label className="text-sm">Arbete och material<select className={input} value={p.split} onChange={event => price({ split: event.target.value as ContractPricing['split'] })}><option value="combined">Tillsammans</option><option value="separate">Separat</option></select></label></div>
          {p.basis === 'total' && (p.split === 'combined' ? <PriceInput label={p.mode === 'mixed' ? 'Fast del inkl. moms (kr)' : 'Fast pris inkl. moms (kr)'} value={p.totalOre} onChange={totalOre => price({ totalOre })} /> : <div className="grid gap-4 sm:grid-cols-2"><PriceInput label="Arbete inkl. moms (kr)" value={p.labourOre} onChange={labourOre => price({ labourOre })} /><PriceInput label="Material inkl. moms (kr)" value={p.materialOre} onChange={materialOre => price({ materialOre })} /></div>)}
          {p.rows.map(row => <fieldset key={row.id} className="space-y-3 border-t border-[#D5DCDD] pt-3"><div className="flex items-end gap-2"><label className="min-w-0 flex-1 text-sm">Moment<input className={input} value={row.title} maxLength={250} onChange={event => updateRow(row.id, { title: event.target.value })} /></label><button type="button" className={`${button} h-11 w-11 shrink-0 px-0`} title="Ta bort prisrad" aria-label={`Ta bort prisrad ${row.title || 'utan namn'}`} onClick={() => price({ rows: p.rows.filter(other => other.id !== row.id) })}><Trash2 size={16} /></button></div>
            {p.mode === 'mixed' && <label className="block text-sm">Momentets prisform<select className={input} value={row.kind} onChange={event => updateRow(row.id, { kind: event.target.value as 'fixed' | 'running' })}><option value="fixed">Fast pris</option><option value="running">Löpande räkning</option></select></label>}
            {p.basis === 'rows' && !(p.mode === 'mixed' && row.kind === 'running') && (p.split === 'combined' ? <PriceInput label="Momentets pris inkl. moms (kr)" value={row.amountOre} onChange={amountOre => updateRow(row.id, { amountOre })} /> : <div className="grid gap-4 sm:grid-cols-2"><PriceInput label="Arbete inkl. moms (kr)" value={row.labourOre} onChange={labourOre => updateRow(row.id, { labourOre })} /><PriceInput label="Material inkl. moms (kr)" value={row.materialOre} onChange={materialOre => updateRow(row.id, { materialOre })} /></div>)}
          </fieldset>)}
          <button type="button" className={button} disabled={p.rows.length >= 50} onClick={() => price({ rows: [...p.rows, { id: crypto.randomUUID(), title: '', kind: 'fixed', amountOre: null, labourOre: null, materialOre: null }] })}><Plus size={16} />Lägg till prisrad</button>
        </>}
        <dl className="flex flex-wrap items-center justify-between gap-3 bg-[#EDF1F1] p-3 font-semibold"><dt>{p.mode === 'mixed' ? 'Fast del inkl. moms' : 'Fast pris inkl. moms'}</dt><dd>{contractFixedAmount(p) === null ? 'Pris ej fastställt' : money(contractFixedAmount(p))}</dd></dl>
      </section>}
      {p.mode !== 'fixed' && <section className="space-y-4 border-y border-[#D5DCDD] py-4" aria-label="Löpande ersättning för tillvalet"><h3 className="font-semibold">Löpande ersättning</h3>
        <PriceInput label="Arbete inkl. arvode och moms (kr/tim)" value={p.running.hourlyOre} onChange={hourlyOre => running({ hourlyOre })} />
        <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={p.running.managementOre === null} onChange={event => running({ managementOre: event.target.checked ? null : p.running.hourlyOre ?? 0 })} />Samma timpris för arbetsledning</label>
        {p.running.managementOre !== null && <PriceInput label="Arbetsledning inkl. arvode och moms (kr/tim)" value={p.running.managementOre} onChange={managementOre => running({ managementOre })} />}
        <PriceInput label="Påslag på självkostnad: material, UE och övrigt (%)" max={100_000} value={p.running.markupPercent === null ? null : Math.round(p.running.markupPercent * 100)} onChange={amount => running({ markupPercent: amount === null ? null : amount / 100 })} />
        <p className="text-sm text-[#596368]">Moms tillkommer på självkostnad och påslag.</p>
        <PriceInput label="Ungefärligt pris för den löpande delen inkl. moms (kr, valfritt)" value={p.running.approximateOre} onChange={approximateOre => running({ approximateOre })} />
      </section>}
    </>}
    <section className="space-y-4 border-t border-[#D5DCDD] pt-4" aria-label="Tillvalets tidspåverkan"><h3 className="font-semibold">Tidspåverkan</h3>
      <label className="block text-sm">Projektets färdigställande<select className={input} value={value.time.status} onChange={event => patch({ time: { ...value.time, status: event.target.value as ChoiceOffer['time']['status'] } })}><option value="unassessed">Inte bedömt</option><option value="none">Ingen påverkan</option><option value="extension">Förlänger tiden</option></select></label>
      {value.time.status === 'extension' && <label className="block text-sm">Bedömd förlängning (arbetsdagar)<input className={input} type="number" min="0" max="3650" step="1" value={value.time.workingDays ?? ''} onChange={event => patch({ time: { ...value.time, workingDays: event.target.value === '' ? null : Number(event.target.value) } })} /></label>}
      {value.time.status !== 'none' && <label className="block text-sm">Förklaring och berörda moment<textarea className={input} rows={3} maxLength={3000} value={value.time.explanation} onChange={event => patch({ time: { ...value.time, explanation: event.target.value } })} /></label>}
    </section>
  </div>
}
