'use client'

import { createContext, useContext, type ReactNode } from 'react'
import { customerMoney, customerVatText, displayedCustomerAmount, storedCustomerAmount, customerVatBreakdown, type CustomerPresentation } from '@/lib/action-cases/customerPresentation'

const PriceContext = createContext<CustomerPresentation | null>(null)
export function CustomerPriceDisplay({ value, children }: { value?: CustomerPresentation | null; children: ReactNode }) {
  return <PriceContext.Provider value={value ?? null}>{children}</PriceContext.Provider>
}
export function useCustomerPriceDisplay() {
  const presentation = useContext(PriceContext), basis = presentation?.vatBasis ?? 'incl'
  return { presentation, basis, label: basis === 'excl' ? 'exkl. moms' : 'inkl. moms',
    text: (text: string) => customerVatText(text, basis),
    money: (ore: number | null, rate = 25, stored: 'incl' | 'excl' = 'incl') => customerMoney(ore, presentation, rate, stored),
    display: (ore: number | null, rate = 25) => displayedCustomerAmount(ore, basis, rate),
    store: (ore: number | null, rate = 25) => storedCustomerAmount(ore, basis, rate) }
}
export function CustomerPriceTotals({ grossOre, rate = 25 }: { grossOre: number | null; rate?: number }) {
  const { basis, presentation } = useCustomerPriceDisplay()
  if (!presentation || grossOre === null) return null
  const totals = customerVatBreakdown(grossOre, rate)
  const format = (ore: number) => new Intl.NumberFormat('sv-SE', { style: 'currency', currency: 'SEK' }).format(ore / 100)
  return <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-2 border-t border-[#D5DCDD] pt-3 text-sm sm:grid-cols-3" aria-label="Momsredovisning">
    <div className={basis === 'excl' ? 'font-semibold' : ''}><dt>Exkl. moms</dt><dd>{format(totals.netOre)}</dd></div>
    <div><dt>Moms {rate} %</dt><dd>{format(totals.vatOre)}</dd></div>
    <div className={basis === 'incl' ? 'font-semibold' : ''}><dt>Inkl. moms</dt><dd>{format(totals.grossOre)}</dd></div>
  </dl>
}
