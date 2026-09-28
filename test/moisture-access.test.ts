import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import type * as AccessServer from '../src/lib/access/server'
import type * as OrganizationServer from '../src/lib/organizations/server'
// @ts-expect-error Node's strip-types test runner requires the explicit TypeScript extension.
import { organizationSwitchDestination, organizationSwitcherRoot, organizationSwitcherSurfaceForPath } from '../src/lib/organizations/navigation.ts'
// @ts-expect-error Node's strip-types test runner requires the explicit TypeScript extension.
import { PLATFORM_MODULE_KEYS } from '../src/lib/access/model.ts'

const read = (file: string) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')

function load<T>(file: string, dependencies: Record<string, unknown>): T {
  const code = ts.transpileModule(read(file), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
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
      const result = () => {
        if (table === 'profiles') return {
          data: { id: 'profile-1', full_name: 'Testperson', email: 'person@example.test', is_admin: options.legacyAdmin ?? false },
          error: null,
        }
        if (table === 'platform_access_assignments') return options.missingSchema
          ? { data: null, error: { message: 'relation platform_access_assignments does not exist' } }
          : { data: rows.filter(row => filters.every(([key, value]) => row[key as keyof typeof row] === value)), error: null }
        if (table === 'org_members') return { data: organizations, error: null }
        throw new Error(`Unexpected table ${table}`)
      }
      const query = {
        select: () => query,
        eq: (key: string, value: unknown) => { filters.push([key, value]); return query },
        order: () => query,
        limit: () => query,
        maybeSingle: async () => result(),
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
    '@/lib/access/server': access,
    '@/lib/customers/server': { getOrganizationCustomerNavigationContext: () => { throw new Error('Unexpected customer context') } },
    '@/lib/tu/server': { requireTuContext: () => { throw new Error('Moisture must not reuse TU authorization') } },
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
