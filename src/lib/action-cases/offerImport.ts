import type { ActionCaseItemView } from './contracts'
import type { CustomerOfferItem } from './customerOffers'

export function scopeNotesDiffer(source: ActionCaseItemView, target: CustomerOfferItem): boolean {
  return source.scopeNotesAvailable === true && (
    (source.scopeExclusions ?? '') !== (target.scopeExclusions ?? '') ||
    (source.scopeAdvice ?? '') !== (target.scopeAdvice ?? '')
  )
}

// Re-import only the explicitly selected notes; preserve the customer's edited scope and price.
export function importOfferItems(existing: CustomerOfferItem[], selected: ActionCaseItemView[], withPrices: boolean): CustomerOfferItem[] {
  const notes = (source: ActionCaseItemView) => source.scopeNotesAvailable
    ? { scopeExclusions: source.scopeExclusions ?? '', scopeAdvice: source.scopeAdvice ?? '' } : {}
  return [
    ...existing.map((item) => {
      const source = selected.find((s) => s.id === item.id)
      return source && scopeNotesDiffer(source, item) ? { ...item, ...notes(source) } : item
    }),
    ...selected.filter((source, index) => !existing.some((i) => i.id === source.id) && selected.findIndex((s) => s.id === source.id) === index)
      .map((source): CustomerOfferItem => ({ id: source.id, title: source.title, scope: source.scope ?? '',
        ...notes(source), kind: 'included', amountOre: withPrices ? importableCustomerPrice(source) : null })),
  ]
}

// Only customer prices cross into an offer. Internal costs and supplier notes stay private.
export function importableCustomerPrice(item: ActionCaseItemView): number | null {
  if (item.lumpSum) return item.lumpSum.verified && item.lumpSum.customerPrice !== null
    ? Math.round(item.lumpSum.customerPrice * (1 + item.lumpSum.vatRate / 100) * 100) : null
  const lines = item.costLines.filter((line) => !line.coveredByQuoteId)
  if (!lines.length || lines.some((line) => !line.verified || line.quantity === null || line.unitCost === null)) return null
  return Math.round(lines.reduce((sum, line) => sum + line.quantity! * line.unitCost! * (1 + line.markupPercent / 100) * (1 + line.vatRate / 100), 0) * 100)
}
