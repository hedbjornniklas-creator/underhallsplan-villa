import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { emptyInvoiceBasis, normalizeInvoiceBasis, invoiceBasisTotals, projectCompletionBlockers } from '../src/lib/action-cases/projectCompletion.ts'

const body = (patch = {}) => ({ ...emptyInvoiceBasis({ issuer: 'Test AB', recipient: 'Testkund' }), date: '2026-11-07', lines: [{ id: randomUUID(), description: 'Arbetstid', quantity: 10, unit: 'tim', unitPriceOre: 60000, vatRate: 25 }], ...patch })
test('invoice basis has explicit net, VAT, gross totals and accepts zero separately from missing', () => {
  const b = normalizeInvoiceBasis(body()), totals = invoiceBasisTotals(b)
  assert.equal(totals.complete, true); assert.equal(totals.netOre, 600000); assert.equal(totals.vatOre, 150000); assert.equal(totals.grossOre, 750000)
  b.lines[0].unitPriceOre = 0; assert.equal(invoiceBasisTotals(b).complete, true); assert.equal(invoiceBasisTotals(b).grossOre, 0)
  b.lines[0].unitPriceOre = null; assert.equal(invoiceBasisTotals(b).complete, false)
  b.lines[0].unitPriceOre = 500; b.lines[0].quantity = null; assert.equal(invoiceBasisTotals(b).complete, false)
})
test('drafts can be incomplete; numeric precision, duplicate IDs, invalid dates and runaway totals are rejected', () => {
  assert.doesNotThrow(() => normalizeInvoiceBasis(emptyInvoiceBasis({ issuer: '', recipient: '' })))
  for (const date of ['2026-02-30', '2026-13-01', '', '2026-1-2']) assert.throws(() => normalizeInvoiceBasis(body({ date })))
  for (const patch of [{ quantity: -1 }, { quantity: 1.00001 }, { unitPriceOre: 1.5 }, { vatRate: 26 }, { unitPriceOre: NaN }, { quantity: 1e6, unitPriceOre: 1e12 }]) {
    const b = body(); Object.assign(b.lines[0], patch); assert.throws(() => normalizeInvoiceBasis(b), /INVALID/)
  }
  const b = body(); b.lines.push({ ...b.lines[0] }); assert.throws(() => normalizeInvoiceBasis(b))
})
test('discount rows use integer ore with consistent half rounding', () => {
  const b = body(); b.lines[0] = { ...b.lines[0], quantity: 0.5, unitPriceOre: -101, vatRate: 25 }
  assert.equal(invoiceBasisTotals(b).netOre, -51); assert.equal(invoiceBasisTotals(b).vatOre, -13)
})
test('closing checks work complete, fully invoiced and all questions closed, not paid', () => {
  assert.deepEqual(projectCompletionBlockers({ workComplete: true, invoiced: true, openQuestions: 0 }), [])
  assert.equal(projectCompletionBlockers({ workComplete: false, invoiced: false, openQuestions: 3 }).length, 3)
  assert.equal(projectCompletionBlockers({ workComplete: true, invoiced: true, openQuestions: null }).length, 1)
})
