import type { PackageRequestLine } from './quoteRequests'
import { groupRequestLines } from './quoteRequests'
import { quoteId } from './quotes'

export type QuotePackageView = {
  requestId: string; groupKey: string; quoteId: string; anchorLineId: string; itemId: string
  workPartId: string | null; amount: number; coveredLineIds: string[]
  state: 'active' | 'removed'; updatedAt: string
}
export type PackageLineVersion = { costLineId: string; updatedAt: string }
export type QuotePackageAction = {
  caseId: string; requestId: string; groupKey: string; expectedUpdatedAt: string
} & ({ operation: 'remove' } | {
  operation: 'accept'; checked: true; offeredScope: string; amount: number; separateGroupPriceConfirmed: boolean
  expectedLines: PackageLineVersion[]; coveredLineIds?: string[]
  validUntil?: string | null
})

export const PACKAGE_ALLOCATION_REASON = 'Paketet omfattar flera åtgärder eller arbetsdelar. Välj en prisgrupp och bekräfta ett självständigt grupppris. Automatisk fördelning av ett gemensamt paketpris stöds inte.'
export function packageAcceptanceBlockReason(lines: readonly PackageRequestLine[], groupKey?: string, separateGroupPriceConfirmed = false): string | null {
  const groups = groupRequestLines(lines)
  if (!groups.length || (groupKey != null && !groups.some((group) => group.key === groupKey))) return PACKAGE_ALLOCATION_REASON
  return groups.length === 1 || (groupKey != null && separateGroupPriceConfirmed) ? null : PACKAGE_ALLOCATION_REASON
}

const invalid = (): never => { throw new Error('ACTION_CASE_PACKAGE_INVALID') }
function version(value: unknown) {
  if (typeof value !== 'string' || value.length > 50 || !/^\d{4}-\d\d-\d\dT/.test(value) || !Number.isFinite(Date.parse(value))) return invalid()
  return value
}
export function normalizeQuotePackageAction(input: Record<string, unknown>): QuotePackageAction {
  if (typeof input.groupKey !== 'string') return invalid()
  const [item, part, extra] = input.groupKey.split(':')
  if (part == null || extra != null) return invalid()
  const groupKey = `${quoteId(item)}:${part ? quoteId(part) : ''}`
  const base = { caseId: quoteId(input.caseId), requestId: quoteId(input.requestId), groupKey, expectedUpdatedAt: version(input.expectedUpdatedAt) }
  if (input.operation === 'remove') return { ...base, operation: 'remove' }
  if (input.operation !== 'accept' || input.checked !== true || typeof input.offeredScope !== 'string' ||
    !input.offeredScope.trim() || input.offeredScope.length > 4000) return invalid()
  if (!Array.isArray(input.expectedLines) || input.expectedLines.length < 1 || input.expectedLines.length > 60) return invalid()
  const expectedLines = input.expectedLines.map((value) => {
    if (!value || typeof value !== 'object') return invalid()
    return { costLineId: quoteId(value.costLineId), updatedAt: version(value.updatedAt) }
  })
  if (new Set(expectedLines.map((line) => line.costLineId)).size !== expectedLines.length) return invalid()
  const covered = input.coveredLineIds ?? []
  if (!Array.isArray(covered) || covered.length > 30) return invalid()
  const coveredLineIds = covered.map(quoteId)
  if (new Set(coveredLineIds).size !== coveredLineIds.length) return invalid()
  let validUntil: string | null = null
  if (input.validUntil != null && input.validUntil !== '') {
    if (typeof input.validUntil !== 'string' || !/^\d{4}-\d\d-\d\d$/.test(input.validUntil)) return invalid()
    const parsed = new Date(`${input.validUntil}T00:00:00Z`)
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== input.validUntil) return invalid()
    validUntil = input.validUntil
  }
  const amount = normalizePackageAmount(input.amount)
  return { ...base, operation: 'accept', checked: true, offeredScope: input.offeredScope.trim(), amount,
    separateGroupPriceConfirmed: input.separateGroupPriceConfirmed === true, expectedLines, coveredLineIds, validUntil }
}

export function normalizePackageAmount(value: unknown): number {
  if ((typeof value !== 'number' && typeof value !== 'string') || !/^\d+(\.\d{1,2})?$/.test(String(value))) return invalid()
  const amount = Number(value)
  if (!Number.isFinite(amount) || amount < 0 || amount > 999999999999.99) return invalid()
  return amount
}

// Deliberately excludes original_lines: the restoration basis is internal only.
export const PACKAGE_VIEW_COLUMNS = 'request_id,group_key,quote_id,anchor_line_id,action_case_item_id,work_part_id,amount,covered_line_ids,state,updated_at'
export function mapQuotePackage(row: Record<string, unknown>): QuotePackageView {
  if (row.state !== 'active' && row.state !== 'removed') return invalid()
  return { requestId: String(row.request_id), groupKey: String(row.group_key), quoteId: String(row.quote_id), anchorLineId: String(row.anchor_line_id),
    itemId: String(row.action_case_item_id), workPartId: row.work_part_id ? String(row.work_part_id) : null,
    amount: Number(row.amount), coveredLineIds: row.covered_line_ids as string[], state: row.state, updatedAt: String(row.updated_at) }
}
