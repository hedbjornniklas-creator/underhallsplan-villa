import type { ActionCaseCostLineView, ActionCaseItemView, ActionCaseWorkspace } from './contracts'
import { normalizeCostLine } from './costing'
import { normalizeLumpSum } from './lumpSum'
import { normalizeWorkPartAction } from './workParts'
import { offerId } from './customerOffers'

export type CalculationEdit = { key: string; itemId: string; operation: 'line' | 'delete_line' | 'complete' | 'lump_sum' | 'work_part' | 'markup'; data: Record<string, unknown> }
export type CalculationSaveResult = { requestId: string; expectedUpdatedAt: string; updatedAt: string; caseId: string; partId?: string; item: ActionCaseItemView; caseStatus: ActionCaseWorkspace['cases'][number]['status'] }
export function sameCalculationVersion(a: string, b: string) {
  const key = (value: string) => {
    const match = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.(\d{1,6}))?(?:Z|[+-]\d{2}:?\d{2})$/.exec(value)
    const parsed = Date.parse(value)
    return match && Number.isFinite(parsed) ? BigInt(Math.floor(parsed / 1000)) * BigInt(1000000) + BigInt((match[1] ?? '').padEnd(6, '0')) : null
  }
  return key(a) !== null && key(a) === key(b)
}
export function calculationData(edit: CalculationEdit, caseId: string, expectedUpdatedAt: string) {
  const data = edit.data
  if (edit.operation === 'line') return { ...normalizeCostLine(data), id: offerId(data.id), create: data.create === true }
  if (edit.operation === 'delete_line') return { id: offerId(data.id) }
  if (edit.operation === 'complete') {
    if (typeof data.complete !== 'boolean') throw new Error('ACTION_CASE_COST_LINE_INVALID')
    return { id: offerId(data.id), complete: data.complete }
  }
  if (edit.operation === 'lump_sum') return { lumpSum: normalizeLumpSum(data.lumpSum) }
  if (edit.operation === 'work_part') {
    const part: Record<string, unknown> = { ...normalizeWorkPartAction({ ...data, caseId, itemId: edit.itemId, expectedUpdatedAt }) }
    delete part.caseId; delete part.itemId; delete part.expectedUpdatedAt
    return part
  }
  if (edit.operation === 'markup') {
    const markupPercent = Number(data.markupPercent)
    if (data.markupPercent == null || String(data.markupPercent).trim() === '' || !Number.isFinite(markupPercent) || markupPercent < -100 || markupPercent > 1000) throw new Error('ACTION_CASE_COST_LINE_INVALID')
    return { id: offerId(data.id), markupPercent }
  }
  throw new Error('ACTION_CASE_COST_LINE_INVALID')
}

export function overlayCalculation(item: ActionCaseItemView, edits: CalculationEdit[]): ActionCaseItemView {
  let result = { ...item, costLines: [...item.costLines] }
  for (const edit of edits) {
    if (edit.itemId !== item.id) continue
    const data = edit.data, index = result.costLines.findIndex(line => line.id === data.id)
    if (edit.operation === 'delete_line') result.costLines = result.costLines.filter(line => line.id !== data.id)
    if (edit.operation === 'complete' && index >= 0) result.costLines[index] = { ...result.costLines[index], verified: data.complete === true }
    if (edit.operation === 'line') {
      const number = (value: unknown, min: number, max: number) => value !== '' && value != null && Number.isFinite(Number(value)) && Number(value) >= min && Number(value) <= max ? Number(value) : null
      const quantity = number(data.quantity, 0.001, 99999999999.999)
      const next: ActionCaseCostLineView = { ...(result.costLines[index] ?? { id: String(data.id), vatRate: 25, sourceCheckedAt: null, sortOrder: Number.MAX_SAFE_INTEGER, pricingMethod: 'direct' }),
        category: data.category as ActionCaseCostLineView['category'], description: String(data.description ?? ''), unit: String(data.unit ?? ''),
        quantity, unitCost: number(data.unitCost, 0, 999999999999.99), markupPercent: number(data.markupPercent, -100, 1000) ?? 0,
        priceSource: data.priceSource as ActionCaseCostLineView['priceSource'], sourceUrl: String(data.sourceUrl ?? '') || null,
        quantityBasis: quantity === null ? 'unknown' : data.quantityBasis as ActionCaseCostLineView['quantityBasis'], notes: String(data.notes ?? '') || null, verified: data.verified === true }
      if (index < 0) result.costLines.push(next)
      else result.costLines[index] = next
    }
    if (edit.operation === 'lump_sum') {
      try { result = { ...result, lumpSum: normalizeLumpSum(data.lumpSum) } } catch { /* Invalid raw values stay in the editor, not in totals. */ }
    }
    if (edit.operation === 'markup' && index >= 0 && Number.isFinite(Number(data.markupPercent))) result.costLines[index] = { ...result.costLines[index], markupPercent: Number(data.markupPercent), verified: false }
    if (edit.operation === 'work_part' && data.operation === 'save') {
      const id = data.partId == null ? edit.key.slice('part:'.length) : String(data.partId)
      const parts = [...(result.workParts ?? [])], found = parts.findIndex(part => part.id === id)
      const part = { ...(parts[found] ?? { id, sortOrder: Number.MAX_SAFE_INTEGER, updatedAt: item.updatedAt }), title: String(data.title ?? ''), scope: String(data.scope ?? '') || null }
      if (found < 0) parts.push(part)
      else parts[found] = part
      result = { ...result, workParts: parts }
    }
  }
  return result
}

export function mergeCalculationSave(workspace: ActionCaseWorkspace, result: CalculationSaveResult): ActionCaseWorkspace {
  return { ...workspace, cases: workspace.cases.map(project => project.id !== result.caseId ? project : {
    ...project, status: result.caseStatus, items: project.items.map(item => item.id === result.item.id ? result.item : item),
  }) }
}
