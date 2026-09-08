export const EB_FOLLOW_UP_PRICE_ORE = 59_900
export const EB_FOLLOW_UP_NET_PRICE_ORE = 47_920
export const EB_FOLLOW_UP_VAT_ORE = 11_980
export const EB_FOLLOW_UP_VAT_RATE = 25
/** Orders produce manual invoice material for Admin, never an automatically issued invoice. */
export const EB_FOLLOW_UP_ADMIN_EMAIL = 'jn@hedbjorn.se'
export const EB_FOLLOW_UP_TERMS_VERSION = '2026-09-07'
export const EB_FOLLOW_UP_SERVICE_DESCRIPTION =
  'Digital uppföljning av noteringarna i detta fastställda utlåtande. Du fördelar noteringar till entreprenörer som kan svara och lämna åtgärdsbilder. Tjänsten omfattar inte en ny besiktning, teknisk granskning eller godkännande av åtgärder.'

export type EbFollowUpSeller = {
  name: string
  orgNumber: string
  address: string
  email: string
  phone?: string | null
}

export type EbFollowUpOffer = {
  available: boolean
  /** Only temporary technical failures should offer the customer a retry. */
  retryable?: boolean
  reason: string | null
  priceOre: number
  netPriceOre: number
  vatOre: number
  vatRate: number
  termsVersion: string
  serviceDescription: string
  alreadyActive: boolean
  seller: EbFollowUpSeller | null
}

export type EbFollowUpBuyer = {
  name: string
  email: string
  invoiceName: string
  invoiceOrgNo: string | null
  invoiceAddress: string
  invoicePostalCode: string
  invoiceCity: string
}

export type EbFollowUpOrderInput = {
  action: 'order'
  challengeId: string
  code: string
  name: string
  invoiceName: string
  invoiceOrgNo?: string | null
  invoiceAddress: string
  invoicePostalCode: string
  invoiceCity: string
  acceptTerms: true
  requestImmediateStart: true
  acceptInvoice: true
  termsVersion: string
  confirmedPriceOre: number
}

export function normalizeEbFollowUpEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const email = value.trim().toLowerCase()
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null
}

export function validateEbFollowUpBuyer(input: Record<string, unknown>, email: string): EbFollowUpBuyer {
  if (input.acceptTerms !== true || input.requestImmediateStart !== true || input.acceptInvoice !== true) {
    throw new Error('EB_FOLLOW_UP_CONSENT_REQUIRED')
  }
  if (input.termsVersion !== EB_FOLLOW_UP_TERMS_VERSION || input.confirmedPriceOre !== EB_FOLLOW_UP_PRICE_ORE) {
    throw new Error('EB_FOLLOW_UP_OFFER_CHANGED')
  }
  const field = (name: string, max: number): string => {
    const value = input[name]
    if (typeof value !== 'string' || !value.trim() || value.trim().length > max || /[\u0000-\u001f]/.test(value)) {
      throw new Error('EB_FOLLOW_UP_BUYER_INVALID')
    }
    return value.trim()
  }
  const invoiceOrgNo = input.invoiceOrgNo == null || input.invoiceOrgNo === '' ? null : field('invoiceOrgNo', 40)
  return {
    name: field('name', 150), email, invoiceName: field('invoiceName', 200), invoiceOrgNo,
    invoiceAddress: field('invoiceAddress', 250), invoicePostalCode: field('invoicePostalCode', 30),
    invoiceCity: field('invoiceCity', 100),
  }
}
