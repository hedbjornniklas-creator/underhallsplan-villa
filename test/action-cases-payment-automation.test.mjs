import assert from 'node:assert/strict'
import { test } from 'node:test'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { emptyCustomerOffer, normalizeCustomerOffer, customerOfferBaseAmount, offerPublishIssues } from '../src/lib/action-cases/customerOffers.ts'
import { abs18PaymentText, normalizePaymentPlan, normalizePaymentConditions, paymentConditionsText, configurePaymentPlan,
  distributePaymentPlan, importPaymentPlanRows, syncPaymentPlan, paymentPercentAmount, paymentPlanTotal, paymentPlanIssues } from '../src/lib/action-cases/customerPaymentPlan.ts'

const row = (amountOre, title = 'Grund') => ({ id: randomUUID(), title, condition: 'Efter utfört arbete.', plannedDate: '2026-11-30', amountOre })
const old = () => ({ version: 1, installments: [row(33389900), row(35264500, 'Stomme')] })

test('payment import copies selected customer amounts, preserves percentage terms and requires new invoicing conditions', () => {
  const original = configurePaymentPlan(old(), 200000000, true, 10)
  const before = structuredClone(original)
  const sources = [{ id: 'ground', title: 'Mark', amountOre: 28500000 }, { id: 'roof', title: 'Tak', amountOre: 35200000 }, { id: 'unknown', title: 'El', amountOre: null }]
  const imported = importPaymentPlanRows(original, sources, ['roof', 'ground'])
  assert.deepEqual(original, before)
  assert.deepEqual(imported.installments[0], original.installments[0])
  assert.deepEqual(imported.installments.at(-1), original.installments.at(-1))
  assert.deepEqual(imported.installments.slice(1, -1).map(({ title, amountOre, condition, plannedDate }) => ({ title, amountOre, condition, plannedDate })), [
    { title: 'Mark', amountOre: 28500000, condition: '', plannedDate: '' },
    { title: 'Tak', amountOre: 35200000, condition: '', plannedDate: '' },
  ])
  assert(paymentPlanIssues(imported, 200000000).some((message) => message.includes('summa')))
  assert(paymentPlanIssues(imported, 200000000).some((message) => message.includes('faktureringsvillkor')))
  assert.equal(paymentPlanTotal(distributePaymentPlan(imported, 200000000)), 200000000)
  assert.deepEqual(normalizePaymentPlan(JSON.parse(JSON.stringify(imported))), imported)
  sources[0].amountOre = 1
  assert.equal(imported.installments[1].amountOre, 28500000)
  const reimported = importPaymentPlanRows(imported, sources, ['roof'])
  assert.equal(reimported.installments.length, 3)
})

test('payment import works without a plan and does not recreate a disabled final payment', () => {
  const sources = [{ id: 'ground', title: 'Mark', amountOre: 10001 }]
  const imported = importPaymentPlanRows(null, sources, ['ground'])
  assert.equal(imported.installments.length, 1)
  assert.equal(imported.automation, undefined)
  const disabled = configurePaymentPlan(old(), 100000000, false, 10, false)
  const next = importPaymentPlanRows(disabled, sources, ['ground'])
  assert.equal(next.automation.finalEnabled, false)
  assert.equal(next.installments.length, 1)
  for (const selection of [[], ['missing'], ['ground', 'ground']]) assert.throws(() => importPaymentPlanRows(null, sources, selection), /INVALID/)
  for (const amountOre of [null, 0, -1, 1.5, 100000000001]) assert.throws(() => importPaymentPlanRows(null, [{ ...sources[0], amountOre }], ['ground']), /INVALID/)
  const tooMany = Array.from({ length: 61 }, (_, i) => ({ ...sources[0], id: String(i) }))
  assert.throws(() => importPaymentPlanRows(null, tooMany, tooMany.map((r) => r.id)), /INVALID/)
})
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

test('removing the final payment preserves the first percentage and all other row details, with exact reallocation', () => {
  const original = configurePaymentPlan(old(), 203034201, true, 20)
  const before = structuredClone(original)
  const removed = configurePaymentPlan(original, 203034201, true, 20, false)
  assert.deepEqual(original, before)
  assert.equal(removed.automation.finalEnabled, false)
  assert.equal(removed.installments.some((r) => r.kind === 'final'), false)
  assert.deepEqual(removed.installments[0], original.installments[0])
  assert.deepEqual(removed.installments.slice(1).map(({ amountOre, ...r }) => r), original.installments.slice(1, -1).map(({ amountOre, ...r }) => r))
  assert.equal(paymentPlanTotal(removed), 203034201)
  assert.deepEqual(paymentPlanIssues(removed, 203034201, 'fixed'), [])
  const reloaded = normalizePaymentPlan(JSON.parse(JSON.stringify(removed)))
  assert.deepEqual(reloaded, removed)
  const changed = configurePaymentPlan(reloaded, 210000001, true, 15)
  assert.equal(changed.installments.some((r) => r.kind === 'final'), false)
  assert.equal(paymentPlanTotal(changed), 210000001)
  const restored = configurePaymentPlan(changed, 210000001, true, 15, true)
  assert.equal(restored.installments.at(-1).kind, 'final')
  assert.equal(restored.installments.at(-1).amountOre, 21000000)
  assert.equal(paymentPlanTotal(restored), 210000001)
})

test('both percentage rows can be removed, including when the contract price becomes unknown', () => {
  const original = configurePaymentPlan(old(), 100000000, true, 10)
  const manual = configurePaymentPlan(original, 100000000, false, 10, false)
  assert(manual.installments.every((r) => !r.kind))
  assert.equal(paymentPlanTotal(manual), 100000000)
  assert.deepEqual(paymentPlanIssues(manual, 100000000, 'mixed'), [])
  const unknown = configurePaymentPlan(original, null, false, 10, false)
  assert(unknown.installments.every((r) => !r.kind))
  assert.deepEqual(unknown.installments, original.installments.filter((r) => !r.kind))
  assert.equal(syncPaymentPlan(manual, 110000000).installments.some((r) => r.kind), false)
  const empty = configurePaymentPlan({ ...original, installments: original.installments.filter((r) => r.kind) }, 100000000, false, 10, false)
  assert.equal(normalizePaymentPlan(empty).installments.length, 0)
  assert(paymentPlanIssues(empty, 100000000).some((issue) => issue.includes('minst en')))
})

test('old automatic plans still require a final row; an explicit final setting must match the row', () => {
  const legacy = configurePaymentPlan(old(), 100000000)
  delete legacy.automation.finalEnabled
  assert.deepEqual(normalizePaymentPlan(legacy), legacy)
  assert.throws(() => normalizePaymentPlan({ ...legacy, installments: legacy.installments.slice(0, -1) }), /INVALID/)
  for (const finalEnabled of [false, null, 'false', 0])
    assert.throws(() => normalizePaymentPlan({ ...legacy, automation: { ...legacy.automation, finalEnabled } }), /INVALID/)
  const off = configurePaymentPlan(legacy, 100000000, false, 10, false)
  assert.throws(() => normalizePaymentPlan({ ...off, automation: { ...off.automation, finalEnabled: true } }), /INVALID/)
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
  assert.match(ui, /Boolean\(plan\?\.automation\) === Boolean\(value\.automation\)/)
  const server = readFileSync(new URL('../src/lib/action-cases/customerOffersServer.ts', import.meta.url), 'utf8')
  assert.match(server, /rpc\('assert_payment_automation'/)
})
