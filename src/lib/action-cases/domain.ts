import type { ActionCaseCostLineView, ActionCaseItemView } from './contracts'

export function calculateActionCaseCostTotals(
  lines: ReadonlyArray<Pick<ActionCaseCostLineView, 'quantity' | 'unitCost' | 'markupPercent'>>
) {
  if (!lines.length || lines.some((line) => line.quantity === null || line.unitCost === null)) {
    return { internalCost: null, customerPrice: null }
  }
  const internalCost = lines.reduce((sum, line) => sum + line.quantity! * line.unitCost!, 0)
  const customerPrice = lines.reduce(
    (sum, line) => sum + line.quantity! * line.unitCost! * (1 + line.markupPercent / 100),
    0
  )
  return {
    internalCost: Math.round(internalCost * 100) / 100,
    customerPrice: Math.round(customerPrice * 100) / 100,
  }
}

export function actionCaseCostCoverage(lines: ReadonlyArray<Pick<ActionCaseCostLineView,
  'quantity' | 'unitCost' | 'markupPercent' | 'verified'>>) {
  const known = lines.filter((line) => line.quantity !== null && line.unitCost !== null)
  return {
    missingQuantity: lines.filter((line) => line.quantity === null).length,
    missingPrice: lines.filter((line) => line.unitCost === null).length,
    unchecked: lines.filter((line) => !line.verified).length,
    knownTotals: calculateActionCaseCostTotals(known),
    complete: lines.length > 0 && known.length === lines.length && lines.every((line) => line.verified),
  }
}

export function actionCaseItemCompletion(item: Pick<
  ActionCaseItemView,
  'scope' | 'ownLaborReady' | 'materialPriceReady' | 'wasteSolutionReady' | 'requiresSubcontractor' | 'subcontractorPriceReady'
> & { costLines?: ActionCaseCostLineView[] }) {
  const checks = [Boolean(item.scope?.trim()), item.ownLaborReady, item.materialPriceReady, item.wasteSolutionReady]
  if (item.requiresSubcontractor) checks.push(item.subcontractorPriceReady)
  if (item.costLines?.length) checks.push(actionCaseCostCoverage(item.costLines).complete)
  return Math.round((checks.filter(Boolean).length / checks.length) * 100)
}

export function filterActionCasePortalItems<T extends { id: string }>(
  role: 'customer' | 'subcontractor',
  items: readonly T[],
  grantedAttachmentItemIds: ReadonlyArray<string | null>
) {
  if (role === 'customer') return [...items]
  const visibleItemIds = new Set(grantedAttachmentItemIds.filter((id): id is string => Boolean(id)))
  return items.filter((item) => visibleItemIds.has(item.id))
}
