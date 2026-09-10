import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync as readTextFileSync } from 'node:fs'
import * as nodeCrypto from 'node:crypto'
import ts from 'typescript'
// @ts-expect-error Node's strip-types runner requires the source extension.
import * as fortnoxDomain from '../src/lib/fortnox/domain.ts'
import type * as FortnoxServer from '../src/lib/fortnox/server'

function load<T>(file: string, dependencies: Record<string, unknown>): T {
  const code = ts.transpileModule(
    readTextFileSync(new URL(`../${file}`, import.meta.url), 'utf8'),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    }
  ).outputText
  const compiled = { exports: {} }

  new Function('require', 'module', 'exports', code)(
    (key: string) => {
      if (key in dependencies) return dependencies[key]
      throw new Error(`Unexpected dependency ${key}`)
    },
    compiled,
    compiled.exports
  )

  return compiled.exports as T
}

const ORG_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_ORG_ID = '22222222-2222-4222-8222-222222222222'
const PROFILE_ID = '33333333-3333-4333-8333-333333333333'
const OTHER_PROFILE_ID = '44444444-4444-4444-8444-444444444444'
const ORGANIZATION_NUMBER = '556123-4567'
const CALLBACK_STATE = 'state_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
const AUTHORIZATION_CODE = 'one-time-authorization-code'
const AUTHORIZATION_TOKEN = 'authorization-access-token'
const CLIENT_CREDENTIALS_TOKEN = 'client-credentials-access-token'
const CURRENT_SCOPES = ['companyinformation', 'customer', 'invoice']
const REAUTHORIZATION_ERRORS = [
  'FORTNOX_ACCESS_TOKEN_REJECTED',
  'FORTNOX_CLIENT_CREDENTIALS_REJECTED',
  'FORTNOX_COMPANY_VERIFICATION_FAILED',
  'FORTNOX_INVALID_TENANT',
  'FORTNOX_ORGANIZATION_MISMATCH',
  'FORTNOX_PERMISSION_OR_LICENSE_MISSING',
  'FORTNOX_REQUIRED_SCOPE_MISSING',
] as const

type Membership = {
  org_id: string
  profile_id: string
  role: 'admin' | 'inspector'
  is_active: boolean
  is_default: boolean
  created_at: string
}

type Organization = {
  id: string
  name: string
  organization_number: string | null
}

type Connection = {
  org_id: string
  tenant_id?: string
  connection_version?: number | string
  company_name: string
  company_organization_number: string
  granted_scopes: string[]
  status: 'connected' | 'needs_reauthorization'
  connected_at: string
  last_verified_at: string
}

type StateFixture = {
  profileId: string
  consumed?: boolean
  row: {
    org_id: string
    requested_scopes: string[]
  }
}

type HarnessOptions = {
  profileId?: string
  moduleError?: string
  memberships?: Membership[]
  organizations?: Organization[]
  connections?: Connection[]
  assignments?: Array<Record<string, unknown>>
  states?: Record<string, StateFixture>
  initialCompany?: {
    tenantId: string
    companyName: string
    organizationNumber: string
  }
  verifiedCompany?: {
    tenantId: string
    companyName: string
    organizationNumber: string
  }
  upsertError?: { code?: string; message?: string } | null
  saveResult?: boolean
  verificationResult?: boolean
  clientCredentialsError?: string
  companyError?: string
}

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

function serverHarness(options: HarnessOptions = {}) {
  const profileId = options.profileId ?? PROFILE_ID
  const context = {
    identity: {
      userId: profileId,
      profileId,
      fullName: 'Fortnox Admin',
      email: 'admin@example.test',
      isLegacyAdmin: false,
    },
    assignments: options.assignments ?? [],
    normalizedAccessAvailable: false,
  }
  const memberships = options.memberships ?? [
    {
      org_id: ORG_ID,
      profile_id: profileId,
      role: 'admin' as const,
      is_active: true,
      is_default: true,
      created_at: '2026-09-09T08:00:00.000Z',
    },
  ]
  const organizations = options.organizations ?? [
    {
      id: ORG_ID,
      name: 'HusHub Test AB',
      organization_number: ORGANIZATION_NUMBER,
    },
  ]
  const connections = options.connections ?? []
  const stateFixtures = new Map(
    Object.entries(options.states ?? {}).map(([state, fixture]) => [
      sha256(state),
      { ...fixture },
    ])
  )
  const configuration = {
    clientId: 'fortnox-client-id',
    clientSecret: 'fortnox-client-secret',
    redirectUri: fortnoxDomain.FORTNOX_PRODUCTION_REDIRECT_URI,
  }
  const defaultCompany = {
    tenantId: '123456',
    companyName: 'HusHub Test AB',
    organizationNumber: ORGANIZATION_NUMBER,
  }

  const moduleCalls: unknown[] = []
  const productCalls: unknown[] = []
  const databaseReads: Array<{
    table: string
    filters: Array<[string, unknown]>
  }> = []
  const listReads: Array<{
    table: string
    columns: string
    filters: Array<[string, unknown]>
    inFilters: Array<[string, unknown[]]>
    orders: Array<{
      column: string
      options?: { ascending?: boolean; nullsFirst?: boolean }
    }>
  }> = []
  const rpcCalls: Array<{ name: string; input: Record<string, unknown> }> = []
  const stateInserts: Record<string, unknown>[] = []
  const connectionUpserts: Array<{
    payload: Record<string, unknown>
    options: Record<string, unknown>
  }> = []
  const organizationUpdates: Array<{
    payload: Record<string, unknown>
    filters: Array<[string, unknown]>
  }> = []
  const connectionUpdates: Array<{
    payload: Record<string, unknown>
    filters: Array<[string, unknown]>
  }> = []
  const providerCalls: Array<{ name: string; input: unknown }> = []

  const admin = {
    from(table: string) {
      const filters: Array<[string, unknown]> = []
      const inFilters: Array<[string, unknown[]]> = []
      const orders: Array<{
        column: string
        options?: { ascending?: boolean; nullsFirst?: boolean }
      }> = []
      let columns = ''
      let updatePayload: Record<string, unknown> | null = null

      function matches(rowValue: object) {
        const row = rowValue as Record<string, unknown>
        return (
          filters.every(([column, value]) => row[column] === value) &&
          inFilters.every(([column, values]) => values.includes(row[column]))
        )
      }

      function sorted(rows: Array<Record<string, unknown>>) {
        return [...rows].sort((left, right) => {
          for (const order of orders) {
            const leftValue = String(left[order.column] ?? '')
            const rightValue = String(right[order.column] ?? '')
            if (leftValue === rightValue) continue
            const comparison = leftValue < rightValue ? -1 : 1
            return order.options?.ascending === false ? -comparison : comparison
          }
          return 0
        })
      }

      function listResult() {
        listReads.push({
          table,
          columns,
          filters: [...filters],
          inFilters: inFilters.map(([column, values]) => [column, [...values]]),
          orders: orders.map((order) => ({ ...order })),
        })

        const source: object[] =
          table === 'org_members'
            ? memberships
            : table === 'organizations'
              ? organizations
              : table === 'fortnox_connections'
                ? connections
                : []
        if (!source.length && !['org_members', 'organizations', 'fortnox_connections'].includes(table)) {
          throw new Error(`Unexpected list table ${table}`)
        }

        const rows = source
          .filter((row) => matches(row))
          .map((row) => ({ ...(row as Record<string, unknown>) }))
        return { data: sorted(rows), error: null }
      }

      function awaitedResult() {
        if (updatePayload) {
          if (table === 'organizations') {
            organizationUpdates.push({ payload: updatePayload, filters: [...filters] })
            return { data: null, error: null }
          }
          if (table === 'fortnox_connections') {
            connectionUpdates.push({ payload: updatePayload, filters: [...filters] })
            return { data: null, error: null }
          }
          throw new Error(`Unexpected update table ${table}`)
        }
        return listResult()
      }

      const query = {
        select(selectedColumns: string) {
          columns = selectedColumns
          return query
        },
        eq(column: string, value: unknown) {
          filters.push([column, value])
          return query
        },
        in(column: string, values: unknown[]) {
          inFilters.push([column, [...values]])
          return query
        },
        order(
          column: string,
          orderOptions?: { ascending?: boolean; nullsFirst?: boolean }
        ) {
          orders.push({ column, options: orderOptions })
          return query
        },
        update(payload: Record<string, unknown>) {
          updatePayload = payload
          return query
        },
        async maybeSingle() {
          databaseReads.push({ table, filters: [...filters] })
          if (table === 'org_members') {
            const row = memberships.find((membership) => matches(membership))
            return { data: row ?? null, error: null }
          }
          if (table === 'organizations') {
            const row = organizations.find((organization) => matches(organization))
            return { data: row ?? null, error: null }
          }
          if (table === 'fortnox_connections') {
            const row = connections.find((connection) => matches(connection))
            return {
              data: row
                ? { ...row, connection_version: row.connection_version ?? 1 }
                : null,
              error: null,
            }
          }
          throw new Error(`Unexpected maybeSingle table ${table}`)
        },
        async insert(payload: Record<string, unknown>) {
          if (table !== 'fortnox_oauth_states') {
            throw new Error(`Unexpected insert table ${table}`)
          }
          stateInserts.push(payload)
          return { error: null }
        },
        async upsert(payload: Record<string, unknown>, upsertOptions: Record<string, unknown>) {
          if (table !== 'fortnox_connections') {
            throw new Error(`Unexpected upsert table ${table}`)
          }
          connectionUpserts.push({ payload, options: upsertOptions })
          return { error: options.upsertError ?? null }
        },
        then<TResult1 = unknown, TResult2 = never>(
          onfulfilled?:
            | ((value: ReturnType<typeof awaitedResult>) => TResult1 | PromiseLike<TResult1>)
            | null,
          onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
        ) {
          return Promise.resolve(awaitedResult()).then(onfulfilled, onrejected)
        },
      }

      return query
    },
    async rpc(name: string, input: Record<string, unknown>) {
      rpcCalls.push({ name, input })

      if (name === 'create_fortnox_oauth_state') {
        for (const fixture of stateFixtures.values()) {
          if (fixture.row.org_id === input.p_org_id && !fixture.consumed) {
            fixture.consumed = true
          }
        }
        stateFixtures.set(String(input.p_state_hash), {
          profileId: String(input.p_profile_id),
          row: {
            org_id: String(input.p_org_id),
            requested_scopes: input.p_requested_scopes as string[],
          },
        })
        stateInserts.push({
          state_hash: input.p_state_hash,
          org_id: input.p_org_id,
          initiated_by_profile_id: input.p_profile_id,
          requested_scopes: input.p_requested_scopes,
          expires_at: input.p_expires_at,
        })
        return { data: null, error: null }
      }

      if (name === 'save_fortnox_connection_from_oauth_state') {
        const fixture = stateFixtures.get(String(input.p_state_hash))
        connectionUpserts.push({
          payload: {
            org_id: fixture?.row.org_id,
            tenant_id: input.p_tenant_id,
            company_name: input.p_company_name,
            company_organization_number: input.p_company_organization_number,
            granted_scopes: input.p_granted_scopes,
            status: 'connected',
            connected_by_profile_id: input.p_profile_id,
            connected_at: input.p_verified_at,
            last_verified_at: input.p_verified_at,
            last_error_code: null,
            last_error_at: null,
          },
          options: { onConflict: 'org_id' },
        })
        return {
          data: options.saveResult ?? true,
          error: options.upsertError ?? null,
        }
      }

      if (name === 'apply_fortnox_connection_verification') {
        const connection = connections.find(
          (candidate) =>
            candidate.org_id === input.p_org_id &&
            candidate.tenant_id === input.p_tenant_id &&
            Number(candidate.connection_version ?? 1) === Number(input.p_expected_version)
        )
        if (!connection || options.verificationResult === false) {
          return { data: [], error: null }
        }

        const mutable = connection as Connection & Record<string, unknown>
        const verifiedAt = '2026-09-09T10:00:00.000Z'
        if (input.p_error_code === null) {
          mutable.company_name = String(input.p_company_name)
          mutable.granted_scopes = input.p_granted_scopes as string[]
          mutable.status = 'connected'
          mutable.last_verified_at = verifiedAt
          mutable.last_error_code = null
          mutable.last_error_at = null
        } else {
          mutable.status = 'needs_reauthorization'
          mutable.last_error_code = input.p_error_code
          mutable.last_error_at = verifiedAt
        }
        mutable.connection_version = Number(connection.connection_version ?? 1) + 1

        return {
          data: [
            {
              company_name: connection.company_name,
              company_organization_number: connection.company_organization_number,
              granted_scopes: connection.granted_scopes,
              status: connection.status,
              connected_at: connection.connected_at,
              last_verified_at: connection.last_verified_at,
              connection_version: connection.connection_version,
            },
          ],
          error: null,
        }
      }

      if (name !== 'consume_fortnox_oauth_state') {
        throw new Error(`Unexpected RPC ${name}`)
      }

      const fixture = stateFixtures.get(String(input.p_state_hash))
      if (
        !fixture ||
        fixture.consumed ||
        fixture.profileId !== input.p_profile_id
      ) {
        return { data: [], error: null }
      }

      fixture.consumed = true
      return { data: [fixture.row], error: null }
    },
  }

  const provider = {
    getFortnoxConfiguration: () => configuration,
    isFortnoxConfigured: () => true,
    async exchangeFortnoxAuthorizationCode(input: unknown) {
      providerCalls.push({ name: 'exchange', input })
      return {
        accessToken: AUTHORIZATION_TOKEN,
        scopes: [...CURRENT_SCOPES],
        expiresIn: 3600,
        tokenType: 'bearer' as const,
      }
    },
    async requestFortnoxClientCredentialsToken(input: unknown) {
      providerCalls.push({ name: 'client_credentials', input })
      if (options.clientCredentialsError) {
        throw new Error(options.clientCredentialsError)
      }
      return {
        accessToken: CLIENT_CREDENTIALS_TOKEN,
        scopes: [...CURRENT_SCOPES],
        expiresIn: 3600,
        tokenType: 'bearer' as const,
      }
    },
    async fetchFortnoxCompanyInformation(accessToken: string) {
      providerCalls.push({ name: 'company', input: accessToken })
      if (options.companyError) throw new Error(options.companyError)
      return accessToken === AUTHORIZATION_TOKEN
        ? (options.initialCompany ?? defaultCompany)
        : (options.verifiedCompany ?? options.initialCompany ?? defaultCompany)
    },
  }

  const server = load<typeof FortnoxServer>('src/lib/fortnox/server.ts', {
    'server-only': {},
    'node:crypto': nodeCrypto,
    '@/lib/access/server': {
      requireProductAccess: async (productKey: unknown) => {
        productCalls.push(productKey)
        return context
      },
      requireModuleAccess: async (input: unknown) => {
        moduleCalls.push(input)
        if (options.moduleError) throw new Error(options.moduleError)
        return context
      },
    },
    '@/lib/supabase/admin': { createSupabaseAdminClient: () => admin },
    './domain': fortnoxDomain,
    './provider': provider,
  })

  return {
    server,
    configuration,
    moduleCalls,
    productCalls,
    databaseReads,
    listReads,
    rpcCalls,
    stateInserts,
    connectionUpserts,
    organizationUpdates,
    connectionUpdates,
    providerCalls,
  }
}

const exactAdminCheck = {
  productKey: 'dashboard',
  moduleKey: 'admin',
  scopeType: 'organization',
  scopeId: ORG_ID,
}

test('settings expose only active member organizations, safe status and fail-closed management rights', async () => {
  const inactiveOrgId = '55555555-5555-4555-8555-555555555555'
  const connectedAt = '2026-09-09T09:00:00.000Z'
  const verifiedAt = '2026-09-09T09:05:00.000Z'
  const harness = serverHarness({
    assignments: [
      {
        id: 'assignment-1',
        productId: 'dashboard-product',
        productKey: 'dashboard',
        productLabel: 'BesiktApp',
        moduleId: 'admin-module',
        moduleKey: 'admin',
        moduleLabel: 'Administration',
        roleId: 'dashboard-admin-role',
        roleKey: 'dashboard_admin',
        roleLabel: 'Dashboard admin',
        scopeType: 'organization',
        scopeId: ORG_ID,
        expiresAt: null,
      },
    ],
    memberships: [
      {
        org_id: ORG_ID,
        profile_id: PROFILE_ID,
        role: 'admin',
        is_active: true,
        is_default: false,
        created_at: '2026-09-09T08:00:00.000Z',
      },
      {
        org_id: OTHER_ORG_ID,
        profile_id: PROFILE_ID,
        role: 'admin',
        is_active: true,
        is_default: true,
        created_at: '2026-09-09T08:01:00.000Z',
      },
      {
        org_id: inactiveOrgId,
        profile_id: PROFILE_ID,
        role: 'admin',
        is_active: false,
        is_default: false,
        created_at: '2026-09-09T08:02:00.000Z',
      },
      {
        org_id: inactiveOrgId,
        profile_id: OTHER_PROFILE_ID,
        role: 'admin',
        is_active: true,
        is_default: true,
        created_at: '2026-09-09T08:03:00.000Z',
      },
    ],
    organizations: [
      { id: ORG_ID, name: 'Scoped Admin AB', organization_number: ORGANIZATION_NUMBER },
      { id: OTHER_ORG_ID, name: 'Default AB', organization_number: '556765-4321' },
      { id: inactiveOrgId, name: 'Hidden AB', organization_number: '556999-9999' },
    ],
    connections: [
      {
        org_id: OTHER_ORG_ID,
        tenant_id: 'must-not-be-exposed',
        company_name: 'Default Fortnox AB',
        company_organization_number: '556765-4321',
        granted_scopes: ['companyinformation'],
        status: 'connected',
        connected_at: connectedAt,
        last_verified_at: verifiedAt,
      },
      {
        org_id: inactiveOrgId,
        tenant_id: 'hidden-tenant',
        company_name: 'Hidden Fortnox AB',
        company_organization_number: '556999-9999',
        granted_scopes: ['companyinformation'],
        status: 'connected',
        connected_at: connectedAt,
        last_verified_at: verifiedAt,
      },
    ],
  })

  const settings = await harness.server.getFortnoxSettings()

  assert.deepEqual(harness.productCalls, ['dashboard'])
  assert.deepEqual(harness.moduleCalls, [])
  assert.deepEqual(settings, {
    configured: true,
    organizations: [
      {
        id: OTHER_ORG_ID,
        name: 'Default AB',
        organizationNumber: '556765-4321',
        isDefault: true,
        canManage: false,
        connection: {
          companyName: 'Default Fortnox AB',
          organizationNumber: '556765-4321',
          grantedScopes: ['companyinformation'],
          status: 'needs_reauthorization',
          connectedAt,
          lastVerifiedAt: verifiedAt,
        },
      },
      {
        id: ORG_ID,
        name: 'Scoped Admin AB',
        organizationNumber: ORGANIZATION_NUMBER,
        isDefault: false,
        canManage: true,
        connection: null,
      },
    ],
  })
  assert.equal(JSON.stringify(settings).includes('must-not-be-exposed'), false)
  assert.equal(JSON.stringify(settings).includes('hidden-tenant'), false)

  const membershipRead = harness.listReads.find((read) => read.table === 'org_members')
  assert.deepEqual(membershipRead, {
    table: 'org_members',
    columns: 'org_id,role,is_default,created_at',
    filters: [
      ['profile_id', PROFILE_ID],
      ['is_active', true],
    ],
    inFilters: [],
    orders: [
      { column: 'is_default', options: { ascending: false } },
      { column: 'created_at', options: { ascending: true } },
    ],
  })
  const connectionRead = harness.listReads.find(
    (read) => read.table === 'fortnox_connections'
  )
  assert.deepEqual(connectionRead?.inFilters, [['org_id', [OTHER_ORG_ID, ORG_ID]]])
  assert.equal(connectionRead?.columns.includes('tenant_id'), false)
})

test('organization number saves canonically and rejects invalid or connection-conflicting values', async () => {
  const canonical = serverHarness({
    organizations: [
      { id: ORG_ID, name: 'HusHub Test AB', organization_number: null },
    ],
  })
  assert.equal(
    await canonical.server.updateFortnoxOrganizationNumber(ORG_ID, ' 5561234567 '),
    ORGANIZATION_NUMBER
  )
  assert.deepEqual(canonical.moduleCalls, [exactAdminCheck])
  assert.deepEqual(canonical.organizationUpdates, [
    {
      payload: { organization_number: ORGANIZATION_NUMBER },
      filters: [['id', ORG_ID]],
    },
  ])

  for (const invalidValue of ['', '556123 4567', 'not-an-organization-number']) {
    const invalid = serverHarness()
    await assert.rejects(
      invalid.server.updateFortnoxOrganizationNumber(ORG_ID, invalidValue),
      /FORTNOX_ORGANIZATION_NUMBER_INVALID/
    )
    assert.equal(invalid.organizationUpdates.length, 0)
    assert.equal(
      invalid.databaseReads.some((read) => read.table === 'fortnox_connections'),
      false
    )
  }

  const locked = serverHarness({
    connections: [
      {
        org_id: ORG_ID,
        tenant_id: '123456',
        company_name: 'Already Connected AB',
        company_organization_number: '556765-4321',
        granted_scopes: [...CURRENT_SCOPES],
        status: 'connected',
        connected_at: '2026-09-09T09:00:00.000Z',
        last_verified_at: '2026-09-09T09:05:00.000Z',
      },
    ],
  })
  await assert.rejects(
    locked.server.updateFortnoxOrganizationNumber(ORG_ID, ORGANIZATION_NUMBER),
    /FORTNOX_ORGANIZATION_NUMBER_LOCKED/
  )
  assert.equal(locked.organizationUpdates.length, 0)
  assert.deepEqual(
    locked.databaseReads.find((read) => read.table === 'fortnox_connections'),
    { table: 'fortnox_connections', filters: [['org_id', ORG_ID]] }
  )
})

test('connection setup fails closed at both the module and exact active-admin boundaries', async () => {
  const deniedByModule = serverHarness({ moduleError: 'MODULE_ACCESS_REQUIRED' })
  await assert.rejects(
    deniedByModule.server.createFortnoxAuthorization(ORG_ID),
    /MODULE_ACCESS_REQUIRED/
  )
  assert.deepEqual(deniedByModule.moduleCalls, [exactAdminCheck])
  assert.equal(deniedByModule.databaseReads.length, 0)
  assert.equal(deniedByModule.stateInserts.length, 0)
  assert.equal(deniedByModule.providerCalls.length, 0)

  const deniedByMembership = serverHarness({
    memberships: [
      {
        org_id: OTHER_ORG_ID,
        profile_id: PROFILE_ID,
        role: 'admin',
        is_active: true,
        is_default: true,
        created_at: '2026-09-09T08:00:00.000Z',
      },
      {
        org_id: ORG_ID,
        profile_id: PROFILE_ID,
        role: 'admin',
        is_active: false,
        is_default: false,
        created_at: '2026-09-09T08:01:00.000Z',
      },
      {
        org_id: ORG_ID,
        profile_id: PROFILE_ID,
        role: 'inspector',
        is_active: true,
        is_default: false,
        created_at: '2026-09-09T08:02:00.000Z',
      },
    ],
  })
  await assert.rejects(
    deniedByMembership.server.createFortnoxAuthorization(ORG_ID),
    /FORTNOX_ORGANIZATION_ADMIN_REQUIRED/
  )
  assert.deepEqual(deniedByMembership.moduleCalls, [exactAdminCheck])
  assert.deepEqual(deniedByMembership.databaseReads, [
    {
      table: 'org_members',
      filters: [
        ['org_id', ORG_ID],
        ['profile_id', PROFILE_ID],
        ['is_active', true],
        ['role', 'admin'],
      ],
    },
  ])
  assert.equal(deniedByMembership.stateInserts.length, 0)
  assert.equal(deniedByMembership.providerCalls.length, 0)
})

test('live verification uses the stored TenantId and refreshes only safe connection metadata', async () => {
  const connectedAt = '2026-09-09T09:00:00.000Z'
  const harness = serverHarness({
    connections: [
      {
        org_id: ORG_ID,
        tenant_id: '123456',
        company_name: 'Old Company Name AB',
        company_organization_number: ORGANIZATION_NUMBER,
        granted_scopes: [...CURRENT_SCOPES],
        status: 'needs_reauthorization',
        connected_at: connectedAt,
        last_verified_at: '2026-09-09T09:05:00.000Z',
      },
    ],
    verifiedCompany: {
      tenantId: '123456',
      companyName: 'HusHub Test AB',
      organizationNumber: ORGANIZATION_NUMBER,
    },
  })

  const result = await harness.server.verifyFortnoxConnection(ORG_ID)

  assert.deepEqual(harness.moduleCalls, [exactAdminCheck, exactAdminCheck])
  assert.deepEqual(
    harness.providerCalls.map((call) => call.name),
    ['client_credentials', 'company']
  )
  assert.deepEqual(harness.providerCalls[0].input, {
    tenantId: '123456',
    requestedScopes: [...CURRENT_SCOPES],
    configuration: harness.configuration,
  })
  assert.equal(harness.providerCalls[1].input, CLIENT_CREDENTIALS_TOKEN)
  assert.equal(harness.connectionUpdates.length, 0)
  assert.deepEqual(
    harness.rpcCalls.find(
      (call) => call.name === 'apply_fortnox_connection_verification'
    ),
    {
      name: 'apply_fortnox_connection_verification',
      input: {
        p_org_id: ORG_ID,
        p_tenant_id: '123456',
        p_expected_version: 1,
        p_company_name: 'HusHub Test AB',
        p_granted_scopes: [...CURRENT_SCOPES],
        p_error_code: null,
      },
    }
  )
  assert.deepEqual(result, {
    companyName: 'HusHub Test AB',
    organizationNumber: ORGANIZATION_NUMBER,
    grantedScopes: [...CURRENT_SCOPES],
    status: 'connected',
    connectedAt,
    lastVerifiedAt: '2026-09-09T10:00:00.000Z',
  })

  const serializedResult = JSON.stringify(result)
  assert.equal(serializedResult.includes('123456'), false)
  assert.equal(serializedResult.includes(CLIENT_CREDENTIALS_TOKEN), false)
  assert.equal(serializedResult.includes(harness.configuration.clientSecret), false)
})

test('legacy identity-only connections require reauthorization before provider access', async () => {
  const connection: Connection = {
    org_id: ORG_ID,
    tenant_id: '123456',
    connection_version: 4,
    company_name: 'HusHub Test AB',
    company_organization_number: ORGANIZATION_NUMBER,
    granted_scopes: ['companyinformation'],
    status: 'connected',
    connected_at: '2026-09-09T09:00:00.000Z',
    last_verified_at: '2026-09-09T09:05:00.000Z',
  }
  const harness = serverHarness({ connections: [connection] })

  await assert.rejects(
    harness.server.verifyFortnoxConnection(ORG_ID),
    /FORTNOX_REQUIRED_SCOPE_MISSING/
  )

  assert.equal(harness.providerCalls.length, 0)
  assert.deepEqual(
    harness.rpcCalls.find(
      (call) => call.name === 'apply_fortnox_connection_verification'
    )?.input,
    {
      p_org_id: ORG_ID,
      p_tenant_id: '123456',
      p_expected_version: 4,
      p_company_name: null,
      p_granted_scopes: null,
      p_error_code: 'FORTNOX_REQUIRED_SCOPE_MISSING',
    }
  )
  assert.equal(connection.status, 'needs_reauthorization')
  assert.equal(connection.connection_version, 5)
})

test('live verification marks rejected credentials for reauthorization but leaves transient failures unchanged', async () => {
  const connectionFixture = (): Connection => ({
    org_id: ORG_ID,
    tenant_id: '123456',
    connection_version: 1,
    company_name: 'HusHub Test AB',
    company_organization_number: ORGANIZATION_NUMBER,
    granted_scopes: [...CURRENT_SCOPES],
    status: 'connected',
    connected_at: '2026-09-09T09:00:00.000Z',
    last_verified_at: '2026-09-09T09:05:00.000Z',
  })
  const rejectedConnection = connectionFixture()
  const rejected = serverHarness({
    connections: [rejectedConnection],
    clientCredentialsError: 'FORTNOX_CLIENT_CREDENTIALS_REJECTED',
  })

  await assert.rejects(
    rejected.server.verifyFortnoxConnection(ORG_ID),
    /FORTNOX_CLIENT_CREDENTIALS_REJECTED/
  )
  assert.equal(rejected.connectionUpdates.length, 0)
  assert.deepEqual(
    rejected.rpcCalls.find(
      (call) => call.name === 'apply_fortnox_connection_verification'
    ),
    {
      name: 'apply_fortnox_connection_verification',
      input: {
        p_org_id: ORG_ID,
        p_tenant_id: '123456',
        p_expected_version: 1,
        p_company_name: null,
        p_granted_scopes: null,
        p_error_code: 'FORTNOX_CLIENT_CREDENTIALS_REJECTED',
      },
    }
  )
  assert.equal(rejectedConnection.status, 'needs_reauthorization')
  assert.equal(rejectedConnection.connection_version, 2)

  const transientConnection = connectionFixture()
  const transient = serverHarness({
    connections: [transientConnection],
    clientCredentialsError: 'FORTNOX_TEMPORARILY_UNAVAILABLE',
  })
  await assert.rejects(
    transient.server.verifyFortnoxConnection(ORG_ID),
    /FORTNOX_TEMPORARILY_UNAVAILABLE/
  )
  assert.equal(transient.connectionUpdates.length, 0)
  assert.equal(
    transient.rpcCalls.some(
      (call) => call.name === 'apply_fortnox_connection_verification'
    ),
    false
  )
  assert.deepEqual(transientConnection, connectionFixture())

  const missing = serverHarness()
  await assert.rejects(
    missing.server.verifyFortnoxConnection(ORG_ID),
    /FORTNOX_CONNECTION_NOT_FOUND/
  )
  assert.equal(missing.providerCalls.length, 0)
  assert.equal(missing.connectionUpdates.length, 0)
})

test('live verification fails closed when a newer connection version wins the race', async () => {
  const connection: Connection = {
    org_id: ORG_ID,
    tenant_id: '123456',
    connection_version: 7,
    company_name: 'HusHub Test AB',
    company_organization_number: ORGANIZATION_NUMBER,
    granted_scopes: [...CURRENT_SCOPES],
    status: 'connected',
    connected_at: '2026-09-09T09:00:00.000Z',
    last_verified_at: '2026-09-09T09:05:00.000Z',
  }
  const harness = serverHarness({
    connections: [connection],
    verificationResult: false,
  })

  await assert.rejects(
    harness.server.verifyFortnoxConnection(ORG_ID),
    /FORTNOX_VERIFICATION_SUPERSEDED/
  )
  assert.deepEqual(harness.moduleCalls, [exactAdminCheck, exactAdminCheck])
  assert.deepEqual(
    harness.rpcCalls.find(
      (call) => call.name === 'apply_fortnox_connection_verification'
    )?.input,
    {
      p_org_id: ORG_ID,
      p_tenant_id: '123456',
      p_expected_version: 7,
      p_company_name: 'HusHub Test AB',
      p_granted_scopes: [...CURRENT_SCOPES],
      p_error_code: null,
    }
  )
  assert.equal(connection.connection_version, 7)
  assert.equal(connection.last_verified_at, '2026-09-09T09:05:00.000Z')
})

test('every permanent connection error uses the versioned reauthorization RPC contract', async () => {
  for (const errorCode of REAUTHORIZATION_ERRORS) {
    const connection: Connection = {
      org_id: ORG_ID,
      tenant_id: '123456',
      connection_version: 11,
      company_name: 'HusHub Test AB',
      company_organization_number: ORGANIZATION_NUMBER,
      granted_scopes: [...CURRENT_SCOPES],
      status: 'connected',
      connected_at: '2026-09-09T09:00:00.000Z',
      last_verified_at: '2026-09-09T09:05:00.000Z',
    }
    const harness = serverHarness({
      connections: [connection],
      clientCredentialsError: errorCode,
    })

    await assert.rejects(
      harness.server.verifyFortnoxConnection(ORG_ID),
      new RegExp(errorCode)
    )
    const applyCalls = harness.rpcCalls.filter(
      (call) => call.name === 'apply_fortnox_connection_verification'
    )
    assert.equal(applyCalls.length, 1, errorCode)
    assert.deepEqual(applyCalls[0].input, {
      p_org_id: ORG_ID,
      p_tenant_id: '123456',
      p_expected_version: 11,
      p_company_name: null,
      p_granted_scopes: null,
      p_error_code: errorCode,
    })
    assert.equal(connection.status, 'needs_reauthorization')
    assert.equal(connection.connection_version, 12)
  }
})

test('authorization state is random in the URL and persisted only as a profile-bound hash', async () => {
  const harness = serverHarness()
  const startedAt = Date.now()
  const authorizationUrl = new URL(
    await harness.server.createFortnoxAuthorization(ORG_ID)
  )
  const finishedAt = Date.now()
  const state = authorizationUrl.searchParams.get('state')

  assert.ok(state)
  assert.match(state, /^[A-Za-z0-9_-]{43}$/)
  assert.equal(harness.stateInserts.length, 1)

  const persisted = harness.stateInserts[0]
  assert.deepEqual(Object.keys(persisted).sort(), [
    'expires_at',
    'initiated_by_profile_id',
    'org_id',
    'requested_scopes',
    'state_hash',
  ])
  assert.equal(persisted.state_hash, sha256(state))
  assert.notEqual(persisted.state_hash, state)
  assert.equal(persisted.org_id, ORG_ID)
  assert.equal(persisted.initiated_by_profile_id, PROFILE_ID)
  assert.deepEqual(persisted.requested_scopes, CURRENT_SCOPES)
  assert.ok(
    new Date(String(persisted.expires_at)).getTime() >= startedAt + 10 * 60 * 1000
  )
  assert.ok(
    new Date(String(persisted.expires_at)).getTime() <= finishedAt + 10 * 60 * 1000
  )
  assert.doesNotMatch(JSON.stringify(persisted), new RegExp(state))
  assert.doesNotMatch(JSON.stringify(persisted), /fortnox-client-secret/)
  assert.equal(authorizationUrl.toString().includes(harness.configuration.clientSecret), false)
})

test('callback state is validated and atomically consumed for the current profile before provider calls', async () => {
  const malformed = serverHarness()
  await assert.rejects(
    malformed.server.completeFortnoxAuthorization({ state: 'too-short', code: AUTHORIZATION_CODE }),
    /FORTNOX_STATE_INVALID/
  )
  assert.equal(malformed.productCalls.length, 0)
  assert.equal(malformed.rpcCalls.length, 0)
  assert.equal(malformed.providerCalls.length, 0)

  const wrongProfile = serverHarness({
    states: {
      [CALLBACK_STATE]: {
        profileId: OTHER_PROFILE_ID,
        row: { org_id: ORG_ID, requested_scopes: [...CURRENT_SCOPES] },
      },
    },
  })
  await assert.rejects(
    wrongProfile.server.completeFortnoxAuthorization({
      state: CALLBACK_STATE,
      code: AUTHORIZATION_CODE,
    }),
    /FORTNOX_STATE_INVALID/
  )
  assert.deepEqual(wrongProfile.productCalls, ['dashboard'])
  assert.deepEqual(wrongProfile.rpcCalls, [
    {
      name: 'consume_fortnox_oauth_state',
      input: {
        p_state_hash: sha256(CALLBACK_STATE),
        p_profile_id: PROFILE_ID,
      },
    },
  ])
  assert.equal(wrongProfile.moduleCalls.length, 0)
  assert.equal(wrongProfile.providerCalls.length, 0)
  assert.equal(wrongProfile.connectionUpserts.length, 0)

  const legacyState = serverHarness({
    states: {
      [CALLBACK_STATE]: {
        profileId: PROFILE_ID,
        row: { org_id: ORG_ID, requested_scopes: ['companyinformation'] },
      },
    },
  })
  await assert.rejects(
    legacyState.server.completeFortnoxAuthorization({
      state: CALLBACK_STATE,
      code: AUTHORIZATION_CODE,
    }),
    /FORTNOX_STATE_INVALID/
  )
  assert.equal(legacyState.providerCalls.length, 0)
  assert.equal(legacyState.connectionUpserts.length, 0)

  const cancelled = serverHarness({
    states: {
      [CALLBACK_STATE]: {
        profileId: PROFILE_ID,
        row: { org_id: ORG_ID, requested_scopes: [...CURRENT_SCOPES] },
      },
    },
  })
  let cancelledError: unknown
  try {
    await cancelled.server.completeFortnoxAuthorization({
      state: CALLBACK_STATE,
      providerError: 'access_denied',
    })
  } catch (error) {
    cancelledError = error
  }
  assert.match(String(cancelledError), /FORTNOX_AUTHORIZATION_CANCELLED/)
  assert.equal(
    cancelled.server.fortnoxCallbackFailureOrganizationId(cancelledError),
    ORG_ID
  )
  assert.equal(cancelled.providerCalls.length, 0)

  for (const providerError of ['error_missing_license', 'error_missing_app_license']) {
    const missingLicense = serverHarness({
      states: {
        [CALLBACK_STATE]: {
          profileId: PROFILE_ID,
          row: { org_id: ORG_ID, requested_scopes: [...CURRENT_SCOPES] },
        },
      },
    })
    await assert.rejects(
      missingLicense.server.completeFortnoxAuthorization({
        state: CALLBACK_STATE,
        providerError,
      }),
      /FORTNOX_PERMISSION_OR_LICENSE_MISSING/
    )
    assert.equal(missingLicense.providerCalls.length, 0)
  }
})

test('successful callback verifies both grants and persists one safe connection without credentials', async () => {
  const harness = serverHarness({
    states: {
      [CALLBACK_STATE]: {
        profileId: PROFILE_ID,
        row: { org_id: ORG_ID, requested_scopes: [...CURRENT_SCOPES] },
      },
    },
  })

  const result = await harness.server.completeFortnoxAuthorization({
    state: CALLBACK_STATE,
    code: AUTHORIZATION_CODE,
  })

  assert.deepEqual(harness.moduleCalls, [exactAdminCheck, exactAdminCheck])
  assert.deepEqual(harness.databaseReads[0], {
    table: 'org_members',
    filters: [
      ['org_id', ORG_ID],
      ['profile_id', PROFILE_ID],
      ['is_active', true],
      ['role', 'admin'],
    ],
  })
  assert.deepEqual(
    harness.providerCalls.map((call) => call.name),
    ['exchange', 'company', 'client_credentials', 'company']
  )
  assert.deepEqual(harness.providerCalls[0].input, {
    code: AUTHORIZATION_CODE,
    requestedScopes: [...CURRENT_SCOPES],
    configuration: harness.configuration,
  })
  assert.equal(harness.providerCalls[1].input, AUTHORIZATION_TOKEN)
  assert.deepEqual(harness.providerCalls[2].input, {
    tenantId: '123456',
    requestedScopes: [...CURRENT_SCOPES],
    configuration: harness.configuration,
  })
  assert.equal(harness.providerCalls[3].input, CLIENT_CREDENTIALS_TOKEN)

  assert.equal(harness.connectionUpserts.length, 1)
  const upsert = harness.connectionUpserts[0]
  assert.deepEqual(upsert.options, { onConflict: 'org_id' })
  assert.deepEqual(Object.keys(upsert.payload).sort(), [
    'company_name',
    'company_organization_number',
    'connected_at',
    'connected_by_profile_id',
    'granted_scopes',
    'last_error_at',
    'last_error_code',
    'last_verified_at',
    'org_id',
    'status',
    'tenant_id',
  ])
  assert.equal(upsert.payload.org_id, ORG_ID)
  assert.equal(upsert.payload.tenant_id, '123456')
  assert.equal(upsert.payload.company_name, 'HusHub Test AB')
  assert.equal(upsert.payload.company_organization_number, ORGANIZATION_NUMBER)
  assert.deepEqual(upsert.payload.granted_scopes, CURRENT_SCOPES)
  assert.equal(upsert.payload.status, 'connected')
  assert.equal(upsert.payload.connected_by_profile_id, PROFILE_ID)
  assert.equal(upsert.payload.connected_at, upsert.payload.last_verified_at)
  assert.equal(upsert.payload.last_error_code, null)
  assert.equal(upsert.payload.last_error_at, null)

  const serialized = JSON.stringify(upsert)
  for (const secret of [
    CALLBACK_STATE,
    sha256(CALLBACK_STATE),
    AUTHORIZATION_CODE,
    AUTHORIZATION_TOKEN,
    CLIENT_CREDENTIALS_TOKEN,
    harness.configuration.clientSecret,
  ]) {
    assert.equal(serialized.includes(secret), false, `${secret} must not be persisted`)
  }
  assert.deepEqual(result, {
    orgId: ORG_ID,
    companyName: 'HusHub Test AB',
    organizationNumber: ORGANIZATION_NUMBER,
    grantedScopes: [...CURRENT_SCOPES],
    status: 'connected',
    connectedAt: upsert.payload.connected_at,
    lastVerifiedAt: upsert.payload.last_verified_at,
  })

  const providerCallCount = harness.providerCalls.length
  await assert.rejects(
    harness.server.completeFortnoxAuthorization({
      state: CALLBACK_STATE,
      code: AUTHORIZATION_CODE,
    }),
    /FORTNOX_STATE_INVALID/
  )
  assert.equal(harness.providerCalls.length, providerCallCount)
  assert.equal(harness.connectionUpserts.length, 1)
})

test('organization mismatch aborts before client credentials or persistence', async () => {
  const harness = serverHarness({
    states: {
      [CALLBACK_STATE]: {
        profileId: PROFILE_ID,
        row: { org_id: ORG_ID, requested_scopes: [...CURRENT_SCOPES] },
      },
    },
    initialCompany: {
      tenantId: '123456',
      companyName: 'Another Company AB',
      organizationNumber: '556765-4321',
    },
  })

  await assert.rejects(
    harness.server.completeFortnoxAuthorization({
      state: CALLBACK_STATE,
      code: AUTHORIZATION_CODE,
    }),
    /FORTNOX_ORGANIZATION_MISMATCH/
  )
  assert.deepEqual(
    harness.providerCalls.map((call) => call.name),
    ['exchange', 'company']
  )
  assert.equal(harness.connectionUpserts.length, 0)
})

test('a TenantId uniqueness conflict is reported without a second or credential-bearing write', async () => {
  const harness = serverHarness({
    states: {
      [CALLBACK_STATE]: {
        profileId: PROFILE_ID,
        row: { org_id: ORG_ID, requested_scopes: [...CURRENT_SCOPES] },
      },
    },
    upsertError: { code: '23505', message: 'unique violation' },
  })

  await assert.rejects(
    harness.server.completeFortnoxAuthorization({
      state: CALLBACK_STATE,
      code: AUTHORIZATION_CODE,
    }),
    /FORTNOX_TENANT_ALREADY_CONNECTED/
  )
  assert.equal(harness.connectionUpserts.length, 1)
  const serialized = JSON.stringify(harness.connectionUpserts[0])
  for (const secret of [
    CALLBACK_STATE,
    AUTHORIZATION_CODE,
    AUTHORIZATION_TOKEN,
    CLIENT_CREDENTIALS_TOKEN,
    harness.configuration.clientSecret,
  ]) {
    assert.equal(serialized.includes(secret), false)
  }
})

test('a superseded OAuth attempt fails closed without exposing callback credentials', async () => {
  const harness = serverHarness({
    states: {
      [CALLBACK_STATE]: {
        profileId: PROFILE_ID,
        row: { org_id: ORG_ID, requested_scopes: [...CURRENT_SCOPES] },
      },
    },
    saveResult: false,
  })

  let callbackError: unknown
  try {
    await harness.server.completeFortnoxAuthorization({
      state: CALLBACK_STATE,
      code: AUTHORIZATION_CODE,
    })
  } catch (error) {
    callbackError = error
  }

  assert.match(String(callbackError), /FORTNOX_AUTHORIZATION_SUPERSEDED/)
  assert.equal(
    harness.server.fortnoxCallbackFailureOrganizationId(callbackError),
    ORG_ID
  )
  assert.deepEqual(
    harness.providerCalls.map((call) => call.name),
    ['exchange', 'company', 'client_credentials', 'company']
  )

  const saveCalls = harness.rpcCalls.filter(
    (call) => call.name === 'save_fortnox_connection_from_oauth_state'
  )
  assert.equal(saveCalls.length, 1)
  assert.equal(harness.connectionUpserts.length, 1)

  const externallyVisibleFailure = String(callbackError)
  const persistencePayload = JSON.stringify(harness.connectionUpserts[0])
  for (const secret of [
    CALLBACK_STATE,
    sha256(CALLBACK_STATE),
    AUTHORIZATION_CODE,
    AUTHORIZATION_TOKEN,
    CLIENT_CREDENTIALS_TOKEN,
    harness.configuration.clientSecret,
  ]) {
    assert.equal(externallyVisibleFailure.includes(secret), false)
    assert.equal(persistencePayload.includes(secret), false)
  }
})
