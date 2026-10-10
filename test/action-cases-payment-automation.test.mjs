import assert from 'node:assert/strict'
import { test } from 'node:test'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { emptyCustomerOffer, normalizeCustomerOffer, customerOfferBaseAmount, offerPublishIssues } from '../src/lib/action-cases/customerOffers.ts'
import { abs18PaymentText, normalizePaymentPlan, normalizePaymentConditions, paymentConditionsText, configurePaymentPlan,
  distributePaymentPlan, syncPaymentPlan, paymentPercentAmount, paymentPlanTotal, paymentPlanIssues } from '../src/lib/action-cases/customerPaymentPlan.ts'

const row = (amountOre, title = 'Grund') => ({ id: randomUUID(), title, condition: 'Efter utfört arbete.', plannedDate: '2026-11-30', amountOre })
const old = () => ({ version: 1, installments: [row(33389900), row(35264500, 'Stomme')] })
test('legacy plans and signed snapshots remain unmodified until an explicit setup', () => {
  const p = old(), before = structuredClone(p)
  assert.deepEqual(normalizePaymentPlan(p), p)
  assert.equal(syncPaymentPlan(p, 200000000), p)
  const next = configurePaymentPlan(p, 200000000)
  assert.deepEqual(p, before)
  assert.equal(next.installments.at(-1).kind, 'final')
  assert.equal(next.installments.at(-1).amountOre, 20000000)
  assert.equal(paymentPlanTotal(next), 200000000)
  assert.equal(next.installments[0].condition, p.installments[0].condition)
  assert.equal(next.installments[0].plannedDate, p.installments[0].plannedDate)
})
test('first and final percentages are anchored and leave the middle rows exactly the remainder', () => {
  const p = configurePaymentPlan(old(), 203034201, true, 20)
  assert.equal(p.installments[0].kind, 'initial')
  assert.equal(p.installments[0].amountOre, 40606840)
  assert.equal(p.installments.at(-1).amountOre, 20303420)
  assert.equal(paymentPlanTotal(p), 203034201)
  assert.match(p.installments[0].condition, /utfört/)
  assert.doesNotMatch(p.installments[0].condition, /beställning|förskott/)
  assert.match(p.installments.at(-1).condition, /godkänd slutbesiktning/)
  assert.deepEqual(paymentPlanIssues(p, 203034201, 'fixed'), [])
  const off = configurePaymentPlan(p, 203034201, false, 20)
  assert.equal(off.installments.some((r) => r.kind === 'initial'), false)
  assert.equal(paymentPlanTotal(off), 203034201)
})
test('changed contract price recalculates percentages, never silently rewrites manual milestone amounts', () => {
  const p = configurePaymentPlan(old(), 100000000, true, 10), oldMiddle = p.installments.filter((r) => !r.kind)
  const next = syncPaymentPlan(p, 110000000)
  assert.equal(next.installments.at(-1).amountOre, 11000000)
  assert.equal(next.installments[0].amountOre, 11000000)
  assert.deepEqual(next.installments.filter((r) => !r.kind), oldMiddle)
  assert(paymentPlanIssues(next, 110000000).some((v) => v.includes('ändrade pris')))
  const reconciled = distributePaymentPlan(next, 110000000)
  assert.equal(paymentPlanTotal(reconciled), 110000000)
  assert.deepEqual(paymentPlanIssues(reconciled, 110000000), [])
  assert.equal(syncPaymentPlan(reconciled, 110000000), reconciled)
})
test('large and fractional allocations are exact, deterministic, positive and use ore rather than floats', () => {
  for (const total of [17, 101, 203034201, 99999999999, 100000000000]) {
    const p = { version: 1, installments: [row(1), row(null), row(2), row(5)] }
    const next = distributePaymentPlan(p, total)
    assert.equal(paymentPlanTotal(next), total)
    assert(next.installments.every((r) => Number.isSafeInteger(r.amountOre) && r.amountOre > 0))
    assert.deepEqual(distributePaymentPlan(p, total), next)
    const equal = distributePaymentPlan(p, total, true), amounts = equal.installments.map((r) => r.amountOre)
    assert.equal(paymentPlanTotal(equal), total)
    assert(Math.max(...amounts) - Math.min(...amounts) <= 1)
  }
  assert.equal(paymentPercentAmount(15, 10), 2)
  assert.equal(paymentPercentAmount(100000000000, 12.34), 12340000000)
  assert.throws(() => distributePaymentPlan({ version: 1, installments: [row(1), row(1)] }, 1), /INVALID/)
})
test('unknown prices remain unknown and automatic plans cannot disguise mixed or running prices', () => {
  const p = configurePaymentPlan(null, null, true, null)
  assert(p.installments.every((r) => r.amountOre === null))
  assert(paymentPlanIssues(p, null).some((v) => v.includes('pris')))
  const ready = configurePaymentPlan(old(), 100000000)
  assert(paymentPlanIssues(ready, 100000000, 'mixed').some((v) => v.includes('fast pris')))
  assert(paymentPlanIssues(ready, 100000000, 'running').some((v) => v.includes('fast pris')))
})
test('settings validate limits, row identity/order and percentage precision without losing legacy terms', () => {
  const p = configurePaymentPlan(old(), 100000000, true, 10)
  assert.deepEqual(normalizePaymentPlan(p), p)
  for (const patch of [{ initialPercent: -1 }, { initialPercent: 90.01 }, { initialPercent: 1.001 }, { allocationBaseOre: 1.5 }, { initialEnabled: 'true' }, { version: 2 }])
    assert.throws(() => normalizePaymentPlan({ ...p, automation: { ...p.automation, ...patch } }), /INVALID/)
  assert.throws(() => normalizePaymentPlan({ ...p, installments: [...p.installments].reverse() }), /INVALID/)
  assert.throws(() => normalizePaymentPlan({ ...p, automation: undefined }), /INVALID/)
  const terms = { version: 1, days: 15, standardText: abs18PaymentText }, d = { ...emptyCustomerOffer(), paymentConditions: terms, paymentTerms: 'Egen överenskommelse.' }
  const normalized = normalizeCustomerOffer(d)
  assert.equal(normalized.paymentTerms, d.paymentTerms)
  assert.deepEqual(normalized.paymentConditions, terms)
  assert.match(paymentConditionsText(terms, d.paymentTerms), /15 dagar.*[\s\S]*tio procent.*[\s\S]*Egen överenskommelse/)
  assert.equal(paymentConditionsText(undefined, 'Äldre villkor'), 'Äldre villkor')
  for (const days of [0, -1, 1.5, 366, '30', null]) assert.throws(() => normalizePaymentConditions({ ...terms, days }), /INVALID/)
  assert(!offerPublishIssues(d).includes('Ange betalningsvillkor.'))
})
test('payment plan uses the independent contract price, not work-part or offer display amounts', () => {
  const d = { ...emptyCustomerOffer(), baseAmountOre: 100000000, paymentConditions: { version: 1, days: 30, standardText: abs18PaymentText },
    items: [{ id: randomUUID(), title: 'Omfattning', scope: 'Text', kind: 'included', amountOre: 1 }] }
  assert.equal(customerOfferBaseAmount(d), 100000000)
  const p = configurePaymentPlan(null, customerOfferBaseAmount(d))
  assert.equal(paymentPlanTotal(p), 100000000)
})
test('UI exposes payment days, compact rows, explicit reconciliation, editable text and locked percentage amounts', () => {
  const ui = readFileSync(new URL('../src/components/tasks/CustomerPaymentPlan.tsx', import.meta.url), 'utf8')
  assert.match(ui, /Betalning inom \(dagar\)/)
  assert.match(ui, /Reservera slutbetalning 10 %/)
  assert.match(ui, /Anpassa till avtalets belopp/)
  assert.match(ui, /Övriga betalningsvillkor/)
  assert.match(ui, /output aria-label="Automatiskt belopp inkl. moms"/)
  assert.match(ui, /disabled=\{Boolean\(row.kind\)\}/)
  assert.match(ui, /Boolean\(plan\?\.automation\) === Boolean\(value\.automation\)/)
  const server = readFileSync(new URL('../src/lib/action-cases/customerOffersServer.ts', import.meta.url), 'utf8')
  assert.match(server, /rpc\('assert_payment_automation'/)
})
