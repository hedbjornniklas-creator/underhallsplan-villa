import { createHash } from 'node:crypto'
// @ts-expect-error Node strip-types tests.
import { normalizeContractPricing, contractFixedAmount, contractRowAmount } from './contractPricing.ts'
// @ts-expect-error Node strip-types tests.
import { normalizeProjectCustomerPricing, customerPricingParts } from './projectCustomerPricing.ts'
// @ts-expect-error Node strip-types tests.
import { normalizePaymentPlan } from './customerPaymentPlan.ts'
// @ts-expect-error Node strip-types tests.
import { normalizeChoiceOffer } from './choiceOffer.ts'
import type { BillingCandidate, BillingContext, BillingSupplierSource } from './billingFlow'

type Json = Record<string, unknown>
const obj = (v: unknown): Json => v && typeof v === 'object' && !Array.isArray(v) ? v as Json : {}
const list = (v: unknown): Json[] => Array.isArray(v) ? v.map(obj) : []
const str = (v: unknown) => typeof v === 'string' ? v : ''
const lines = (v: unknown[]) => v.filter(x => typeof x === 'string' && x.trim()).join('\n')
const nullableMoney = (v: unknown): number | null => Number.isSafeInteger(v) && Number(v) >= 0 ? Number(v) : null

export function billingSourceContext(raw: Json, userId: string): BillingContext {
  const candidates: BillingCandidate[] = [], frozen = obj(raw.frozen)
  const document = Object.keys(frozen).length ? obj(frozen.snapshot) : obj(raw.draft)
  const reference = Object.keys(frozen).length ? `${frozen.kind === 'contract' ? 'Avtal' : 'Accepterad offert'} version ${frozen.version}` : 'Dokumenterad överenskommelse krävs'
  let baseFixedGrossOre: number | null = null
  const add = (v: Omit<BillingCandidate, 'fingerprint'>, source: unknown) => candidates.push({ ...v, fingerprint: createHash('sha256').update(JSON.stringify({ source, ...v })).digest('hex') })
  const parts = (key: string, title: string, group: 'base' | 'change', terms: unknown, source: unknown, suppressFixed = false) => {
    const p = normalizeProjectCustomerPricing(terms)
    for (const { key: part, label, charge } of customerPricingParts(p)) {
      if (suppressFixed && charge.mode === 'fixed') continue
      add({ key: `${key}:${part}`, title: title + (label ? ` / ${label}` : ''), group, mode: charge.mode, fixedGrossOre: charge.fixedOre, hourlyGrossOre: charge.hourlyOre,
        budgetGrossOre: charge.budgetOre, markupPercent: charge.markupPercent, conditions: p.reviewTerms, reference }, source)
    }
  }
  const pricing = document.contractPricing ? normalizeContractPricing(document.contractPricing) : null
  if (pricing) baseFixedGrossOre = contractFixedAmount(pricing)
  else baseFixedGrossOre = nullableMoney(document.baseAmountOre)
  const plan = document.paymentPlan ? normalizePaymentPlan(document.paymentPlan) : null
  const usePlan = Boolean(plan?.installments.length && baseFixedGrossOre !== null && plan.installments.every(p => p.amountOre !== null) &&
    plan.installments.reduce((s, p) => s + p.amountOre!, 0) === baseFixedGrossOre)
  if (usePlan) for (const row of plan!.installments) {
    add({ key: `base:payment:${row.id}`, title: row.title, group: 'base', mode: 'fixed', fixedGrossOre: row.amountOre, hourlyGrossOre: null, markupPercent: null, budgetGrossOre: null, reference, conditions: row.condition }, { frozen, row })
  }
  if (pricing) {
    if (pricing.basis === 'total' && baseFixedGrossOre !== null && !usePlan) add({ key: 'base:total', title: 'Grundavtalets fasta del', group: 'base', mode: 'fixed', fixedGrossOre: baseFixedGrossOre, hourlyGrossOre: null, markupPercent: null, budgetGrossOre: null, reference, conditions: str(document.paymentTerms) }, frozen)
    for (const row of pricing.rows) {
      if (row.projectPricing) parts(`base:${row.sourceItemId ?? row.id}`, row.title, 'base', row.projectPricing.terms, { frozen, reference: row.projectPricing }, usePlan || pricing.basis === 'total')
      else {
        const fixed = pricing.mode === 'fixed' || pricing.mode === 'mixed' && row.kind === 'fixed'
        if (fixed && (usePlan || pricing.basis === 'total')) continue
        add({ key: `base:${row.sourceItemId ?? row.id}:combined`, title: row.title, group: 'base', mode: fixed ? 'fixed' : pricing.budget ? 'budget' : 'running',
          fixedGrossOre: fixed ? contractRowAmount(pricing, row) : null, hourlyGrossOre: fixed ? null : pricing.running.hourlyOre, markupPercent: fixed ? null : pricing.running.markupPercent,
          budgetGrossOre: pricing.budget?.rows.find(b => b.id === row.id)?.amountOre ?? null, reference, conditions: pricing.budget?.reviewTerms ?? str(document.paymentTerms) }, { frozen, row, running: pricing.running, budget: pricing.budget })
      }
    }
    if (pricing.mode !== 'fixed' && !candidates.some(c => c.group === 'base' && c.mode !== 'fixed')) {
      add({ key: 'base:running', title: 'Grundavtalets löpande del', group: 'base', mode: 'running', fixedGrossOre: null, hourlyGrossOre: pricing.running.hourlyOre,
        markupPercent: pricing.running.markupPercent, budgetGrossOre: null, reference, conditions: str(document.paymentTerms) }, { frozen, running: pricing.running })
    }
  } else if (!Object.keys(frozen).length) {
    for (const price of list(raw.prices)) {
      const item = list(raw.items).find(i => i.id === price.id)
      parts(`base:${price.id}`, str(item?.title) || 'Moment', 'base', price.terms, price)
    }
  } else if (baseFixedGrossOre !== null && !usePlan) add({ key: 'base:total', title: 'Grundavtal', group: 'base', mode: 'fixed', fixedGrossOre: baseFixedGrossOre,
    hourlyGrossOre: null, markupPercent: null, budgetGrossOre: null, reference, conditions: str(document.paymentTerms) }, frozen)
  for (const item of list(raw.choices)) {
    const o = obj(item.offer)
    if (o.kind !== 'change') continue
    const offer = normalizeChoiceOffer(o), p = offer.pricing, key = `change:${item.id}`
    if (p.mode !== 'running') add({ key: `${key}:fixed`, title: str(item.title) + (p.mode === 'mixed' ? ' / fast del' : ''), group: 'change', mode: 'fixed', fixedGrossOre: offer.priceNeutral ? 0 : contractFixedAmount(p),
      hourlyGrossOre: null, markupPercent: null, budgetGrossOre: null, reference: `ÄTA: ${str(item.title)}`, conditions: offer.conditions }, { item })
    if (p.mode !== 'fixed') add({ key: `${key}:running`, title: str(item.title) + (p.mode === 'mixed' ? ' / löpande del' : ''), group: 'change', mode: p.budget ? 'budget' : 'running', fixedGrossOre: null,
      hourlyGrossOre: p.running.hourlyOre, markupPercent: p.running.markupPercent, budgetGrossOre: p.budget?.rows.length && p.budget.rows.every(r => r.amountOre !== null) ? p.budget.rows.reduce((s, r) => s + r.amountOre!, 0) : null,
      reference: `ÄTA: ${str(item.title)}`, conditions: p.budget?.reviewTerms || offer.conditions }, { item })
  }
  const suppliers: BillingSupplierSource[] = []
  for (const invoice of list(raw.invoices)) {
    const b = obj(invoice.body), legacy = Array.isArray(invoice.legacyAllocations) ? invoice.legacyAllocations : []
    for (const a of list(b.allocations)) {
      if (a.caseId !== raw.caseId || typeof a.id !== 'string' || b.approvalStatus === 'void') continue
      suppliers.push({ key: `${invoice.id}:${a.id}`, invoiceId: str(invoice.id), allocationId: a.id, revision: Number(invoice.revision), targetKey: a.changeId ? `change:${a.changeId}` : a.itemId ? `base:${a.itemId}` : 'base:common',
        title: `${str(b.supplierName)} / ${str(b.invoiceNumber)}${a.description ? ` / ${a.description}` : ''}`, date: str(b.invoiceDate), netOre: Number(a.amountOre) * (b.documentKind === 'credit' ? -1 : 1),
        reviewed: b.approvalStatus === 'approved', original: invoice.hasOriginal === true, legacy: legacy.includes(a.id),
        fingerprint: createHash('sha256').update(JSON.stringify({ header: Object.fromEntries(Object.entries(b).filter(([k]) => !['notes', 'sourceText', 'allocations', 'paymentStatus', 'paidOn'].includes(k))), allocation: a, original: invoice.hasOriginal === true })).digest('hex') })
    }
  }
  const sender = obj(Object.keys(frozen).length ? document.senderProfile : document.senderProfile ?? raw.sender), c = obj(raw.customer)
  const issuer = lines([sender.legalName || sender.name, sender.organizationNumber, sender.address, [sender.postalCode, sender.city].filter(Boolean).join(' ')]) || str(document.issuerName)
  const recipient = Object.keys(c).length ? c.invoiceSame === false
    ? lines([c.invoiceName || c.name, c.invoiceAddress, [c.invoicePostalCode, c.invoiceCity].filter(Boolean).join(' ')])
    : lines([c.name, c.address, [c.postalCode, c.city].filter(Boolean).join(' ')]) : str(raw.customerName)
  return { candidates, suppliers, canManage: raw.manager === userId, cancelled: raw.status === 'cancelled', legacyCount: list(raw.legacy).length,
    openQuestions: Number(raw.openQuestions), baseFixedGrossOre, issuer, recipient, projectTitle: str(raw.title) }
}
