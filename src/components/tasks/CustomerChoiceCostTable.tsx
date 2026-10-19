'use client'

import { Fragment, useState } from 'react'
import { Pencil, Plus, Trash2, Undo2, X } from 'lucide-react'
import { money } from '@/lib/action-cases/customerOffers'
import { choiceCalculatedPrice, choiceRowPrice, choiceRows, isChoiceCalculation, type CustomerChoiceCalculation, type CustomerChoiceCosting, type CustomerChoiceCostRow } from '@/lib/action-cases/customerChoiceCosting'
import PriceInput from './CustomerOfferPriceInput'
import './action-case-costs.css'
import './customer-choice-costs.css'

const command = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-[#D5DCDD] px-3 py-2 text-sm font-semibold disabled:opacity-50'
const icon = `${command} h-11 w-11 shrink-0 px-0`
const blankRow = (): CustomerChoiceCostRow => ({ id: crypto.randomUUID(), title: '', costOre: null, markupBasisPoints: 0, fixedMarkupOre: null, complete: false })

export default function CustomerChoiceCostTable({ optionId, value, customerPrice, available, onChange, onPrice }: {
  optionId: string
  value?: CustomerChoiceCosting[string]
  customerPrice: number | null
  available: boolean
  onChange: (value: CustomerChoiceCalculation) => void
  onPrice: (amount: number | null) => void
}) {
  const rows = choiceRows(value, optionId)
  let total: ReturnType<typeof choiceCalculatedPrice> = null, invalid = false
  try { total = choiceCalculatedPrice(rows) } catch { invalid = true }
  const mode = value && isChoiceCalculation(value) ? value.priceMode : total && total.grossOre === customerPrice ? 'calculated' : 'manual'
  const [editing, setEditing] = useState<string | null>(null)
  const [removed, setRemoved] = useState<{ row: CustomerChoiceCostRow; index: number } | null>(null)
  const change = (next: CustomerChoiceCostRow[], priceMode = mode) => onChange({ version: 2, priceMode, rows: next })
  const patch = (id: string, update: Partial<CustomerChoiceCostRow>) => change(rows.map(row => row.id === id ? { ...row, ...update, ...('costOre' in update || 'title' in update ? { complete: false } : {}) } : row))
  const add = () => { const row = blankRow(); change([...rows, row]); setEditing(row.id) }
  const rowPrice = (row: CustomerChoiceCostRow) => { try { const result = choiceRowPrice(row); return result === null ? 'Pris saknas' : money(result) } catch { return 'Kontrollera belopp' } }
  return <section className="gizmo-choice-costs" aria-label="Alternativets pris">
    <fieldset disabled={!available} className="gizmo-choice-price-mode"><legend>Prissättning</legend>
      {(['calculated', 'manual'] as const).map(priceMode => <label key={priceMode}><input type="radio" name={`price-mode-${optionId}`} checked={mode === priceMode} onChange={() => {
        if (priceMode === 'calculated' && !rows.length) { const row = blankRow(); change([row], priceMode); setEditing(row.id) }
        else change(rows, priceMode)
      }} />{priceMode === 'calculated' ? 'Kalkylrader' : 'Samlat kundpris'}</label>)}
    </fieldset>
    {!available && <p role="status" className="mt-2 text-sm text-[#596368]">Kalkylrader behöver aktiveras av administratören. Sparade priser är kvar.</p>}
    {mode === 'manual' ? <PriceInput label="Kundpris inkl. moms (kr)" value={customerPrice} onChange={onPrice} /> : <>
      <div className="gizmo-cost-toolbar"><div><h3>Kalkyl</h3><p>Exklusive moms</p></div><button type="button" className={command} disabled={!available || rows.length >= 50} onClick={add}><Plus size={17} />Lägg till rad</button></div>
      <table className="gizmo-cost-table" aria-label="Alternativets kalkylrader"><colgroup><col data-column="done" /><col /><col data-column="cost" /><col data-column="markup" /><col data-column="price" /><col data-column="edit" /></colgroup>
        <thead><tr><th scope="col" className="gizmo-cost-check">Klar</th><th scope="col">Kalkylrad</th><th scope="col" data-number>Kostnad</th><th scope="col" data-number>Påslag</th><th scope="col" data-number>Kundpris</th><th scope="col"><span className="sr-only">Redigera</span></th></tr></thead>
        <tbody>{!rows.length && <tr><td colSpan={6} className="gizmo-cost-empty">Inga kalkylrader.</td></tr>}{rows.map(row => <Fragment key={row.id}>
          <tr data-open={editing === row.id}>
            <td className="gizmo-cost-check"><label><input type="checkbox" aria-label={`Klar: ${row.title || 'Ny rad'}`} checked={row.complete} disabled={!available || row.costOre === null || !row.title.trim()} onChange={event => patch(row.id, { complete: event.target.checked })} /></label></td>
            <td className="gizmo-cost-name"><strong>{row.title || 'Ny kalkylrad'}</strong>{row.costOre === null && <small>Pris saknas</small>}</td>
            <td data-number data-label="Kostnad">{row.costOre === null ? 'Pris saknas' : money(row.costOre)}</td>
            <td data-number data-label="Påslag">{((row.markupBasisPoints ?? 0) / 100).toLocaleString('sv-SE')} %{Boolean(row.fixedMarkupOre) && <small className="block">+ {money(row.fixedMarkupOre)}</small>}</td>
            <td data-number data-label="Kundpris">{rowPrice(row)}</td>
            <td className="gizmo-cost-edit"><button type="button" className={icon} disabled={!available} title="Redigera kalkylrad" aria-label={`Redigera kalkylrad ${row.title || 'Ny rad'}`} aria-expanded={editing === row.id} onClick={() => setEditing(editing === row.id ? null : row.id)}><Pencil size={16} /></button></td>
          </tr>
          {editing === row.id && <tr className="gizmo-cost-detail"><td colSpan={6}><fieldset disabled={!available} className="gizmo-choice-row-fields">
            <label className="gizmo-choice-row-title">Benämning<input aria-label="Kalkylradens benämning" className="mt-1 block w-full rounded-md border border-[#D5DCDD] bg-white px-3 py-2" maxLength={200} value={row.title} onChange={event => patch(row.id, { title: event.target.value })} /></label>
            <PriceInput label="Kostnad exkl. moms (kr)" value={row.costOre} onChange={costOre => patch(row.id, { costOre })} />
            <PriceInput label="Påslag (%)" value={row.markupBasisPoints} max={100_000} onChange={markupBasisPoints => patch(row.id, { markupBasisPoints, complete: false })} />
            <PriceInput label="Fast påslag exkl. moms (kr, valfritt)" value={row.fixedMarkupOre} onChange={fixedMarkupOre => patch(row.id, { fixedMarkupOre, complete: false })} />
          </fieldset><div className="gizmo-cost-detail-actions"><button type="button" className={command} onClick={() => setEditing(null)}><X size={16} />Stäng rad</button><button type="button" className={`${command} text-rose-700`} disabled={!available} onClick={() => { setRemoved({ row, index: rows.indexOf(row) }); change(rows.filter(other => other.id !== row.id)); setEditing(null) }}><Trash2 size={16} />Ta bort rad</button></div></td></tr>}
        </Fragment>)}</tbody>
        <tfoot><tr><td colSpan={2}>Summa exkl. moms</td><td data-number data-label="Kostnad">{total ? money(total.costOre) : 'Ej komplett'}</td><td className="gizmo-cost-total-spacer" /><td data-number data-label="Kundpris">{total ? money(total.netOre) : 'Ej komplett'}</td><td className="gizmo-cost-total-spacer" /></tr></tfoot>
      </table>
      {removed && <button type="button" className={`${command} mt-2`} disabled={!available || rows.length >= 50} onClick={() => { const next = [...rows]; next.splice(Math.min(removed.index, next.length), 0, removed.row); change(next); setRemoved(null) }}><Undo2 size={16} />Ångra borttagning</button>}
      <dl className="gizmo-choice-price-total" aria-live="polite"><div><dt>Moms 25 %</dt><dd>{total ? money(total.vatOre) : ''}</dd></div><div><dt>Kundpris inkl. moms</dt><dd>{total ? money(total.grossOre) : 'Pris ej fastställt'}</dd></div></dl>
      {invalid && <p role="alert" className="mt-2 text-sm text-rose-700">Summan är för stor. Kontrollera beloppen.</p>}
    </>}
  </section>
}
