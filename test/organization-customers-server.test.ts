import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'
import type * as CustomerDomain from '../src/lib/customers/domain'
import type * as CustomerServer from '../src/lib/customers/server'
// @ts-expect-error Node's strip-types runner requires the source extension.
import * as fortnoxDomain from '../src/lib/fortnox/domain.ts'

const ORG_A = '11111111-1111-4111-8111-111111111111'
const ORG_B = '22222222-2222-4222-8222-222222222222'
const PROFILE_ID = '33333333-3333-4333-8333-333333333333'
const CUSTOMER_ID = '44444444-4444-4444-8444-444444444444'

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

type Assignment = {
  productKey: string
  moduleKey: string | null
  roleKey: string | null
  scopeType: string
  scopeId: string | null
}

type Membership = {
  org_id: string
  profile_id: string
  role: 'admin' | 'inspector'
  is_active: boolean
  is_default: boolean
  created_at: string
  organizations: { name: string }
}

type CustomerRow = {
  [key: string]: unknown
  id: string
  org_id: string
}

function membership(
  orgId: string,
  role: Membership['role'],
  isDefault: boolean,
  name: string
): Membership {
  return {
    org_id: orgId,
    profile_id: PROFILE_ID,
    role,
    is_active: true,
    is_default: isDefault,
    created_at: isDefault
      ? '2026-09-10T08:00:00.000Z'
      : '2026-09-10T09:00:00.000Z',
    organizations: { name },
  }
}

function row(orgId = ORG_A, overrides: Partial<CustomerRow> = {}): CustomerRow {
  return {
    id: CUSTOMER_ID,
    org_id: orgId,
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
  assignments?: Assignment[]
  memberships?: Membership[]
  rows?: CustomerRow[]
} = {}) {
  const productCalls: string[] = []
  const reads: Array<{ table: string; filters: Array<[string, unknown]> }> = []
  const inserts: Array<Record<string, unknown>> = []
  const memberships = options.memberships ?? [membership(ORG_A, 'admin', true, 'Org A')]
  const customers = options.rows ?? [row()]

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
            ? row(String(inserted.org_id), {
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
            | ((value: { data: Array<Membership | CustomerRow>; error: null }) =>
                | TResult1
                | PromiseLike<TResult1>)
            | null,
          onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
        ) {
          reads.push({ table, filters: [...filters] })
          const source: Array<Membership | CustomerRow> =
            table === 'org_members'
              ? memberships
              : table === 'organization_customers'
                ? customers
                : []
          const filtered = source.filter((candidate) =>
            filters.every(
              ([column, value]) =>
                (candidate as unknown as Record<string, unknown>)[column] === value
            )
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
      requireProductAccess: async (productKey: string) => {
        productCalls.push(productKey)
        return {
          identity: {
            userId: PROFILE_ID,
            profileId: PROFILE_ID,
            fullName: 'Test Admin',
            email: 'admin@example.se',
            isLegacyAdmin: false,
          },
          assignments: options.assignments ?? [],
          normalizedAccessAvailable: Boolean(options.assignments),
        }
      },
    },
    '@/lib/supabase/admin': { createSupabaseAdminClient: () => admin },
    './domain': customerDomain,
  })

  return { inserts, productCalls, reads, server }
}

test('workspace keeps the default organization and exposes a secure multi-org choice', async () => {
  const harness = serverHarness({
    memberships: [
      membership(ORG_A, 'inspector', true, 'Besiktningsbolaget Stockholm'),
      membership(ORG_B, 'admin', false, 'Hushub 1'),
    ],
    rows: [row(ORG_A), row(ORG_B, { id: '55555555-5555-4555-8555-555555555555' })],
  })
  const workspace = await harness.server.getOrganizationCustomerWorkspace()

  assert.equal(workspace.organization.id, ORG_A)
  assert.equal(workspace.organization.name, 'Besiktningsbolaget Stockholm')
  assert.equal(workspace.organization.canManage, false)
  assert.deepEqual(
    workspace.organizations.map(({ id, canManage }) => ({ id, canManage })),
    [
      { id: ORG_A, canManage: false },
      { id: ORG_B, canManage: true },
    ]
  )
  assert.deepEqual(
    harness.reads.find((read) => read.table === 'organization_customers')?.filters,
    [['org_id', ORG_A]]
  )

  const selected = await harness.server.getOrganizationCustomerWorkspace(ORG_B)
  assert.equal(selected.organization.name, 'Hushub 1')
  assert.equal(selected.organization.canManage, true)
})

test('normalized access lists and reads only the exact organization scope', async () => {
  const harness = serverHarness({
    assignments: [
      {
        productKey: 'dashboard',
        moduleKey: 'inspections',
        roleKey: 'inspector',
        scopeType: 'organization',
        scopeId: ORG_B,
      },
    ],
    memberships: [
      membership(ORG_A, 'admin', true, 'Org A'),
      membership(ORG_B, 'admin', false, 'Org B'),
    ],
    rows: [row(ORG_B)],
  })
  const workspace = await harness.server.getOrganizationCustomerWorkspace(ORG_B)

  assert.deepEqual(workspace.organizations.map((organization) => organization.id), [ORG_B])
  assert.equal(workspace.organization.canManage, false)
  assert.equal(workspace.customers[0].identityNumber, null)
  await assert.rejects(
    harness.server.getOrganizationCustomerWorkspace(ORG_A),
    { message: 'CUSTOMER_ORGANIZATION_MEMBER_REQUIRED' }
  )
})

test('global dashboard admin access applies to every active member organization', async () => {
  const harness = serverHarness({
    assignments: [
      {
        productKey: 'dashboard',
        moduleKey: 'admin',
        roleKey: 'dashboard_admin',
        scopeType: 'global',
        scopeId: null,
      },
    ],
    memberships: [
      membership(ORG_A, 'admin', true, 'Org A'),
      membership(ORG_B, 'admin', false, 'Org B'),
    ],
    rows: [row(ORG_B)],
  })

  const workspace = await harness.server.getOrganizationCustomerWorkspace(ORG_B)

  assert.deepEqual(workspace.organizations.map((organization) => organization.id), [ORG_A, ORG_B])
  assert.equal(workspace.organization.canManage, true)
})

test('admin create derives selected organization and audit profile on the server', async () => {
  const harness = serverHarness({
    memberships: [membership(ORG_B, 'admin', false, 'Hushub 1')],
  })
  const customer = await harness.server.createOrganizationCustomer(
    ORG_B,
    businessInput()
  )

  assert.equal(customer.customerNumber, '1001')
  assert.equal(harness.productCalls[0], 'dashboard')
  assert.equal(harness.inserts.length, 1)
  assert.equal(harness.inserts[0].org_id, ORG_B)
  assert.equal(harness.inserts[0].created_by_profile_id, PROFILE_ID)
  assert.equal(harness.inserts[0].updated_by_profile_id, PROFILE_ID)
  assert.equal(harness.inserts[0].organization_number, '556123-4567')
  assert.equal('customer_number' in harness.inserts[0], false)
})

test('inspectors and admins without exact normalized admin scope cannot mutate', async () => {
  const cases = [
    serverHarness({ memberships: [membership(ORG_A, 'inspector', true, 'Org A')] }),
    serverHarness({
      assignments: [
        {
          productKey: 'dashboard',
          moduleKey: 'inspections',
          roleKey: 'inspector',
          scopeType: 'organization',
          scopeId: ORG_A,
        },
      ],
      memberships: [membership(ORG_A, 'admin', true, 'Org A')],
    }),
  ]

  for (const harness of cases) {
    await assert.rejects(
      harness.server.createOrganizationCustomer(ORG_A, businessInput()),
      { message: 'CUSTOMER_ORGANIZATION_ADMIN_REQUIRED' }
    )
    assert.equal(harness.inserts.length, 0)
  }
})

test('mutations reject missing, blank and malformed organization ids', async () => {
  const harness = serverHarness()

  for (const orgId of [undefined, null, '', 'not-a-uuid']) {
    await assert.rejects(
      harness.server.createOrganizationCustomer(orgId, businessInput()),
      { message: 'CUSTOMER_ORGANIZATION_INVALID' }
    )
  }
  assert.equal(harness.inserts.length, 0)
})
