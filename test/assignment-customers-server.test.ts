import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'
import type * as AssignmentCustomerDomain from '../src/lib/assignment-customers/domain'
import type * as AssignmentCustomerServer from '../src/lib/assignment-customers/server'
import type * as CustomerDomain from '../src/lib/customers/domain'
// @ts-expect-error Node's strip-types runner requires the source extension.
import * as fortnoxDomain from '../src/lib/fortnox/domain.ts'

const ORG_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_ORG_ID = '22222222-2222-4222-8222-222222222222'
const ASSIGNMENT_ID = '33333333-3333-4333-8333-333333333333'
const CUSTOMER_ID = '44444444-4444-4444-8444-444444444444'
const PROFILE_ID = '55555555-5555-4555-8555-555555555555'
const EXPECTED_UPDATED_AT = '2026-09-11T10:00:00.123456+02:00'
const RESULT_UPDATED_AT = '2026-09-11T10:00:01.123456+02:00'

function load<T>(file: string, dependencies: Record<string, unknown>): T {
  const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const compiled = { exports: {} }
  new Function('require', 'module', 'exports', output)(
    (name: string) => {
      if (name in dependencies) return dependencies[name]
      throw new Error(`Unexpected assignment-customer server dependency: ${name}`)
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

type HarnessOptions = {
  activeMember?: boolean
  normalizedOrgId?: string | null
  rpcCode?: string
  rpcError?: { code?: string; message?: string } | null
  rpcData?: unknown
}

function harness(options: HarnessOptions = {}) {
  const fromCalls: Array<{ table: string; filters: Array<[string, unknown]> }> = []
  const deleteCalls: Array<{ table: string; filters: Array<[string, unknown]> }> = []
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = []
  const normalizedOrgId =
    options.normalizedOrgId === undefined ? ORG_ID : options.normalizedOrgId
  const context = {
    identity: {
      userId: PROFILE_ID,
      profileId: PROFILE_ID,
      fullName: 'Besiktningsman',
      email: 'inspector@example.test',
      isLegacyAdmin: false,
    },
    assignments:
      normalizedOrgId === null
        ? []
        : [
            {
              productKey: 'dashboard',
              moduleKey: 'technical_investigations',
              roleKey: 'inspector',
              scopeType: 'organization',
              scopeId: normalizedOrgId,
            },
          ],
    normalizedAccessAvailable: normalizedOrgId !== null,
  }
  const resultCode = options.rpcCode ?? 'LINKED'
  const defaultData = [
    {
      result_code: resultCode,
      assignment_id: ASSIGNMENT_ID,
      organization_customer_id: CUSTOMER_ID,
      assignment_updated_at: RESULT_UPDATED_AT,
      customer_number: '1001',
      customer_version: 2,
      customer_created: resultCode === 'CREATED_AND_LINKED',
    },
  ]

  const admin = {
    from(table: string) {
      const filters: Array<[string, unknown]> = []
      let deleting = false
      const query = {
        select() {
          return query
        },
        delete() {
          deleting = true
          return query
        },
        eq(column: string, value: unknown) {
          filters.push([column, value])
          return query
        },
        is(column: string, value: unknown) {
          filters.push([column, value])
          return query
        },
        async maybeSingle() {
          if (deleting) {
            deleteCalls.push({ table, filters: [...filters] })
            return { data: { id: ASSIGNMENT_ID }, error: null }
          }
          fromCalls.push({ table, filters: [...filters] })
          return {
            data: options.activeMember === false ? null : { org_id: ORG_ID },
            error: null,
          }
        },
      }
      return query
    },
    async rpc(name: string, args: Record<string, unknown>) {
      rpcCalls.push({ name, args })
      return {
        data: options.rpcData === undefined ? defaultData : options.rpcData,
        error: options.rpcError ?? null,
      }
    },
  }

  const server = load<typeof AssignmentCustomerServer>(
    'src/lib/assignment-customers/server.ts',
    {
      'server-only': {},
      '@/lib/access/server': { requireProductAccess: async () => context },
      '@/lib/supabase/admin': { createSupabaseAdminClient: () => admin },
      './domain': domain,
    }
  )
  return { server, deleteCalls, fromCalls, rpcCalls }
}

test('an active TU inspector links an exact active, versioned customer', async () => {
  const candidate = harness()
  const result = await candidate.server.assignOrganizationCustomer(
    ORG_ID,
    ASSIGNMENT_ID,
    EXPECTED_UPDATED_AT,
    { mode: 'existing', customerId: CUSTOMER_ID, customerVersion: 1 }
  )

  assert.deepEqual(result, {
    assignmentId: ASSIGNMENT_ID,
    assignmentUpdatedAt: RESULT_UPDATED_AT,
    customer: {
      id: CUSTOMER_ID,
      customerNumber: '1001',
      version: 2,
      created: false,
    },
  })
  assert.deepEqual(candidate.rpcCalls, [
    {
      name: 'assign_organization_customer',
      args: {
        p_org_id: ORG_ID,
        p_assignment_id: ASSIGNMENT_ID,
        p_expected_assignment_updated_at: EXPECTED_UPDATED_AT,
        p_mode: 'existing',
        p_customer_id: CUSTOMER_ID,
        p_expected_customer_version: 1,
        p_customer_type: null,
        p_identity_number: null,
        p_actor_profile_id: PROFILE_ID,
      },
    },
  ])
  assert.deepEqual(candidate.fromCalls[0], {
    table: 'org_members',
    filters: [
      ['org_id', ORG_ID],
      ['profile_id', PROFILE_ID],
      ['is_active', true],
    ],
  })
})

test('create sends only canonical identity metadata and never contact matching fields', async () => {
  const candidate = harness({ rpcCode: 'CREATED_AND_LINKED' })
  const result = await candidate.server.assignOrganizationCustomer(
    ORG_ID,
    ASSIGNMENT_ID,
    EXPECTED_UPDATED_AT,
    {
      mode: 'create',
      customerType: 'business',
      identityNumber: '5561234567',
    }
  )

  assert.equal(result.customer.created, true)
  assert.deepEqual(candidate.rpcCalls[0].args, {
    p_org_id: ORG_ID,
    p_assignment_id: ASSIGNMENT_ID,
    p_expected_assignment_updated_at: EXPECTED_UPDATED_AT,
    p_mode: 'create',
    p_customer_id: null,
    p_expected_customer_version: null,
    p_customer_type: 'business',
    p_identity_number: '556123-4567',
    p_actor_profile_id: PROFILE_ID,
  })
  assert.equal('email' in candidate.rpcCalls[0].args, false)
  assert.equal('name' in candidate.rpcCalls[0].args, false)
})

test('membership and normalized organization scope are both fail-closed', async () => {
  const inactive = harness({ activeMember: false })
  await assert.rejects(
    inactive.server.assignOrganizationCustomer(
      ORG_ID,
      ASSIGNMENT_ID,
      EXPECTED_UPDATED_AT,
      { mode: 'existing', customerId: CUSTOMER_ID, customerVersion: 1 }
    ),
    { message: 'ASSIGNMENT_CUSTOMER_MEMBER_REQUIRED' }
  )
  assert.deepEqual(inactive.rpcCalls, [])

  const wrongScope = harness({ normalizedOrgId: OTHER_ORG_ID })
  await assert.rejects(
    wrongScope.server.assignOrganizationCustomer(
      ORG_ID,
      ASSIGNMENT_ID,
      EXPECTED_UPDATED_AT,
      { mode: 'existing', customerId: CUSTOMER_ID, customerVersion: 1 }
    ),
    { message: 'ASSIGNMENT_CUSTOMER_MEMBER_REQUIRED' }
  )
  assert.deepEqual(wrongScope.fromCalls, [])
  assert.deepEqual(wrongScope.rpcCalls, [])
})

test('SQL outcome codes become stable, non-diagnostic service errors', async () => {
  const cases = [
    ['ASSIGNMENT_VERSION_CONFLICT', 'ASSIGNMENT_CUSTOMER_ASSIGNMENT_VERSION_CONFLICT'],
    ['LINK_CONFLICT', 'ASSIGNMENT_CUSTOMER_LINK_CONFLICT'],
    ['CUSTOMER_NOT_FOUND', 'ASSIGNMENT_CUSTOMER_NOT_FOUND'],
    ['CUSTOMER_INACTIVE', 'ASSIGNMENT_CUSTOMER_INACTIVE'],
    ['CUSTOMER_VERSION_CONFLICT', 'ASSIGNMENT_CUSTOMER_VERSION_CONFLICT'],
    ['CUSTOMER_IDENTITY_CONFLICT', 'ASSIGNMENT_CUSTOMER_IDENTITY_CONFLICT'],
    ['CUSTOMER_EMAIL_REQUIRED', 'ASSIGNMENT_CUSTOMER_EMAIL_REQUIRED'],
    ['CUSTOMER_SNAPSHOT_INCOMPLETE', 'ASSIGNMENT_CUSTOMER_SNAPSHOT_INCOMPLETE'],
  ] as const

  for (const [rpcCode, expected] of cases) {
    const candidate = harness({ rpcCode })
    await assert.rejects(
      candidate.server.assignOrganizationCustomer(
        ORG_ID,
        ASSIGNMENT_ID,
        EXPECTED_UPDATED_AT,
        { mode: 'existing', customerId: CUSTOMER_ID, customerVersion: 1 }
      ),
      { message: expected }
    )
  }
})

test('idempotent ALREADY_LINKED succeeds while malformed RPC output fails closed', async () => {
  const retry = harness({ rpcCode: 'ALREADY_LINKED' })
  const result = await retry.server.assignOrganizationCustomer(
    ORG_ID,
    ASSIGNMENT_ID,
    EXPECTED_UPDATED_AT,
    { mode: 'create', customerType: 'private', identityNumber: null }
  )
  assert.equal(result.customer.id, CUSTOMER_ID)
  assert.equal(result.customer.created, false)

  for (const rpcData of [null, [], [{ result_code: 'SOMETHING_NEW' }], [{
    result_code: 'LINKED',
    assignment_id: OTHER_ORG_ID,
    organization_customer_id: CUSTOMER_ID,
    assignment_updated_at: RESULT_UPDATED_AT,
    customer_number: 1001,
    customer_version: 1,
    customer_created: false,
  }]]) {
    const malformed = harness({ rpcData })
    await assert.rejects(
      malformed.server.assignOrganizationCustomer(
        ORG_ID,
        ASSIGNMENT_ID,
        EXPECTED_UPDATED_AT,
        { mode: 'create', customerType: 'private', identityNumber: null }
      ),
      { message: 'ASSIGNMENT_CUSTOMER_DATABASE_FAILED' }
    )
  }
})

test('missing RPC schema is distinguishable without leaking database messages', async () => {
  const candidate = harness({
    rpcError: { code: 'PGRST202', message: 'secret SQL details' },
  })
  await assert.rejects(
    candidate.server.assignOrganizationCustomer(
      ORG_ID,
      ASSIGNMENT_ID,
      EXPECTED_UPDATED_AT,
      { mode: 'create', customerType: 'private', identityNumber: null }
    ),
    { message: 'ASSIGNMENT_CUSTOMERS_SCHEMA_REQUIRED' }
  )
})

test('failed module flows can discard only their unchanged, unlinked draft', async () => {
  const candidate = harness()
  const discarded = await candidate.server.discardUnlinkedAssignmentDraft(
    ORG_ID,
    ASSIGNMENT_ID,
    EXPECTED_UPDATED_AT
  )

  assert.equal(discarded, true)
  assert.deepEqual(candidate.deleteCalls, [{
    table: 'assignments',
    filters: [
      ['org_id', ORG_ID],
      ['id', ASSIGNMENT_ID],
      ['created_by', PROFILE_ID],
      ['status', 'draft'],
      ['updated_at', EXPECTED_UPDATED_AT],
      ['organization_customer_id', null],
    ],
  }])
})
