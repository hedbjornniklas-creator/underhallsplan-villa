import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'
import type * as CustomerDomain from '../src/lib/customers/domain'
// @ts-expect-error Node's strip-types runner requires the source extension.
import * as fortnoxDomain from '../src/lib/fortnox/domain.ts'

function loadDomain() {
  const source = readFileSync(
    new URL('../src/lib/customers/domain.ts', import.meta.url),
    'utf8'
  )
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText
  const compiled = { exports: {} }

  new Function('require', 'module', 'exports', output)(
    (name: string) => {
      if (name === '@/lib/fortnox/domain') return fortnoxDomain
      throw new Error(`Unexpected customer-domain dependency: ${name}`)
    },
    compiled,
    compiled.exports
  )

  return compiled.exports as typeof CustomerDomain
}

const domain = loadDomain()

function businessInput(overrides: Record<string, unknown> = {}) {
  return {
    customerType: 'business',
    name: '  Exempelbolaget AB  ',
    identityNumber: '5561234567',
    email: '  INFO@EXAMPLE.SE ',
    phone: '070-123 45 67',
    address: 'Exempelgatan 1',
    addressLine2: '',
    postalCode: '123 45',
    city: 'Stockholm',
    countryCode: 'se',
    invoiceSameAsCustomer: true,
    invoiceName: '',
    invoiceEmail: '',
    invoiceAddress: '',
    invoiceAddressLine2: '',
    invoicePostalCode: '',
    invoiceCity: '',
    invoiceCountryCode: '',
    invoiceReference: 'Projekt A',
    ...overrides,
  }
}

test('business customers receive canonical identity and contact values', () => {
  const customer = domain.parseOrganizationCustomerInput(businessInput())

  assert.equal(customer.customerType, 'business')
  assert.equal(customer.name, 'Exempelbolaget AB')
  assert.equal(customer.identityNumber, '556123-4567')
  assert.equal(customer.email, 'info@example.se')
  assert.equal(customer.countryCode, 'SE')
  assert.equal(customer.invoiceSameAsCustomer, true)
  assert.equal(customer.invoiceName, null)
  assert.equal(customer.invoiceCountryCode, null)
  assert.equal(customer.invoiceReference, 'Projekt A')
})

test('private identity is optional, canonicalized and never uses organization-number validation', () => {
  const customer = domain.parseOrganizationCustomerInput(
    businessInput({
      customerType: 'private',
      name: 'Anna Andersson',
      identityNumber: '19900101-1234',
    })
  )
  const withoutIdentity = domain.parseOrganizationCustomerInput(
    businessInput({
      customerType: 'private',
      name: 'Bo Berg',
      identityNumber: '',
    })
  )

  assert.equal(customer.identityNumber, '900101-1234')
  assert.equal(withoutIdentity.identityNumber, null)
  assert.equal(
    domain.normalizeOrganizationCustomerIdentity('169001011234', 'private'),
    null
  )
})

test('a separate invoice recipient is normalized and must have a name and country', () => {
  const customer = domain.parseOrganizationCustomerInput(
    businessInput({
      invoiceSameAsCustomer: false,
      invoiceName: '  Ekonomiavdelningen ',
      invoiceEmail: ' FAKTURA@EXAMPLE.SE ',
      invoiceAddress: 'Box 1',
      invoiceCountryCode: 'se',
    })
  )

  assert.equal(customer.invoiceName, 'Ekonomiavdelningen')
  assert.equal(customer.invoiceEmail, 'faktura@example.se')
  assert.equal(customer.invoiceCountryCode, 'SE')

  assert.throws(
    () =>
      domain.parseOrganizationCustomerInput(
        businessInput({ invoiceSameAsCustomer: false, invoiceName: '' })
      ),
    { message: 'CUSTOMER_INVOICE_NAME_REQUIRED' }
  )
})

test('strict input rejects unknown fields, invalid identities and non-boolean invoice mode', () => {
  assert.throws(
    () => domain.parseOrganizationCustomerInput(businessInput({ orgId: 'attacker-org' })),
    { message: 'CUSTOMER_REQUEST_INVALID' }
  )
  assert.throws(
    () => domain.parseOrganizationCustomerInput(businessInput({ identityNumber: '556123-4568' })),
    { message: 'CUSTOMER_IDENTITY_INVALID' }
  )
  assert.throws(
    () => domain.parseOrganizationCustomerInput(businessInput({ identityNumber: '' })),
    { message: 'CUSTOMER_IDENTITY_REQUIRED' }
  )
  assert.throws(
    () => domain.parseOrganizationCustomerInput(businessInput({ email: 'inte-en-adress' })),
    { message: 'CUSTOMER_EMAIL_INVALID' }
  )
  assert.throws(
    () =>
      domain.parseOrganizationCustomerInput(
        businessInput({ invoiceSameAsCustomer: 'true' })
      ),
    { message: 'CUSTOMER_REQUEST_INVALID' }
  )
})
