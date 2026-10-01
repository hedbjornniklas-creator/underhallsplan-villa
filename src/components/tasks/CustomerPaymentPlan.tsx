'use client'

import { useState } from 'react'
import { ArrowDown, ArrowUp, Plus, Trash2, Undo2 } from 'lucide-react'
import { money } from '@/lib/action-cases/customerOffers'
import { paymentPlanIssues, paymentPlanTotal, type CustomerPayment, type CustomerPaymentPlan } from '@/lib/action-cases/customerPaymentPlan'
import PriceInput from './CustomerOfferPriceInput'

const button = 'inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-slate-300 px-4 py-2 text-sm font-semibold disabled:opacity-50'
const iconButton = 'inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-slate-300 disabled:opacity-40'
const field = 'mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm'

export function PaymentPlanDocument({ plan, paymentTerms, showTerms = true }: {
  plan?: CustomerPaymentPlan | null; paymentTerms: string; showTerms?: boolean
}) {
  return <div>
    {plan?.installments.length ? <>
      <ol className="divide-y divide-slate-200">
        {plan.installments.map((row, index) => <li key={row.id} className="break-inside-avoid py-5">
          <div className="flex flex-wrap justify-between gap-2 font-semibold">
            <h3 className="min-w-0 break-words text-base">{index + 1}. {row.title || 'Delbetalning'}</h3>
            <span>{row.amountOre === null ? 'Belopp saknas' : money(row.amountOre)}</span>
          </div>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-6">{row.condition || 'Faktureringsvillkor saknas'}</p>
          {row.plannedDate && <p className="mt-2 text-sm text-slate-600">Planerad fakturering: <time dateTime={row.plannedDate}>{row.plannedDate}</time></p>}
        </li>)}
      </ol>
      <div className="flex flex-wrap justify-between gap-2 border-y border-slate-200 py-4 text-sm font-semibold">
        <span>Summa inklusive moms</span><span>{money(paymentPlanTotal(plan))}</span>
      </div>
    </> : <p className="py-4 text-sm text-slate-600">Ingen uppdelad betalningsplan finns i denna avtalsversion.</p>}
    {showTerms && <div className="py-5">
      <h3 className="text-base font-semibold">Betalningsvillkor</h3>
      <p className="mt-2 whitespace-pre-wrap text-sm leading-6">{paymentTerms || 'Ej angivet'}</p>
    </div>}
  </div>
}

export function PaymentPlanEditor({ plan, baseAmount, paymentTerms, onChange, onTermsChange }: {
  plan?: CustomerPaymentPlan | null; baseAmount: number | null; paymentTerms: string
  onChange: (plan: CustomerPaymentPlan | null) => void; onTermsChange: (text: string) => void
}) {
  const [removed, setRemoved] = useState<{ row: CustomerPayment; index: number } | null>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const total = plan ? paymentPlanTotal(plan) : 0
  const remaining = baseAmount === null ? null : baseAmount - total
  const issues = paymentPlanIssues(plan, baseAmount)
  function update(id: string, patch: Partial<CustomerPayment>) {
    if (plan) onChange({ ...plan, installments: plan.installments.map((r) => r.id === id ? { ...r, ...patch } : r) })
  }
  function move(index: number, delta: number) {
    if (!plan) return
    const rows = [...plan.installments], target = index + delta
    if (target < 0 || target >= rows.length) return
    ;[rows[index], rows[target]] = [rows[target], rows[index]]
    onChange({ ...plan, installments: rows })
  }
  function add() {
    onChange({ version: 1, installments: [...(plan?.installments ?? []), {
      id: crypto.randomUUID(), title: '', condition: '', amountOre: null, plannedDate: ''
    }] })
  }
  return <>
    <label className="block max-w-3xl text-sm font-medium">Betalningsvillkor *
      <textarea className={field} rows={3} maxLength={6000} value={paymentTerms} onChange={(e) => onTermsChange(e.target.value)} />
    </label>
    <dl className="mt-6 grid gap-4 border-y border-slate-200 py-5 sm:grid-cols-3" aria-live="polite">
      {[['Grundavtal inkl. moms', baseAmount], ['Fördelat', total], [remaining !== null && remaining < 0 ? 'Överfördelat' : 'Kvar att fördela', remaining === null ? null : Math.abs(remaining)]].map(([label, value]) =>
        <div key={String(label)}><dt className="text-sm text-slate-600">{label}</dt><dd className="mt-1 text-lg font-semibold">{value === null ? 'Pris saknas' : money(Number(value))}</dd></div>)}
    </dl>
    {!plan ? <div className="py-6"><button className={button} onClick={add}><Plus size={17} /> Lägg upp betalningsplan</button></div> : <>
      <ol className="divide-y divide-slate-200">
        {plan.installments.map((row, index) => <li className="py-6" key={row.id}>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-base font-semibold">Delbetalning {index + 1}</h3>
            <div className="flex gap-2">
              <button className={iconButton} aria-label={`Flytta upp delbetalning ${index + 1}`} title="Flytta upp" disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp size={17} /></button>
              <button className={iconButton} aria-label={`Flytta ned delbetalning ${index + 1}`} title="Flytta ned" disabled={index === plan.installments.length - 1} onClick={() => move(index, 1)}><ArrowDown size={17} /></button>
              <button className={iconButton} aria-label={`Ta bort delbetalning ${index + 1}`} title="Ta bort" onClick={() => { setRemoved({ row, index }); onChange({ ...plan, installments: plan.installments.filter((r) => r.id !== row.id) }) }}><Trash2 size={17} /></button>
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-medium">Rubrik *<input className={field} maxLength={250} value={row.title} onChange={(e) => update(row.id, { title: e.target.value })} /></label>
            <PriceInput label="Belopp inkl. moms (kr) *" value={row.amountOre} onChange={(amountOre) => update(row.id, { amountOre })} />
            <label className="text-sm font-medium sm:col-span-2">Villkor för fakturering *<textarea className={field} rows={2} maxLength={6000} value={row.condition} onChange={(e) => update(row.id, { condition: e.target.value })} /></label>
            <label className="text-sm font-medium">Planerat faktureringsdatum (valfritt)<input className={field} type="date" value={row.plannedDate} onChange={(e) => update(row.id, { plannedDate: e.target.value })} /></label>
            <div className="flex items-end">
              <button className={button} disabled={remaining === null || remaining + (row.amountOre ?? 0) <= 0 || remaining + (row.amountOre ?? 0) > 100_000_000_000} onClick={() => update(row.id, { amountOre: (remaining ?? 0) + (row.amountOre ?? 0) })}>Använd återstående belopp</button>
            </div>
          </div>
        </li>)}
      </ol>
      {removed && <div className="flex flex-wrap items-center gap-3 py-3 text-sm" role="status">Delbetalningen togs bort.
        <button className={button} disabled={plan.installments.length >= 60} onClick={() => {
          const rows = [...plan.installments]; rows.splice(Math.min(removed.index, rows.length), 0, removed.row)
          onChange({ ...plan, installments: rows }); setRemoved(null)
        }}><Undo2 size={16} /> Ångra</button>
      </div>}
      <div className="flex flex-wrap gap-3 border-t border-slate-200 py-5">
        <button className={button} disabled={plan.installments.length >= 60} onClick={add}><Plus size={17} /> Lägg till delbetalning</button>
        <button className={button} onClick={() => setConfirmRemove(true)}><Trash2 size={17} /> Ta bort betalningsplan</button>
      </div>
      {confirmRemove && <div className="border-l-4 border-amber-500 p-4">
        <p className="text-sm">Ta bort alla delbetalningar från utkastet? Betalningsvillkoren och redan skickade versioner behålls.</p>
        <div className="mt-3 flex flex-wrap gap-3"><button className={button} onClick={() => { onChange(null); setConfirmRemove(false); setRemoved(null) }}>Ta bort planen</button><button className={button} onClick={() => setConfirmRemove(false)}>Avbryt</button></div>
      </div>}
      {issues.length > 0 && <div className="border-l-4 border-amber-500 p-4 text-sm">
        <h3 className="font-semibold">Kvar innan avtalet kan skickas</h3><ul className="mt-2 list-disc space-y-1 pl-5">{issues.map((issue) => <li key={issue}>{issue}</li>)}</ul>
      </div>}
    </>}
  </>
}
