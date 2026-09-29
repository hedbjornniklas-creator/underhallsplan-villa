'use client'

import { Calculator, Check, Plus, Trash2 } from 'lucide-react'
import { money } from '@/lib/action-cases/customerOffers'
import {
  customerOfferCalculatedPrice,
  emptyCustomerOfferCalculation,
  type CustomerOfferCostCalculation
} from '@/lib/action-cases/customerOfferCosting'
import PriceInput from './CustomerOfferPriceInput'

export default function CustomerOfferCostCalculator({ value, customerPrice, onChange, onApply }: {
  value?: CustomerOfferCostCalculation
  customerPrice: number | null
  onChange: (calculation: CustomerOfferCostCalculation) => void
  onApply: (amountOre: number) => void
}) {
  const calculation = value ?? emptyCustomerOfferCalculation()
  let result: ReturnType<typeof customerOfferCalculatedPrice> = null
  let invalid = false
  try { result = customerOfferCalculatedPrice(calculation) } catch { invalid = true }
  const update = (patch: Partial<CustomerOfferCostCalculation>) => onChange({ ...calculation, ...patch })
  const applied = result !== null && customerPrice === result.grossOre
  return <details className="mt-4 border-y border-slate-200 py-3">
    <summary className="cursor-pointer text-sm font-semibold">
      <Calculator size={16} className="mx-2 inline-block" aria-hidden />
      Intern priskalkyl
      {value && <span className="ml-2 font-normal text-slate-500">
        {invalid ? 'Kontrollera beloppen' : result ? money(result.grossOre) : 'Ej komplett'}
      </span>}
    </summary>
    <div className="mt-4 space-y-4">
      <p className="text-sm text-slate-500">Internt underlag · exklusive moms</p>
      <PriceInput label="Inköpspris exkl. moms (kr) *" value={calculation.purchaseOre}
        onChange={(purchaseOre) => update({ purchaseOre })} />
      <div className="grid gap-3 sm:grid-cols-2">
        <PriceInput label="Påslag på inköpspriset (%, valfritt)" value={calculation.markupBasisPoints}
          max={100_000} onChange={(markupBasisPoints) => update({ markupBasisPoints })} />
        <PriceInput label="Fast påslag exkl. moms (kr, valfritt)" value={calculation.fixedMarkupOre}
          onChange={(fixedMarkupOre) => update({ fixedMarkupOre })} />
      </div>
      <div className="border-t border-slate-200 pt-4">
        <h3 className="text-sm font-semibold">Tillägg till kundpriset, exkl. moms</h3>
        {calculation.additions.map((addition, index) => <div key={addition.id}
          className="mt-3 grid grid-cols-[minmax(0,1fr)_44px] items-end gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,180px)_44px]">
          <label className="col-span-2 text-sm font-medium sm:col-span-1">
            Tillägg {index + 1} *
            <input className="mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
              maxLength={200} placeholder="Exempel: Montage eller maskinhyra" value={addition.title}
              onChange={(event) => update({ additions: calculation.additions.map((a) =>
                a.id === addition.id ? { ...a, title: event.target.value } : a) })} />
          </label>
          <PriceInput label={`Belopp tillägg ${index + 1} (kr) *`} value={addition.amountOre}
            onChange={(amountOre) => update({ additions: calculation.additions.map((a) =>
              a.id === addition.id ? { ...a, amountOre } : a) })} />
          <button type="button" className="inline-flex h-11 w-11 items-center justify-center text-rose-700"
            title={`Ta bort tillägg ${index + 1}`} aria-label={`Ta bort tillägg ${index + 1}`}
            onClick={() => update({ additions: calculation.additions.filter((a) => a.id !== addition.id) })}>
            <Trash2 size={17} />
          </button>
        </div>)}
        <button type="button" disabled={calculation.additions.length >= 50}
          className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold disabled:opacity-50"
          onClick={() => update({ additions: [...calculation.additions, { id: crypto.randomUUID(), title: '', amountOre: null }] })}>
          <Plus size={17} /> Lägg till tillägg
        </button>
      </div>
      <div className="border-t border-slate-200 pt-4 text-sm" aria-live="polite">
        {invalid ? <p className="text-rose-700">Summan är för stor. Kontrollera beloppen.</p> : result ? <>
          <dl className="space-y-2">
            <div className="flex flex-wrap justify-between gap-2"><dt>Procentpåslag</dt><dd>{money(result.percentageMarkupOre)}</dd></div>
            <div className="flex flex-wrap justify-between gap-2"><dt>Summa exklusive moms</dt><dd>{money(result.netOre)}</dd></div>
            <div className="flex flex-wrap justify-between gap-2"><dt>Moms 25 %</dt><dd>{money(result.vatOre)}</dd></div>
            <div className="flex flex-wrap justify-between gap-2 font-semibold"><dt>Beräknat kundpris inklusive moms</dt><dd>{money(result.grossOre)}</dd></div>
          </dl>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <span className={applied ? 'text-emerald-700' : 'text-slate-500'}>
              {applied ? 'Kundpriset motsvarar kalkylen' : `Nuvarande kundpris: ${money(customerPrice)}`}
            </span>
            <button type="button" disabled={applied}
              className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-slate-950 px-4 py-2 font-semibold text-white disabled:opacity-50"
              onClick={() => onApply(result!.grossOre)}><Check size={17} /> Använd kundpris</button>
          </div>
        </> : <p className="text-slate-500">{calculation.purchaseOre === null
          ? 'Inköpspris saknas.' : 'Komplettera benämning och belopp på tilläggen.'}</p>}
      </div>
    </div>
  </details>
}
