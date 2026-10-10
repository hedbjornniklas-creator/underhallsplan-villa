import type { CustomerOfferDraft } from './customerOffers'

export type ContractPriceRow = {
  id: string; title: string; sourceItemId?: string; kind: 'fixed' | 'running'
  amountOre: number | null; labourOre: number | null; materialOre: number | null
}
export type ContractPricing = {
  version: 1
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
  return issues
}
export function importContractPrices(p: ContractPricing, sources: { id: string; title: string; amountOre: number | null }[], selected: string[], newId = () => crypto.randomUUID()): ContractPricing {
  if (new Set(selected).size !== selected.length) invalid()
  const rows = p.rows.map((row) => ({ ...row }))
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
    if (target) { target.sourceItemId = id; target.amountOre = source.amountOre; target.labourOre = null; target.materialOre = null }
    else rows.push({ id: newId(), sourceItemId: id, title: source.title, kind: p.mode === 'running' ? 'running' : 'fixed', amountOre: source.amountOre, labourOre: null, materialOre: null })
  }
  // Project prices are combined customer amounts; never guess a labour/material split.
  return normalizeContractPricing({ ...p, rows, basis: 'rows', split: 'combined' })
}
