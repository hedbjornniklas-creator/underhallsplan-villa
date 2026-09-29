// Private worksheets. Never include these in an offer snapshot or portal DTO.
export type CustomerOfferCostCalculation = {
  purchaseOre: number | null
  fixedMarkupOre: number | null
  markupBasisPoints: number | null
  additions: { id: string; title: string; amountOre: number | null }[]
}
export type CustomerOfferCosting = Record<string, CustomerOfferCostCalculation>

const maxAmount = 100_000_000_000
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const invalid = (): never => { throw new Error('CUSTOMER_OFFER_INVALID') }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid()
  return value as Record<string, unknown>
}
function amount(value: unknown, max = maxAmount): number | null {
  if (value === null || value === undefined) return null
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > max)
    return invalid()
  return value
}
export function emptyCustomerOfferCalculation(): CustomerOfferCostCalculation {
  return { purchaseOre: null, fixedMarkupOre: null, markupBasisPoints: null, additions: [] }
}

export function normalizeCustomerOfferCosting(
  value: unknown,
  items: readonly { id: string }[]
): CustomerOfferCosting {
  if (value === undefined) return {}
  const entries = Object.entries(record(value))
  if (entries.length > 200) return invalid()
  const validIds = new Set(items.map((item) => item.id))
  return Object.fromEntries(entries.flatMap(([id, input]) => {
    if (!uuid.test(id)) return invalid()
    // Deleted offer rows must not keep orphaned private worksheets.
    if (!validIds.has(id)) return []
    const row = record(input)
    if (!Array.isArray(row.additions) || row.additions.length > 50) return invalid()
    const seen = new Set<string>()
    const calculation: CustomerOfferCostCalculation = {
      purchaseOre: amount(row.purchaseOre),
      fixedMarkupOre: amount(row.fixedMarkupOre),
      markupBasisPoints: amount(row.markupBasisPoints, 100_000),
      additions: row.additions.map((input) => {
        const addition = record(input)
        if (typeof addition.id !== 'string' || !uuid.test(addition.id) || seen.has(addition.id))
          return invalid()
        seen.add(addition.id)
        if (typeof addition.title !== 'string' || addition.title.length > 200) return invalid()
        return { id: addition.id, title: addition.title.trim(), amountOre: amount(addition.amountOre) }
      })
    }
    customerOfferCalculatedPrice(calculation)
    return [[id, calculation]]
  }))
}

export function customerOfferCalculatedPrice(calculation: CustomerOfferCostCalculation) {
  if (calculation.purchaseOre === null || calculation.additions.some((a) => a.amountOre === null || !a.title.trim()))
    return null
  // Round each percentage amount to whole ore. Percentage applies to purchase only.
  const purchase = BigInt(calculation.purchaseOre)
  const percentageMarkup = (purchase * BigInt(calculation.markupBasisPoints ?? 0) + BigInt(5_000)) / BigInt(10_000)
  const net = purchase + percentageMarkup + BigInt(calculation.fixedMarkupOre ?? 0) +
    calculation.additions.reduce((total, a) => total + BigInt(a.amountOre!), BigInt(0))
  const vat = (net * BigInt(25) + BigInt(50)) / BigInt(100)
  const gross = net + vat
  if (gross > BigInt(maxAmount)) return invalid()
  return { netOre: Number(net), vatOre: Number(vat), grossOre: Number(gross), percentageMarkupOre: Number(percentageMarkup) }
}
