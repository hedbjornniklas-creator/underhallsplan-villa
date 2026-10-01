export type ActionLumpSum = { internalCost: number | null; customerPrice: number | null; vatRate: number; verified: boolean }
export function normalizeLumpSum(value: unknown): ActionLumpSum | null {
  if (value === null) return null
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('ACTION_CASE_LUMP_SUM_INVALID')
  const r = value as Record<string, unknown>
  for (const key of ['internalCost', 'customerPrice']) {
    const amount = r[key]
    if (amount !== null && (typeof amount !== 'number' || !Number.isFinite(amount) || amount < 0 || amount > 1_000_000_000 || Math.abs(Math.round(amount * 100) / 100 - amount) > 0.000001)) throw new Error('ACTION_CASE_LUMP_SUM_INVALID')
  }
  if (![0, 6, 12, 25].includes(Number(r.vatRate)) || typeof r.vatRate !== 'number' || typeof r.verified !== 'boolean' || (r.verified && r.customerPrice === null)) throw new Error('ACTION_CASE_LUMP_SUM_INVALID')
  return { internalCost: r.internalCost as number | null, customerPrice: r.customerPrice as number | null, vatRate: r.vatRate, verified: r.verified }
}
