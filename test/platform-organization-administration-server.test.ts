import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

const ORG = '11111111-1111-4111-8111-111111111111'
const OTHER_ORG = '22222222-2222-4222-8222-222222222222'
const ACTOR = '33333333-3333-4333-8333-333333333333'
const MEMBER = '44444444-4444-4444-8444-444444444444'
const REQUEST = '55555555-5555-4555-8555-555555555555'
const OB = 'inspections'
const TU = 'technical_investigations'
const permission = { productKey: 'hushub_admin', moduleKey: 'access_management', scopeType: 'global' }
const createDraft = () => ({ moduleSetVersion: 2, requestId: REQUEST, name: ' Exempel AB ', organizationNumber: '559281-0823', adminProfileId: MEMBER, modules: [TU] })
const modulesDraft = () => ({ moduleSetVersion: 2, expectedModules: [TU], modules: [] })
const memberDraft = () => ({ moduleSetVersion: 2, profileId: MEMBER, expected: null, role: 'inspector', isActive: true, modules: [TU] })

function load<T>(file: string, dependencies: Record<string, unknown>): T {
  const output = ts.transpileModule(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), {
    fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const compiled = { exports: {} }
  new Function('require', 'module', 'exports', output)((name: string) => {
    if (name in dependencies) return dependencies[name]
    throw new Error(`Unexpected platform organization dependency: ${name}`)
  }, compiled, compiled.exports)
  return compiled.exports as T
}

type Domain = {
  listPlatformOrganizations: () => Promise<unknown>
  getPlatformOrganization: (orgId: unknown) => Promise<Record<string, unknown>>
  createPlatformOrganization: (values: unknown) => Promise<unknown>
  savePlatformOrganizationModules: (orgId: unknown, values: unknown) => Promise<unknown>
  savePlatformOrganizationMember: (orgId: unknown, values: unknown) => Promise<unknown>
}
type Query = { table: string; ops: { name: string; args: unknown[] }[] }
type Result = { data: unknown; error: { code?: string; message?: string } | null }
type Row = Record<string, unknown>

const http = load<Record<string, unknown>>('src/lib/organizations/administrationHttp.ts', {})
const fortnox = load<Record<string, unknown>>('src/lib/fortnox/domain.ts', {})
const supportedModules = load<Record<string, unknown>>('src/lib/organizations/supportedModules.ts', {})
const parsers = load<Record<string, unknown>>('src/lib/organizations/platformAdministrationTypes.ts', {
  '@/lib/organizations/administrationHttp': http, './administrationHttp': http,
  '@/lib/fortnox/domain': fortnox,
  '@/lib/organizations/supportedModules': supportedModules,
})

function harness(options: {
  denied?: string
  authorize?: (input: unknown) => Promise<unknown>
  query?: (call: Query) => Result
  rpc?: (name: string, values: Record<string, unknown>) => Result
} = {}) {
  const calls = {
    permissions: [] as unknown[], events: [] as string[], queries: [] as Query[],
    rpcs: [] as { name: string; values: Record<string, unknown> }[],
  }
  const organization = { id: ORG, name: 'Exempel AB', organization_number: '5592810823', customer_number: 1001,
    created_at: '2026-10-02T00:00:00.000Z', profile_configured: false }
  const member = { org_id: ORG, profile_id: MEMBER, role: 'admin', is_active: true, is_default: false,
    profile: { full_name: 'Anna Medlem', email: 'anna@example.test' } }
  const db = {
    from(table: string) {
      calls.events.push(`query:${table}`)
      const call: Query = { table, ops: [] }
      calls.queries.push(call)
      const builder: Record<string, unknown> = {}
      for (const name of ['select', 'eq', 'in', 'order', 'limit', 'range', 'not', 'or']) {
        builder[name] = (...args: unknown[]) => { call.ops.push({ name, args }); return builder }
      }
      const run = (single = false): Result => {
        if (options.query) return options.query(call)
        const rows = table === 'organizations' ? [organization]
          : table === 'org_members' ? [member]
          : table === 'organization_enabled_modules' ? [{ org_id: ORG, module_key: TU, is_active: true }]
          : table === 'profiles' ? [{ id: MEMBER, full_name: 'Anna Medlem', email: 'anna@example.test' }]
          : []
        return { data: single ? rows[0] ?? null : rows, error: null }
      }
      builder.maybeSingle = async () => run(true)
      builder.single = async () => run(true)
      builder.then = (resolve: (value: Result) => unknown, reject: (error: unknown) => unknown) => Promise.resolve().then(() => run()).then(resolve, reject)
      return builder
    },
    async rpc(name: string, values: Record<string, unknown>) {
      calls.events.push(`rpc:${name}`)
      calls.rpcs.push({ name, values })
      return options.rpc?.(name, values) ?? { data: { saved: true, organizationId: ORG }, error: null }
    },
  }
  const domain = load<Domain>('src/lib/organizations/platformAdministration.ts', {
    'server-only': {},
    '@/lib/access/server': { requireModuleAccess: async (input: unknown) => {
      calls.events.push('permission')
      calls.permissions.push(input)
      if (options.denied) throw new Error(options.denied)
      if (options.authorize) return options.authorize(input)
      return { identity: { profileId: ACTOR }, assignments: [], normalizedAccessAvailable: true }
    } },
    '@/lib/supabase/admin': { createSupabaseAdminClient: () => { calls.events.push('admin-client'); return db } },
    '@/lib/organizations/administrationHttp': http, './administrationHttp': http,
    '@/lib/organizations/platformAdministrationTypes': parsers, './platformAdministrationTypes': parsers,
    '@/lib/organizations/supportedModules': supportedModules,
  })
  return { domain, calls, organization, member }
}

const operations = [
  (domain: Domain) => domain.listPlatformOrganizations(),
  (domain: Domain) => domain.getPlatformOrganization(ORG),
  (domain: Domain) => domain.createPlatformOrganization(createDraft()),
  (domain: Domain) => domain.savePlatformOrganizationModules(ORG, modulesDraft()),
  (domain: Domain) => domain.savePlatformOrganizationMember(ORG, memberDraft()),
]

test('all central organization operations require global HusHub access management before opening a privileged client', async () => {
  for (const denied of ['UNAUTHORIZED', 'MODULE_ACCESS_REQUIRED']) {
    for (const run of operations) {
      const { domain, calls } = harness({ denied })
      await assert.rejects(run(domain), { message: denied })
      assert.deepEqual(calls.permissions, [permission])
      assert.deepEqual(calls.events, ['permission'])
      assert.deepEqual(calls.queries, [])
      assert.deepEqual(calls.rpcs, [])
    }
  }
})

test('creation derives the actor from authentication and delegates one atomic organization bootstrap to SQL', async () => {
  const { domain, calls } = harness()
  await domain.createPlatformOrganization(createDraft())
  assert.deepEqual(calls.permissions[0], permission)
  assert.equal(calls.events[0], 'permission')
  assert.deepEqual(calls.rpcs, [{ name: 'platform_organization_create', values: {
    p_actor: ACTOR, p_request_id: REQUEST,
    p_values: { name: 'Exempel AB', organizationNumber: '559281-0823', adminProfileId: MEMBER, modules: [TU] },
  } }])
})

test('module saves pass both exact organization and optimistic expected modules to SQL', async () => {
  const { domain, calls } = harness()
  await domain.savePlatformOrganizationModules(ORG, modulesDraft())
  assert.equal(calls.events[0], 'permission')
  assert.deepEqual(calls.rpcs, [{ name: 'platform_organization_modules_save', values: {
    p_actor: ACTOR, p_org: ORG, p_expected: [TU], p_modules: [],
  } }])
})

test('member saves distinguish new membership from an optimistic edit without accepting a caller actor', async () => {
  const { domain, calls } = harness()
  await domain.savePlatformOrganizationMember(ORG, memberDraft())
  const expected = { role: 'inspector', isActive: true, modules: [TU] }
  await domain.savePlatformOrganizationMember(ORG, { ...memberDraft(), expected, role: 'admin' })
  assert.deepEqual(calls.rpcs, [
    { name: 'platform_organization_member_save', values: { p_actor: ACTOR, p_org: ORG, p_profile: MEMBER,
      p_expected: null, p_values: { role: 'inspector', isActive: true, modules: [TU] } } },
    { name: 'platform_organization_member_save', values: { p_actor: ACTOR, p_org: ORG, p_profile: MEMBER,
      p_expected: expected, p_values: { role: 'admin', isActive: true, modules: [TU] } } },
  ])
})

test('creation validates exact shape, IDs, company identity and the OB/TU-only module rollout', async () => {
  const invalid = [
    null, [], { moduleSetVersion: 2 }, { ...createDraft(), requestId: 'not-a-uuid' }, { ...createDraft(), adminProfileId: OTHER_ORG + 'junk' },
    { ...createDraft(), actorProfileId: ACTOR }, { ...createDraft(), p_actor: ACTOR },
    { ...createDraft(), name: ' ' }, { ...createDraft(), name: 'Company\u0000Name' },
    { ...createDraft(), organizationNumber: 5592810823 }, { ...createDraft(), organizationNumber: '559281082' },
    { ...createDraft(), modules: ['construction_inspections'] }, { ...createDraft(), modules: [TU, TU] }, { ...createDraft(), modules: [OB, OB] },
    { ...createDraft(), modules: [OB, TU, OB] }, { ...createDraft(), modules: [OB, null] }, { ...createDraft(), modules: TU },
  ]
  for (const values of invalid) {
    const { domain, calls } = harness()
    await assert.rejects(domain.createPlatformOrganization(values), { message: 'ORG_INPUT_INVALID' })
    assert.deepEqual(calls.rpcs, [])
  }
})

test('creation, entitlement and member mutations normalize OB and TU sets while preserving exact organization scope', async () => {
  const { domain, calls } = harness()
  await domain.createPlatformOrganization({ ...createDraft(), modules: [TU, OB] })
  await domain.savePlatformOrganizationModules(OTHER_ORG, { ...modulesDraft(), expectedModules: [TU, OB], modules: [OB] })
  await domain.savePlatformOrganizationMember(OTHER_ORG, { ...memberDraft(), modules: [TU, OB],
    expected: { role: 'inspector', isActive: true, modules: [TU, OB] } })
  assert.deepEqual((calls.rpcs[0].values.p_values as Row).modules, [OB, TU])
  assert.deepEqual(calls.rpcs[1], { name: 'platform_organization_modules_save', values: {
    p_actor: ACTOR, p_org: OTHER_ORG, p_expected: [OB, TU], p_modules: [OB],
  } })
  assert.deepEqual(calls.rpcs[2], { name: 'platform_organization_member_save', values: {
    p_actor: ACTOR, p_org: OTHER_ORG, p_profile: MEMBER,
    p_expected: { role: 'inspector', isActive: true, modules: [OB, TU] },
    p_values: { role: 'inspector', isActive: true, modules: [OB, TU] },
  } })
  assert.ok(calls.rpcs.every(call => !JSON.stringify(call.values).includes('moduleSetVersion')))
})

test('cached TU-only central forms fail closed before RPC until they reload the module selection', async () => {
  for (const version of [undefined, 1, '2', null]) {
    for (const [kind, input] of [['create', createDraft()], ['modules', modulesDraft()], ['member', memberDraft()]] as const) {
      const values: Row = { ...input, moduleSetVersion: version }
      if (version === undefined) delete values.moduleSetVersion
      const { domain, calls } = harness()
      await assert.rejects(kind === 'create' ? domain.createPlatformOrganization(values)
        : kind === 'modules' ? domain.savePlatformOrganizationModules(ORG, values)
        : domain.savePlatformOrganizationMember(ORG, values), { message: 'ORG_MODULE_SELECTION_REFRESH_REQUIRED' })
      assert.deepEqual(calls.rpcs, [])
    }
  }
})

test('a company may be created with no organization number and no operational module', async () => {
  const { domain, calls } = harness()
  await domain.createPlatformOrganization({ ...createDraft(), organizationNumber: null, modules: [] })
  assert.deepEqual(calls.rpcs[0].values.p_values, { name: 'Exempel AB', organizationNumber: null, adminProfileId: MEMBER, modules: [] })
})

test('membership mutations refuse invalid roles, booleans, module scopes and stale-shape snapshots', async () => {
  const invalid = [
    null, [], { ...memberDraft(), actorProfileId: ACTOR }, { ...memberDraft(), profileId: 'not-a-uuid' },
    { ...memberDraft(), role: 'hushub_superadmin' }, { ...memberDraft(), isActive: 'true' },
    { ...memberDraft(), modules: ['admin'] }, { ...memberDraft(), modules: [TU, TU] },
    { ...memberDraft(), expected: {} }, { ...memberDraft(), expected: { role: 'admin', isActive: true } },
    { ...memberDraft(), expected: { role: 'admin', isActive: true, modules: [], actorProfileId: ACTOR } },
    { ...memberDraft(), expected: { role: 'hushub_superadmin', isActive: true, modules: [] } },
  ]
  for (const values of invalid) {
    const { domain, calls } = harness()
    await assert.rejects(domain.savePlatformOrganizationMember(ORG, values), { message: 'ORG_INPUT_INVALID' })
    assert.deepEqual(calls.rpcs, [])
  }
})

test('all scoped service entry points reject malformed organization IDs instead of falling back to another organization', async () => {
  for (const orgId of [null, undefined, '', 'not-a-uuid', [ORG], `${ORG},${OTHER_ORG}`]) {
    const { domain, calls } = harness()
    for (const run of [() => domain.getPlatformOrganization(orgId),
      () => domain.savePlatformOrganizationModules(orgId, modulesDraft()),
      () => domain.savePlatformOrganizationMember(orgId, memberDraft())]) {
      await assert.rejects(run(), { message: 'ORG_INPUT_INVALID' })
    }
    assert.deepEqual(calls.rpcs, [])
  }
})

test('module saves require an exact optimistic request and cannot enable unimplemented modules', async () => {
  for (const values of [{ moduleSetVersion: 2, modules: [TU] }, { moduleSetVersion: 2, expectedModules: [TU] }, { ...modulesDraft(), actorProfileId: ACTOR },
    { ...modulesDraft(), expectedModules: [TU, TU] }, { ...modulesDraft(), modules: ['construction_inspections'] },
    { ...modulesDraft(), modules: [OB, OB] }, { ...modulesDraft(), expectedModules: [OB, 'admin'] }]) {
    const { domain, calls } = harness()
    await assert.rejects(domain.savePlatformOrganizationModules(ORG, values), { message: 'ORG_INPUT_INVALID' })
    assert.deepEqual(calls.rpcs, [])
  }
})

test('database conflicts stay typed and private provider diagnostics are never exposed', async () => {
  for (const [error, expected] of [
    [{ code: 'PGRST202', message: 'missing RPC secret details' }, 'ORG_SCHEMA_REQUIRED'],
    [{ message: 'ORG_CONFLICT' }, 'ORG_CONFLICT'],
    [{ message: 'ORG_LAST_ADMIN' }, 'ORG_LAST_ADMIN'],
    [{ message: 'access_token=secret user=private@example.test' }, 'ORG_REQUEST_FAILED'],
  ] as const) {
    const { domain } = harness({ rpc: () => ({ data: null, error }) })
    await assert.rejects(domain.savePlatformOrganizationMember(ORG, memberDraft()), { message: expected })
  }
})

test('central service uses atomic RPCs, not direct writes to memberships, grants or profiles', () => {
  const source = readFileSync(new URL('../src/lib/organizations/platformAdministration.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /\.(?:insert|update|upsert|delete)\s*\(/u)
  assert.doesNotMatch(source, /requireOrganizationAdmin|requireProductAccess/u)
})

function filteredRows(rows: Row[], query: Query) {
  let result = rows.filter(row => query.ops.filter(op => op.name === 'eq')
    .every(op => row[String(op.args[0])] === op.args[1]) && query.ops.filter(op => op.name === 'in')
    .every(op => (op.args[1] as unknown[]).includes(row[String(op.args[0])])))
  const range = query.ops.find(op => op.name === 'range')
  if (range) result = result.slice(Number(range.args[0]), Number(range.args[1]) + 1)
  return result
}

test('organization detail projects only active, nonexpired, exact-organization dashboard OB/TU inspector grants', async () => {
  const ids = Array.from({ length: 14 }, (_, index) => `66666666-6666-4666-8666-${String(index).padStart(12, '0')}`)
  const rows: Record<string, Row[]> = {
    org_members: ids.map((id, index) => ({ org_id: ORG, profile_id: id, role: 'inspector', is_active: index !== 13,
      profile: index === 1 ? [{ full_name: 'Array relation', email: 'array@example.test' }] : { full_name: `Member ${index}`, email: null } })),
    organization_enabled_modules: [{ org_id: ORG, module_key: OB, is_active: true }, { org_id: ORG, module_key: TU, is_active: true }],
    platform_access_assignments: ids.map((id, index) => ({ id: `grant-${index}`, profile_id: id,
      scope_type: 'organization', scope_id: ORG, is_active: true, expires_at: null,
      product: { key: 'dashboard' }, module: { key: TU }, role: { key: 'inspector' } })),
  }
  const grants = rows.platform_access_assignments
  grants[1] = { ...grants[1], product: [{ key: 'dashboard' }], module: [{ key: TU }], role: [{ key: 'inspector' }], expires_at: '2999-01-01T00:00:00Z' }
  grants[2].expires_at = '2000-01-01T00:00:00Z'
  grants[3].expires_at = 'invalid'
  grants[4].product = { key: 'renoapp' }
  grants[5].module = { key: 'construction_inspections' }
  grants[6].role = { key: 'dashboard_admin' }
  grants[7].role = null
  grants[8].is_active = false
  grants[9].scope_type = 'global'
  grants[10].scope_id = OTHER_ORG
  grants[11].scope_id = null
  grants[12].profile_id = ACTOR
  grants.push({ ...grants[0], id: 'valid-ob', module: { key: OB } }, { ...grants[0], id: 'duplicate-ob', module: { key: OB } })
  const { domain, calls } = harness({ query: query => query.table === 'organizations'
    ? { data: { id: ORG, name: 'Organization A', organization_number: null }, error: null }
    : { data: filteredRows(rows[query.table] ?? [], query), error: null } })
  const detail = await domain.getPlatformOrganization(ORG)
  const members = detail.members as { profileId: string; modules: string[]; displayName: string }[]
  assert.equal(members.length, ids.length)
  assert.deepEqual(members.filter(row => row.modules.length).map(row => row.profileId), ids.slice(0, 2))
  assert.deepEqual(members[0].modules, [OB, TU])
  assert.deepEqual(members[1].modules, [TU])
  assert.equal(members[1].displayName, 'Array relation')
  const query = calls.queries.find(call => call.table === 'platform_access_assignments')!
  assert.deepEqual(query.ops.filter(op => op.name === 'eq').map(op => op.args), [
    ['scope_type', 'organization'], ['scope_id', ORG], ['is_active', true],
  ])
  const membersQuery = calls.queries.find(call => call.table === 'org_members')!
  assert.ok(membersQuery.ops.some(op => op.name === 'eq' && op.args[0] === 'org_id' && op.args[1] === ORG))
})

test('organization directory paginates past the first 500 rows and exposes only safe profile fields', async () => {
  const organizations = Array.from({ length: 501 }, (_, index) => ({ id: `organization-${index}`, name: `Organization ${index}`, organization_number: null }))
  const rows: Record<string, Row[]> = {
    organizations,
    profiles: [{ id: MEMBER, full_name: 'Anna', email: 'anna@example.test', is_admin: true, private_token: 'never-copy' }],
    org_members: [
      { org_id: 'organization-500', profile_id: MEMBER, role: 'admin', is_active: true },
      { org_id: 'organization-500', profile_id: ACTOR, role: 'inspector', is_active: true },
      { org_id: 'organization-500', profile_id: REQUEST, role: 'admin', is_active: false },
    ],
    organization_enabled_modules: [
      { org_id: 'organization-500', module_key: TU, is_active: true },
      { org_id: 'organization-1', module_key: TU, is_active: false },
      { org_id: 'organization-2', module_key: 'inspections', is_active: true },
    ],
  }
  const { domain, calls } = harness({ query: query => ({ data: filteredRows(rows[query.table] ?? [], query), error: null }) })
  const result = await domain.listPlatformOrganizations() as { organizations: Row[]; users: Row[] }
  assert.equal(result.organizations.length, 501)
  assert.deepEqual(result.organizations[500], { id: 'organization-500', name: 'Organization 500', organizationNumber: null,
    modules: [TU], managedModules: [TU], tuManaged: true, activeMemberCount: 2, activeAdminCount: 1 })
  assert.deepEqual(result.organizations[1].modules, [])
  assert.equal(result.organizations[1].tuManaged, true)
  assert.deepEqual(result.organizations[2].modules, [OB])
  assert.deepEqual(result.organizations[2].managedModules, [OB])
  assert.equal(result.organizations[2].tuManaged, false)
  assert.deepEqual(result.users, [{ id: MEMBER, fullName: 'Anna', email: 'anna@example.test' }])
  assert.deepEqual(calls.queries.filter(query => query.table === 'organizations').map(query => query.ops.find(op => op.name === 'range')?.args), [[0, 499], [500, 999]])
  assert.equal(calls.queries.find(query => query.table === 'profiles')?.ops.find(op => op.name === 'select')?.args[0], 'id,full_name,email')
})

test('two-module entitlement pagination uses a stable compound order and retains both module rows per organization', async () => {
  const organizations = Array.from({ length: 501 }, (_, index) => ({ id: `organization-${String(index).padStart(4, '0')}`,
    name: `Organization ${index}`, organization_number: null }))
  const rows: Record<string, Row[]> = { organizations,
    organization_enabled_modules: organizations.flatMap(org => [OB, TU].map(module_key => ({ org_id: org.id, module_key,
      is_active: module_key === OB || org.id !== 'organization-0250' }))),
  }
  const { domain, calls } = harness({ query: query => ({ data: filteredRows(rows[query.table] ?? [], query), error: null }) })
  const result = await domain.listPlatformOrganizations() as { organizations: Row[] }
  const middle = result.organizations.find(org => org.id === 'organization-0250')!
  assert.deepEqual(middle.modules, [OB])
  assert.deepEqual(middle.managedModules, [OB, TU])
  assert.equal(middle.tuManaged, true)
  assert.deepEqual(result.organizations[500].modules, [OB, TU])
  const pages = calls.queries.filter(call => call.table === 'organization_enabled_modules')
  assert.deepEqual(pages.map(page => page.ops.find(op => op.name === 'range')?.args), [[0, 499], [500, 999], [1000, 1499]])
  for (const page of pages) {
    assert.deepEqual(page.ops.filter(op => op.name === 'order').map(op => op.args[0]), ['org_id', 'module_key'])
    assert.ok(page.ops.some(op => op.name === 'in' && op.args[0] === 'module_key'
      && JSON.stringify(op.args[1]) === JSON.stringify([OB, TU])))
  }
})

test('failed organization-directory reads are not returned as an empty successful directory', async () => {
  const { domain } = harness({ query: () => ({ data: null, error: { message: 'password=secret connection detail' } }) })
  await assert.rejects(domain.listPlatformOrganizations(), { message: 'ORG_REQUEST_FAILED' })
  await assert.rejects(domain.getPlatformOrganization(ORG), { message: 'ORG_REQUEST_FAILED' })
})

test('an unknown organization fails instead of returning details for a default company', async () => {
  const { domain } = harness({ query: query => ({ data: query.table === 'organizations' ? null : [], error: null }) })
  await assert.rejects(domain.getPlatformOrganization(OTHER_ORG), { message: 'ORG_NOT_FOUND' })
})

test('organization detail distinguishes unmanaged legacy TU from an explicitly disabled entitlement', async () => {
  for (const [entitlements, managed, modules] of [
    [[], false, []],
    [[{ org_id: ORG, module_key: TU, is_active: false }], true, []],
    [[{ org_id: ORG, module_key: TU, is_active: true }], true, [TU]],
  ] as [Row[], boolean, string[]][]) {
    const { domain } = harness({ query: query => query.table === 'organizations'
      ? { data: { id: ORG, name: 'Company', organization_number: null }, error: null }
      : { data: query.table === 'organization_enabled_modules' ? filteredRows(entitlements, query) : [], error: null } })
    const result = await domain.getPlatformOrganization(ORG)
    assert.deepEqual(result.organization, { id: ORG, name: 'Company', organizationNumber: null,
      managedModules: managed ? [TU] : [], tuManaged: managed, modules })
  }
})

test('organization detail keeps OB grant out of editable snapshots until its entitlement is explicitly managed', async () => {
  for (const [obEntitlements, expected] of [
    [[], [TU]],
    [[{ org_id: ORG, module_key: OB, is_active: false }], [OB, TU]],
    [[{ org_id: ORG, module_key: OB, is_active: true }], [OB, TU]],
  ] as [Row[], string[]][]) {
    const rows: Record<string, Row[]> = {
      organization_enabled_modules: [...obEntitlements, { org_id: ORG, module_key: TU, is_active: true }],
      org_members: [{ org_id: ORG, profile_id: MEMBER, role: 'inspector', is_active: true, profile: { full_name: 'Anna', email: null } }],
      platform_access_assignments: [OB, TU].map(key => ({ profile_id: MEMBER, scope_type: 'organization', scope_id: ORG,
        is_active: true, expires_at: null, product: { key: 'dashboard' }, module: { key }, role: { key: 'inspector' } })),
    }
    const { domain } = harness({ query: query => query.table === 'organizations'
      ? { data: { id: ORG, name: 'Company', organization_number: null }, error: null }
      : { data: filteredRows(rows[query.table] ?? [], query), error: null } })
    const result = await domain.getPlatformOrganization(ORG)
    assert.deepEqual((result.members as Row[])[0].modules, expected)
    assert.deepEqual((result.organization as Row).managedModules, obEntitlements.length ? [OB, TU] : [TU])
  }
})

test('the real access resolver denies an organization administrator and non-global platform grants', async () => {
  const assignment = { id: REQUEST, product_id: 'product-id', module_id: 'module-id', role_id: 'role-id',
    scope_type: 'organization', scope_id: ORG, expires_at: null,
    platform_products: { key: 'dashboard', label: 'BesiktApp' },
    platform_modules: { key: 'admin', label: 'Administration' },
    platform_roles: { key: 'dashboard_admin', label: 'Organisationsadministratör' } }
  for (const assignments of [[], [assignment], [{ ...assignment, platform_products: { key: 'hushub_admin' },
    platform_modules: { key: 'access_management' }, platform_roles: { key: 'hushub_superadmin' } }]]) {
    const authDb = {
      from(table: string) {
        const builder: Record<string, unknown> = {}
        for (const name of ['select', 'eq', 'in', 'order', 'limit']) builder[name] = () => builder
        const result = () => ({ data: table === 'profiles' ? { id: ACTOR, full_name: 'Org Admin', email: 'admin@example.test', is_admin: false }
          : table === 'platform_access_assignments' ? assignments
          : { id: 'membership-id', org_id: ORG, profile_id: ACTOR, role: 'admin', is_active: true }, error: null })
        builder.maybeSingle = async () => result()
        builder.then = (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => Promise.resolve(result()).then(resolve, reject)
        return builder
      },
    }
    const access = load<{ requireModuleAccess: (input: unknown) => Promise<unknown> }>('src/lib/access/server.ts', {
      'server-only': {}, '@/lib/supabase/admin': { createSupabaseAdminClient: () => authDb },
      '@/lib/supabase/server': { createSupabaseServerClient: () => ({ auth: { getUser: async () => ({
        data: { user: { id: ACTOR, email: 'admin@example.test', user_metadata: {} } }, error: null,
      }) } }) },
    })
    for (const operation of operations) {
      const { domain, calls } = harness({ authorize: access.requireModuleAccess })
      await assert.rejects(operation(domain), { message: 'MODULE_ACCESS_REQUIRED' })
      assert.deepEqual(calls.events, ['permission'])
      assert.deepEqual(calls.rpcs, [])
    }
  }
})
