import type { ActionCaseCostLineView, ActionCaseSuggestedCostLine } from './contracts'

export const COST_CATEGORIES = ['own_labor', 'material', 'subcontractor', 'waste', 'transport', 'other'] as const
export const QUANTITY_BASES = ['provided', 'calculated', 'estimated', 'unknown'] as const
const PRICE_SOURCES = ['manual', 'beijer', 'subcontractor', 'price_book', 'ai_suggestion', 'other'] as const

function invalid(): never { throw new Error('ACTION_CASE_COST_LINE_INVALID') }
function amount(value: unknown, max: number, min: number): number | null {
  if (value === null || value === undefined || value === '') return null
  if (typeof value !== 'number' && typeof value !== 'string') return invalid()
  if (typeof value === 'string' && !value.trim()) return null
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed < min || parsed > max) return invalid()
  return parsed
}
function text(value: unknown, max: number, required = false) {
  if (value != null && typeof value !== 'string') return invalid()
  const result = typeof value === 'string' ? value.trim() : ''
  if (result.length > max || (required && !result)) return invalid()
  return result
}

export function normalizeCostLine(input: Record<string, unknown>) {
  const category = text(input.category, 30) as ActionCaseCostLineView['category']
  const priceSource = (text(input.priceSource, 30) || 'manual') as ActionCaseCostLineView['priceSource']
  const quantity = amount(input.quantity, 99999999999.999, 0.001)
  const unitCost = amount(input.unitCost, 999999999999.99, 0)
  const markupPercent = amount(input.markupPercent ?? 0, 1000, -100) ?? 0
  const quantityBasis = (quantity === null ? 'unknown' : (input.quantityBasis || 'provided')) as ActionCaseCostLineView['quantityBasis']
  if (!COST_CATEGORIES.includes(category) || !PRICE_SOURCES.includes(priceSource) || !QUANTITY_BASES.includes(quantityBasis)) return invalid()
  if (quantity !== null && quantityBasis === 'unknown') return invalid()
  const sourceUrl = text(input.sourceUrl, 2000) || null
  if (sourceUrl) {
    try { if (!['https:', 'http:'].includes(new URL(sourceUrl).protocol)) return invalid() }
    catch { return invalid() }
  }
  const verified = input.verified === true
  if (verified && (quantity === null || unitCost === null)) return invalid()
  return {
    category, description: text(input.description, 500, true), quantity,
    unit: text(input.unit, 30, true), unitCost, markupPercent, priceSource,
    quantityBasis, notes: text(input.notes, 2000) || null, sourceUrl, verified,
  }
}

// Treat structured model output as untrusted data, not as a ready-to-use cost estimate.
export function parseCostSuggestions(value: unknown): { lines: Omit<ActionCaseSuggestedCostLine, 'id'>[]; warnings: string[] } {
  if (!value || typeof value !== 'object') throw new Error('ACTION_CASE_AI_INVALID')
  const data = value as Record<string, unknown>
  if (!Array.isArray(data.lines) || data.lines.length > 30 || !Array.isArray(data.warnings) || data.warnings.length > 15) throw new Error('ACTION_CASE_AI_INVALID')
  try {
    const lines = data.lines.map((raw: unknown) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return invalid()
      const row = raw as Record<string, unknown>
      if (!QUANTITY_BASES.includes(row.quantityBasis as typeof QUANTITY_BASES[number])) return invalid()
      const normalized = normalizeCostLine({ ...row, unitCost: null, markupPercent: 0, verified: false, priceSource: 'ai_suggestion', sourceUrl: null })
      if (['calculated', 'estimated'].includes(normalized.quantityBasis) && !normalized.notes) return invalid()
      const { category, description, quantity, unit, quantityBasis, notes } = normalized
      return { category, description, quantity, unit, quantityBasis, notes }
    })
    return { lines, warnings: data.warnings.map((warning) => text(warning, 1000, true)) }
  } catch { throw new Error('ACTION_CASE_AI_INVALID') }
}
