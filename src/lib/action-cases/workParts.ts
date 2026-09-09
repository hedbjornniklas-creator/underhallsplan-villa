import type { ActionCaseWorkPart } from './contracts'

export const MAX_WORK_PART_LINES = 100

type Payload = Record<string, unknown>
type CostPatch = { quantity?: number | null; unit?: string; unitCost?: number | null; markupPercent?: number }
type ActionBase = { caseId: string; itemId: string; expectedUpdatedAt: string }
export type WorkPartAction = ActionBase & (
  | { operation: 'save'; partId: string | null; title: string; scope?: string | null; sortOrder?: number }
  | { operation: 'delete'; partId: string }
  | { operation: 'move_lines'; partId: string | null; costLineIds: string[] }
  | ({ operation: 'bulk_update'; costLineIds: string[] } & CostPatch)
)

function invalid(code = 'ACTION_CASE_WORK_PART_INVALID'): never { throw new Error(code) }

function id(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) return invalid()
  return value.toLowerCase()
}

function text(value: unknown, max: number, required = false): string {
  if (value != null && typeof value !== 'string') return invalid()
  const result = typeof value === 'string' ? value.trim() : ''
  if (result.includes('\0') || result.length > max || (required && !result)) return invalid()
  return result
}

// Keep the original fractional seconds: Date.toISOString() would lose Postgres microseconds.
function timestamp(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:?\d{2})$/.test(value)
    || !Number.isFinite(Date.parse(value))) return invalid('ACTION_CASE_ITEM_STALE')
  return value
}

function lineIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_WORK_PART_LINES) return invalid()
  const ids = value.map(id)
  if (new Set(ids).size !== ids.length) return invalid()
  return ids
}

function amount(value: unknown, min: number, max: number, nullable: boolean): number | null {
  if (value === null && nullable) return null
  if ((typeof value !== 'number' && typeof value !== 'string') || (typeof value === 'string' && !value.trim())) return invalid('ACTION_CASE_COST_LINE_INVALID')
  const result = Number(value)
  if (!Number.isFinite(result) || result < min || result > max) return invalid('ACTION_CASE_COST_LINE_INVALID')
  return result
}

export function normalizeWorkPartAction(input: Payload): WorkPartAction {
  const base = { caseId: id(input.caseId), itemId: id(input.itemId), expectedUpdatedAt: timestamp(input.expectedUpdatedAt) }
  if (input.operation === 'save') {
    const part = { ...base, operation: 'save' as const, partId: input.partId == null ? null : id(input.partId), title: text(input.title, 300, true) }
    const optional: { scope?: string | null; sortOrder?: number } = {}
    if ('scope' in input) optional.scope = text(input.scope, 12000) || null
    if ('sortOrder' in input) {
      if (typeof input.sortOrder !== 'number' || !Number.isInteger(input.sortOrder) || input.sortOrder < 1 || input.sortOrder > 2147483547) return invalid()
      optional.sortOrder = input.sortOrder
    }
    return { ...part, ...optional }
  }
  if (input.operation === 'delete') return { ...base, operation: 'delete', partId: id(input.partId) }
  if (input.operation === 'move_lines') {
    if (!('partId' in input)) return invalid()
    return { ...base, operation: 'move_lines', partId: input.partId === null ? null : id(input.partId), costLineIds: lineIds(input.costLineIds) }
  }
  if (input.operation === 'bulk_update') {
    const patch: CostPatch = {}
    if ('quantity' in input) patch.quantity = amount(input.quantity, 0.001, 99999999999.999, true)
    if ('unitCost' in input) patch.unitCost = amount(input.unitCost, 0, 999999999999.99, true)
    if ('markupPercent' in input) patch.markupPercent = amount(input.markupPercent, -100, 1000, false) as number
    if ('unit' in input) {
      try { patch.unit = text(input.unit, 30, true) } catch { return invalid('ACTION_CASE_COST_LINE_INVALID') }
    }
    if (!Object.keys(patch).length) return invalid('ACTION_CASE_COST_LINE_INVALID')
    return { ...base, operation: 'bulk_update', costLineIds: lineIds(input.costLineIds), ...patch }
  }
  return invalid()
}

export function mapWorkPart(row: Record<string, unknown>): ActionCaseWorkPart {
  return { id: String(row.id), title: String(row.title), scope: row.scope == null ? null : String(row.scope),
    sortOrder: Number(row.sort_order), updatedAt: String(row.updated_at) }
}
