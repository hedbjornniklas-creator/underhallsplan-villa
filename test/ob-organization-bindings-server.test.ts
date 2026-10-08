import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import ts from 'typescript'
import type * as BindingServer from '../src/lib/ob/organizationBindings'
import type * as AccessServer from '../src/lib/access/server'
import type * as AssignmentServer from '../src/lib/assignments/server'

const INSPECTION = '11111111-1111-4111-8111-111111111111'
const OTHER_INSPECTION = '22222222-2222-4222-8222-222222222222'
const ORG = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const OTHER_ORG = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const ACTOR = '33333333-3333-4333-8333-333333333333'
const OTHER_ACTOR = '44444444-4444-4444-8444-444444444444'
type Row = Record<string, unknown>
type DbError = { code?: string; message: string }
type Query = { table: string; select: string; filters: { key: string; value: unknown; operation: 'eq' | 'in' }[] }

const compiled = new Map<string, string>()
function load<T>(file: string, dependencies: Record<string, unknown>, allowUnusedDependencies = false): T {
  let code = compiled.get(file)
  if (!code) {
    code = ts.transpileModule(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), {
      fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText
    compiled.set(file, code)
  }
  const compiledModule = { exports: {} }
  new Function('require', 'module', 'exports', code)((name: string) => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name]
    // The large assignments module imports unrelated mail/PDF implementations;
    // none is used by its real requireOrgContext path under test.
    if (allowUnusedDependencies) return {}
    throw new Error(`Unexpected OB binding dependency: ${name}`)
  }, compiledModule, compiledModule.exports)
  return compiledModule.exports as T
}

function grant(values: Row = {}): Row {
  return {
    id: 'grant-1', profile_id: ACTOR, product_id: 'dashboard-id', module_id: 'ob-id', role_id: 'inspector-id',
    scope_type: 'organization', scope_id: ORG, expires_at: null, is_active: true, source_system: 'organization_administration',
    platform_products: { id: 'dashboard-id', key: 'dashboard', label: 'BesiktApp', is_active: true },
    platform_modules: { product_id: 'dashboard-id', key: 'inspections', label: 'ÖB', is_active: true },
    platform_roles: { product_id: 'dashboard-id', key: 'inspector', label: 'Besiktningsman', is_active: true },
    ...values,
  }
}

function membership(orgId = ORG, values: Row = {}): Row {
  return {
    id: `member-${orgId}`, org_id: orgId, profile_id: ACTOR, role: 'inspector', is_active: true,
    is_default: orgId === OTHER_ORG, created_at: '2026-01-01T00:00:00Z',
    organizations: { name: orgId === ORG ? 'Besiktningsbolaget' : 'Annan organisation', email_from: 'team@example.test' },
    ...values,
  }
}

function harness(options: {
  user?: null | { id: string }
  authError?: boolean
  inspection?: Row | null
  assignment?: Row | null
  binding?: Row | null
  entitlement?: Row | null
  entitlements?: Row[]
  memberships?: Row[]
  grants?: Row[]
  legacyAdmin?: boolean
  tableErrors?: Record<string, DbError>
  overrideContext?: Partial<Awaited<ReturnType<typeof AssignmentServer.requireOrgContext>>>
} = {}) {
  const calls = {
    events: [] as string[], queries: [] as Query[], contexts: [] as unknown[], mutations: [] as string[],
    permissions: [] as unknown[],
  }
  const rows: Record<string, Row[]> = {
    assignments: options.assignment === null ? [] : [options.assignment ?? {
      id: OTHER_INSPECTION, org_id: ORG, inspection_id: null, assignment_type: 'OB',
    }],
    inspections: options.inspection === null ? [] : [options.inspection ?? {
      id: INSPECTION, inspection_family: 'OB', type: 'OB', properties: { owner: ACTOR },
    }],
    ob_organization_bindings: options.binding === null ? [] : [options.binding ?? { inspection_id: INSPECTION, org_id: ORG }],
    organization_enabled_modules: options.entitlements ?? (options.entitlement ? [{ org_id: ORG, module_key: 'inspections', ...options.entitlement }] : []),
    org_members: options.memberships ?? [membership(OTHER_ORG), membership()],
    profiles: [{ id: ACTOR, full_name: 'Person', email: 'person@example.test', is_admin: options.legacyAdmin ?? false }],
    platform_access_assignments: options.grants ?? [grant()],
  }
  const userClient = {
    auth: { getUser: async () => {
      calls.events.push('auth')
      return { data: { user: options.user === null ? null : options.user ?? { id: ACTOR } }, error: options.authError ? { message: 'private auth detail' } : null }
    } },
  }
  const db = {
    from(table: string) {
      calls.events.push(`query:${table}`)
      assert.ok(Object.hasOwn(rows, table), `Unexpected read of ${table}; default organization/bootstrap is forbidden`)
      const call: Query = { table, select: '', filters: [] }
      calls.queries.push(call)
      const valueAt = (row: Row, path: string): unknown => path.split('.').reduce<unknown>((value, part) =>
        value && typeof value === 'object' ? (value as Row)[part] : undefined, row)
      const result = (single: boolean) => {
        if (options.tableErrors?.[table]) return { data: null, error: options.tableErrors[table] }
        const selected = rows[table].filter(row => call.filters.every(filter => {
          const value = valueAt(row, filter.key)
          return filter.operation === 'in' ? (filter.value as unknown[]).includes(value) : value === filter.value
        }))
        const data = single ? selected[0] ?? null : selected
        return { data, error: null }
      }
      const query = {
        select: (columns: string) => { call.select = columns; return query },
        eq: (key: string, value: unknown) => { call.filters.push({ key, value, operation: 'eq' }); return query },
        in: (key: string, value: unknown[]) => { call.filters.push({ key, value, operation: 'in' }); return query },
        order: () => query,
        limit: () => query,
        maybeSingle: async () => result(true),
        then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => Promise.resolve().then(() => result(false)).then(resolve, reject),
        ...Object.fromEntries(['insert', 'update', 'upsert', 'delete'].map(operation => [operation, () => {
          calls.mutations.push(`${table}:${operation}`)
          throw new Error(`Forbidden mutation ${table}:${operation}`)
        }])),
      }
      return query
    },
    rpc() { calls.mutations.push('rpc'); throw new Error('No RPC or write is allowed') },
  }
  const dependencies = {
    'server-only': {},
    '@/lib/supabase/admin': { createSupabaseAdminClient: () => { calls.events.push('admin-client'); return db } },
    '@/lib/supabase/server': { createSupabaseServerClient: () => userClient },
  }
  const access = load<typeof AccessServer>('src/lib/access/server.ts', dependencies)
  const assignments = load<typeof AssignmentServer>('src/lib/assignments/server.ts', dependencies, true)
  const http = load<Record<string, unknown>>('src/lib/organizations/administrationHttp.ts', {})
  const server = load<typeof BindingServer>('src/lib/ob/organizationBindings.ts', {
    ...dependencies,
    '@/lib/organizations/administrationHttp': http,
    '@/lib/access/server': {
      ...access,
      hasCurrentUserAccess: async (input: Parameters<typeof access.hasCurrentUserAccess>[0]) => {
        calls.permissions.push(input)
        return access.hasCurrentUserAccess(input)
      },
    },
    '@/lib/assignments/server': { requireOrgContext: async (orgId: unknown) => {
      assert.ok(typeof orgId === 'string' && orgId.length > 0, 'The default/ensure-membership branch must never run')
      calls.contexts.push(orgId)
      return { ...await assignments.requireOrgContext(orgId), ...options.overrideContext }
    } },
  })
  return { server, calls, rows, db }
}

test('authentication precedes privileged clients and all data reads', async () => {
  for (const options of [{ user: null }, { authError: true }]) {
    const h = harness(options)
    await assert.rejects(h.server.requireObInspectionContext(INSPECTION), { message: 'UNAUTHORIZED' })
    assert.deepEqual(h.calls.events, ['auth'])
    assert.deepEqual(h.calls.mutations, [])
  }
})

test('invalid inspection and explicit organization IDs are rejected without database reads', async () => {
  for (const invalid of [undefined, null, '', 'not-a-uuid', [], {}, `${INSPECTION},${OTHER_INSPECTION}`]) {
    const h = harness()
    await assert.rejects(h.server.requireObInspectionContext(invalid), { message: 'OB_INSPECTION_INVALID' })
    assert.deepEqual(h.calls.events, ['auth'])
  }
  for (const invalid of [null, '', 'not-a-uuid', [], {}, `${ORG},${OTHER_ORG}`]) {
    const h = harness()
    await assert.rejects(h.server.requireObInspectionContext(INSPECTION, invalid), { message: 'ORG_SELECTION_INVALID' })
    assert.deepEqual(h.calls.events, ['auth'])
  }
})

test('binding wins over default membership and absent orgId never invokes bootstrap or fallback', async () => {
  const h = harness()
  assert.deepEqual(await h.server.requireObInspectionContext(INSPECTION), {
    userId: ACTOR, orgId: ORG, role: 'inspector', orgName: 'Besiktningsbolaget', orgEmailFrom: 'team@example.test',
  })
  assert.deepEqual(h.calls.contexts, [ORG])
  const ownerRead = h.calls.queries.find(call => call.table === 'inspections')!
  assert.ok(ownerRead.filters.some(filter => filter.key === 'properties.owner' && filter.value === ACTOR))
  const bindingRead = h.calls.queries.find(call => call.table === 'ob_organization_bindings')!
  assert.equal(bindingRead.select, 'inspection_id,org_id')
  assert.deepEqual(bindingRead.filters, [{ key: 'inspection_id', value: INSPECTION, operation: 'eq' }])
  for (const call of h.calls.queries.filter(query => query.table === 'org_members')) {
    assert.ok(call.filters.some(filter => filter.key === 'org_id' && filter.value === ORG))
    assert.ok(call.filters.some(filter => filter.key === 'is_active' && filter.value === true))
  }
  assert.deepEqual(h.calls.mutations, [])
})

test('same user in two organizations cannot override an inspection binding with the requested organization', async () => {
  const h = harness({ grants: [grant(), grant({ id: 'grant-2', scope_id: OTHER_ORG })] })
  await assert.rejects(h.server.requireObInspectionContext(INSPECTION, OTHER_ORG), { message: 'OB_ORGANIZATION_MISMATCH' })
  assert.deepEqual(h.calls.contexts, [ORG])
  assert.deepEqual(h.calls.mutations, [])
})

test('valid IDs are normalized and explicit matching selection succeeds', async () => {
  const h = harness()
  assert.equal((await h.server.requireObInspectionContext(` ${INSPECTION} `, ` ${ORG.toUpperCase()} `)).orgId, ORG)
})

test('missing inspection or non-owner colleague/admin is rejected before any binding lookup', async () => {
  for (const options of [
    { inspection: null },
    { inspection: { id: INSPECTION, inspection_family: 'OB', type: 'OB', properties: { owner: OTHER_ACTOR } } },
    { inspection: { id: INSPECTION, inspection_family: 'OB', type: 'OB', properties: { owner: OTHER_ACTOR } }, legacyAdmin: true, memberships: [membership(ORG, { role: 'admin' })] },
  ]) {
    const h = harness(options)
    await assert.rejects(h.server.requireObInspectionContext(INSPECTION, OTHER_ORG), { message: 'OB_ORGANIZATION_FORBIDDEN' })
    assert.deepEqual(h.calls.queries.map(call => call.table), ['inspections'])
    assert.deepEqual(h.calls.contexts, [])
  }
})

test('canonical OB (including SB variant) and unambiguous legacy OB/STATUS are accepted', async () => {
  for (const classification of [
    { inspection_family: 'OB', type: 'OB' }, { inspection_family: 'OB', type: 'SB', inspection_variant: 'SB' },
    { inspection_family: null, type: 'OB' }, { inspection_family: null, type: 'STATUS' },
  ]) {
    const h = harness({ inspection: { id: INSPECTION, properties: { owner: ACTOR }, ...classification } })
    assert.equal((await h.server.requireObInspectionContext(INSPECTION)).orgId, ORG)
  }
})

test('other canonical families and ambiguous type-only SB are never treated as OB', async () => {
  for (const classification of [
    { inspection_family: 'EB', type: 'OB' }, { inspection_family: 'TU', type: 'OB' },
    { inspection_family: 'STATUS', type: 'STATUS' }, { inspection_family: null, type: 'SB' },
    { inspection_family: null, type: 'EB' }, { inspection_family: '', type: 'OB' },
  ]) {
    const h = harness({ inspection: { id: INSPECTION, properties: { owner: ACTOR }, ...classification } })
    await assert.rejects(h.server.requireObInspectionContext(INSPECTION), { message: 'OB_ORGANIZATION_FORBIDDEN' })
    assert.deepEqual(h.calls.queries.map(call => call.table), ['inspections'])
  }
})

test('missing binding produces an explicit unassigned result instead of consulting a default or assignments fallback', async () => {
  const h = harness({ binding: null })
  await assert.rejects(h.server.requireObInspectionContext(INSPECTION), { message: 'OB_ORGANIZATION_UNASSIGNED' })
  assert.deepEqual(h.calls.queries.map(call => call.table), ['inspections', 'ob_organization_bindings'])
  assert.deepEqual(h.calls.contexts, [])
  assert.deepEqual(h.calls.mutations, [])
})

test('missing binding table/column/schema cache returns the migration error without leaking database details', async () => {
  for (const code of ['42P01', '42703', 'PGRST205']) {
    const h = harness({ tableErrors: { ob_organization_bindings: { code, message: 'private SQL credentials and detail' } } })
    await assert.rejects(h.server.requireObInspectionContext(INSPECTION), { message: 'OB_ORGANIZATION_MIGRATION_REQUIRED' })
    assert.deepEqual(h.calls.contexts, [])
  }
})

test('unexpected ownership/binding reads and malformed binding rows fail closed with opaque errors', async () => {
  for (const table of ['inspections', 'ob_organization_bindings']) {
    const h = harness({ tableErrors: { [table]: { code: 'XX001', message: 'private database detail' } } })
    await assert.rejects(h.server.requireObInspectionContext(INSPECTION), { message: 'OB_ORGANIZATION_READ_FAILED' })
  }
  for (const org_id of [null, 'invalid', '', {}, undefined]) {
    const h = harness({ binding: { inspection_id: INSPECTION, org_id } })
    await assert.rejects(h.server.requireObInspectionContext(INSPECTION), { message: 'OB_ORGANIZATION_READ_FAILED' })
    assert.deepEqual(h.calls.contexts, [])
  }
})

test('inactive/missing membership denies access even to the owner with global or scoped grants', async () => {
  for (const memberships of [[membership(OTHER_ORG)], [membership(ORG, { is_active: false }), membership(OTHER_ORG)], []]) {
    const h = harness({ memberships, grants: [grant(), grant({ scope_type: 'global', scope_id: null })] })
    await assert.rejects(h.server.requireObInspectionContext(INSPECTION), { message: 'ORG_MEMBERSHIP_REQUIRED' })
    assert.deepEqual(h.calls.contexts, [ORG])
    assert.ok(!h.calls.queries.some(query => query.table === 'organization_enabled_modules'))
    assert.deepEqual(h.calls.mutations, [])
  }
})

test('membership resolution errors are opaque and authenticated context cannot switch actor or organization', async () => {
  const failed = harness({ tableErrors: { org_members: { message: 'secret SQL failure' } } })
  await assert.rejects(failed.server.requireObInspectionContext(INSPECTION), { message: 'OB_ORGANIZATION_READ_FAILED' })
  for (const overrideContext of [{ orgId: OTHER_ORG }, { userId: OTHER_ACTOR }]) {
    const h = harness({ overrideContext })
    await assert.rejects(h.server.requireObInspectionContext(INSPECTION), { message: 'OB_ORGANIZATION_FORBIDDEN' })
    assert.ok(!h.calls.queries.some(query => query.table === 'organization_enabled_modules'))
  }
})

test('untouched organizations preserve existing explicit global and legacy membership access', async () => {
  for (const options of [{ grants: [grant({ scope_type: 'global', scope_id: null })] }, { grants: [] }, { grants: [], legacyAdmin: true }]) {
    const h = harness(options)
    assert.equal((await h.server.requireObInspectionContext(INSPECTION)).orgId, ORG)
    assert.deepEqual(h.calls.permissions, [
      { productKey: 'dashboard', moduleKey: 'inspections', scopeType: 'organization', scopeId: ORG },
      { productKey: 'dashboard', moduleKey: 'inspections', scopeType: 'global' },
    ])
  }
})

test('untouched organizations do not borrow another organization/module grant or revive revoked managed history', async () => {
  for (const grants of [
    [grant({ scope_id: OTHER_ORG })],
    [grant({ platform_modules: { key: 'technical_investigations' } })],
    [grant({ is_active: false })],
    [grant({ expires_at: '2000-01-01T00:00:00Z' })],
  ]) {
    const h = harness({ grants })
    await assert.rejects(h.server.requireObInspectionContext(INSPECTION), { message: 'MODULE_ACCESS_REQUIRED' })
  }
})

test('explicitly disabled OB denies both global and scoped access and never reveals selection mismatch', async () => {
  const h = harness({ entitlement: { is_active: false }, grants: [grant(), grant({ scope_type: 'global', scope_id: null })] })
  await assert.rejects(h.server.requireObInspectionContext(INSPECTION, OTHER_ORG), { message: 'MODULE_ACCESS_REQUIRED' })
  assert.deepEqual(h.calls.permissions, [])
})

test('managed OB requires a real exact organization inspector grant, not legacy or global access', async () => {
  for (const options of [
    { grants: [] }, { grants: [], legacyAdmin: true },
    { grants: [grant({ scope_type: 'global', scope_id: null })] },
    { grants: [grant({ scope_id: OTHER_ORG })] },
    { grants: [grant({ platform_roles: { key: 'dashboard_admin' } })] },
    { grants: [grant({ platform_modules: { key: 'technical_investigations' } })] },
    { grants: [grant({ platform_products: { key: 'hushub_admin' } })] },
    { grants: [grant({ profile_id: OTHER_ACTOR })] },
    { grants: [grant({ scope_type: 'property' })] },
  ]) {
    const h = harness({ ...options, entitlement: { is_active: true } })
    await assert.rejects(h.server.requireObInspectionContext(INSPECTION), { message: 'MODULE_ACCESS_REQUIRED' })
    assert.deepEqual(h.calls.permissions, [])
  }
})

test('managed scoped inspector grants must remain active and unexpired with valid expiry data', async () => {
  for (const values of [
    { is_active: false }, { expires_at: '2000-01-01T00:00:00Z' }, { expires_at: 'invalid' }, { expires_at: '' },
  ]) {
    const h = harness({ entitlement: { is_active: true }, grants: [grant(values)] })
    await assert.rejects(h.server.requireObInspectionContext(INSPECTION), { message: 'MODULE_ACCESS_REQUIRED' })
  }
  for (const expires_at of [null, '2999-01-01T00:00:00Z']) {
    const h = harness({ entitlement: { is_active: true }, grants: [grant({ expires_at })] })
    assert.equal((await h.server.requireObInspectionContext(INSPECTION)).orgId, ORG)
    const grantRead = h.calls.queries.find(query => query.table === 'platform_access_assignments')!
    assert.ok(grantRead.filters.some(filter => filter.key === 'is_active' && filter.value === true))
    assert.ok(grantRead.filters.some(filter => filter.key === 'profile_id' && filter.value === ACTOR))
    assert.deepEqual(h.calls.mutations, [])
  }
})

test('managed grants require active catalog entries belonging to the same product', async () => {
  for (const key of ['platform_products', 'platform_modules', 'platform_roles']) {
    const original = grant()[key] as Row
    for (const invalid of [{ ...original, is_active: false }, { ...original, is_active: null },
      key === 'platform_products' ? { ...original, id: 'wrong-product' } : { ...original, product_id: 'wrong-product' }]) {
      const h = harness({ entitlement: { is_active: true }, grants: [grant({ [key]: invalid })] })
      await assert.rejects(h.server.requireObInspectionContext(INSPECTION), { message: 'MODULE_ACCESS_REQUIRED' })
    }
  }
})

test('availability/grant read failures never fall back to a global grant or expose private details', async () => {
  for (const table of ['organization_enabled_modules', 'platform_access_assignments']) {
    const h = harness({ entitlement: { is_active: true }, tableErrors: { [table]: { message: 'private read failure' } } })
    await assert.rejects(h.server.requireObInspectionContext(INSPECTION), { message: 'OB_ORGANIZATION_READ_FAILED' })
  }
  const missingSchema = harness({ entitlement: { is_active: true }, tableErrors: {
    platform_access_assignments: { message: 'relation platform_access_assignments does not exist' },
  } })
  await assert.rejects(missingSchema.server.requireObInspectionContext(INSPECTION), { message: 'OB_ORGANIZATION_READ_FAILED' })
  const failedLegacyProfile = harness({ tableErrors: { profiles: { message: 'private profile data' } } })
  await assert.rejects(failedLegacyProfile.server.requireObInspectionContext(INSPECTION), { message: 'OB_ORGANIZATION_READ_FAILED' })
})

test('entitlement lookup is exact organization/module and does not filter away disabled rows', async () => {
  const h = harness({ entitlement: { is_active: true } })
  await h.server.requireObInspectionContext(INSPECTION)
  const query = h.calls.queries.find(call => call.table === 'organization_enabled_modules')!
  assert.equal(query.select, 'is_active')
  assert.deepEqual(query.filters, [
    { key: 'org_id', value: ORG, operation: 'eq' }, { key: 'module_key', value: 'inspections', operation: 'eq' },
  ])
})

test('workspace and switcher propagate module read failures instead of selecting another organization', async () => {
  for (const entry of ['workspace', 'switcher'] as const) {
    const h = harness({ tableErrors: { organization_enabled_modules: { message: 'private network failure' } } })
    await assert.rejects(entry === 'workspace' ? h.server.requireObContext()
      : h.server.hasOrganizationObAccess(OTHER_ORG, ACTOR), { message: 'OB_ORGANIZATION_READ_FAILED' })
    assert.deepEqual(h.calls.contexts, [OTHER_ORG])
    assert.deepEqual(h.calls.mutations, [])
  }
})

test('every OB API route uses an organization guard and no default membership resolver', () => {
  function sourceFiles(directory: string): string[] {
    return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
      const path = join(directory, entry.name)
      return entry.isDirectory() ? sourceFiles(path) : /\.tsx?$/.test(entry.name) ? [path] : []
    })
  }
  const routes = sourceFiles(fileURLToPath(new URL('../src/app/api/ob', import.meta.url)))
  assert.ok(routes.length >= 27)
  for (const path of routes) {
    const source = readFileSync(path, 'utf8')
    assert.match(source, /from ['"]@\/lib\/ob\/organizationBindings['"]/, path)
    assert.doesNotMatch(source, /requireOrgContext\(/, path)
    assert.match(source, /obOrganizationFailure\(/, path)
  }
})

test('workspace selection chooses an existing accessible membership and never provisions one', async () => {
  const h = harness()
  const context = await h.server.requireObContext()
  assert.equal(context.orgId, ORG)
  assert.deepEqual(h.calls.contexts, [OTHER_ORG, ORG])
  assert.deepEqual(h.calls.mutations, [])
  const empty = harness({ memberships: [] })
  await assert.rejects(empty.server.requireObContext(), { message: 'ORG_MEMBERSHIP_REQUIRED' })
  assert.deepEqual(empty.calls.contexts, [])
  assert.deepEqual(empty.calls.mutations, [])
})

test('explicit workspace selection is never replaced and creation requires explicit selection', async () => {
  const missing = harness()
  await assert.rejects(missing.server.requireObContext(undefined, true), { message: 'ORG_SELECTION_INVALID' })
  assert.deepEqual(missing.calls.events, ['auth'])
  const denied = harness()
  await assert.rejects(denied.server.requireObContext(OTHER_ORG), { message: 'MODULE_ACCESS_REQUIRED' })
  assert.deepEqual(denied.calls.contexts, [OTHER_ORG])
})

test('assignment context derives its true organization and rejects another module or requested organization', async () => {
  const h = harness()
  assert.equal((await h.server.requireObAssignmentContext(OTHER_INSPECTION)).orgId, ORG)
  assert.deepEqual(h.calls.contexts, [ORG])
  await assert.rejects(h.server.requireObAssignmentContext(OTHER_INSPECTION, OTHER_ORG), { message: 'OB_ORGANIZATION_MISMATCH' })
  for (const assignment_type of ['EB', 'TU', 'UHP']) {
    const other = harness({ assignment: { id: OTHER_INSPECTION, org_id: ORG, inspection_id: null, assignment_type } })
    await assert.rejects(other.server.requireObAssignmentContext(OTHER_INSPECTION), { message: 'OB_ASSIGNMENT_NOT_FOUND' })
    assert.deepEqual(other.calls.contexts, [])
  }
})

test('linked assignments cannot bypass owner checks or disagree with the inspection binding', async () => {
  const assignment = { id: OTHER_INSPECTION, org_id: ORG, inspection_id: INSPECTION, assignment_type: 'STATUS' }
  assert.equal((await harness({ assignment }).server.requireObAssignmentContext(OTHER_INSPECTION)).orgId, ORG)
  const mismatch = harness({ assignment: { ...assignment, org_id: OTHER_ORG } })
  await assert.rejects(mismatch.server.requireObAssignmentContext(OTHER_INSPECTION), { message: 'OB_ORGANIZATION_MISMATCH' })
  const nonOwner = harness({ assignment, inspection: { id: INSPECTION, inspection_family: 'OB', type: 'OB', properties: { owner: OTHER_ACTOR } } })
  await assert.rejects(nonOwner.server.requireObAssignmentContext(OTHER_INSPECTION), { message: 'OB_ORGANIZATION_FORBIDDEN' })
})

test('switcher helper verifies the authenticated actor and membership before module checks', async () => {
  const h = harness()
  assert.equal(await h.server.hasOrganizationObAccess(ORG, OTHER_ACTOR), false)
  assert.deepEqual(h.calls.events, ['auth'])
  assert.equal(await h.server.hasOrganizationObAccess(ORG, ACTOR), true)
  const nonMember = harness({ memberships: [] })
  assert.equal(await nonMember.server.hasOrganizationObAccess(ORG, ACTOR), false)
})

test('all new context entry points authenticate before privileged reads', async () => {
  for (const run of [
    (server: typeof BindingServer) => server.requireObContext(ORG),
    (server: typeof BindingServer) => server.requireObAssignmentContext(OTHER_INSPECTION),
    (server: typeof BindingServer) => server.hasOrganizationObAccess(ORG, ACTOR),
  ]) {
    const h = harness({ user: null })
    await assert.rejects(run(h.server), { message: 'UNAUTHORIZED' })
    assert.deepEqual(h.calls.events, ['auth'])
  }
})

test('one OB context response reuses auth/memberships/legacy grants instead of the former repeated guard chain', async () => {
  const options = { grants: [grant({ scope_type: 'global', scope_id: null })] }
  const before = harness(options)
  // The former context resolver: selected guard, membership list, one complete
  // independently authenticated guard per option. These are the real guards.
  const selected = await before.server.requireObContext(ORG)
  const { data: members } = await before.db.from('org_members').select('org_id')
    .eq('profile_id', selected.userId).eq('is_active', true) as { data: Row[] }
  await Promise.all((members as Row[]).map(row => before.server.hasOrganizationObAccess(String(row.org_id), selected.userId)))
  const after = harness(options)
  const result = await after.server.getObOrganizationSwitcherContext(ORG)
  assert.deepEqual(result.organizations.map(row => row.id), [OTHER_ORG, ORG])
  assert.equal(result.organization.id, ORG)
  assert.equal(before.calls.events.filter(event => event === 'auth').length, 12)
  assert.equal(before.calls.queries.length, 19)
  assert.equal(after.calls.events.filter(event => event === 'auth').length, 1)
  assert.equal(after.calls.queries.length, 5)
  assert.equal(after.calls.queries.filter(query => query.table === 'org_members').length, 1)
  assert.equal(after.calls.queries.filter(query => query.table === 'profiles').length, 1)
  assert.equal(after.calls.queries.filter(query => query.table === 'platform_access_assignments').length, 1)
  assert.deepEqual(after.calls.mutations, [])
})

test('managed navigation never loads legacy identity and checks each exact entitlement/grant once', async () => {
  const h = harness({
    grants: [grant(), grant({ scope_id: OTHER_ORG })],
    entitlements: [ORG, OTHER_ORG].map(org_id => ({ org_id, module_key: 'inspections', is_active: true })),
  })
  const result = await h.server.getObOrganizationSwitcherContext(ORG, { inspectionId: INSPECTION })
  assert.equal(result.organization.id, ORG)
  assert.equal(result.organizations.length, 2)
  assert.equal(h.calls.events.filter(event => event === 'auth').length, 1)
  assert.equal(h.calls.queries.length, 7) // inspection + binding + members + two entitlement/grant pairs
  assert.equal(h.calls.queries.filter(query => query.table === 'profiles').length, 0)
  assert.equal(h.calls.queries.filter(query => query.table === 'org_members').length, 1)
  assert.deepEqual(h.calls.queries.slice(0, 2).map(query => query.table), ['inspections', 'ob_organization_bindings'])
})

test('request-local navigation context is discarded: revoked membership/grant/entitlement denies the next request', async () => {
  for (const revoke of [
    (rows: Record<string, Row[]>) => { rows.org_members.find(row => row.org_id === ORG)!.is_active = false },
    (rows: Record<string, Row[]>) => { rows.platform_access_assignments[0].is_active = false },
    (rows: Record<string, Row[]>) => { rows.organization_enabled_modules[0].is_active = false },
  ]) {
    const h = harness({ entitlement: { is_active: true } })
    assert.equal((await h.server.getObOrganizationSwitcherContext(ORG)).organization.id, ORG)
    revoke(h.rows)
    await assert.rejects(h.server.getObOrganizationSwitcherContext(ORG), /ORG_MEMBERSHIP_REQUIRED|MODULE_ACCESS_REQUIRED/)
    assert.equal(h.calls.events.filter(event => event === 'auth').length, 2)
  }
})

test('navigation uses exactly the same managed and legacy decisions as the protected entity guard', async () => {
  const cases = [
    {}, { grants: [] }, { grants: [], legacyAdmin: true },
    { grants: [grant({ scope_type: 'global', scope_id: null })] },
    { grants: [grant({ scope_id: OTHER_ORG })] },
    { grants: [grant({ is_active: false })] },
    { grants: [grant({ expires_at: '2000-01-01T00:00:00Z' })] },
    { grants: [grant({ platform_modules: { key: 'technical_investigations' } })] },
    { memberships: [] }, { memberships: [membership(ORG, { is_active: false })] },
    { entitlement: { is_active: false }, legacyAdmin: true },
    { entitlement: { is_active: true } },
    { entitlement: { is_active: true }, grants: [] },
    { entitlement: { is_active: true }, grants: [grant({ scope_type: 'global', scope_id: null })] },
    { entitlement: { is_active: true }, grants: [grant({ profile_id: OTHER_ACTOR })] },
    { entitlement: { is_active: true }, grants: [grant({ expires_at: 'invalid' })] },
    { entitlement: { is_active: true }, grants: [grant({ platform_roles: { key: 'dashboard_admin' } })] },
    ...['platform_products', 'platform_modules', 'platform_roles'].flatMap(key => [
      { entitlement: { is_active: true }, grants: [grant({ [key]: { ...(grant()[key] as Row), is_active: false } })] },
      { entitlement: { is_active: true }, grants: [grant({ [key]: { ...(grant()[key] as Row), product_id: 'other', id: 'other' } })] },
    ]),
  ]
  const outcome = async (run: () => Promise<unknown>) => {
    try { await run(); return 'allowed' } catch (error) { return (error as Error).message }
  }
  for (const options of cases) {
    const original = harness(options)
    const navigation = harness(options)
    assert.equal(await outcome(() => navigation.server.getObOrganizationSwitcherContext(ORG, { inspectionId: INSPECTION })),
      await outcome(() => original.server.requireObInspectionContext(INSPECTION, ORG)), JSON.stringify(options))
  }
})

test('navigation authenticates before reads and rejects non-owner before bindings or memberships', async () => {
  for (const options of [{ user: null }, { authError: true }]) {
    const h = harness(options)
    await assert.rejects(h.server.getObOrganizationSwitcherContext(ORG), { message: 'UNAUTHORIZED' })
    assert.deepEqual(h.calls.events, ['auth'])
  }
  const h = harness({ inspection: { id: INSPECTION, inspection_family: 'OB', type: 'OB', properties: { owner: OTHER_ACTOR } } })
  await assert.rejects(h.server.getObOrganizationSwitcherContext(ORG, { inspectionId: INSPECTION }), { message: 'OB_ORGANIZATION_FORBIDDEN' })
  assert.deepEqual(h.calls.queries.map(query => query.table), ['inspections'])
})

test('navigation preserves bound organization, assignment linkage and authorized-only mismatch errors', async () => {
  const linked = { id: OTHER_INSPECTION, org_id: ORG, inspection_id: INSPECTION, assignment_type: 'STATUS' }
  const h = harness({ assignment: linked })
  assert.equal((await h.server.getObOrganizationSwitcherContext(undefined, { assignmentId: OTHER_INSPECTION })).organization.id, ORG)
  assert.equal(h.calls.events.filter(event => event === 'auth').length, 1)
  await assert.rejects(h.server.getObOrganizationSwitcherContext(OTHER_ORG, { inspectionId: INSPECTION }), { message: 'OB_ORGANIZATION_MISMATCH' })
  const mismatch = harness({ assignment: { ...linked, org_id: OTHER_ORG } })
  await assert.rejects(mismatch.server.getObOrganizationSwitcherContext(undefined, { assignmentId: OTHER_INSPECTION }), { message: 'OB_ORGANIZATION_MISMATCH' })
  const disabled = harness({ entitlement: { is_active: false } })
  await assert.rejects(disabled.server.getObOrganizationSwitcherContext(OTHER_ORG, { inspectionId: INSPECTION }), { message: 'MODULE_ACCESS_REQUIRED' })
})

test('navigation fails closed on member/access reads, never silently hiding an unreadable organization', async () => {
  for (const table of ['org_members', 'organization_enabled_modules', 'platform_access_assignments', 'profiles']) {
    const h = harness({ tableErrors: { [table]: { message: 'private database details' } } })
    await assert.rejects(h.server.getObOrganizationSwitcherContext(ORG), { message: 'OB_ORGANIZATION_READ_FAILED' })
  }
})
