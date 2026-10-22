// @ts-expect-error Explicit extensions support the shared Node test runner.
import { contractFixedAmount, contractPricingIssues, normalizeContractPricing, type ContractPricing } from './contractPricing.ts'
import type { CustomerPlannedItem } from './customerPlanning'
import type { CustomerChoiceCostRow, CustomerChoiceCosting } from './customerChoiceCosting'
// @ts-expect-error Explicit extensions support the shared Node test runner.
import { choiceCalculatedPrice, choiceRowPrice, choiceRows, isChoiceCalculation } from './customerChoiceCosting.ts'

export type ChoiceOffer = {
  version: 1
  kind: 'selection' | 'option' | 'change'
  conditions: string
  exclusions: string
  priceNeutral: boolean
  priceSource: 'calculation' | 'manual'
  pricing: ContractPricing
  time: { status: 'unassessed' | 'none' | 'extension'; workingDays: number | null; explanation: string }
}

export function choiceOfferForEditing(item: Pick<CustomerPlannedItem, 'offer' | 'budgetOre'> & { id?: string }, costing?: CustomerChoiceCosting[string]): ChoiceOffer {
  if (item.offer) return item.offer
  let calculated = costing && isChoiceCalculation(costing) ? costing.priceMode === 'calculated' : false
  if (costing && !isChoiceCalculation(costing) && item.id) {
    try { calculated = choiceCalculatedPrice(choiceRows(costing, item.id))?.grossOre === item.budgetOre } catch { /* Preserve the saved manual amount. */ }
  }
  return { version: 1, kind: 'option', conditions: '', exclusions: '', priceNeutral: false, priceSource: calculated ? 'calculation' : 'manual',
    pricing: { version: 1, mode: 'fixed', display: 'total', split: 'combined', basis: 'total', rows: [], totalOre: item.budgetOre, labourOre: null, materialOre: null,
      running: { hourlyOre: null, managementOre: null, markupPercent: null, approximateOre: null } },
    time: { status: 'unassessed', workingDays: null, explanation: '' } }
}

export function normalizeChoiceOffer(input: unknown): ChoiceOffer {
  const fail = (): never => { throw new Error('CUSTOMER_CHOICE_OFFER_INVALID') }
  if (!input || typeof input !== 'object' || Array.isArray(input)) return fail()
  const v = input as Record<string, unknown>, time = v.time as Record<string, unknown> | null
  if (v.version !== 1 || !['selection', 'option', 'change'].includes(String(v.kind)) || typeof v.priceNeutral !== 'boolean' || !['calculation', 'manual'].includes(String(v.priceSource)) ||
    !time || typeof time !== 'object' || Array.isArray(time) || !['unassessed', 'none', 'extension'].includes(String(time.status)) ||
    (time.workingDays !== null && (!Number.isSafeInteger(time.workingDays) || Number(time.workingDays) < 0 || Number(time.workingDays) > 3650))) return fail()
  const text = (value: unknown, max: number) => typeof value === 'string' && value.length <= max ? value.trim() : fail()
  return { version: 1, kind: v.kind as ChoiceOffer['kind'], conditions: text(v.conditions, 6000), exclusions: text(v.exclusions, 6000),
    priceNeutral: v.priceNeutral, priceSource: v.priceSource as ChoiceOffer['priceSource'], pricing: normalizeContractPricing(v.pricing),
    time: { status: time.status as ChoiceOffer['time']['status'], workingDays: time.workingDays as number | null, explanation: text(time.explanation, 3000) } }
}

export function choiceOfferIssues(offer: ChoiceOffer): string[] {
  const errors = offer.priceNeutral ? [] : contractPricingIssues(offer.pricing)
  if (offer.time.status === 'extension' && (!offer.time.workingDays || !offer.time.explanation.trim())) errors.push('Ange tidsförlängning i arbetsdagar och förklaring.')
  return errors
}

export function choiceOfferBudget(offer: ChoiceOffer): number | null {
  return offer.priceNeutral ? 0 : offer.pricing.mode === 'fixed' ? contractFixedAmount(offer.pricing) : null
}

export function choiceTimeText(time: ChoiceOffer['time']) {
  return time.status === 'none' ? 'Ingen påverkan på projektets färdigställande.' : time.status === 'extension'
    ? `${time.workingDays === null ? 'Tidsförlängningens längd är inte fastställd.' : `Bedömd förlängning: ${time.workingDays} arbetsdagar.`}${time.explanation ? `\n${time.explanation}` : ''}`
    : `Tidspåverkan är inte bedömd.${time.explanation ? `\n${time.explanation}` : ''}`
}

export function calculatedChoicePricing(offer: ChoiceOffer, rows: CustomerChoiceCostRow[]): ContractPricing {
  const p = offer.pricing
  const sums = { fixed: 0, running: 0 }, gross = { fixed: 0, running: 0 }
  return { ...p, basis: 'rows', split: 'combined', totalOre: null, labourOre: null, materialOre: null,
    rows: rows.map(row => ({ id: row.id, title: row.title, kind: row.chargeType ?? 'fixed', amountOre: (() => {
      const net = choiceRowPrice(row)
      if (net === null || !row.title.trim()) return null
      // Allocate VAT rounding so displayed rows equal the calculated total, also for mixed pricing.
      const bucket = p.mode === 'mixed' && row.chargeType === 'running' ? 'running' : 'fixed'
      sums[bucket] += net
      const next = Math.round(sums[bucket] * 1.25), amount = next - gross[bucket]
      gross[bucket] = next
      return amount
    })(), labourOre: null, materialOre: null })) }
}

export function choicePriceLabel(item: Pick<CustomerPlannedItem, 'offer' | 'budgetOre'>, format: (amount: number) => string): string {
  if (item.offer?.priceNeutral) return 'Ingår utan prisändring'
  const p = item.offer?.pricing
  if (p?.mode === 'running') return 'Löpande räkning'
  if (p?.mode === 'mixed') {
    const amount = contractFixedAmount(p)
    return amount === null ? 'Fast + löpande · fast pris ej fastställt' : `${format(amount)} + löpande`
  }
  return item.budgetOre === null ? 'Pris ej fastställt' : format(item.budgetOre)
}

export function synchronizeChoiceOffers<T extends CustomerPlannedItem>(items: readonly T[], costing: CustomerChoiceCosting): T[] {
  return items.map(item => {
    if (!item.offer) return item
    const offer = item.offer.priceSource === 'calculation' && !item.offer.priceNeutral
      ? { ...item.offer, pricing: calculatedChoicePricing(item.offer, choiceRows(costing[item.id], item.id)) } : item.offer
    return { ...item, offer, budgetOre: choiceOfferBudget(offer) }
  })
}
