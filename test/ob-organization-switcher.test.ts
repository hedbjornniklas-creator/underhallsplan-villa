import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

function harness(options: { allowed?: string[]; membershipError?: boolean; accessError?: string } = {}) {
  const accessCalls: string[] = []
  const requested: unknown[] = []
  const members = [
    { org_id: 'a', profile_id: 'actor', is_active: true, is_default: true, organizations: { name: ' A ' } },
    { org_id: 'b', profile_id: 'actor', is_active: true, is_default: false, organizations: [{ name: 'B' }] },
    { org_id: 'c', profile_id: 'actor', is_active: true, is_default: false, organizations: null },
    { org_id: 'inactive', profile_id: 'actor', is_active: false },
    { org_id: 'other-person', profile_id: 'other', is_active: true },
  ]
  const invalid = () => { throw new Error('OB must not use another surface or legacy default context') }
  const dependencies: Record<string, unknown> = {
    'server-only': {},
    '@/lib/access/server': { hasCurrentUserAccess: invalid },
    '@/lib/customers/server': { getOrganizationCustomerNavigationContext: invalid },
    '@/lib/tu/server': { requireTuContext: invalid },
    '@/lib/moisture/server': { requireMoistureContext: invalid },
    './administration': { requireOrganizationContext: invalid },
    '@/lib/organizations/moduleAvailability': { hasOrganizationTuAccess: invalid },
    '@/lib/ob/organizationBindings': {
      requireObContext: async (orgId?: unknown) => {
        requested.push(orgId)
        return { orgId: orgId ?? 'b', userId: 'actor' }
      },
      hasOrganizationObAccess: async (orgId: string, userId: string) => {
        assert.equal(userId, 'actor')
        accessCalls.push(orgId)
        if (orgId === options.accessError) throw new Error('OB_ORGANIZATION_READ_FAILED')
        return (options.allowed ?? ['b', 'c']).includes(orgId)
      },
    },
    '@/lib/supabase/admin': { createSupabaseAdminClient: () => ({ from(table: string) {
      assert.equal(table, 'org_members')
      const filters: [string, unknown][] = []
      const query = {
        select: () => query,
        eq: (key: string, value: unknown) => { filters.push([key, value]); return query },
        order: () => query,
        then: (resolve: (result: unknown) => unknown) => Promise.resolve({
          data: members.filter(row => filters.every(([key, value]) => (row as Record<string, unknown>)[key] === value)),
          error: options.membershipError ? { message: 'internal database detail' } : null,
        }).then(resolve),
      }
      return query
    } }) },
  }
  const code = ts.transpileModule(readFileSync(new URL('../src/lib/organizations/server.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const compiled = { exports: {} }
  new Function('require', 'module', 'exports', code)((name: string) => {
    assert.ok(Object.hasOwn(dependencies, name), name)
    return dependencies[name]
  }, compiled, compiled.exports)
  const service = compiled.exports as { getOrganizationSwitcherContext: (surface: string, org?: unknown) => Promise<{
    organization: { id: string }; organizations: { id: string; name: string | null; isDefault: boolean }[]
  }> }
  return { service, accessCalls, requested }
}

test('OB switcher offers only the current actor’s active memberships allowed by OB authorization', async () => {
  const h = harness()
  const result = await h.service.getOrganizationSwitcherContext('ob', 'b')
  assert.equal(result.organization.id, 'b')
  assert.deepEqual(result.organizations, [
    { id: 'b', name: 'B', isDefault: false }, { id: 'c', name: null, isDefault: false },
  ])
  assert.deepEqual(h.accessCalls, ['a', 'b', 'c'])
  assert.deepEqual(h.requested, ['b'])
})

test('OB workspace without selection delegates choice to OB context, not a legacy bootstrap', async () => {
  const h = harness()
  assert.equal((await h.service.getOrganizationSwitcherContext('ob')).organization.id, 'b')
  assert.deepEqual(h.requested, [undefined])
})

test('OB selected organization cannot silently fall back when its access or membership disappears', async () => {
  for (const orgId of ['a', 'inactive', 'other-person', 'missing']) {
    const h = harness()
    await assert.rejects(h.service.getOrganizationSwitcherContext('ob', orgId), { message: 'MODULE_ACCESS_REQUIRED' })
  }
})

test('membership and individual access read errors fail the entire switcher instead of hiding an organization', async () => {
  for (const options of [{ membershipError: true }, { accessError: 'a' }]) {
    const h = harness(options)
    await assert.rejects(h.service.getOrganizationSwitcherContext('ob', 'b'), { message: 'OB_ORGANIZATION_READ_FAILED' })
  }
})
