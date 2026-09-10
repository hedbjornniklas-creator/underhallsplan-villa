import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'
import type * as CustomerDomain from '../src/lib/customers/domain'
import type * as CustomerServer from '../src/lib/customers/server'
// @ts-expect-error Node's strip-types runner requires the source extension.
import * as fortnoxDomain from '../src/lib/fortnox/domain.ts'

const ORG_ID = '11111111-1111-4111-8111-111111111111'
const PROFILE_ID = '22222222-2222-4222-8222-222222222222'
const CUSTOMER_ID = '33333333-3333-4333-8333-333333333333'

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
      throw new Error(`Unexpected customer-server dependency: ${name}`)
    },
    compiled,
    compiled.exports
  )

  return compiled.exports as T
}

const customerDomain = load<typeof CustomerDomain>('src/lib/customers/domain.ts', {
  '@/lib/fortnox/domain': fortnoxDomain,
})

type AccessInput = {
  productKey: string
  moduleKey?: string
  scopeType?: string
  scopeId?: string | null
}

type CustomerRow = {
  [key: string]: unknown
  id: string
  org_id: string
}

function row(overrides: Partial<CustomerRow> = {}): CustomerRow {
  return {
    id: CUSTOMER_ID,
    org_id: ORG_ID,
    customer_number: 1001,
    customer_type: 'private',
    name: 'Anna Andersson',
    organization_number: null,
    personal_identity_number: '900101-1234',
    email: 'anna@example.se',
    phone: null,
    address: null,
    address_line_2: null,
    postal_code: null,
    city: null,
    country_code: 'SE',
    invoice_same_as_customer: true,
    invoice_name: null,
    invoice_email: null,
    invoice_address: null,
    invoice_address_line_2: null,
    invoice_postal_code: null,
    invoice_city: null,
    invoice_country_code: null,
    invoice_reference: null,
    fortnox_customer_number: null,
    is_active: true,
    version: 1,
    created_at: '2026-09-10T08:00:00.000Z',
    updated_at: '2026-09-10T08:00:00.000Z',
    ...overrides,
  }
}

function businessInput() {
  return {
    customerType: 'business',
    name: 'Exempelbolaget AB',
    identityNumber: '556123-4567',
    email: 'info@example.se',
    phone: null,
    address: null,
    addressLine2: null,
    postalCode: null,
    city: null,
    countryCode: 'SE',
    invoiceSameAsCustomer: true,
    invoiceName: null,
    invoiceEmail: null,
    invoiceAddress: null,
    invoiceAddressLine2: null,
    invoicePostalCode: null,
    invoiceCity: null,
    invoiceCountryCode: null,
    invoiceReference: null,
  }
}

function serverHarness(options: {
  role?: 'admin' | 'inspector'
  readAccess?: boolean
  adminAccess?: boolean
  rows?: CustomerRow[]
} = {}) {
  const accessCalls: AccessInput[] = []
  const reads: Array<{ table: string; filters: Array<[string, unknown]> }> = []
  const inserts: Array<Record<string, unknown>> = []
  const rows = options.rows ?? [row()]

  const admin = {
    from(table: string) {
      const filters: Array<[string, unknown]> = []
      let inserted: Record<string, unknown> | null = null

      const query = {
        select() {
          return query
        },
        insert(value: Record<string, unknown>) {
          inserted = value
          inserts.push(value)
          return query
        },
        eq(column: string, value: unknown) {
          filters.push([column, value])
          return query
        },
        order() {
          return query
        },
        single: async () => ({
          data: inserted
            ? row({
                customer_type: inserted.customer_type,
                name: inserted.name,
                organization_number: inserted.organization_number,
                personal_identity_number: inserted.personal_identity_number,
                email: inserted.email,
                created_by_profile_id: inserted.created_by_profile_id,
                updated_by_profile_id: inserted.updated_by_profile_id,
              })
            : null,
          error: null,
        }),
        then<TResult1 = unknown, TResult2 = never>(
          onfulfilled?:
            | ((value: { data: CustomerRow[]; error: null }) => TResult1 | PromiseLike<TResult1>)
            | null,
          onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
        ) {
          reads.push({ table, filters: [...filters] })
          const filtered = rows.filter((candidate) =>
            filters.every(([column, value]) => candidate[column] === value)
          )
          return Promise.resolve({ data: filtered, error: null }).then(
            onfulfilled,
            onrejected
          )
        },
      }
      return query
    },
  }

  const server = load<typeof CustomerServer>('src/lib/customers/server.ts', {
    'server-only': {},
    '@/lib/access/server': {
      hasCurrentUserAccess: async (input: AccessInput) => {
        accessCalls.push(input)
        return input.moduleKey === 'admin'
          ? (options.adminAccess ?? true)
          : (options.readAccess ?? true)
      },
    },
    '@/lib/assignments/server': {
      requireOrgContext: async () => ({
        userId: PROFILE_ID,
        orgId: ORG_ID,
        role: options.role ?? 'admin',
        orgName: 'HusHub 1',
        orgEmailFrom: null,
      }),
    },
    '@/lib/supabase/admin': { createSupabaseAdminClient: () => admin },
    './domain': customerDomain,
  })

  return { accessCalls, inserts, reads, server }
}

test('read is scoped to the current organization and hides private identity from non-managers', async () => {
  const harness = serverHarness({ role: 'admin', adminAccess: false })
  const workspace = await harness.server.getOrganizationCustomerWorkspace()

  assert.equal(workspace.organization.id, ORG_ID)
  assert.equal(workspace.organization.canManage, false)
  assert.equal(workspace.customers[0].identityNumber, null)
  assert.deepEqual(harness.reads[0].filters, [['org_id', ORG_ID]])
  assert.deepEqual(harness.accessCalls, [
    {
      productKey: 'dashboard',
      scopeType: 'organization',
      scopeId: ORG_ID,
    },
    {
      productKey: 'dashboard',
      moduleKey: 'admin',
      scopeType: 'organization',
      scopeId: ORG_ID,
    },
  ])
})

test('read is rejected when Dashboard access belongs to another organization', async () => {
  const harness = serverHarness({ readAccess: false })

  await assert.rejects(
    harness.server.getOrganizationCustomerWorkspace(),
    { message: 'PRODUCT_ACCESS_REQUIRED' }
  )
  assert.equal(harness.reads.length, 0)
})

test('admin create derives organization and audit profile on the server', async () => {
  const harness = serverHarness()
  const customer = await harness.server.createOrganizationCustomer(businessInput())

  assert.equal(customer.customerNumber, '1001')
  assert.equal(harness.inserts.length, 1)
  assert.equal(harness.inserts[0].org_id, ORG_ID)
  assert.equal(harness.inserts[0].created_by_profile_id, PROFILE_ID)
  assert.equal(harness.inserts[0].updated_by_profile_id, PROFILE_ID)
  assert.equal(harness.inserts[0].organization_number, '556123-4567')
  assert.equal('customer_number' in harness.inserts[0], false)
})

test('inspectors and admins without an exact admin scope cannot mutate customers', async () => {
  for (const options of [
    { role: 'inspector' as const, adminAccess: true },
    { role: 'admin' as const, adminAccess: false },
  ]) {
    const harness = serverHarness(options)
    await assert.rejects(
      harness.server.createOrganizationCustomer(businessInput()),
      { message: 'CUSTOMER_ORGANIZATION_ADMIN_REQUIRED' }
    )
    assert.equal(harness.inserts.length, 0)
  }
})
