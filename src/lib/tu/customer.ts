export type TuCustomerKind = 'consumer' | 'business' | 'association'
export type TuPriceBasis = 'inclusive' | 'exclusive'

export type TuCustomer = {
  version: 1
  kind: TuCustomerKind
  contactName: string
  contactRole: string
  identityNumber: string
  invoiceName: string
  invoiceAddress: string
  invoiceReference: string
}

export type TuPricing = {
  version: 1
  basis: TuPriceBasis
  amount: number
  vatRate: number
  net: number
  vat: number
  gross: number
}

export class TuCustomerError extends Error {}

export const TU_CUSTOMER_LABELS: Record<TuCustomerKind, string> = {
  consumer: 'Privatperson', business: 'F\u00f6retag', association: 'F\u00f6rening',
}

export function tuCustomerKind(details: Record<string, unknown> | null | undefined): TuCustomerKind {
  const customer = readTuCustomer(details?.tuCustomer)
  return customer?.kind ?? (details?.customerType === 'business' ? 'business' : 'consumer')
}

export function readTuCustomer(value: unknown): TuCustomer | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const item = value as Record<string, unknown>
  if (item.version !== 1 || !['consumer', 'business', 'association'].includes(String(item.kind))) return null
  const string = (key: string) => typeof item[key] === 'string' ? item[key] as string : ''
  return {
    version: 1, kind: item.kind as TuCustomerKind, contactName: string('contactName'),
    contactRole: string('contactRole'), identityNumber: string('identityNumber'),
    invoiceName: string('invoiceName'), invoiceAddress: string('invoiceAddress'),
    invoiceReference: string('invoiceReference'),
  }
}

export function parseTuCustomer(value: unknown, requireContact = false): TuCustomer {
  const customer = readTuCustomer(value)
  if (!customer) throw new TuCustomerError('V\u00e4lj privatperson, f\u00f6retag eller f\u00f6rening.')
  for (const key of ['contactName', 'contactRole', 'identityNumber', 'invoiceName', 'invoiceAddress', 'invoiceReference'] as const) {
    if (typeof (value as Record<string, unknown>)[key] !== 'string') {
      throw new TuCustomerError('Kontrollera best\u00e4llar- och fakturauppgifterna.')
    }
    const text = customer[key].trim()
    if (text.length > (key === 'invoiceAddress' ? 1000 : 200) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text)) {
      throw new TuCustomerError('Kontrollera best\u00e4llar- och fakturauppgifterna.')
    }
    customer[key] = text
  }
  if (customer.kind !== 'consumer' && !/^\d{6}[- ]?\d{4}$/.test(customer.identityNumber)) {
    throw new TuCustomerError('Ange ett organisationsnummer med tio siffror.')
  }
  if (requireContact && customer.kind !== 'consumer' && !customer.contactName) {
    throw new TuCustomerError('Ange kontaktpersonens namn.')
  }
  return customer
}

export function defaultTuPriceBasis(kind: TuCustomerKind): TuPriceBasis {
  return kind === 'business' ? 'exclusive' : 'inclusive'
}

export function calculateTuPricing(amount: unknown, basis: unknown, vatRate: unknown = 25): TuPricing {
  const value = typeof amount === 'string' && amount.trim() ? Number(amount.replace(',', '.')) : amount
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 999999999 ||
      (basis !== 'inclusive' && basis !== 'exclusive') || (vatRate !== 25 && vatRate !== 0)) {
    throw new TuCustomerError('Ange ett giltigt pris och om det inkluderar moms.')
  }
  const cents = Math.round(value * 100)
  const netCents = basis === 'inclusive' ? Math.round(cents * 100 / (100 + vatRate)) : cents
  const grossCents = basis === 'inclusive' ? cents : Math.round(netCents * (100 + vatRate) / 100)
  return { version: 1, amount: cents / 100, basis, vatRate, net: netCents / 100, vat: (grossCents - netCents) / 100, gross: grossCents / 100 }
}

export function parseTuPricing(value: unknown): TuPricing | null {
  if (value == null) return null
  if (typeof value !== 'object' || Array.isArray(value)) throw new TuCustomerError('Kontrollera prisuppgifterna.')
  const item = value as Record<string, unknown>
  return calculateTuPricing(item.amount, item.basis, item.vatRate)
}

export function readTuPricing(details: Record<string, unknown> | null | undefined): TuPricing | null {
  const value = details?.tuPricing
  if (!value || typeof value !== 'object' || (value as { version?: unknown }).version !== 1) return null
  try { return parseTuPricing(value) } catch { return null }
}

export function tuMoney(amount: number) {
  return new Intl.NumberFormat('sv-SE', { style: 'currency', currency: 'SEK', maximumFractionDigits: 2 }).format(amount)
}

export function tuPriceText(amount: number | null, details: Record<string, unknown> | null | undefined) {
  const price = readTuPricing(details)
  if (!price) return amount == null ? 'Ej angivet' : tuMoney(amount)
  const lead = price.basis === 'exclusive' && tuCustomerKind(details) === 'business' ? `${tuMoney(price.net)} exkl. moms` : `${tuMoney(price.gross)} inkl. moms`
  return `${lead} (${tuMoney(price.net)} exkl. moms + ${tuMoney(price.vat)} moms ${price.vatRate} %, totalt ${tuMoney(price.gross)})`
}

// "villa" is the existing database key for non-apartment TU objects, not a customer category.
export function tuUsesApartment(details: Record<string, unknown> | null | undefined, brfName?: string | null, apartmentNumber?: string | null, legacyRole?: string | null) {
  if (details?.objectType === 'villa') return false
  if (details?.objectType === 'apartment') return true
  const role = (legacyRole ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  return Boolean(brfName?.trim() || apartmentNumber?.trim() || role.includes('lagenhet') || role.includes('apartment') || role.includes('apt'))
}

export function parseTuCustomerAcceptance(details: Record<string, unknown> | null, body: Record<string, unknown>) {
  const issued = readTuCustomer(details?.tuCustomer)
  if (!issued) return null
  const customer = parseTuCustomer(body.tuCustomer, true)
  if (customer.kind !== issued.kind) throw new TuCustomerError('Best\u00e4llartypen har \u00e4ndrats. Kontakta besiktningsmannen.')
  if (customer.kind !== 'consumer' && body.representativeConfirmed !== true) {
    throw new TuCustomerError('Bekr\u00e4fta att du har r\u00e4tt att best\u00e4lla f\u00f6r organisationen.')
  }
  const invoiceEmail = typeof body.invoiceEmail === 'string' ? body.invoiceEmail.trim().toLowerCase() : ''
  if (invoiceEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(invoiceEmail)) {
    throw new TuCustomerError('Ange en giltig faktura-e-postadress.')
  }
  return { customer, invoiceEmail, representativeConfirmed: customer.kind === 'consumer' ? null : true }
}
