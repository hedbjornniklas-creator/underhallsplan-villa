import type { ActionCaseItemView } from './contracts'
import type { CustomerOfferDraft } from './customerOffers'
// @ts-expect-error Node strip-types tests require the explicit extension.
import { contractDisplayPricing, contractFixedAmount, contractPricingForEditing, contractRowAmount, importContractPrices, normalizeContractPricing } from './contractPricing.ts'
// @ts-expect-error Node strip-types tests require the explicit extension.
import { normalizeProjectCustomerPricing, type ProjectCustomerPricing } from './projectCustomerPricing.ts'

export type BillingPart = 'combined' | 'labour' | 'material'
const money = (n: number) => Number.isSafeInteger(Math.round(n)) && n >= 0 ? Math.round(n) : null
export function exclusiveAmount(inclusiveOre: number | null, vatRate = 25) {
  return inclusiveOre === null ? null : money(inclusiveOre / (1 + vatRate / 100))
}
export function inclusiveAmount(exclusiveOre: number | null, vatRate = 25) {
  return exclusiveOre === null ? null : money(exclusiveOre * (1 + vatRate / 100))
}

// A proposal only. Reading or recalculating an internal estimate never writes customer terms.
export function billingCalculation(item: Pick<ActionCaseItemView, 'costLines' | 'lumpSum'>, part: BillingPart = 'combined') {
  if (item.lumpSum) {
    const p = item.lumpSum, netOre = p.customerPrice === null ? null : money(p.customerPrice * 100)
    return { netOre, grossOre: netOre === null ? null : inclusiveAmount(netOre, p.vatRate), vatRate: p.vatRate,
      available: part === 'combined' && netOre !== null, reason: part !== 'combined' ? 'En klumpsumma har ingen känd fördelning mellan arbete och material.' : netOre === null ? 'Kalkylens kundpris saknas.' : '' }
  }
  const active = item.costLines.filter(line => !line.coveredByQuoteId)
  const rows = active.filter(line => part === 'combined' || (part === 'material' ? line.category === 'material' : ['own_labor', 'subcontractor'].includes(line.category)))
  const unknown = !rows.length || rows.some(line => line.quantity === null || line.unitCost === null || !Number.isFinite(line.markupPercent) || !Number.isFinite(line.vatRate))
  const rates = [...new Set(rows.map(line => line.vatRate))], vatRate = rates.length === 1 && Number.isFinite(rates[0]) ? rates[0] : 25
  const netOre = unknown ? null : money(rows.reduce((sum, line) => sum + line.quantity! * line.unitCost! * (1 + line.markupPercent / 100) * 100, 0))
  const grossOre = unknown ? null : money(rows.reduce((sum, line) => sum + line.quantity! * line.unitCost! * (1 + line.markupPercent / 100) * (1 + line.vatRate / 100) * 100, 0))
  const other = part !== 'combined' && active.some(line => !['own_labor', 'subcontractor', 'material'].includes(line.category))
  const quoteAllocation = part !== 'combined' && item.costLines.some(line => line.coveredByQuoteId)
  const reason = unknown ? 'Mängd eller pris saknas i kalkylunderlaget.' : rates.length > 1 ? 'Kalkylen har blandade momssatser. Ange kundbeloppet manuellt.'
    : other || quoteAllocation ? 'Kalkylen innehåller kostnader utan säker fördelning mellan arbete och material. Ange delbeloppen manuellt.' : ''
  return { netOre, grossOre, vatRate, available: !reason && grossOre !== null, reason }
}

export function applyBillingCalculation(terms: ProjectCustomerPricing, item: Pick<ActionCaseItemView, 'costLines' | 'lumpSum'>, part: BillingPart) {
  const amount = billingCalculation(item, part)
  if (!amount.available || terms[part].mode === 'running') throw new Error('PROJECT_PRICE_CALCULATION_UNAVAILABLE')
  return normalizeProjectCustomerPricing({ ...terms, [part]: { ...terms[part], [terms[part].mode === 'fixed' ? 'fixedOre' : 'budgetOre']: amount.grossOre } })
}

export function offerBillingSummary(draft: CustomerOfferDraft) {
  const p = draft.contractPricing
  if (!p) return draft.pricingMode !== 'itemized' && draft.baseAmountOre !== null
    ? [{ id: 'total', title: 'Fast klumpsumma', mode: 'fixed' as const, amountOre: draft.baseAmountOre, sourceItemId: undefined, shared: false }]
    : draft.items.filter(item => item.kind === 'included').map(item => ({ id: item.id, title: item.title, mode: item.amountOre === null ? 'missing' as const : 'fixed' as const, amountOre: item.amountOre, sourceItemId: item.sourceItemId, shared: false }))
  if (p.basis === 'total' && p.mode === 'fixed') return [{ id: 'total', title: 'Fast klumpsumma', mode: 'fixed' as const, amountOre: contractFixedAmount(p), sourceItemId: undefined, shared: false }]
  const view = contractDisplayPricing(p)
  const result = view.rows.filter(row => p.basis !== 'total' || p.mode === 'running' || row.kind === 'running').map(row => {
    const stored = p.rows.find(source => row.id === source.id || row.id.startsWith(`${source.id}:`))
    const running = p.mode === 'running' || row.kind === 'running'
    const budget = view.budget?.rows.find(entry => entry.id === row.id)
    return { id: row.id, title: row.title, mode: running ? budget ? 'budget' as const : 'running' as const : 'fixed' as const,
      amountOre: running ? budget?.amountOre ?? null : row.amountOre, sourceItemId: stored?.sourceItemId,
      shared: Boolean(stored?.projectPricing) }
  })
  if (p.basis === 'total' && p.mode === 'mixed') result.unshift({ id: 'total', title: 'Fast klumpsumma', mode: 'fixed', amountOre: contractFixedAmount(p), sourceItemId: undefined, shared: false })
  return result
}

// Explicit transition only: never allocate an old manual total across moments.
export function offerMomentPricing(draft: CustomerOfferDraft, sources: ActionCaseItemView[]): Partial<CustomerOfferDraft> {
  const old = contractPricingForEditing(draft)
  let next = normalizeContractPricing({ ...old, basis: 'rows', split: 'combined', totalOre: null, labourOre: null, materialOre: null,
    running: { ...old.running, approximateOre: null },
    rows: old.rows.map(row => row.projectPricing ? row : { ...row, kind: old.mode === 'running' ? 'running' : row.kind,
      amountOre: contractRowAmount(old, row), labourOre: null, materialOre: null }) })
  const configured = sources.filter(source => source.contractWork?.customerPricing?.terms && old.rows.some(row => (row.sourceItemId ?? row.id) === source.id))
  if (configured.length) next = importContractPrices(next, configured.map(source => ({ id: source.id, title: source.title, amountOre: null,
    projectPricing: { revision: source.contractWork!.customerPricing!.revision, terms: source.contractWork!.customerPricing!.terms! } })), configured.map(source => source.id))
  return { contractPricing: next, pricingMode: 'total', ...(draft.offerHourEstimate ? { offerHourEstimate: null } : {}) }
}
