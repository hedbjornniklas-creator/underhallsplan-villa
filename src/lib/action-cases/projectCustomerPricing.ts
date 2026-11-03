export type CustomerCharge = {
  mode: 'fixed' | 'running' | 'budget'
  fixedOre: number | null
  budgetOre: number | null
  hourlyOre: number | null
  markupPercent: number | null
}
export type ProjectCustomerPricing = {
  version: 1
  split: 'combined' | 'separate'
  combined: CustomerCharge
  labour: CustomerCharge
  material: CustomerCharge
  assumptions: string
  reviewTerms: string
}
export type ProjectPricingReference = { revision: number; terms: ProjectCustomerPricing }
export type ProjectPricingState = {
  revision: number
  terms: ProjectCustomerPricing | null
  candidates: { source: 'offer' | 'contract'; terms: ProjectCustomerPricing }[]
  documentRevisions: { offer: number | null; contract: number | null }
}
export const customerChargeLabels = { fixed: 'Fast pris', running: 'Löpande räkning', budget: 'Löpande med planeringsbudget' }
export function emptyCustomerCharge(): CustomerCharge {
  return { mode: 'fixed', fixedOre: null, budgetOre: null, hourlyOre: null, markupPercent: null }
}
export function emptyProjectCustomerPricing(): ProjectCustomerPricing {
  return { version: 1, split: 'combined', combined: emptyCustomerCharge(), labour: emptyCustomerCharge(), material: emptyCustomerCharge(), assumptions: '', reviewTerms: '' }
}
function invalid(): never { throw new Error('CUSTOMER_OFFER_INVALID') }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid()
  return value as Record<string, unknown>
}
function money(value: unknown): number | null {
  if (value === null) return null
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > 100_000_000_000) invalid()
  return Number(value)
}
export function normalizeProjectCustomerPricing(value: unknown): ProjectCustomerPricing {
  const input = object(value)
  if (input.version !== 1 || !['combined', 'separate'].includes(String(input.split))) invalid()
  const charge = (value: unknown): CustomerCharge => {
    const part = object(value), percent = part.markupPercent
    if (!['fixed', 'running', 'budget'].includes(String(part.mode)) ||
      (percent !== null && (typeof percent !== 'number' || !Number.isFinite(percent) || percent < 0 || percent > 1000 || Math.abs(percent * 100 - Math.round(percent * 100)) > 0.00001))) invalid()
    return { mode: part.mode as CustomerCharge['mode'], fixedOre: money(part.fixedOre), budgetOre: money(part.budgetOre), hourlyOre: money(part.hourlyOre), markupPercent: percent as number | null }
  }
  const text = (key: string) => {
    if (typeof input[key] !== 'string' || input[key].length > 6000) invalid()
    return (input[key] as string).trim()
  }
  const result: ProjectCustomerPricing = { version: 1, split: input.split as ProjectCustomerPricing['split'],
    combined: charge(input.combined), labour: charge(input.labour), material: charge(input.material), assumptions: text('assumptions'), reviewTerms: text('reviewTerms') }
  for (const key of ['fixedOre', 'budgetOre'] as const) {
    if (customerPricingParts(result).reduce((sum, part) => sum + (part.charge[key] ?? 0), 0) > 100_000_000_000) invalid()
  }
  return result
}
export function normalizeProjectPricingReference(value: unknown): ProjectPricingReference {
  const input = object(value)
  if (!Number.isSafeInteger(input.revision) || Number(input.revision) < 1) invalid()
  return { revision: Number(input.revision), terms: normalizeProjectCustomerPricing(input.terms) }
}
export function customerPricingParts(terms: ProjectCustomerPricing) {
  return terms.split === 'combined' ? [{ key: 'combined', label: '', charge: terms.combined }] : [
    { key: 'labour', label: 'Arbete', charge: terms.labour }, { key: 'material', label: 'Material', charge: terms.material },
  ]
}
export function projectPricingIssues(terms: ProjectCustomerPricing): string[] {
  const issues: string[] = []
  for (const { key, label, charge } of customerPricingParts(terms)) {
    const prefix = label ? `${label}: ` : ''
    if (charge.mode === 'fixed' && charge.fixedOre === null) issues.push(`${prefix}ange fast pris inklusive moms.`)
    if (charge.mode !== 'fixed') {
      if (key !== 'material' && (charge.hourlyOre === null || charge.hourlyOre <= 0)) issues.push(`${prefix}ange timpris inklusive moms.`)
      if (key !== 'labour' && charge.markupPercent === null) issues.push(`${prefix}ange påslag på självkostnad, även om det är 0 %.`)
      if (charge.mode === 'budget' && charge.budgetOre === null) issues.push(`${prefix}ange planeringsbudget inklusive moms.`)
    }
  }
  if (customerPricingParts(terms).some(part => part.charge.mode === 'budget')) {
    if (!terms.assumptions.trim()) issues.push('Beskriv budgetens förutsättningar.')
    if (!terms.reviewTerms.trim()) issues.push('Ange när samråd om budgeten ska ske.')
  }
  return issues
}

// Inactive entries are editing memory, never customer-visible price promises.
export function publicProjectPricing(reference: ProjectPricingReference, showFixedAmounts: boolean): ProjectPricingReference {
  const terms = reference.terms, blank = emptyCustomerCharge()
  const visible = (charge: CustomerCharge): CustomerCharge => ({ ...charge,
    fixedOre: showFixedAmounts && charge.mode === 'fixed' ? charge.fixedOre : null,
    budgetOre: charge.mode === 'budget' ? charge.budgetOre : null,
    hourlyOre: charge.mode !== 'fixed' ? charge.hourlyOre : null,
    markupPercent: charge.mode !== 'fixed' ? charge.markupPercent : null })
  const budget = customerPricingParts(terms).some(part => part.charge.mode === 'budget')
  return { revision: reference.revision, terms: { ...terms,
    combined: terms.split === 'combined' ? visible(terms.combined) : blank,
    labour: terms.split === 'separate' ? visible(terms.labour) : blank,
    material: terms.split === 'separate' ? visible(terms.material) : blank,
    assumptions: budget ? terms.assumptions : '', reviewTerms: budget ? terms.reviewTerms : '' } }
}
