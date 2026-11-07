import assert from 'node:assert/strict'
import test from 'node:test'
// @ts-expect-error Native Node tests require the explicit TypeScript extension.
import { emptyEbInspectionBilling, unavailableEbInspectionBilling, parseEbInspectionBillingPatch, parseEbInspectionBilling } from '../src/lib/eb/billing.ts'

test('empty and unavailable are distinct independent values, never a guessed billed state', () => {
  assert.equal(emptyEbInspectionBilling().status, 'not_invoiced')
  assert.equal(unavailableEbInspectionBilling().status, 'unavailable')
  assert.equal(emptyEbInspectionBilling().revision, 0)
  const value = emptyEbInspectionBilling(); value.invoiceNumber = 'changed'
  assert.equal(emptyEbInspectionBilling().invoiceNumber, null)
})

test('patch requires explicit status, invoice number and a safe revision; unknown scope is excluded', () => {
  assert.deepEqual(parseEbInspectionBillingPatch({
    isInvoiced: false, invoiceNumber: '  F-123  ', expectedRevision: 7,
    orgId: 'forged', userId: 'forged', status: 'completed',
  }), { isInvoiced: false, invoiceNumber: 'F-123', expectedRevision: 7 })
  assert.equal(parseEbInspectionBillingPatch({ isInvoiced: true, invoiceNumber: '  ', expectedRevision: 0 }).invoiceNumber, null)
  for (const value of [null, [], {}, { isInvoiced: 'true' },
    { isInvoiced: true, invoiceNumber: 123, expectedRevision: 0 },
    ...[-1, 0.5, NaN, Infinity, 2147483648, '0'].map(expectedRevision => ({ isInvoiced: true, invoiceNumber: null, expectedRevision })),
    ...['x'.repeat(101), 'X\nY', 'X\tY', 'X\u007fY'].map(invoiceNumber => ({ isInvoiced: true, invoiceNumber, expectedRevision: 0 })),
  ]) assert.throws(() => parseEbInspectionBillingPatch(value), /EB_BILLING_INPUT_INVALID/)
})

test('successful metadata rejects malformed dates, fields, unknown and inconsistent statuses', () => {
  const empty = emptyEbInspectionBilling()
  assert.deepEqual(parseEbInspectionBilling(empty), empty)
  const invoiced = { ...empty, status: 'invoiced', invoicedAt: '2026-11-07T12:00:00Z',
    invoiceNumber: 'F-12', revision: 1, updatedAt: '2026-11-07T12:00:00Z', updatedByName: 'Testperson' }
  assert.deepEqual(parseEbInspectionBilling(invoiced), invoiced)
  for (const value of [null, {}, unavailableEbInspectionBilling(), { ...empty, status: 'invoiced' },
    { ...invoiced, status: 'not_invoiced' }, { ...invoiced, invoicedAt: 'invalid' },
    { ...empty, updatedAt: 123 }, { ...empty, updatedByName: 123 }, { ...empty, revision: -1 },
  ]) assert.equal(parseEbInspectionBilling(value), null)
})
