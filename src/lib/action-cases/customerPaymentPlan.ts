export type CustomerPayment = {
  id: string
  title: string
  condition: string
  plannedDate: string
  amountOre: number | null
}
export type CustomerPaymentPlan = { version: 1; installments: CustomerPayment[] }

export function normalizePaymentPlan(value: unknown): CustomerPaymentPlan | null {
  if (value === null) return null
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('CUSTOMER_OFFER_INVALID')
  const p = value as Record<string, unknown>
  if (p.version !== 1 || !Array.isArray(p.installments) || p.installments.length > 60)
    throw new Error('CUSTOMER_OFFER_INVALID')
  const installments = p.installments.map((input): CustomerPayment => {
    if (!input || typeof input !== 'object') throw new Error('CUSTOMER_OFFER_INVALID')
    const r = input as Record<string, unknown>
    if (typeof r.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(r.id) ||
      typeof r.title !== 'string' || r.title.length > 250 ||
      typeof r.condition !== 'string' || r.condition.length > 6000 ||
      typeof r.plannedDate !== 'string' || (r.plannedDate !== '' &&
        (!/^\d{4}-\d{2}-\d{2}$/.test(r.plannedDate) || !Number.isFinite(Date.parse(r.plannedDate)) ||
          new Date(r.plannedDate).toISOString().slice(0, 10) !== r.plannedDate)) ||
      (r.amountOre !== null && (!Number.isSafeInteger(r.amountOre) || Number(r.amountOre) < 0 || Number(r.amountOre) > 100_000_000_000)))
      throw new Error('CUSTOMER_OFFER_INVALID')
    return { id: r.id.toLowerCase(), title: r.title.trim(), condition: r.condition.trim(), plannedDate: r.plannedDate, amountOre: r.amountOre as number | null }
  })
  if (new Set(installments.map((r) => r.id)).size !== installments.length) throw new Error('CUSTOMER_OFFER_INVALID')
  return { version: 1, installments }
}

export function paymentPlanTotal(plan: CustomerPaymentPlan): number {
  return plan.installments.reduce((sum, r) => sum + (r.amountOre ?? 0), 0)
}

export function paymentPlanIssues(plan: CustomerPaymentPlan | null | undefined, baseAmount: number | null): string[] {
  if (!plan) return []
  const issues: string[] = []
  if (!plan.installments.length) issues.push('Lägg till minst en delbetalning i betalningsplanen.')
  for (const [index, row] of plan.installments.entries()) {
    if (!row.title.trim() || !row.condition.trim()) issues.push(`Komplettera rubrik och faktureringsvillkor för delbetalning ${index + 1}.`)
    if (row.amountOre === null || row.amountOre <= 0) issues.push(`Ange ett belopp större än noll för delbetalning ${index + 1}.`)
  }
  if (baseAmount === null) issues.push('Grundavtalets pris måste vara klart innan betalningsplanen skickas.')
  else if (paymentPlanTotal(plan) !== baseAmount) issues.push('Betalningsplanens summa ska motsvara grundavtalets pris.')
  return issues
}
