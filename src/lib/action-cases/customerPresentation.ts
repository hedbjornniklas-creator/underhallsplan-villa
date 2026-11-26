export const projectCustomerTypes = ['private', 'business', 'association'] as const
export type ProjectCustomerType = typeof projectCustomerTypes[number]
export type VatBasis = 'incl' | 'excl'
export type CustomerPresentation = { version: 1; customerType: ProjectCustomerType; vatBasis: VatBasis }
export type ProjectCustomerPresentation = { available: boolean; revision: number; value: CustomerPresentation | null }
export const customerTypeLabels = { private: 'Privatperson', business: 'Företag', association: 'Förening / BRF' }

export function defaultCustomerPresentation(customerType: ProjectCustomerType): CustomerPresentation {
  return { version: 1, customerType, vatBasis: customerType === 'business' ? 'excl' : 'incl' }
}

export function normalizeCustomerPresentation(value: unknown): CustomerPresentation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('CUSTOMER_PRESENTATION_INVALID')
  const input = value as Record<string, unknown>
  if (Object.keys(input).length !== 3 || input.version !== 1 || !projectCustomerTypes.includes(input.customerType as ProjectCustomerType) ||
    !['incl', 'excl'].includes(String(input.vatBasis)) || (input.customerType === 'private' && input.vatBasis !== 'incl')) throw new Error('CUSTOMER_PRESENTATION_INVALID')
  return { version: 1, customerType: input.customerType as ProjectCustomerType, vatBasis: input.vatBasis as VatBasis }
}

// Ordinary customer price fields have always stored VAT-inclusive ore. The
// explicitly named amountExVatOre fields in B2B alternatives are already net.
export function displayedCustomerAmount(ore: number | null, basis: VatBasis = 'incl', rate = 25, stored: VatBasis = 'incl') {
  if (ore === null || basis === stored) return ore
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) throw new Error('CUSTOMER_PRESENTATION_INVALID')
  return Math.round(stored === 'incl' ? ore / (1 + rate / 100) : ore * (1 + rate / 100))
}
export function storedCustomerAmount(ore: number | null, basis: VatBasis = 'incl', rate = 25) {
  return displayedCustomerAmount(ore, 'incl', rate, basis)
}
export function customerVatText(text: string, basis: VatBasis = 'incl') {
  if (basis === 'incl') return text
  return text.replace(/inklusive (entreprenörarvode|arvode) och moms/gu, 'inklusive $1, exklusive moms')
    .replace(/inkl\. (entreprenörarvode|arvode) och moms/gu, 'inkl. $1, exkl. moms')
    .replace(/inkluderar (entreprenörarvode|arvode) och moms/gu, 'inkluderar $1 men inte moms')
    .replace(/inklusive moms/gu, 'exklusive moms').replace(/Inklusive moms/gu, 'Exklusive moms')
    .replace(/inkl\. moms/gu, 'exkl. moms').replace(/Inkl\. moms/gu, 'Exkl. moms')
    .replace(/Beloppen inkluderar moms/gu, 'Moms tillkommer på beloppen')
}
export function customerMoney(ore: number | null, presentation?: CustomerPresentation | null, rate = 25, stored: VatBasis = 'incl') {
  const amount = displayedCustomerAmount(ore, presentation?.vatBasis ?? 'incl', rate, stored)
  return amount === null ? 'Pris saknas' : new Intl.NumberFormat('sv-SE', { style: 'currency', currency: 'SEK' }).format(amount / 100)
}
export function customerVatBreakdown(grossOre: number, rate = 25) {
  const netOre = displayedCustomerAmount(grossOre, 'excl', rate)!
  return { netOre, vatOre: grossOre - netOre, grossOre }
}
