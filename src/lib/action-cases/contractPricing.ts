import type { CustomerOfferDraft } from './customerOffers'

export type ContractPriceRow = {
  id: string; title: string; sourceItemId?: string; kind: 'fixed' | 'running'
  amountOre: number | null; labourOre: number | null; materialOre: number | null
}
export type ContractBudget = {
  version: 1
  rows: { id: string; amountOre: number | null }[]
  assumptions: string
  reviewTerms: string
}
export const defaultBudgetReviewTerms = 'Arbetena ersätts på löpande räkning enligt angivna prisgrunder. Planeringsbudgeten utgår från angivna förutsättningar och osäkerheter och används för uppföljning och samråd. Entreprenören ska följa upp kostnaderna per moment och underrätta beställaren så snart prognosen visar risk för att ett moments budget överskrids. Parterna ska då samråda om omfattning, kostnader och fortsatt arbete innan berörda arbeten fortsätter utöver den överenskomna budgeten. Beslut om ändrad omfattning, reviderad budget eller paus ska dokumenteras skriftligt. Fast pris för ett avgränsat moment gäller först efter en särskild skriftlig överenskommelse som även anger hur redan utfört arbete hanteras.'
export type ContractPricing = {
  version: 1
  budget?: ContractBudget | null
  mode: 'fixed' | 'running' | 'mixed'
  display: 'priced' | 'unpriced' | 'total'
  split: 'combined' | 'separate'
  basis: 'rows' | 'total'
  rows: ContractPriceRow[]
  totalOre: number | null; labourOre: number | null; materialOre: number | null
  running: { hourlyOre: number | null; managementOre: number | null; markupPercent: number | null; approximateOre: number | null }
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
function invalid(): never { throw new Error('CUSTOMER_OFFER_INVALID') }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid()
  return value as Record<string, unknown>
}
function amount(value: unknown): number | null {
  if (value === null) return null
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > 100_000_000_000) invalid()
  return Number(value)
}
function choice<T extends string>(value: unknown, allowed: readonly T[]): T {
  if (!allowed.includes(value as T)) invalid()
  return value as T
}
export function normalizeContractPricing(value: unknown): ContractPricing {
  const p = object(value), r = object(p.running)
  if (p.version !== 1 || !Array.isArray(p.rows) || p.rows.length > 200) invalid()
  const rows = (p.rows as unknown[]).map((input): ContractPriceRow => {
    const row = object(input)
    if (typeof row.id !== 'string' || !uuid.test(row.id) || typeof row.title !== 'string' || row.title.length > 250 ||
      (row.sourceItemId !== undefined && (typeof row.sourceItemId !== 'string' || !uuid.test(row.sourceItemId)))) invalid()
    return { id: (row.id as string).toLowerCase(), title: (row.title as string).trim(),
      ...(row.sourceItemId === undefined ? {} : { sourceItemId: (row.sourceItemId as string).toLowerCase() }),
      kind: choice(row.kind, ['fixed', 'running']), amountOre: amount(row.amountOre), labourOre: amount(row.labourOre), materialOre: amount(row.materialOre) }
  })
  if (new Set(rows.map((row) => row.id)).size !== rows.length ||
    new Set(rows.flatMap((row) => row.sourceItemId ? [row.sourceItemId] : [])).size !== rows.filter((row) => row.sourceItemId).length) invalid()
  const percent = r.markupPercent
  if (percent !== null && (typeof percent !== 'number' || !Number.isFinite(percent) || percent < 0 || percent > 1000 || Math.abs(percent * 100 - Math.round(percent * 100)) > 0.00001)) invalid()
  const result: ContractPricing = { version: 1, rows,
    mode: choice(p.mode, ['fixed', 'running', 'mixed']), display: choice(p.display, ['priced', 'unpriced', 'total']),
    split: choice(p.split, ['combined', 'separate']), basis: choice(p.basis, ['rows', 'total']),
    totalOre: amount(p.totalOre), labourOre: amount(p.labourOre), materialOre: amount(p.materialOre),
    running: { hourlyOre: amount(r.hourlyOre), managementOre: amount(r.managementOre), markupPercent: percent as number | null, approximateOre: amount(r.approximateOre) } }
  if (p.budget !== undefined) {
    if (p.budget === null) result.budget = null
    else {
      const budget = object(p.budget)
      if (budget.version !== 1 || !Array.isArray(budget.rows) || budget.rows.length > 200 ||
        typeof budget.assumptions !== 'string' || budget.assumptions.length > 6000 || typeof budget.reviewTerms !== 'string' || budget.reviewTerms.length > 6000 ||
        result.mode === 'fixed' || result.running.approximateOre !== null) invalid()
      const budgetRows = budget.rows.map((input) => {
        const row = object(input)
        const id = typeof row.id === 'string' ? row.id.toLowerCase() : invalid()
        if (!uuid.test(id) || !rows.some(entry => entry.id === id)) invalid()
        return { id, amountOre: amount(row.amountOre) }
      })
      if (new Set(budgetRows.map(row => row.id)).size !== budgetRows.length) invalid()
      result.budget = { version: 1, rows: budgetRows, assumptions: budget.assumptions.trim(), reviewTerms: budget.reviewTerms.trim() }
      const knownBudget = budgetRows.filter(entry => rows.some(row => row.id === entry.id && (result.mode === 'running' || row.kind === 'running'))).reduce((sum, row) => sum + (row.amountOre ?? 0), 0)
        + (result.mode === 'mixed' ? contractFixedAmount(result) ?? 0 : 0)
      if (!Number.isSafeInteger(knownBudget) || knownBudget > 100_000_000_000) invalid()
      const budgetTotal = contractBudgetAmount(result)
      if (budgetTotal !== null && (!Number.isSafeInteger(budgetTotal) || budgetTotal > 100_000_000_000)) invalid()
    }
  }
  const total = contractFixedAmount(result)
  if (total !== null && (!Number.isSafeInteger(total) || total > 100_000_000_000)) invalid()
  return result
}
export function contractPricingForEditing(draft: CustomerOfferDraft): ContractPricing {
  if (draft.contractPricing) return draft.contractPricing
  return { version: 1, mode: 'fixed', display: draft.pricingMode === 'itemized' ? 'priced' : 'unpriced', split: 'combined',
    basis: draft.pricingMode === 'itemized' ? 'rows' : 'total', totalOre: draft.baseAmountOre, labourOre: null, materialOre: null,
    rows: draft.items.filter((row) => row.kind === 'included').map((row) => ({ id: row.id, title: row.title,
      ...(row.sourceItemId ? { sourceItemId: row.sourceItemId } : {}), kind: 'fixed', amountOre: row.amountOre, labourOre: null, materialOre: null })),
    running: { hourlyOre: null, managementOre: null, markupPercent: null, approximateOre: null } }
}
export function contractRowAmount(p: ContractPricing, row: Pick<ContractPriceRow, 'amountOre' | 'labourOre' | 'materialOre'>): number | null {
  return p.split === 'combined' ? row.amountOre : row.labourOre === null || row.materialOre === null ? null : row.labourOre + row.materialOre
}
export function contractFixedRows(p: ContractPricing) { return p.rows.filter((row) => p.mode !== 'mixed' || row.kind === 'fixed') }
export function contractFixedAmount(p: ContractPricing): number | null {
  if (p.mode === 'running') return null
  if (p.basis === 'total') return contractRowAmount(p, { amountOre: p.totalOre, labourOre: p.labourOre, materialOre: p.materialOre })
  const rows = contractFixedRows(p), amounts = rows.map((row) => contractRowAmount(p, row))
  return !rows.length || amounts.some((amount) => amount === null) ? null : amounts.reduce<number>((sum, amount) => sum + amount!, 0)
}
export function contractBudgetAmount(p: ContractPricing): number | null {
  if (!p.budget || p.mode === 'fixed') return null
  const rows = p.rows.filter(row => p.mode === 'running' || row.kind === 'running')
  const amounts = rows.map(row => p.budget!.rows.find(entry => entry.id === row.id)?.amountOre ?? null)
  const fixed = p.mode === 'mixed' ? contractFixedAmount(p) : 0
  return !rows.length || fixed === null || amounts.some(amount => amount === null) ? null : fixed + amounts.reduce<number>((sum, amount) => sum + amount!, 0)
}
export function contractPriceModeLabel(p: ContractPricing): string {
  if (p.mode === 'fixed') return 'Fast pris'
  if (p.mode === 'mixed') return p.budget ? 'Fast pris + löpande med budget' : 'Fast + löpande'
  return p.budget ? 'Löpande räkning med budget' : 'Löpande räkning'
}
export function offerCompensationText(p: ContractPricing): string {
  const basis = p.mode === 'mixed'
    ? 'Offerten kombinerar fast pris och löpande räkning. Fast pris gäller endast de arbeten och leveranser som anges under Fasta priser. Övriga angivna arbeten och inköp ersätts enligt prisgrunderna för löpande räkning.'
    : p.mode === 'fixed' ? 'Fast pris gäller för den omfattning och de leveranser som anges i offerten.'
      : 'Arbeten och inköp ersätts på löpande räkning enligt angivna timpriser och påslag.'
  return p.budget
    ? `${basis} Budgetbeloppen redovisas separat som underlag för planering, kostnadsuppföljning och samråd. Fast pris och budget ska inte läsas som ett fast totalpris för hela uppdraget.`
    : basis
}
export function offerBudgetBreakdown(p: ContractPricing) {
  if (!p.budget) return null
  const running = p.rows.filter(row => p.mode === 'running' || row.kind === 'running')
  const amounts = running.map(row => p.budget!.rows.find(entry => entry.id === row.id)?.amountOre ?? null)
  const unbudgetedTitles = running.filter((_, index) => amounts[index] === null).map(row => row.title)
  const runningOre = amounts.some(amount => amount !== null) ? amounts.reduce<number>((sum, amount) => sum + (amount ?? 0), 0) : null
  return { runningOre, unbudgetedTitles }
}
export function contractPricingIssues(p: ContractPricing): string[] {
  const issues: string[] = []
  if (p.rows.some((row) => !row.title.trim())) issues.push('Ange momentets namn för alla prisrader.')
  if (p.mode !== 'running' && contractFixedAmount(p) === null) issues.push('Komplettera det fasta priset inklusive moms.')
  if (p.mode === 'mixed' && (!p.rows.some((row) => row.kind === 'fixed') || !p.rows.some((row) => row.kind === 'running')))
    issues.push('Ange vilka moment som har fast pris och vilka som utförs på löpande räkning.')
  if (p.mode !== 'fixed') {
    if (p.running.hourlyOre === null || p.running.hourlyOre <= 0) issues.push('Ange timpris inklusive entreprenörarvode och moms.')
    if (p.running.managementOre !== null && p.running.managementOre <= 0) issues.push('Ange arbetsledningens timpris eller välj samma timpris.')
    if (p.running.markupPercent === null) issues.push('Ange entreprenörarvode på självkostnader, även om det är 0 %.')
    if (p.running.approximateOre !== null && p.running.approximateOre <= 0) issues.push('Ange ett ungefärligt pris större än noll eller lämna fältet tomt.')
  }
  if (p.basis === 'total' && p.display === 'priced' && p.mode !== 'running') issues.push('För att redovisa delpriser behöver summan beräknas från prisraderna.')
  if (p.budget) {
    if (contractBudgetAmount(p) === null) issues.push('Ange planeringsbudget inklusive moms för varje moment på löpande räkning.')
    if (!p.budget.assumptions.trim()) issues.push('Beskriv budgetens förutsättningar och osäkerheter.')
    if (!p.budget.reviewTerms.trim()) issues.push('Ange hur budgeten ska följas upp och när samråd ska ske.')
  }
  return issues
}
export function importContractPrices(p: ContractPricing, sources: { id: string; title: string; amountOre: number | null }[], selected: string[], newId = () => crypto.randomUUID()): ContractPricing {
  if (new Set(selected).size !== selected.length) invalid()
  const rows = p.rows.map((row) => ({ ...row }))
  const budget = p.budget ? { ...p.budget, rows: p.budget.rows.map(row => ({ ...row })) } : p.budget
  for (const id of selected) {
    const source = sources.find((row) => row.id === id)
    if (!source || source.amountOre === null) invalid()
    let target = rows.find((row) => row.sourceItemId === id || row.id === id)
    if (!target) {
      const matching = rows.filter((row) => !row.sourceItemId && row.title.trim().toLocaleLowerCase('sv-SE') === source.title.trim().toLocaleLowerCase('sv-SE'))
      const uniqueSource = sources.filter((row) => row.title.trim().toLocaleLowerCase('sv-SE') === source.title.trim().toLocaleLowerCase('sv-SE')).length === 1
      if (matching.length && (matching.length !== 1 || !uniqueSource)) throw new Error('CUSTOMER_CONTRACT_PRICE_AMBIGUOUS')
      if (matching.length === 1) target = matching[0]
    }
    if (!target) {
      target = { id: newId(), sourceItemId: id, title: source.title, kind: p.mode === 'running' || budget ? 'running' : 'fixed', amountOre: null, labourOre: null, materialOre: null }
      rows.push(target)
    }
    target.sourceItemId = id
    if (budget && (p.mode === 'running' || target.kind === 'running')) {
      budget.rows = [...budget.rows.filter(row => row.id !== target.id), { id: target.id, amountOre: source.amountOre }]
    } else { target.amountOre = source.amountOre; target.labourOre = null; target.materialOre = null }
  }
  // Project prices are combined customer amounts; never guess a labour/material split.
  return normalizeContractPricing({ ...p, rows, ...(budget === undefined ? {} : { budget }), basis: 'rows', split: 'combined' })
}
