import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

function load<T>(path: string, dependencies: Record<string, unknown>): T {
  const code = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const compiled = { exports: {} }
  new Function('require', 'module', 'exports', code)((name: string) => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name]
    throw new Error(`Unexpected TU switcher dependency: ${name}`)
  }, compiled, compiled.exports)
  return compiled.exports as T
}

type Context = { organization: { id: string }; organizations: { id: string }[] }
type Service = { getOrganizationSwitcherContext: (surface: string, orgId?: string) => Promise<Context> }

function harness(options: {
  global?: boolean
  scoped?: string[]
  enabled?: Record<string, boolean>
  entitlementError?: boolean
} = {}) {
  const permissionCalls: { moduleKey: string; scopeType: string; scopeId?: string }[] = []
  const entitlementReads: string[] = []
  const memberships = [
    ...['org-a', 'org-b', 'org-c', 'org-d'].map((org_id, index) => ({ org_id, profile_id: 'person', is_active: true,
      is_default: index === 0, created_at: `${index}`, organizations: { name: org_id } })),
    { org_id: 'inactive', profile_id: 'person', is_active: false, is_default: false, created_at: '5', organizations: { name: 'Inactive' } },
    { org_id: 'someone-else', profile_id: 'other', is_active: true, is_default: false, created_at: '6', organizations: { name: 'Other' } },
  ]
  const db = {
    from(table: string) {
      const filters: [string, unknown][] = []
      const result = () => {
        if (table === 'org_members') return { data: memberships.filter(row => filters.every(([key, value]) => (row as Record<string, unknown>)[key] === value)), error: null }
        assert.equal(table, 'organization_enabled_modules')
        assert.ok(filters.some(([key, value]) => key === 'module_key' && value === 'technical_investigations'))
        const orgId = String(filters.find(([key]) => key === 'org_id')?.[1])
        entitlementReads.push(orgId)
        return { data: options.enabled && Object.hasOwn(options.enabled, orgId) ? { is_active: options.enabled[orgId] } : null,
          error: options.entitlementError ? { message: 'private database details' } : null }
      }
      const query = {
        select: () => query,
        eq: (key: string, value: unknown) => { filters.push([key, value]); return query },
        order: () => query,
        maybeSingle: async () => result(),
        then: (resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) => Promise.resolve().then(result).then(resolve, reject),
      }
      return query
    },
  }
  const availability = load<Record<string, unknown>>('src/lib/organizations/moduleAvailability.ts', {
    'server-only': {}, '@/lib/supabase/admin': { createSupabaseAdminClient: () => db },
  })
  const invalidSurface = () => { throw new Error('TU switcher must use TU context') }
  const service = load<Service>('src/lib/organizations/server.ts', {
    'server-only': {}, '@/lib/supabase/admin': { createSupabaseAdminClient: () => db },
    '@/lib/access/server': { hasCurrentUserAccess: async (input: { moduleKey: string; scopeType: string; scopeId?: string }) => {
      permissionCalls.push(input)
      assert.equal(input.moduleKey, 'technical_investigations')
      return input.scopeType === 'global' ? Boolean(options.global) : (options.scoped ?? []).includes(input.scopeId ?? '')
    } },
    '@/lib/organizations/moduleAvailability': availability,
    '@/lib/ob/organizationBindings': { requireObContext: invalidSurface, hasOrganizationObAccess: invalidSurface },
    '@/lib/tu/server': { requireTuContext: async (orgId: string | undefined) => ({ userId: 'person', orgId: orgId ?? 'org-a' }) },
    '@/lib/moisture/server': { requireMoistureContext: invalidSurface },
    '@/lib/customers/server': { getOrganizationCustomerNavigationContext: invalidSurface },
    './administration': { requireOrganizationContext: invalidSurface },
  })
  return { service, permissionCalls, entitlementReads }
}

test('TU switcher excludes disabled and unassigned managed organizations despite an old global grant', async () => {
  const h = harness({ global: true, scoped: ['org-b', 'org-c'], enabled: { 'org-a': true, 'org-b': true, 'org-c': false } })
  const result = await h.service.getOrganizationSwitcherContext('tu', 'org-b')
  assert.equal(result.organization.id, 'org-b')
  assert.deepEqual(result.organizations.map(org => org.id), ['org-b', 'org-d'])
  assert.deepEqual(h.entitlementReads, ['org-a', 'org-b', 'org-c', 'org-d'])
  assert.deepEqual(h.permissionCalls.filter(call => call.scopeType === 'organization').map(call => call.scopeId), ['org-a', 'org-b', 'org-c', 'org-d'])
})

test('TU switcher needs personal scoped access in an enabled managed organization and never borrows another organization grant', async () => {
  const h = harness({ scoped: ['org-b'], enabled: { 'org-a': true, 'org-b': true, 'org-c': false } })
  const result = await h.service.getOrganizationSwitcherContext('tu', 'org-b')
  assert.deepEqual(result.organizations.map(org => org.id), ['org-b'])
  await assert.rejects(h.service.getOrganizationSwitcherContext('tu', 'org-a'), { message: 'MODULE_ACCESS_REQUIRED' })
  await assert.rejects(h.service.getOrganizationSwitcherContext('tu', 'org-d'), { message: 'MODULE_ACCESS_REQUIRED' })
})

test('TU switcher preserves untouched legacy global access only for active member organizations without a management row', async () => {
  const h = harness({ global: true })
  const result = await h.service.getOrganizationSwitcherContext('tu', 'org-a')
  assert.deepEqual(result.organizations.map(org => org.id), ['org-a', 'org-b', 'org-c', 'org-d'])
  await assert.rejects(h.service.getOrganizationSwitcherContext('tu', 'inactive'), { message: 'MODULE_ACCESS_REQUIRED' })
  await assert.rejects(h.service.getOrganizationSwitcherContext('tu', 'someone-else'), { message: 'MODULE_ACCESS_REQUIRED' })
})

test('TU switcher fails closed on an entitlement read error instead of presenting global-grant fallback', async () => {
  const h = harness({ global: true, scoped: ['org-a'], entitlementError: true })
  await assert.rejects(h.service.getOrganizationSwitcherContext('tu', 'org-a'), { message: 'MODULE_ACCESS_REQUIRED' })
})

test('an explicitly disabled TU organization cannot remain selected through a global or scoped grant', async () => {
  const h = harness({ global: true, scoped: ['org-a', 'org-b'], enabled: { 'org-a': false, 'org-b': true } })
  await assert.rejects(h.service.getOrganizationSwitcherContext('tu', 'org-a'), { message: 'MODULE_ACCESS_REQUIRED' })
})
