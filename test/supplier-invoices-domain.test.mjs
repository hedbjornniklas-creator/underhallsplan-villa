import assert from 'node:assert/strict'
import test from 'node:test'
import {
  normalizeSupplierInvoiceDraft, parseInvoiceAmount, extractInvoiceText,
  summarizeSupplierInvoices, getProjectInvoiceEconomy, invoiceAllocatedOre,
  invoiceUnallocatedOre, MAX_INVOICE_AMOUNT_ORE,
} from '../src/lib/supplier-invoices/domain.ts'

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const draft = (overrides = {}) => ({
  supplierName: 'Bygg AB', supplierOrgNumber: '556123-4567', invoiceNumber: '123',
  invoiceDate: '2026-11-01', dueDate: '2026-11-30', documentKind: 'invoice',
  creditReferenceInvoiceId: null, currency: 'SEK', netAmountOre: 100000,
  vatAmountOre: 25000, approvalStatus: 'registered', paymentStatus: 'unpaid',
  paidOn: null, notes: '', sourceText: '', allocations: [], ...overrides,
})
const allocation = (overrides = {}) => ({ caseId: id(1), itemId: id(2), category: 'material', description: '', amountOre: 100000, ...overrides })
const invoice = (overrides = {}) => ({
  ...draft(), id: id(10), revision: 1, source: 'manual', externalId: null,
  createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-01T00:00:00Z', attachments: [], ...overrides,
})
function invalid(patch, expectedIssue) {
  assert.throws(() => normalizeSupplierInvoiceDraft(draft(patch)), (error) =>
    error.message === 'INVOICE_INVALID' && (!expectedIssue || error.issues.includes(expectedIssue)))
}

test('monetary parsing preserves öre and rejects ambiguous decimals, negatives and invalid input', () => {
  for (const value of ['1 234,56', '1\u00a0234,56 kr', '1\u202f234.56 SEK', '1234.56', '1.234,56', '1,234.56']) assert.equal(parseInvoiceAmount(value), 123456, value)
  assert.equal(parseInvoiceAmount('0,01'), 1)
  assert.equal(parseInvoiceAmount('1,2'), 120)
  assert.equal(parseInvoiceAmount('0'), 0)
  for (const value of ['', '1.234', '1,234', '1 2', '1e4', '-123', 'NaN', '1 234,567', '12.345.67', '999999999999']) assert.equal(parseInvoiceAmount(value), null, value)
})

test('normalization accepts a partial split without fabricating a default allocation', () => {
  const normalized = normalizeSupplierInvoiceDraft(draft({ supplierName: '  Bygg AB  ', allocations: [allocation({ amountOre: 60000 })] }))
  assert.equal(normalized.supplierName, 'Bygg AB')
  assert.equal(invoiceAllocatedOre(normalized), 60000)
  assert.equal(invoiceUnallocatedOre(normalized), 40000)
  assert.deepEqual(normalizeSupplierInvoiceDraft(draft()).allocations, [])
})

test('API input cannot smuggle source ids or org/creator identities into invoice body', () => {
  const normalized = normalizeSupplierInvoiceDraft({ ...draft(), orgId: id(99), source: 'fortnox', externalId: '123', createdBy: id(99) })
  assert.deepEqual(normalized, draft())
})

test('all money is bounded integer magnitudes and allocation sum cannot exceed invoice net', () => {
  for (const netAmountOre of [0, -1, 1.01, '1000', Number.NaN, Number.POSITIVE_INFINITY, MAX_INVOICE_AMOUNT_ORE + 1]) invalid({ netAmountOre }, 'netAmountOre')
  invalid({ vatAmountOre: -1 }, 'vatAmountOre')
  invalid({ allocations: [allocation({ amountOre: 60000 }), allocation({ caseId: id(3), amountOre: 50000 })] }, 'allocationTotal')
  invalid({ allocations: [allocation({ amountOre: 0 })] }, 'allocations.0.amountOre')
  invalid({ allocations: [allocation({ caseId: 'no' })] }, 'allocations.0.caseId')
  invalid({ allocations: [allocation({ itemId: 'no' })] }, 'allocations.0.itemId')
  invalid({ allocations: [allocation({ category: 'own_labor' })] }, 'allocations.0.category')
  invalid({ allocations: Array.from({ length: 101 }, () => allocation({ amountOre: 1 })) }, 'allocations')
})

test('invalid calendar dates, currencies and states are rejected, including numeric payment flags', () => {
  for (const invoiceDate of ['2026-02-29', '2026-04-31', '2026-13-01', '2026-1-01', '1899-01-01', '']) invalid({ invoiceDate }, 'invoiceDate')
  assert.equal(normalizeSupplierInvoiceDraft(draft({ invoiceDate: '2024-02-29' })).invoiceDate, '2024-02-29')
  invalid({ currency: 'EUR' }, 'currency')
  invalid({ approvalStatus: 'paid' }, 'approvalStatus')
  invalid({ paymentStatus: true }, 'paymentStatus')
  invalid({ paymentStatus: 'paid' }, 'paidOn')
  invalid({ paidOn: '2026-11-05' }, 'paidOn')
  assert.equal(normalizeSupplierInvoiceDraft(draft({ paymentStatus: 'paid', paidOn: '2026-11-05' })).approvalStatus, 'registered')
})

test('credit reference allowed only for a credit and uses a distinct internal invoice id', () => {
  invalid({ creditReferenceInvoiceId: id(10) }, 'creditReferenceInvoiceId')
  invalid({ documentKind: 'credit', creditReferenceInvoiceId: 'invoice number' }, 'creditReferenceInvoiceId')
  assert.equal(normalizeSupplierInvoiceDraft(draft({ documentKind: 'credit', creditReferenceInvoiceId: id(10) })).netAmountOre, 100000)
})

test('pasting labelled text proposes fields while retaining exact source for review', () => {
  const source = 'Leverantör: Bygg AB\nOrg.nr: 556123-4567\nFaktura nr: AB-123\nFakturadatum: 2026-11-01\nFörfallodatum: 30.11.2026\nNetto: 1 234,56 kr\nMoms: 308,64 kr'
  assert.deepEqual(extractInvoiceText(source), { sourceText: source, supplierName: 'Bygg AB', supplierOrgNumber: '556123-4567', invoiceNumber: 'AB-123', invoiceDate: '2026-11-01', dueDate: '2026-11-30', netAmountOre: 123456, vatAmountOre: 30864 })
})

test('paste parser never invents net cost or 25 percent VAT from a gross total or rate', () => {
  const result = extractInvoiceText('Unlabelled Supplier\nTotalt att betala: 125 000 kr\nMoms 25 %\nFörfallodatum: 31.02.2026')
  assert.equal(result.netAmountOre, undefined)
  assert.equal(result.vatAmountOre, undefined)
  assert.equal(result.supplierName, undefined)
  assert.equal(result.dueDate, undefined)
  assert.equal(extractInvoiceText('KREDITFAKTURA\nFakturanr: K-10').documentKind, 'credit')
})

test('totals count each invoice once, separate approval/payment, and subtract credits', () => {
  const records = [
    invoice({ approvalStatus: 'approved', dueDate: '2026-11-04', allocations: [allocation({ amountOre: 30000 }), allocation({ caseId: id(3), amountOre: 50000 })] }),
    invoice({ id: id(11), documentKind: 'credit', netAmountOre: 20000, vatAmountOre: 5000, dueDate: '2026-11-01', allocations: [allocation({ amountOre: 20000 })] }),
    invoice({ id: id(12), netAmountOre: 30000, vatAmountOre: 0, paymentStatus: 'paid', paidOn: '2026-11-05', dueDate: '2026-11-01', allocations: [allocation({ amountOre: 30000 })] }),
    invoice({ id: id(13), approvalStatus: 'void' }),
  ]
  assert.deepEqual(summarizeSupplierInvoices(records, '2026-11-05'), {
    registeredNetCostOre: 110000, approvedNetCostOre: 100000, unpaidGrossOre: 100000,
    overdueGrossOre: 125000, unallocatedNetOre: 20000, count: 3,
  })
})

test('due today is not overdue and an unresolved dispute remains visible as invoice cost', () => {
  const summary = summarizeSupplierInvoices([invoice({ approvalStatus: 'disputed', dueDate: '2026-11-05' })], '2026-11-05')
  assert.equal(summary.overdueGrossOre, 0)
  assert.equal(summary.registeredNetCostOre, 100000)
  assert.equal(summary.approvedNetCostOre, 0)
})

test('unallocated credits cannot cancel attention needed for unallocated debit invoices', () => {
  const result = summarizeSupplierInvoices([invoice(), invoice({ documentKind: 'credit' })], '2026-11-05')
  assert.equal(result.registeredNetCostOre, 0)
  assert.equal(result.unallocatedNetOre, 200000)
})

test('project economy sums only the allocated net share, including common costs and negative credits', () => {
  const project = { id: id(1), items: [{ id: id(2), title: 'Kök', estimatedCost: 2000, status: 'in_progress' }, { id: id(3), title: 'El', estimatedCost: 500, status: 'in_progress' }] }
  const records = [
    invoice({ allocations: [allocation({ amountOre: 60000 }), allocation({ itemId: null, amountOre: 10000 }), allocation({ caseId: id(4), itemId: null, amountOre: 30000 })] }),
    invoice({ id: id(11), documentKind: 'credit', netAmountOre: 20000, allocations: [allocation({ amountOre: 20000 })] }),
    invoice({ id: id(12), approvalStatus: 'void', allocations: [allocation()] }),
  ]
  const result = getProjectInvoiceEconomy(project, records)
  assert.equal(result.estimatedCostOre, 250000)
  assert.equal(result.actualCostOre, 50000)
  assert.equal(result.remainingEstimateOre, 200000)
  assert.equal(result.invoiceCount, 2)
  assert.equal(result.rows.find((row) => row.itemId === id(2)).actualCostOre, 40000)
  assert.equal(result.rows.find((row) => row.itemId === null).actualCostOre, 10000)
  assert.equal(result.rows.find((row) => row.itemId === id(3)).actualCostOre, 0)
})

test('incomplete internal estimates stay unknown instead of becoming zero or a full budget', () => {
  const result = getProjectInvoiceEconomy({ id: id(1), items: [{ id: id(2), title: 'Kök', estimatedCost: null, status: 'in_progress' }] }, [invoice({ allocations: [allocation()] })])
  assert.equal(result.estimatedCostOre, null)
  assert.equal(result.remainingEstimateOre, null)
  assert.equal(result.actualCostOre, 100000)
  assert.equal(getProjectInvoiceEconomy({ id: id(1), items: [] }, []).estimatedCostOre, null)
})
