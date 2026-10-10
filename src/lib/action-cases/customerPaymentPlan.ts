export type CustomerPayment = {
  id: string
  title: string
  condition: string
  plannedDate: string
  amountOre: number | null
  kind?: 'initial' | 'final'
}
export type PaymentConditions = { version: 1; days: number; standardText: string }
export type CustomerPaymentPlan = { version: 1; installments: CustomerPayment[]; automation?: {
  version: 1; initialEnabled: boolean; initialPercent: number | null; allocationBaseOre: number | null
} }

export const abs18PaymentText = 'Betalning erläggs mot faktura. I faktura angivna arbeten ska vara utförda när fakturering sker. Om inte betalning erläggs i rätt tid utgår dröjsmålsränta enligt räntelagen.\n\nBeställaren har rätt att hålla inne tio procent av det avtalade priset till dess entreprenaden har godkänts vid slutbesiktning.\n\nBesiktningsmannen ska i samband med slutbesiktningen värdera hur stort belopp som beställaren har rätt att hålla inne tills eventuella fel avhjälpts.'
const validAmount = (v: unknown) => v === null || (Number.isSafeInteger(v) && Number(v) >= 0 && Number(v) <= 100_000_000_000)
function invalid(): never { throw new Error('CUSTOMER_OFFER_INVALID') }
export function normalizePaymentConditions(value: unknown): PaymentConditions {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid()
  const p = value as Record<string, unknown>
  if (p.version !== 1 || !Number.isInteger(p.days) || Number(p.days) < 1 || Number(p.days) > 365 ||
    typeof p.standardText !== 'string' || p.standardText.length > 6000) invalid()
  return { version: 1, days: Number(p.days), standardText: (p.standardText as string).trim() }
}
export function paymentConditionsText(conditions: PaymentConditions | undefined, other: string): string {
  return conditions ? [`Faktura betalas inom ${conditions.days} dagar efter mottagandet.`, conditions.standardText, other].filter(Boolean).join('\n\n') : other
}

export function normalizePaymentPlan(value: unknown): CustomerPaymentPlan | null {
  if (value === null) return null
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('CUSTOMER_OFFER_INVALID')
  const p = value as Record<string, unknown>
  if (p.version !== 1 || !Array.isArray(p.installments) || p.installments.length > 60)
    throw new Error('CUSTOMER_OFFER_INVALID')
  const installments = p.installments.map((input): CustomerPayment => {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('CUSTOMER_OFFER_INVALID')
    const r = input as Record<string, unknown>
    if (typeof r.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(r.id) ||
      typeof r.title !== 'string' || r.title.length > 250 ||
      typeof r.condition !== 'string' || r.condition.length > 6000 ||
      typeof r.plannedDate !== 'string' || (r.plannedDate !== '' &&
        (!/^\d{4}-\d{2}-\d{2}$/.test(r.plannedDate) || !Number.isFinite(Date.parse(r.plannedDate)) ||
          new Date(r.plannedDate).toISOString().slice(0, 10) !== r.plannedDate)) ||
      (r.kind !== undefined && r.kind !== 'initial' && r.kind !== 'final') || !validAmount(r.amountOre))
      throw new Error('CUSTOMER_OFFER_INVALID')
    return { id: r.id.toLowerCase(), title: r.title.trim(), condition: r.condition.trim(), plannedDate: r.plannedDate, amountOre: r.amountOre as number | null,
      ...(r.kind === undefined ? {} : { kind: r.kind as CustomerPayment['kind'] }) }
  })
  if (new Set(installments.map((r) => r.id)).size !== installments.length) throw new Error('CUSTOMER_OFFER_INVALID')
  const result: CustomerPaymentPlan = { version: 1, installments }
  if (p.automation !== undefined) {
    if (!p.automation || typeof p.automation !== 'object' || Array.isArray(p.automation)) invalid()
    const a = p.automation as Record<string, unknown>, percent = a.initialPercent
    if (a.version !== 1 || typeof a.initialEnabled !== 'boolean' || !validAmount(a.allocationBaseOre) ||
      (percent !== null && (typeof percent !== 'number' || !Number.isFinite(percent) || percent < 0 || percent > 90 || Math.abs(percent * 100 - Math.round(percent * 100)) > 0.00001))) invalid()
    if (installments.filter((r) => r.kind === 'final').length !== 1 || installments.at(-1)?.kind !== 'final' ||
      installments.filter((r) => r.kind === 'initial').length !== (a.initialEnabled ? 1 : 0) || (a.initialEnabled && installments[0]?.kind !== 'initial')) invalid()
    result.automation = { version: 1, initialEnabled: a.initialEnabled as boolean, initialPercent: percent as number | null, allocationBaseOre: a.allocationBaseOre as number | null }
  } else if (installments.some((r) => r.kind)) invalid()
  return result
}

export function paymentPercentAmount(base: number | null, percent: number | null): number | null {
  if (base === null || percent === null) return null
  return Number((BigInt(base) * BigInt(Math.round(percent * 100)) + BigInt(5000)) / BigInt(10000))
}
export function syncPaymentPlan(plan: CustomerPaymentPlan | null | undefined, base: number | null): CustomerPaymentPlan | null | undefined {
  if (!plan?.automation) return plan
  const rows = plan.installments.map((r) => r.kind ? { ...r, amountOre: paymentPercentAmount(base, r.kind === 'final' ? 10 : plan.automation!.initialPercent) } : r)
  return rows.every((r, i) => r.amountOre === plan.installments[i].amountOre) ? plan : { ...plan, installments: rows }
}
// Largest remainders keep the allocation exact to the last ore, even for large contracts.
export function distributePaymentPlan(plan: CustomerPaymentPlan, base: number, equal = false): CustomerPaymentPlan {
  const synced = syncPaymentPlan(plan, base)!, regular = synced.installments.filter((r) => !r.kind)
  const available = base - synced.installments.filter((r) => r.kind).reduce((sum, r) => sum + (r.amountOre ?? 0), 0)
  if (available < 0 || !regular.length || regular.length > available) invalid()
  const positive = regular.filter((r) => (r.amountOre ?? 0) > 0), mean = positive.length ? Math.round(positive.reduce((s, r) => s + r.amountOre!, 0) / positive.length) : 1
  const weights = regular.map((r) => BigInt(equal ? 1 : r.amountOre && r.amountOre > 0 ? r.amountOre : mean)), sum = weights.reduce((s, w) => s + w, BigInt(0))
  const remaining = BigInt(available - regular.length)
  const shares = weights.map((w, index) => ({ index, amount: Number(remaining * w / sum) + 1, remainder: remaining * w % sum }))
  let extra = available - shares.reduce((s, r) => s + r.amount, 0)
  for (const row of [...shares].sort((a, b) => a.remainder === b.remainder ? a.index - b.index : a.remainder > b.remainder ? -1 : 1)) {
    if (extra-- <= 0) break
    row.amount++
  }
  const amounts = new Map(regular.map((r, i) => [r.id, shares[i].amount]))
  return { ...synced, ...(synced.automation ? { automation: { ...synced.automation, allocationBaseOre: base } } : {}),
    installments: synced.installments.map((r) => r.kind ? r : { ...r, amountOre: amounts.get(r.id)! }) }
}
export function configurePaymentPlan(plan: CustomerPaymentPlan | null | undefined, base: number | null, enabled = false, percent: number | null = 10,
  newId = () => crypto.randomUUID()): CustomerPaymentPlan {
  const regular = plan?.installments.filter((r) => !r.kind) ?? [{ id: newId(), title: 'Delbetalning', condition: '', plannedDate: '', amountOre: null }]
  const initial = plan?.installments.find((r) => r.kind === 'initial') ?? { id: newId(), kind: 'initial' as const, title: 'Första delbetalning', condition: 'Efter att det avtalade första arbetsmomentet är utfört.', plannedDate: '', amountOre: null }
  const final = plan?.installments.find((r) => r.kind === 'final') ?? { id: newId(), kind: 'final' as const, title: 'Slutbetalning', condition: 'Efter godkänd slutbesiktning. Beställarens rätt att hålla inne belopp för kvarstående fel påverkas inte.', plannedDate: '', amountOre: null }
  const value: CustomerPaymentPlan = { version: 1, automation: { version: 1, initialEnabled: enabled, initialPercent: percent, allocationBaseOre: base },
    installments: [...(enabled ? [initial] : []), ...regular, final] }
  const synced = syncPaymentPlan(value, base)!
  return base !== null && (!enabled || percent !== null) && regular.length && base - paymentPlanTotal({ version: 1, installments: synced.installments.filter((r) => r.kind) }) >= regular.length
    ? distributePaymentPlan(synced, base) : synced
}

export function paymentPlanTotal(plan: CustomerPaymentPlan): number {
  return plan.installments.reduce((sum, r) => sum + (r.amountOre ?? 0), 0)
}

export function paymentPlanIssues(plan: CustomerPaymentPlan | null | undefined, baseAmount: number | null, priceMode?: string): string[] {
  if (!plan) return []
  const issues: string[] = []
  if (plan.automation) {
    if (priceMode && priceMode !== 'fixed') issues.push('Automatiska procentbetalningar kräver ett fast pris för hela grundavtalet.')
    if (plan.automation.initialEnabled && (plan.automation.initialPercent === null || plan.automation.initialPercent <= 0)) issues.push('Ange procent för den första delbetalningen.')
    for (const row of plan.installments.filter((r) => r.kind)) {
      const expected = paymentPercentAmount(baseAmount, row.kind === 'final' ? 10 : plan.automation.initialPercent)
      if (row.amountOre !== expected) issues.push('Procentbetalningarna måste räknas från grundavtalets aktuella pris.')
    }
    if (baseAmount !== null && plan.automation.allocationBaseOre !== baseAmount) issues.push('Anpassa betalningsplanen till avtalets ändrade pris.')
  }
  if (!plan.installments.length) issues.push('Lägg till minst en delbetalning i betalningsplanen.')
  for (const [index, row] of plan.installments.entries()) {
    if (!row.title.trim() || !row.condition.trim()) issues.push(`Komplettera rubrik och faktureringsvillkor för delbetalning ${index + 1}.`)
    if (row.amountOre === null || row.amountOre <= 0) issues.push(`Ange ett belopp större än noll för delbetalning ${index + 1}.`)
  }
  if (baseAmount === null) issues.push('Grundavtalets pris måste vara klart innan betalningsplanen skickas.')
  else if (paymentPlanTotal(plan) !== baseAmount) issues.push('Betalningsplanens summa ska motsvara grundavtalets pris.')
  return issues
}
