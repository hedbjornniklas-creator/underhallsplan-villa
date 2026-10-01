import type { CustomerOfferCosting } from './customerOfferCosting'

export const planningStatuses = {
  planned: 'Planerat',
  pricing: 'Behöver prissättas',
  deferred: 'Senare beslut',
  external: 'Beställaren ordnar'
} as const
export type CustomerPlannedItem = {
  id: string
  title: string
  scope: string
  status: keyof typeof planningStatuses
  budgetOre: number | null
  decisionBy: string
  optionGroup?: string
}
export type CustomerPlanning = {
  revision: number
  items: CustomerPlannedItem[]
  sharedItems: CustomerPlannedItem[]
  available: boolean
  costing?: CustomerOfferCosting
  costingAvailable?: boolean
}
export function normalizePlannedItems(
  value: unknown,
  complete = false
): CustomerPlannedItem[] {
  const fail = (): never => {
    throw new Error('CUSTOMER_OFFER_INVALID')
  }
  const text = (v: unknown, max: number) =>
    typeof v === 'string' && v.length <= max ? v.trim() : fail()
  if (!Array.isArray(value) || value.length > 200) fail()
  const items = (value as unknown[]).map((v): CustomerPlannedItem => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) return fail()
    const item = v as Record<string, unknown>
    const id = text(item.id, 36),
      title = text(item.title, 250),
      scope = text(item.scope, 12000),
      decisionBy = text(item.decisionBy, 10)
    if (
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        id
      ) ||
      !Object.hasOwn(planningStatuses, String(item.status))
    )
      fail()
    if (complete && (!title || !scope)) fail()
    if (
      decisionBy &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(decisionBy) ||
        !Number.isFinite(Date.parse(decisionBy)) ||
        new Date(decisionBy).toISOString().slice(0, 10) !== decisionBy)
    )
      fail()
    if (
      item.budgetOre !== null &&
      (!Number.isSafeInteger(item.budgetOre) ||
        Number(item.budgetOre) < 0 ||
        Number(item.budgetOre) > 100_000_000_000)
    )
      fail()
    return {
      id,
      title,
      scope,
      status: item.status as CustomerPlannedItem['status'],
      budgetOre: item.budgetOre as number | null,
      decisionBy,
      ...(item.optionGroup !== undefined ? { optionGroup: text(item.optionGroup, 100) } : {})
    }
  })
  if (new Set(items.map((i) => i.id)).size !== items.length) fail()
  return items
}
