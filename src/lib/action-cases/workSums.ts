import type { ActionCaseItemView } from './contracts'

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
const nonnegative = (value: unknown): value is number => finite(value) && value >= 0
const ore = (value: number) => Number.isSafeInteger(Math.round(value * 100)) ? Math.round(value * 100) : null

// Display only: neither readiness nor an agreed contract price is derived here.
export function workItemSum(item: Pick<ActionCaseItemView, 'costLines' | 'lumpSum'>) {
  if (item.lumpSum) {
    const p = item.lumpSum
    const amountOre = nonnegative(p.customerPrice) && nonnegative(p.vatRate) ? ore(p.customerPrice * (1 + p.vatRate / 100)) : null
    return { amountOre, partial: amountOre === null }
  }
  const lines = item.costLines.filter(line => !line.coveredByQuoteId)
  const known = lines.filter(line => nonnegative(line.quantity) && nonnegative(line.unitCost) && finite(line.markupPercent) && line.markupPercent >= -100 && nonnegative(line.vatRate))
  const amountOre = known.length ? ore(known.reduce((sum, line) => sum + line.quantity! * line.unitCost! * (1 + line.markupPercent / 100) * (1 + line.vatRate / 100), 0)) : null
  return { amountOre, partial: !lines.length || known.length !== lines.length || amountOre === null }
}

export function workProjectSum(items: Pick<ActionCaseItemView, 'costLines' | 'lumpSum' | 'status'>[]) {
  const included = items.filter(item => !['cancelled', 'declined'].includes(item.status)).map(workItemSum)
  const known = included.filter(row => row.amountOre !== null)
  const total = known.reduce((sum, row) => sum + row.amountOre!, 0)
  const amountOre = (known.length || !included.length) && Number.isSafeInteger(total) ? total : null
  return { amountOre, partial: included.some(row => row.partial) || amountOre === null, incompleteItems: included.filter(row => row.partial).length }
}
