import type { ActionCaseCostLineView, ActionCaseItemView, ActionCaseQuote } from '@/lib/action-cases/contracts'
import { quoteIsStale } from '@/lib/action-cases/quotes'

export function coveringQuoteForLine(line: ActionCaseCostLineView, item: ActionCaseItemView) {
  if (!line.coveredByQuoteId) return undefined
  return item.costLines.flatMap((costLine) => costLine.quotes ?? []).find((quote) => quote.id === line.coveredByQuoteId)
}

export function groupPriceForLine(line: ActionCaseCostLineView, item: ActionCaseItemView) {
  const quote = line.coveredByQuoteId ? coveringQuoteForLine(line, item) : line.quotes?.find((quote) => quote.id === line.selectedQuoteId)
  return quote?.packageGroupKey != null ? quote : undefined
}

export function groupPriceUsability(quote: ActionCaseQuote | undefined, item: ActionCaseItemView | undefined, today?: string) {
  const anchor = quote && item?.costLines.find((line) => line.quotes?.some((candidate) => candidate.id === quote.id))
  if (!quote || !item || !anchor) return { usable: false, label: 'Kan inte användas: offertunderlag saknas' }
  // Covered work has its own description; validity belongs to the quote's anchor.
  if (quoteIsStale(quote, item.scope, anchor.description, today)) return { usable: false, label: 'Behöver ny offert: ändrad omfattning eller utgången giltighet' }
  if (!quote.checked || quote.amount === null) return { usable: false, label: 'Kan inte användas: belopp eller kontroll saknas' }
  if (quote.separatePricesConfirmed === false) return { usable: false, label: 'Kan inte användas: prisvillkoren behöver bekräftas' }
  if (anchor.pricingMethod !== 'quotes' || anchor.selectedQuoteId !== quote.id || anchor.coveredByQuoteId || anchor.unitCost === null || !anchor.verified) {
    return { usable: false, label: 'Grupppriset kan inte användas i kalkylen' }
  }
  return { usable: true, label: 'Används i kalkylen' }
}
