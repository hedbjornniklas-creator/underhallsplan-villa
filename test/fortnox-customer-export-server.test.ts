import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as nodeCrypto from 'node:crypto'
import ts from 'typescript'
// @ts-expect-error Node's strip-types runner requires the source extension.
import * as fortnoxDomain from '../src/lib/fortnox/domain.ts'
import type * as FortnoxServer from '../src/lib/fortnox/server'

function load<T>(file: string, dependencies: Record<string, unknown>): T {
  const code = ts.transpileModule(
    readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'),
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
const CUSTOMER_ID = '22222222-2222-4222-8222-222222222222'
const PROFILE_ID = '33333333-3333-4333-8333-333333333333'
const ORGANIZATION_NUMBER = '556123-4567'
const TENANT_ID = '123456'
const ACCESS_TOKEN = 'customer-access-token'
const CREATED_AT = '2026-09-10T08:00:00.000Z'
const UPDATED_AT = '2026-09-10T08:05:00.000Z'
const SYNCED_AT = '2026-09-10T09:00:00.000Z'

type CustomerRow = {
  id: string
  org_id: string
  customer_number: number
  customer_type: 'business' | 'private'
  name: string
  organization_number: string | null
  personal_identity_number: string | null
  email: string | null
  phone: string | null
  address: string | null
  address_line_2: string | null
  postal_code: string | null
  city: string | null
  country_code: string
  invoice_same_as_customer: boolean
  invoice_name: string | null
  invoice_email: string | null
  invoice_address: string | null
  invoice_address_line_2: string | null
  invoice_postal_code: string | null
  invoice_city: string | null
  invoice_country_code: string | null
  invoice_reference: string | null
  fortnox_tenant_id: string | null
  fortnox_customer_number: string | null
  fortnox_synced_at: string | null
  is_active: boolean
  version: number
  created_at: string
  updated_at: string
}

type HarnessOptions = {
  customer?: Partial<CustomerRow>
  moduleError?: string
  matches?: Array<{
    customerNumber: string
    externalReference: string | null
    organizationNumber: string | null
  }>
  fetchedCustomers?: Array<
    | {
        customerNumber: string
        externalReference: string | null
        organizationNumber: string | null
      }
    | null
  >
  createError?: string
  bindCode?: string
  connectionTenantId?: string
}

function exportHarness(options: HarnessOptions = {}) {
  const customer: CustomerRow = {
    id: CUSTOMER_ID,
    org_id: ORG_ID,
    customer_number: 1001,
    customer_type: 'private',
    name: 'Testkund Privat',
    organization_number: null,
    personal_identity_number: null,
    email: 'kund@example.test',
    phone: '0701234567',
    address: 'Testgatan 1',
    address_line_2: null,
    postal_code: '123 45',
    city: 'Stockholm',
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
    fortnox_tenant_id: null,
    fortnox_customer_number: null,
    fortnox_synced_at: null,
    is_active: true,
    version: 1,
    created_at: CREATED_AT,
    updated_at: UPDATED_AT,
    ...options.customer,
  }
  const membership = {
    org_id: ORG_ID,
    profile_id: PROFILE_ID,
    role: 'admin',
    is_active: true,
    is_default: true,
    created_at: CREATED_AT,
  }
  const organization = {
    id: ORG_ID,
    name: 'HusHub Test AB',
    organization_number: ORGANIZATION_NUMBER,
  }
  const connection = {
    org_id: ORG_ID,
    tenant_id: options.connectionTenantId ?? TENANT_ID,
    connection_version: 1,
    company_name: 'HusHub Test AB',
    company_organization_number: ORGANIZATION_NUMBER,
    granted_scopes: [...fortnoxDomain.FORTNOX_CONNECTION_SCOPES],
    status: 'connected',
    connected_at: CREATED_AT,
    last_verified_at: UPDATED_AT,
  }
  const context = {
    identity: {
      userId: PROFILE_ID,
      profileId: PROFILE_ID,
      fullName: 'Fortnox Admin',
      email: 'admin@example.test',
      isLegacyAdmin: false,
    },
    assignments: [],
    normalizedAccessAvailable: false,
  }
  const providerCalls: Array<{ name: string; input: unknown }> = []
  const databaseReads: Array<{ table: string; filters: Array<[string, unknown]> }> = []
  const rpcCalls: Array<{ name: string; input: Record<string, unknown> }> = []
  const fetchedCustomers = [...(options.fetchedCustomers ?? [null])]

  const admin = {
    from(table: string) {
      const filters: Array<[string, unknown]> = []
      const matchesFilters = (row: Record<string, unknown>) =>
        filters.every(([column, value]) => row[column] === value)
      const query = {
        select() {
          return query
        },
        eq(column: string, value: unknown) {
          filters.push([column, value])
          return query
        },
        async maybeSingle() {
          databaseReads.push({ table, filters: [...filters] })
          const row =
            table === 'org_members'
              ? membership
              : table === 'organizations'
                ? organization
                : table === 'fortnox_connections'
                  ? connection
                  : table === 'organization_customers'
                    ? customer
                    : null
          if (!row) throw new Error(`Unexpected table ${table}`)
          return {
            data: matchesFilters(row as Record<string, unknown>) ? { ...row } : null,
            error: null,
          }
        },
      }
      return query
    },
    async rpc(name: string, input: Record<string, unknown>) {
      rpcCalls.push({ name, input })
      if (name !== 'bind_organization_customer_to_fortnox') {
        throw new Error(`Unexpected RPC ${name}`)
      }
      const resultCode = options.bindCode ?? 'BOUND'
      if (resultCode !== 'BOUND' && resultCode !== 'ALREADY_BOUND') {
        return { data: [{ result_code: resultCode }], error: null }
      }
      customer.fortnox_tenant_id = String(input.p_tenant_id)
      customer.fortnox_customer_number = String(input.p_fortnox_customer_number)
      customer.fortnox_synced_at = SYNCED_AT
      customer.version += resultCode === 'BOUND' ? 1 : 0
      customer.updated_at = SYNCED_AT
      return {
        data: [
          {
            result_code: resultCode,
            customer_id: customer.id,
            bound_org_id: customer.org_id,
            bound_tenant_id: customer.fortnox_tenant_id,
            bound_fortnox_customer_number: customer.fortnox_customer_number,
            bound_at: customer.fortnox_synced_at,
            customer_version: customer.version,
            customer_updated_at: customer.updated_at,
          },
        ],
        error: null,
      }
    },
  }

  const provider = {
    getFortnoxConfiguration: () => ({
      clientId: 'client-id',
      clientSecret: 'client-secret',
      redirectUri: fortnoxDomain.FORTNOX_PRODUCTION_REDIRECT_URI,
    }),
    async requestFortnoxClientCredentialsToken(input: unknown) {
      providerCalls.push({ name: 'token', input })
      return {
        accessToken: ACCESS_TOKEN,
        scopes: ['companyinformation', 'customer'],
        expiresIn: 3600,
        tokenType: 'bearer' as const,
      }
    },
    async fetchFortnoxCompanyInformation(input: unknown) {
      providerCalls.push({ name: 'company', input })
      return {
        tenantId: TENANT_ID,
        companyName: 'HusHub Test AB',
        organizationNumber: ORGANIZATION_NUMBER,
      }
    },
    async findFortnoxCustomersByOrganizationNumber(...input: unknown[]) {
      providerCalls.push({ name: 'find', input })
      return options.matches ?? []
    },
    async fetchFortnoxCustomer(...input: unknown[]) {
      providerCalls.push({ name: 'fetch', input })
      return fetchedCustomers.shift() ?? null
    },
    async createFortnoxCustomer(...input: unknown[]) {
      providerCalls.push({ name: 'create', input })
      if (options.createError) throw new Error(options.createError)
      const draft = input[1] as {
        CustomerNumber: string
        ExternalReference: string
        OrganisationNumber?: string
      }
      return {
        customerNumber: draft.CustomerNumber,
        externalReference: draft.ExternalReference,
        organizationNumber: draft.OrganisationNumber ?? null,
      }
    },
  }

  const server = load<typeof FortnoxServer>('src/lib/fortnox/server.ts', {
    'server-only': {},
    'node:crypto': nodeCrypto,
    '@/lib/access/server': {
      requireProductAccess: async () => context,
      requireModuleAccess: async () => {
        if (options.moduleError) throw new Error(options.moduleError)
        return context
      },
    },
    '@/lib/supabase/admin': { createSupabaseAdminClient: () => admin },
    './domain': fortnoxDomain,
    './provider': provider,
  })

  return { server, customer, providerCalls, databaseReads, rpcCalls }
}

test('private customer export creates one deterministic Fortnox customer and binds it', async () => {
  const harness = exportHarness()

  const result = await harness.server.exportOrganizationCustomerToFortnox(
    ORG_ID,
    CUSTOMER_ID,
    1
  )

  assert.equal(result.fortnoxCustomerNumber, 'HH1001')
  assert.equal(result.version, 2)
  assert.equal(harness.providerCalls.filter((call) => call.name === 'find').length, 0)
  const createCall = harness.providerCalls.find((call) => call.name === 'create')
  assert.ok(createCall)
  const draft = (createCall.input as unknown[])[1] as Record<string, unknown>
  assert.deepEqual(draft, {
    Name: 'Testkund Privat',
    CustomerNumber: 'HH1001',
    ExternalReference: `HH${CUSTOMER_ID.replaceAll('-', '').toUpperCase()}`,
    Type: 'PRIVATE',
    Email: 'kund@example.test',
    EmailInvoice: 'kund@example.test',
    Phone1: '0701234567',
    Address1: 'Testgatan 1',
    ZipCode: '123 45',
    City: 'Stockholm',
    CountryCode: 'SE',
  })
  assert.equal(harness.rpcCalls.length, 1)
  assert.deepEqual(harness.rpcCalls[0], {
    name: 'bind_organization_customer_to_fortnox',
    input: {
      p_org_id: ORG_ID,
      p_customer_id: CUSTOMER_ID,
      p_expected_version: 1,
      p_profile_id: PROFILE_ID,
      p_tenant_id: TENANT_ID,
      p_fortnox_customer_number: 'HH1001',
    },
  })
})

test('an already linked customer is idempotent and performs no Fortnox API call', async () => {
  const harness = exportHarness({
    customer: {
      fortnox_tenant_id: TENANT_ID,
      fortnox_customer_number: 'HH1001',
      fortnox_synced_at: SYNCED_AT,
      version: 2,
    },
  })

  const result = await harness.server.exportOrganizationCustomerToFortnox(
    ORG_ID,
    CUSTOMER_ID,
    1
  )

  assert.equal(result.fortnoxCustomerNumber, 'HH1001')
  assert.equal(result.version, 2)
  assert.deepEqual(harness.providerCalls, [])
  assert.deepEqual(harness.rpcCalls, [])
})

test('a business customer reuses one exact organization-number match', async () => {
  const harness = exportHarness({
    customer: {
      customer_type: 'business',
      name: 'Kundbolaget AB',
      organization_number: ORGANIZATION_NUMBER,
    },
    matches: [
      {
        customerNumber: '77',
        externalReference: null,
        organizationNumber: ORGANIZATION_NUMBER,
      },
    ],
  })

  const result = await harness.server.exportOrganizationCustomerToFortnox(
    ORG_ID,
    CUSTOMER_ID,
    1
  )

  assert.equal(result.fortnoxCustomerNumber, '77')
  assert.equal(harness.providerCalls.filter((call) => call.name === 'find').length, 1)
  assert.equal(harness.providerCalls.filter((call) => call.name === 'create').length, 0)
})

test('ambiguous business matches stop before create and binding', async () => {
  const harness = exportHarness({
    customer: {
      customer_type: 'business',
      name: 'Kundbolaget AB',
      organization_number: ORGANIZATION_NUMBER,
    },
    matches: [
      {
        customerNumber: '77',
        externalReference: null,
        organizationNumber: ORGANIZATION_NUMBER,
      },
      {
        customerNumber: '88',
        externalReference: null,
        organizationNumber: ORGANIZATION_NUMBER,
      },
    ],
  })

  await assert.rejects(
    harness.server.exportOrganizationCustomerToFortnox(
      ORG_ID,
      CUSTOMER_ID,
      1
    ),
    /FORTNOX_CUSTOMER_MATCH_AMBIGUOUS/
  )
  assert.equal(harness.providerCalls.filter((call) => call.name === 'create').length, 0)
  assert.deepEqual(harness.rpcCalls, [])
})

test('an unknown create outcome is reconciled with the same deterministic number', async () => {
  const identity = fortnoxDomain.buildFortnoxCustomerIdentity(CUSTOMER_ID, 1001)
  const harness = exportHarness({
    fetchedCustomers: [
      null,
      {
        customerNumber: identity.customerNumber,
        externalReference: identity.externalReference,
        organizationNumber: null,
      },
    ],
    createError: 'FORTNOX_CUSTOMER_OUTCOME_UNKNOWN',
  })

  const result = await harness.server.exportOrganizationCustomerToFortnox(
    ORG_ID,
    CUSTOMER_ID,
    1
  )

  assert.equal(result.fortnoxCustomerNumber, 'HH1001')
  assert.equal(harness.providerCalls.filter((call) => call.name === 'create').length, 1)
  assert.equal(harness.providerCalls.filter((call) => call.name === 'fetch').length, 2)
})

test('stale customer data and lost admin access stop before all provider writes', async () => {
  const stale = exportHarness({ customer: { version: 2 } })
  await assert.rejects(
    stale.server.exportOrganizationCustomerToFortnox(ORG_ID, CUSTOMER_ID, 1),
    /FORTNOX_CUSTOMER_VERSION_CONFLICT/
  )
  assert.deepEqual(stale.providerCalls, [])

  const unauthorized = exportHarness({
    moduleError: 'FORTNOX_ORGANIZATION_ADMIN_REQUIRED',
  })
  await assert.rejects(
    unauthorized.server.exportOrganizationCustomerToFortnox(
      ORG_ID,
      CUSTOMER_ID,
      1
    ),
    /FORTNOX_ORGANIZATION_ADMIN_REQUIRED/
  )
  assert.deepEqual(unauthorized.providerCalls, [])
  assert.deepEqual(unauthorized.databaseReads, [])
})

test('a customer edit that wins the final race is not locally bound', async () => {
  const harness = exportHarness({ bindCode: 'VERSION_CONFLICT' })

  await assert.rejects(
    harness.server.exportOrganizationCustomerToFortnox(
      ORG_ID,
      CUSTOMER_ID,
      1
    ),
    /FORTNOX_CUSTOMER_VERSION_CONFLICT/
  )
  assert.equal(harness.providerCalls.filter((call) => call.name === 'create').length, 1)
  assert.equal(harness.rpcCalls.length, 1)
})
