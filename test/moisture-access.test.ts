import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import type * as AccessServer from '../src/lib/access/server'
import type * as OrganizationServer from '../src/lib/organizations/server'
import type * as AccessManagementClient from '../src/app/(app)/admin/access/AccessManagementClient'
// @ts-expect-error Node's strip-types test runner requires the explicit TypeScript extension.
import { organizationSwitchDestination, organizationSwitcherRoot, organizationSwitcherSurfaceForPath } from '../src/lib/organizations/navigation.ts'
// @ts-expect-error Node's strip-types test runner requires the explicit TypeScript extension.
import { PLATFORM_MODULE_KEYS } from '../src/lib/access/model.ts'

const read = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')

function load<T>(file: string, dependencies: Record<string, unknown>): T {
  const code = ts.transpileModule(read(file), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
  const compiled = { exports: {} }
  new Function('require', 'module', 'exports', code)(
    (key: string) => {
      if (key in dependencies) return dependencies[key]
      throw new Error(`Unexpected dependency ${key}`)
    }, compiled, compiled.exports
  )
  return compiled.exports as T
}

type Grant = {
  moduleKey: string | null
  scopeType: 'global' | 'organization'
  scopeId?: string | null
  active?: boolean
  expiresAt?: string | null
}

const check = { productKey: 'dashboard', moduleKey: 'moisture_safety' } as const

function harness(options: { grants?: Grant[]; missingSchema?: boolean; legacyAdmin?: boolean } = {}) {
  const organizations = [
    { org_id: 'org-a', is_default: true, created_at: '2026-01-01', organizations: { name: 'Org A' } },
    { org_id: 'org-b', is_default: false, created_at: '2026-01-02', organizations: { name: 'Org B' } },
  ]
  const rows = (options.grants ?? []).map((grant, index) => ({
    id: `grant-${index}`, product_id: 'dashboard-id', module_id: grant.moduleKey,
    role_id: 'inspector-id', profile_id: 'profile-1', is_active: grant.active !== false,
    scope_type: grant.scopeType, scope_id: grant.scopeId ?? null,
    expires_at: grant.expiresAt ?? null,
    platform_products: { key: 'dashboard', label: 'BesiktApp' },
    platform_modules: grant.moduleKey ? { key: grant.moduleKey, label: grant.moduleKey } : null,
    platform_roles: { key: 'inspector', label: 'Besiktningsman' },
  }))
  const admin = {
    from(table: string) {
      const filters: Array<[string, unknown]> = []
      const setFilters: Array<[string, unknown[]]> = []
      const result = () => {
        if (table === 'profiles') return {
          data: { id: 'profile-1', full_name: 'Testperson', email: 'person@example.test', is_admin: options.legacyAdmin ?? false },
          error: null,
        }
        if (table === 'platform_access_assignments') return options.missingSchema
          ? { data: null, error: { message: 'relation platform_access_assignments does not exist' } }
          : { data: rows.filter(row => filters.every(([key, value]) => key === 'platform_products.key'
            ? row.platform_products.key === value : row[key as keyof typeof row] === value)
            && setFilters.every(([key, values]) => values.includes((row as Record<string, unknown>)[key]))), error: null }
        if (table === 'org_members') return { data: organizations, error: null }
        throw new Error(`Unexpected table ${table}`)
      }
      const query = {
        select: () => query,
        eq: (key: string, value: unknown) => { filters.push([key, value]); return query },
        in: (key: string, values: unknown[]) => { setFilters.push([key, values]); return query },
        order: () => query,
        limit: () => query,
        maybeSingle: async () => {
          const response = result()
          return { ...response, data: Array.isArray(response.data) ? response.data[0] ?? null : response.data }
        },
        then: (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve),
      }
      return query
    },
  }
  const access = load<typeof AccessServer>('src/lib/access/server.ts', {
    'server-only': {},
    '@/lib/supabase/admin': { createSupabaseAdminClient: () => admin },
    '@/lib/supabase/server': {
      createSupabaseServerClient: () => ({ auth: {
        getUser: async () => ({ data: { user: { id: 'profile-1', email: 'person@example.test' } }, error: null }),
      } }),
    },
  })
  const selectedOrgIds: unknown[] = []
  const service = load<typeof OrganizationServer>('src/lib/organizations/server.ts', {
    'server-only': {},
    './administration': { requireOrganizationContext: () => { throw new Error('Moisture must not use settings-only authorization') } },
    '@/lib/access/server': access,
    '@/lib/customers/server': { getOrganizationCustomerNavigationContext: () => { throw new Error('Unexpected customer context') } },
    '@/lib/tu/server': { requireTuContext: () => { throw new Error('Moisture must not reuse TU authorization') } },
    '@/lib/organizations/moduleAvailability': { hasOrganizationTuAccess: () => { throw new Error('Moisture must not use TU entitlements') } },
    '@/lib/moisture/server': { requireMoistureContext: async (orgId: unknown) => {
      selectedOrgIds.push(orgId)
      return { orgId: orgId ?? 'org-a', orgName: 'Selected', userId: 'profile-1' }
    } },
    '@/lib/supabase/admin': { createSupabaseAdminClient: () => admin },
  })
  return { access, service, selectedOrgIds }
}

test('moisture is registered but grants no access through legacy roles, TU, or a product-wide grant', async () => {
  assert.ok(PLATFORM_MODULE_KEYS.dashboard.includes('moisture_safety'))
  for (const options of [
    {}, { missingSchema: true }, { legacyAdmin: true }, { missingSchema: true, legacyAdmin: true },
    { grants: [{ moduleKey: 'technical_investigations', scopeType: 'global' as const }] },
    { grants: [{ moduleKey: null, scopeType: 'global' as const }] },
  ]) {
    const { access } = harness(options)
    assert.equal(await access.hasCurrentUserAccess(check), false)
    await assert.rejects(access.requireModuleAccess(check), /MODULE_ACCESS_REQUIRED/)
  }
})

test('organization grants are exact and another module cannot supply global moisture access', async () => {
  const { access } = harness({ grants: [
    { moduleKey: 'moisture_safety', scopeType: 'organization', scopeId: 'org-a' },
    { moduleKey: 'technical_investigations', scopeType: 'global' },
  ] })
  assert.equal(await access.hasCurrentUserAccess(check), true)
  assert.equal(await access.hasCurrentUserAccess({ ...check, scopeType: 'organization', scopeId: 'org-a' }), true)
  assert.equal(await access.hasCurrentUserAccess({ ...check, scopeType: 'organization', scopeId: 'org-b' }), false)
  assert.equal(await access.hasCurrentUserAccess({ ...check, scopeType: 'global' }), false)
})

test('only active, unexpired explicit moisture grants authorize the module', async () => {
  const { access } = harness({ grants: [
    { moduleKey: 'moisture_safety', scopeType: 'global', active: false },
    { moduleKey: 'moisture_safety', scopeType: 'organization', scopeId: 'org-a', expiresAt: '2000-01-01T00:00:00Z' },
  ] })
  assert.equal(await access.hasCurrentUserAccess(check), false)
  const global = harness({ grants: [{ moduleKey: 'moisture_safety', scopeType: 'global' }] })
  assert.equal(await global.access.hasCurrentUserAccess({ ...check, scopeType: 'global' }), true)
})

test('moisture switcher resolves its own context and offers only permitted memberships', async () => {
  const { service, selectedOrgIds } = harness({ grants: [
    { moduleKey: 'moisture_safety', scopeType: 'organization', scopeId: 'org-b' },
    { moduleKey: 'technical_investigations', scopeType: 'global' },
  ] })
  const result = await service.getOrganizationSwitcherContext('moisture', 'org-b')
  assert.deepEqual(selectedOrgIds, ['org-b'])
  assert.equal(result.organization.id, 'org-b')
  assert.deepEqual(result.organizations.map(org => org.id), ['org-b'])
  await assert.rejects(service.getOrganizationSwitcherContext('moisture', 'org-a'), /MODULE_ACCESS_REQUIRED/)
})

test('an explicit global moisture grant permits all memberships but never adds an unjoined organization', async () => {
  const { service } = harness({ grants: [
    { moduleKey: 'moisture_safety', scopeType: 'organization', scopeId: 'org-a' },
    { moduleKey: 'moisture_safety', scopeType: 'global' },
  ] })
  const result = await service.getOrganizationSwitcherContext('moisture', 'org-b')
  assert.deepEqual(result.organizations.map(org => org.id), ['org-a', 'org-b'])
  await assert.rejects(service.getOrganizationSwitcherContext('moisture', 'not-a-member'), /MODULE_ACCESS_REQUIRED/)
})

test('organization changes leave moisture project detail and discard the previous project query', () => {
  assert.equal(organizationSwitcherSurfaceForPath('/fuktsakerhet'), 'moisture')
  assert.equal(organizationSwitcherSurfaceForPath('/fuktsakerhet/projects/project-a'), 'moisture')
  assert.equal(organizationSwitcherSurfaceForPath('/fuktsakerhet-extra'), null)
  assert.equal(organizationSwitcherRoot('moisture'), '/fuktsakerhet')
  assert.equal(organizationSwitchDestination({
    pathname: '/fuktsakerhet/projects/project-a', search: 'orgId=org-a&document=old-document',
    surface: 'moisture', orgId: 'org-b',
  }), '/fuktsakerhet?orgId=org-b')
  assert.equal(organizationSwitchDestination({
    pathname: '/fuktsakerhet', search: 'orgId=org-a', surface: 'moisture', orgId: 'org-b',
  }), '/fuktsakerhet?orgId=org-b')
})

test('dashboard and module navigation include moisture without extending invitation defaults', () => {
  assert.match(read('src/app/(dashboard)/dashboard-v1/page.tsx'), /moduleKey: 'moisture_safety'/)
  assert.match(read('src/components/Topbar.tsx'), /organizationHref\('\/fuktsakerhet'\)/)
  assert.doesNotMatch(read('src/lib/besiktapp/invitationContracts.ts'), /moisture_safety/)
})

test('organization context endpoint accepts moisture, keeps responses private and denies a different organization', async () => {
  const { service } = harness({ grants: [
    { moduleKey: 'moisture_safety', scopeType: 'organization', scopeId: 'org-a' },
  ] })
  const route = load<{ GET: (request: Request) => Promise<Response> }>('src/app/api/organizations/context/route.ts', {
    'next/server': { NextResponse: { json: (body: unknown, init: ResponseInit) => Response.json(body, init) } },
    '@/lib/organizations/server': service,
  })
  const allowed = await route.GET(new Request('https://hushub.test/api/organizations/context?surface=moisture&orgId=org-a'))
  assert.equal(allowed.status, 200)
  assert.match(allowed.headers.get('Cache-Control') ?? '', /private, no-store/)
  assert.equal((await allowed.json()).organization.id, 'org-a')
  const denied = await route.GET(new Request('https://hushub.test/api/organizations/context?surface=moisture&orgId=org-b'))
  assert.equal(denied.status, 403)
  const duplicate = await route.GET(new Request('https://hushub.test/api/organizations/context?surface=moisture&orgId=org-a&orgId=org-b'))
  assert.equal(duplicate.status, 400)
  const unknown = await route.GET(new Request('https://hushub.test/api/organizations/context?surface=unknown'))
  assert.equal(unknown.status, 400)
})

const adminUi = load<typeof AccessManagementClient>('src/app/(app)/admin/access/AccessManagementClient.tsx', {
  react: {},
  'next/link': {},
  'react/jsx-runtime': {},
  '@/components/Protected': {},
})
type DashboardGrant = Parameters<typeof AccessManagementClient.createDashboardRows>[1][number]
const dashboardModules = ['inspections', 'construction_inspections', 'technical_investigations', 'moisture_safety']
  .map(key => ({ id: `module-${key}`, key, label: key, description: null }))

function dashboardGrant(id: string, changes: Partial<DashboardGrant> = {}): DashboardGrant {
  return {
    id, productId: 'dashboard-id', productKey: 'dashboard', productLabel: 'BesiktApp',
    moduleId: 'module-inspections', moduleKey: 'inspections', moduleLabel: 'ÖB',
    roleId: 'inspector-id', roleKey: 'inspector', roleLabel: 'Besiktningsman',
    scopeType: 'global', scopeId: null, scopeLabel: 'Global',
    grantedReason: 'Behåll denna anteckning', expiresAt: '2099-01-01T00:00:00Z', createdAt: '2026-01-01T00:00:00Z',
    ...changes,
  }
}

const ownerGrants = [
  dashboardGrant('org-admin', { moduleId: null, moduleKey: null, roleId: 'admin-id', roleKey: 'dashboard_admin', scopeType: 'organization', scopeId: 'org-a' }),
  dashboardGrant('org-tasks', { moduleId: 'module-tasks', moduleKey: 'tasks', roleId: 'task-role', roleKey: 'task_coordinator', scopeType: 'organization', scopeId: 'org-a' }),
  ...dashboardModules.slice(0, 3).map(module => dashboardGrant(`global-${module.key}`, { moduleId: module.id, moduleKey: module.key })),
]

test('activating moisture is additive for the owner and leaves organization admin, tasks and unchanged grants intact', () => {
  const before = structuredClone(ownerGrants)
  const rows = adminUi.createDashboardRows(dashboardModules, ownerGrants)
  assert.deepEqual(rows.map(row => row.enabled), [true, true, true, false])
  const updated = rows.map(row => row.moduleId === 'module-moisture_safety' ? { ...row, enabled: true } : row)
  assert.deepEqual(adminUi.dashboardAssignmentChanges(updated, ownerGrants), [
    { kind: 'grant', moduleId: 'module-moisture_safety' },
  ])
  assert.deepEqual(adminUi.dashboardAssignmentChanges(rows, ownerGrants), [])
  assert.deepEqual(ownerGrants, before)
})

test('global module toggles are never inferred from organization grants or broad legacy grants', () => {
  const grants = [
    ownerGrants[0], ownerGrants[1],
    dashboardGrant('legacy-global', { moduleId: null, moduleKey: null }),
    dashboardGrant('legacy-org', { moduleId: null, moduleKey: null, scopeType: 'organization', scopeId: 'org-a' }),
    ...dashboardModules.map(module => dashboardGrant(`org-${module.key}`, {
      moduleId: module.id, moduleKey: module.key, scopeType: 'organization', scopeId: 'org-a',
    })),
  ]
  const rows = adminUi.createDashboardRows(dashboardModules, grants)
  assert.ok(rows.every(row => !row.enabled && row.assignmentId === null))
  assert.deepEqual(adminUi.dashboardAssignmentChanges(rows, grants), [])
})

test('disabling one global module revokes only that grant and preserves matching organization and broad legacy access', () => {
  const grants = [
    ...ownerGrants,
    dashboardGrant('org-eb', { moduleId: 'module-construction_inspections', moduleKey: 'construction_inspections', scopeType: 'organization', scopeId: 'org-b' }),
    dashboardGrant('broad-global', { moduleId: null, moduleKey: null }),
  ]
  const rows = adminUi.createDashboardRows(dashboardModules, grants)
    .map(row => row.moduleId === 'module-construction_inspections' ? { ...row, enabled: false } : row)
  assert.deepEqual(adminUi.dashboardAssignmentChanges(rows, grants), [
    { kind: 'revoke', assignmentId: 'global-construction_inspections' },
  ])
})

test('an incomplete module catalog never removes or rewrites grants that have no rendered toggle', () => {
  const rows = adminUi.createDashboardRows(dashboardModules.filter(module => module.key === 'moisture_safety'), ownerGrants)
  assert.deepEqual(adminUi.dashboardAssignmentChanges(rows, ownerGrants), [])
})
