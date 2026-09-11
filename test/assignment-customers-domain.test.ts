import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'
import type * as AssignmentCustomerDomain from '../src/lib/assignment-customers/domain'
import type * as CustomerDomain from '../src/lib/customers/domain'
// @ts-expect-error Node's strip-types runner requires the source extension.
import * as fortnoxDomain from '../src/lib/fortnox/domain.ts'

function load<T>(file: string, dependencies: Record<string, unknown>): T {
  const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText
  const compiled = { exports: {} }

  new Function('require', 'module', 'exports', output)(
    (name: string) => {
      if (name in dependencies) return dependencies[name]
      throw new Error(`Unexpected assignment-customer domain dependency: ${name}`)
    },
    compiled,
    compiled.exports
  )
  return compiled.exports as T
}

const customerDomain = load<typeof CustomerDomain>('src/lib/customers/domain.ts', {
  '@/lib/fortnox/domain': fortnoxDomain,
})
const domain = load<typeof AssignmentCustomerDomain>(
  'src/lib/assignment-customers/domain.ts',
  { '@/lib/customers/domain': customerDomain }
)

const CUSTOMER_ID = '11111111-1111-4111-8111-111111111111'

test('existing customer selection is explicit, versioned and exactly shaped', () => {
  assert.deepEqual(
    domain.parseAssignmentCustomerBinding({
      mode: 'existing',
      customerId: CUSTOMER_ID,
      customerVersion: 3,
    }),
    {
      mode: 'existing',
      customerId: CUSTOMER_ID,
      customerVersion: 3,
    }
  )

  for (const invalid of [
    { mode: 'existing', customerId: CUSTOMER_ID },
    { mode: 'existing', customerId: CUSTOMER_ID, customerVersion: 0 },
    {
      mode: 'existing',
      customerId: CUSTOMER_ID,
      customerVersion: 1,
      email: 'match@example.test',
    },
    { mode: 'existing', customerId: 'not-a-uuid', customerVersion: 1 },
  ]) {
    assert.throws(() => domain.parseAssignmentCustomerBinding(invalid))
  }
})

test('create accepts only type and identity and canonicalizes identities', () => {
  assert.deepEqual(
    domain.parseAssignmentCustomerBinding({
      mode: 'create',
      customerType: 'business',
      identityNumber: '5561234567',
    }),
    {
      mode: 'create',
      customerType: 'business',
      identityNumber: '556123-4567',
    }
  )
  assert.deepEqual(
    domain.parseAssignmentCustomerBinding({
      mode: 'create',
      customerType: 'private',
      identityNumber: null,
    }),
    { mode: 'create', customerType: 'private', identityNumber: null }
  )
  assert.deepEqual(
    domain.parseAssignmentCustomerBinding({
      mode: 'create',
      customerType: 'private',
      identityNumber: '19900101-1234',
    }),
    {
      mode: 'create',
      customerType: 'private',
      identityNumber: '900101-1234',
    }
  )
})

test('create never accepts contact fields that could imply automatic matching', () => {
  assert.throws(
    () =>
      domain.parseAssignmentCustomerBinding({
        mode: 'create',
        customerType: 'private',
        identityNumber: null,
        email: 'shared@example.test',
      }),
    { message: 'ASSIGNMENT_CUSTOMER_BINDING_INVALID' }
  )
  assert.throws(
    () =>
      domain.parseAssignmentCustomerBinding({
        mode: 'create',
        customerType: 'business',
        identityNumber: null,
      }),
    { message: 'CUSTOMER_IDENTITY_REQUIRED' }
  )
  assert.throws(
    () =>
      domain.parseAssignmentCustomerBinding({
        mode: 'create',
        customerType: 'private',
        identityNumber: 'not-an-identity',
      }),
    { message: 'CUSTOMER_IDENTITY_INVALID' }
  )
})

test('organization, assignment and concurrency token parsers are strict', () => {
  const valid = '22222222-2222-4222-8222-222222222222'
  assert.equal(domain.parseAssignmentCustomerOrganizationId(valid), valid)
  assert.equal(domain.parseAssignmentCustomerAssignmentId(valid), valid)
  assert.equal(
    domain.parseAssignmentCustomerExpectedUpdatedAt('2026-09-11T10:15:30.123456+02:00'),
    '2026-09-11T10:15:30.123456+02:00'
  )

  assert.throws(() => domain.parseAssignmentCustomerOrganizationId('org-a'))
  assert.throws(() => domain.parseAssignmentCustomerAssignmentId('assignment-a'))
  assert.throws(() => domain.parseAssignmentCustomerExpectedUpdatedAt('tomorrow'))
})
