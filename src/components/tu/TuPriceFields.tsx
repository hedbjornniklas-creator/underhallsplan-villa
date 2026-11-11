'use client'

import { calculateTuPricing, tuMoney, type TuPriceBasis, type TuPricing } from '@/lib/tu/customer'

export function TuPriceSummary({ price }: { price: TuPricing }) {
  return <dl className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-1 text-sm">
    <dt>Pris exkl. moms</dt><dd className="text-right tabular-nums">{tuMoney(price.net)}</dd>
    <dt>Moms ({price.vatRate} %)</dt><dd className="text-right tabular-nums">{tuMoney(price.vat)}</dd>
    <dt className="font-semibold">Totalt inkl. moms</dt><dd className="text-right font-semibold tabular-nums">{tuMoney(price.gross)}</dd>
  </dl>
}

export default function TuPriceFields({ amount, basis, vatRate, onChange, disabled = false }: {
  amount: string; basis: TuPriceBasis; vatRate: number
  onChange: (value: { amount: string; basis: TuPriceBasis; vatRate: number }) => void
  disabled?: boolean
}) {
  let price: TuPricing | null = null
  try { if (amount.trim()) price = calculateTuPricing(amount, basis, vatRate) } catch {}
  const changeBasis = (next: TuPriceBasis) => {
    onChange({ basis: next, vatRate, amount })
  }
  return <fieldset disabled={disabled} className="min-w-0 space-y-3">
    <div className="grid min-w-0 gap-3 sm:grid-cols-3">
      <label className="min-w-0 text-sm">{basis === 'exclusive' ? 'Pris exkl. moms, SEK' : 'Pris inkl. moms, SEK'}
        <input inputMode="decimal" value={amount} onChange={event => onChange({ amount: event.target.value, basis, vatRate })}
          className="mt-1 block min-h-11 w-full min-w-0 rounded-md border border-slate-300 px-3 text-base" />
      </label>
      <label className="min-w-0 text-sm">Prisangivelse
        <select value={basis} onChange={event => changeBasis(event.target.value as TuPriceBasis)} className="mt-1 min-h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-base">
          <option value="inclusive">Inklusive moms</option><option value="exclusive">Exklusive moms</option>
        </select>
      </label>
      <label className="min-w-0 text-sm">Momssats
        <select value={vatRate} onChange={event => onChange({ amount, basis, vatRate: Number(event.target.value) })} className="mt-1 min-h-11 w-full rounded-md border border-slate-300 bg-white px-3 text-base">
          <option value={25}>25 %</option><option value={0}>0 %</option>
        </select>
      </label>
    </div>
    {price && <TuPriceSummary price={price} />}
  </fieldset>
}
