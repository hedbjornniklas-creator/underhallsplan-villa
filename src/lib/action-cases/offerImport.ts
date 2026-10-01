import type { ActionCaseItemView } from './contracts'

// Only customer prices cross into an offer. Internal costs and supplier notes stay private.
export function importableCustomerPrice(item: ActionCaseItemView): number | null {
  if (item.lumpSum) return item.lumpSum.verified && item.lumpSum.customerPrice !== null
    ? Math.round(item.lumpSum.customerPrice * (1 + item.lumpSum.vatRate / 100) * 100) : null
  const lines = item.costLines.filter((line) => !line.coveredByQuoteId)
  if (!lines.length || lines.some((line) => !line.verified || line.quantity === null || line.unitCost === null)) return null
  return Math.round(lines.reduce((sum, line) => sum + line.quantity! * line.unitCost! * (1 + line.markupPercent / 100) * (1 + line.vatRate / 100), 0) * 100)
}
