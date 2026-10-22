// @ts-expect-error Node strip-types tests require the explicit extension.
import { normalizeCustomerOfferCosting, type CustomerOfferCostCalculation } from './customerOfferCosting.ts'

export type CustomerChoiceCostRow = {
  id: string
  title: string
  costOre: number | null
  markupBasisPoints: number | null
  fixedMarkupOre: number | null
  complete: boolean
  quantity?: number | null
  unit?: string
  unitCostOre?: number | null
  category?: 'own_labor' | 'material' | 'subcontractor' | 'other'
  chargeType?: 'fixed' | 'running'
}
export type CustomerChoiceCalculation = {
  version: 2 | 3
  priceMode: 'calculated' | 'manual'
  rows: CustomerChoiceCostRow[]
}
export type CustomerChoiceCosting = Record<string, CustomerChoiceCalculation | CustomerOfferCostCalculation>
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const maximum = 100_000_000_000
const fail = (): never => { throw new Error('CUSTOMER_CHOICE_COSTING_INVALID') }
function amount(value: unknown, max = maximum): number | null {
  if (value === null) return null
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= max ? value : fail()
}
export function isChoiceCalculation(value: CustomerChoiceCosting[string]): value is CustomerChoiceCalculation {
  return 'version' in value && (value.version === 2 || value.version === 3)
}
export function choiceRowCost(row: CustomerChoiceCostRow): number | null {
  if (row.quantity === undefined && row.unitCostOre === undefined) return row.costOre
  if (row.quantity == null || row.unitCostOre == null) return null
  if (!Number.isSafeInteger(row.unitCostOre) || row.unitCostOre < 0 || row.unitCostOre > maximum || row.quantity > 1_000_000_000) return fail()
  const millis = Math.round(row.quantity * 1000)
  if (!Number.isSafeInteger(millis) || millis < 0 || Math.abs(millis / 1000 - row.quantity) > 0.0000001) return fail()
  const total = (BigInt(millis) * BigInt(row.unitCostOre) + BigInt(500)) / BigInt(1000)
  return total > BigInt(maximum) ? fail() : Number(total)
}
export function choiceRowPrice(row: CustomerChoiceCostRow): number | null {
  const rowCost = choiceRowCost(row)
  if (rowCost === null) return null
  const cost = BigInt(rowCost)
  const markup = (cost * BigInt(row.markupBasisPoints ?? 0) + BigInt(5_000)) / BigInt(10_000)
  const result = cost + markup + BigInt(row.fixedMarkupOre ?? 0)
  if (result > BigInt(maximum)) return fail()
  return Number(result)
}
export function choiceCalculatedPrice(rows: readonly CustomerChoiceCostRow[]) {
  if (!rows.length || rows.some(row => choiceRowCost(row) === null || !row.title.trim())) return null
  const cost = rows.reduce((sum, row) => sum + BigInt(choiceRowCost(row)!), BigInt(0))
  const net = rows.reduce((sum, row) => sum + BigInt(choiceRowPrice(row)!), BigInt(0))
  const vat = (net * BigInt(25) + BigInt(50)) / BigInt(100)
  if (net + vat > BigInt(maximum) || cost > BigInt(maximum)) return fail()
  return { costOre: Number(cost), netOre: Number(net), vatOre: Number(vat), grossOre: Number(net + vat) }
}

// A legacy worksheet is projected, never converted by reading or opening a panel.
export function choiceRows(value: CustomerChoiceCosting[string] | undefined, optionId: string): CustomerChoiceCostRow[] {
  if (!value) return []
  if (isChoiceCalculation(value)) return value.rows
  const rows: CustomerChoiceCostRow[] = value.additions.map(addition => ({ id: addition.id, title: addition.title, costOre: addition.amountOre, markupBasisPoints: 0, fixedMarkupOre: null, complete: false }))
  let suffix = BigInt(`0x${optionId.slice(-12)}`)
  const allocate = () => {
    let id: string
    do { suffix = (suffix + BigInt(1)) % BigInt('0x1000000000000'); id = optionId.slice(0, -12) + suffix.toString(16).padStart(12, '0') } while (rows.some(row => row.id === id))
    return id
  }
  rows.unshift({ id: allocate(), title: 'Material / inköp', costOre: value.purchaseOre, markupBasisPoints: value.markupBasisPoints, fixedMarkupOre: value.fixedMarkupOre, complete: false })
  return rows
}
export function normalizeCustomerChoiceCosting(value: unknown, items: readonly { id: string }[]): CustomerChoiceCosting {
  if (value === undefined) return {}
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length > 200) return fail()
  const validIds = new Set(items.map(item => item.id))
  return Object.fromEntries(Object.entries(value).flatMap<[string, CustomerChoiceCosting[string]]>(([id, raw]) => {
    if (!uuid.test(id)) return fail()
    if (!validIds.has(id)) return []
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail()
    if (!('version' in raw)) return [[id, normalizeCustomerOfferCosting({ [id]: raw }, items)[id]]]
    if ((raw.version !== 2 && raw.version !== 3) || !('priceMode' in raw) || !['calculated', 'manual'].includes(String(raw.priceMode)) || !('rows' in raw) || !Array.isArray(raw.rows) || raw.rows.length > 50) return fail()
    const seen = new Set<string>()
    const rows = raw.rows.map((row: Record<string, unknown>): CustomerChoiceCostRow => {
      if (!row || typeof row !== 'object' || Array.isArray(row) || typeof row.id !== 'string' || !uuid.test(row.id) || seen.has(row.id) ||
        typeof row.title !== 'string' || row.title.length > 200 || typeof row.complete !== 'boolean') return fail()
      seen.add(row.id)
      const safe: CustomerChoiceCostRow = { id: row.id, title: row.title.trim(), costOre: amount(row.costOre), markupBasisPoints: amount(row.markupBasisPoints, 100_000), fixedMarkupOre: amount(row.fixedMarkupOre), complete: row.complete }
      if (raw.version === 3) {
        if ((row.quantity !== null && (typeof row.quantity !== 'number' || !Number.isFinite(row.quantity) || row.quantity < 0 || row.quantity > 1_000_000_000)) ||
          typeof row.unit !== 'string' || !row.unit.trim() || row.unit.length > 30 || !['own_labor', 'material', 'subcontractor', 'other'].includes(String(row.category)) || !['fixed', 'running'].includes(String(row.chargeType))) return fail()
        Object.assign(safe, { quantity: row.quantity, unit: row.unit.trim(), unitCostOre: amount(row.unitCostOre), category: row.category, chargeType: row.chargeType })
        if (safe.costOre !== choiceRowCost(safe)) return fail()
      }
      if (safe.complete && (safe.costOre === null || !safe.title)) return fail()
      choiceRowPrice(safe)
      return safe
    })
    choiceCalculatedPrice(rows)
    return [[id, { version: raw.version as 2 | 3, priceMode: raw.priceMode, rows }]]
  }))
}

// Only row-based choice prices are derived. Legacy and manual prices remain untouched.
export function synchronizeChoicePrices<T extends { id: string; budgetOre: number | null }>(items: readonly T[], costing: CustomerChoiceCosting): T[] {
  return items.map(item => {
    const calculation = costing[item.id]
    if (!calculation || !isChoiceCalculation(calculation) || calculation.priceMode !== 'calculated') return item
    return { ...item, budgetOre: choiceCalculatedPrice(calculation.rows)?.grossOre ?? null }
  })
}

export function guardChoiceCostingDowngrade(stored: CustomerChoiceCosting, next: CustomerChoiceCosting) {
  for (const [id, previous] of Object.entries(stored)) {
    if (isChoiceCalculation(previous) && (!next[id] || !isChoiceCalculation(next[id]) || (previous.version === 3 && 'version' in next[id] && next[id].version !== 3))) throw new Error('CUSTOMER_CHOICE_COSTING_STALE')
  }
}
