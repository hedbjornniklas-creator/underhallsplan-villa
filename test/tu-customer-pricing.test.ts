import assert from 'node:assert/strict'
import { test } from 'node:test'
// @ts-expect-error Node strip-types requires explicit extensions.
import { loadTuModule } from './helpers/load-tu-module.ts'
import type * as Customer from '../src/lib/tu/customer'
import type * as Editing from '../src/lib/tu/assignmentEditing'
const customer = loadTuModule<typeof Customer>('src/lib/tu/customer.ts')
const editing = loadTuModule<typeof Editing>('src/lib/tu/assignmentEditing.ts')
const person: Customer.TuCustomer = { version: 1, kind: 'consumer', contactName: '', contactRole: '',
  identityNumber: '', invoiceName: '', invoiceAddress: '', invoiceReference: '' }
const association: Customer.TuCustomer = { ...person, kind: 'association', identityNumber: '769600-0000', contactName: 'Anna Exempel', contactRole: 'Kassor' }

test('customer category is independent of the object and its BRF', () => {
  assert.equal(customer.tuCustomerKind({ tuCustomer: person, objectType: 'apartment', brfName: 'BRF Test' }), 'consumer')
  assert.equal(customer.tuCustomerKind({ tuCustomer: association, objectType: 'villa' }), 'association')
  assert.equal(customer.tuUsesApartment({ objectType: 'villa' }, 'Old BRF', '12'), false)
  assert.equal(customer.tuUsesApartment({ objectType: 'apartment' }), true)
  assert.equal(customer.tuUsesApartment({}, 'Legacy BRF'), true)
  assert.equal(customer.tuUsesApartment({}, null, null, 'Teknisk utredning - Lägenhet'), true)
  assert.equal(customer.tuUsesApartment({ objectType: 'villa' }, null, null, 'Lägenhet'), false)
})

test('defaults are inclusive for individuals and associations, exclusive for companies', () => {
  assert.equal(customer.defaultTuPriceBasis('consumer'), 'inclusive')
  assert.equal(customer.defaultTuPriceBasis('association'), 'inclusive')
  assert.equal(customer.defaultTuPriceBasis('business'), 'exclusive')
  assert.deepEqual(customer.calculateTuPricing('1250,50', 'inclusive', 25),
    { version: 1, amount: 1250.5, basis: 'inclusive', vatRate: 25, net: 1000.4, vat: 250.1, gross: 1250.5 })
  assert.equal(customer.calculateTuPricing(1000.4, 'exclusive', 25).gross, 1250.5)
  assert.equal(customer.calculateTuPricing(0, 'inclusive', 25).gross, 0)
  assert.equal(customer.calculateTuPricing(100, 'inclusive', 0).vat, 0)
  for (const value of ['', 'abc', -1, Infinity, NaN, 1e12]) assert.throws(() => customer.calculateTuPricing(value, 'inclusive'))
  assert.throws(() => customer.calculateTuPricing(100, 'inclusive', 12))
})

test('server recalculates submitted totals, and never infers VAT on a legacy price', () => {
  assert.equal(customer.parseTuPricing({ amount: 1000, basis: 'exclusive', vatRate: 25, gross: 1 })?.gross, 1250)
  assert.equal(customer.readTuPricing({ customerType: 'business' }), null)
  assert.doesNotMatch(customer.tuPriceText(1200, { customerType: 'business' }), /moms/)
  assert.match(customer.tuPriceText(1250, { tuPricing: customer.calculateTuPricing(1000, 'exclusive') }), /exkl\. moms/)
})

test('organization approval requires a named representative and authority, never changes legal category', () => {
  assert.doesNotThrow(() => customer.parseTuCustomer(person, true))
  assert.throws(() => customer.parseTuCustomer({ ...association, contactName: '' }, true))
  assert.throws(() => customer.parseTuCustomer({ ...association, identityNumber: '' }))
  assert.throws(() => customer.parseTuCustomer({ ...association, contactRole: 1 }))
  assert.throws(() => customer.parseTuCustomerAcceptance({ tuCustomer: association }, { tuCustomer: association }))
  assert.throws(() => customer.parseTuCustomerAcceptance({ tuCustomer: association }, { tuCustomer: person, representativeConfirmed: true }))
  const result = customer.parseTuCustomerAcceptance({ tuCustomer: association }, { tuCustomer: association, representativeConfirmed: true, invoiceEmail: 'INVOICE@example.com' })
  assert.equal(result?.invoiceEmail, 'invoice@example.com')
  assert.equal(result?.customer.kind, 'association')
  assert.equal(customer.parseTuCustomerAcceptance({}, {}), null, 'old issued links keep their existing acceptance flow')
})

test('draft edits preserve unrelated metadata and derive the gross amount', () => {
  const details = { reportTemplateKey: 'technical_status_statement', objectType: 'villa', tuCustomer: association }
  const edit = editing.parseTuAssignmentEdit({ expectedUpdatedAt: '2026-11-11T09:00:00Z',
    tuCustomer: association, tuPricing: { amount: 5000, basis: 'exclusive', vatRate: 25 }, price_amount: '1',
  }, details)
  assert.equal(edit.patch.price_amount, 6250)
  assert.equal((edit.patch.assignment_details as Record<string, unknown>).reportTemplateKey, details.reportTemplateKey)
  assert.equal((edit.patch.assignment_details as Record<string, unknown>).customerType, 'business')
  assert.equal(details.tuCustomer, association, 'input untouched')
  assert.throws(() => editing.parseTuAssignmentEdit({ expectedUpdatedAt: '2026-11-11T09:00:00Z', price_amount: '1000' },
    { tuPricing: customer.calculateTuPricing(1000, 'exclusive') }))
})

test('TU email displays net, VAT and total without affecting the OB email', () => {
  const email = loadTuModule<{ buildAssignmentConfirmationEmail: (input: unknown) => { text: string; html: string } }>('src/lib/assignments/emailTemplates.ts')
  const assignment = { assignment_type: 'TU', customer_name: 'Testforening', price_amount: 6250,
    assignment_details: { objectType: 'villa', tuCustomer: association, tuPricing: customer.calculateTuPricing(5000, 'exclusive') } }
  const input = { assignment, termsRole: 'technical', orgName: 'Test', acceptUrl: 'https://example.test/accept/token', expiresAt: '2026-12-01', termsVersion: 'test' }
  const result = email.buildAssignmentConfirmationEmail(input)
  assert.match(result.text, /exkl\. moms/)
  assert.match(result.text, /moms 25 %, totalt/)
  const ob = email.buildAssignmentConfirmationEmail({ ...input, termsRole: 'seller', assignment: { ...assignment, assignment_type: 'OB', assignment_details: {} } })
  assert.doesNotMatch(ob.text, /exkl\. moms/)
})
