import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID as id } from 'node:crypto'
import { billingSourceContext } from '../src/lib/action-cases/billingFlowSources.ts'

const manager = id(), caseId = id(), item = id(), change = id(), part = (mode, values = {}) => ({ mode, fixedOre: null, hourlyOre: null, budgetOre: null, markupPercent: null, ...values })
const terms = { version: 1, split: 'separate', combined: part('fixed'), labour: part('fixed', { fixedOre: 1250000 }), material: part('budget', { budgetOre: 2500000, markupPercent: 15 }), assumptions: 'Fiktiva förutsättningar', reviewTerms: 'Avstämning vid risk' }
const pricing = { version: 1, mode: 'mixed', display: 'priced', split: 'combined', basis: 'rows', rows: [{ id: id(), sourceItemId: item, title: 'Byggarbete', kind: 'fixed', amountOre: null, labourOre: null, materialOre: null, projectPricing: { revision: 2, terms } }], totalOre: null, labourOre: null, materialOre: null, running: { hourlyOre: null, managementOre: null, markupPercent: null, approximateOre: null } }
const source = () => ({ caseId, title: 'Fiktivt projekt', status: 'in_progress', manager, customerName: 'Testkund', frozen: { id: id(), version: 3, kind: 'contract', snapshot: { contractPricing: pricing, paymentTerms: 'Efter utförande', senderProfile: { name: 'Fryst bolag', organizationNumber: '000000-0000' } } }, draft: { contractPricing: { ...pricing, totalOre: 99999999 } }, prices: [{ id: item, revision: 9, terms: { ...terms, labour: part('fixed', { fixedOre: 8888888 }) } }], items: [{ id: item, title: 'Aktuell titel' }], choices: [], legacy: [], invoices: [], openQuestions: 0, sender: { name: 'Annat bolag' } })
test('locked customer price and sender are read, never replaced by newer live calculation or draft', () => {
  const raw = source(), before = structuredClone(raw), ctx = billingSourceContext(raw, manager)
  assert.equal(ctx.baseFixedGrossOre, 1250000)
  assert.equal(ctx.candidates.find(c => c.key.endsWith(':labour')).fixedGrossOre, 1250000)
  assert.equal(ctx.candidates.find(c => c.key.endsWith(':material')).mode, 'budget')
  assert.equal(ctx.candidates.find(c => c.key.endsWith(':material')).budgetGrossOre, 2500000)
  assert.match(ctx.issuer, /Fryst bolag/)
  assert.deepEqual(raw, before)
})
test('valid frozen payment plan replaces fixed work candidates, not running material', () => {
  const raw = source(), row = id()
  raw.frozen.snapshot.paymentPlan = { version: 1, installments: [{ id: row, title: 'Delbetalning', condition: 'Utfört', plannedDate: '', amountOre: 1250000 }] }
  const ctx = billingSourceContext(raw, manager)
  assert.equal(ctx.candidates.filter(c => c.mode === 'fixed').length, 1)
  assert.equal(ctx.candidates.find(c => c.mode === 'fixed').key, `base:payment:${row}`)
  assert.equal(ctx.candidates.filter(c => c.mode === 'budget').length, 1)
})
test('missing frozen per-item terms do not fall back to live customer prices', () => {
  const raw = source(); raw.frozen.snapshot = { issuerName: 'Fryst avsändare' }
  assert.equal(billingSourceContext(raw, manager).candidates.length, 0)
})
test('choice is only a candidate; no approval, prices or ledger records are created on read', () => {
  const raw = source()
  raw.choices = [{ id: change, title: 'Undersökning', offer: { version: 1, kind: 'change', priceNeutral: false, priceSource: 'manual', conditions: '', exclusions: '', pricing: { ...pricing, mode: 'fixed', basis: 'total', rows: [], totalOre: 2500000 }, time: { status: 'none', workingDays: null, explanation: '' } } }]
  const ctx = billingSourceContext(raw, manager)
  assert.equal(ctx.candidates.find(c => c.key.startsWith('change:')).fixedGrossOre, 2500000)
  assert.ok(!('flow' in ctx))
})
test('supplier source uses one signed allocation, not entire invoice or purchase VAT', () => {
  const raw = source(), invoice = id(), alloc = id()
  raw.invoices = [{ id: invoice, revision: 4, hasOriginal: true, legacyAllocations: [alloc], body: { supplierName: 'UE', invoiceNumber: 'A1', invoiceDate: '2026-11-09', documentKind: 'credit', approvalStatus: 'approved', netAmountOre: 1000000, vatAmountOre: 250000, allocations: [{ id: alloc, caseId, itemId: item, changeId: null, amountOre: 200000, description: 'Delpost' }, { id: id(), caseId: id(), itemId: item, amountOre: 800000 }] } }]
  const ctx = billingSourceContext(raw, manager)
  assert.equal(ctx.suppliers.length, 1); assert.equal(ctx.suppliers[0].netOre, -200000); assert.equal(ctx.suppliers[0].legacy, true)
})
test('fingerprint changes when customer conditions change; source inputs stay immutable', () => {
  const raw = source(), a = billingSourceContext(raw, manager).candidates
  raw.frozen.snapshot = structuredClone(raw.frozen.snapshot)
  raw.frozen.snapshot.contractPricing.rows[0].projectPricing.terms.material.markupPercent = 20
  const b = billingSourceContext(raw, manager).candidates
  assert.notEqual(a[0].fingerprint, b[0].fingerprint)
  assert.equal(a[0].fingerprint.length, 64)
})

test('a running contract without work rows still provides its documented global rates', () => {
  const raw = source(); raw.frozen.snapshot.contractPricing = { ...pricing, mode: 'running', rows: [], running: { ...pricing.running, hourlyOre: 75000, markupPercent: 15 } }
  const c = billingSourceContext(raw, manager).candidates
  assert.equal(c.length, 1); assert.equal(c[0].key, 'base:running'); assert.equal(c[0].hourlyGrossOre, 75000)
})

test('a locked legacy document never adopts the current sender if its own profile is missing', () => {
  const raw = source(); delete raw.frozen.snapshot.senderProfile; raw.frozen.snapshot.issuerName = 'Fryst juridisk avsändare'
  assert.equal(billingSourceContext(raw, manager).issuer, 'Fryst juridisk avsändare')
})
