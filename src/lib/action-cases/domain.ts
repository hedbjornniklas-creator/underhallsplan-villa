import type { ActionCaseCostLineView, ActionCaseItemView } from './contracts'

export function calculateActionCaseCostTotals(
  lines: ReadonlyArray<Pick<ActionCaseCostLineView, 'quantity' | 'unitCost' | 'markupPercent'>>
) {
  const internalCost = lines.reduce((sum, line) => sum + line.quantity * line.unitCost, 0)
  const customerPrice = lines.reduce(
    (sum, line) => sum + line.quantity * line.unitCost * (1 + line.markupPercent / 100),
    0
  )
  return {
    internalCost: Math.round(internalCost * 100) / 100,
    customerPrice: Math.round(customerPrice * 100) / 100,
  }
}

export function actionCaseItemCompletion(item: Pick<
  ActionCaseItemView,
  'scope' | 'ownLaborReady' | 'materialPriceReady' | 'wasteSolutionReady' | 'requiresSubcontractor' | 'subcontractorPriceReady'
>) {
  const checks = [Boolean(item.scope?.trim()), item.ownLaborReady, item.materialPriceReady, item.wasteSolutionReady]
  if (item.requiresSubcontractor) checks.push(item.subcontractorPriceReady)
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
