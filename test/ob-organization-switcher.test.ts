import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

function harness(error?: string) {
  const calls: unknown[] = []
  const result = { organization: { id: 'b', name: 'B', isDefault: false }, organizations: [
    { id: 'b', name: 'B', isDefault: false }, { id: 'c', name: null, isDefault: true },
  ] }
  const invalid = () => { throw new Error('OB must use its request-local resolver, not a second auth/membership chain') }
  const dependencies: Record<string, unknown> = {
    'server-only': {},
    '@/lib/access/server': { hasCurrentUserAccess: invalid },
    '@/lib/customers/server': { getOrganizationCustomerNavigationContext: invalid },
    '@/lib/tu/server': { requireTuContext: invalid },
    '@/lib/moisture/server': { requireMoistureContext: invalid },
    './administration': { requireOrganizationContext: invalid },
    '@/lib/organizations/moduleAvailability': { hasOrganizationTuAccess: invalid },
    '@/lib/ob/organizationBindings': { getObOrganizationSwitcherContext: async (org: unknown, entity: unknown) => {
      calls.push([org, entity])
      if (error) throw new Error(error)
      return result
    } },
    '@/lib/supabase/admin': { createSupabaseAdminClient: invalid },
  }
  const code = ts.transpileModule(readFileSync(new URL('../src/lib/organizations/server.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const compiled = { exports: {} }
  new Function('require', 'module', 'exports', code)((name: string) => {
    assert.ok(Object.hasOwn(dependencies, name), name)
    return dependencies[name]
  }, compiled, compiled.exports)
  const service = compiled.exports as { getOrganizationSwitcherContext: (surface: string, org?: unknown, entity?: unknown) => Promise<typeof result> }
  return { service, calls, result }
}

test('OB switcher delegates selection and entity validation to one request-local resolver without extra reads', async () => {
  for (const [org, entity] of [[undefined, undefined], ['b', undefined], [undefined, { inspectionId: 'id' }], ['b', { assignmentId: 'id' }]]) {
    const h = harness()
    assert.equal(await h.service.getOrganizationSwitcherContext('ob', org, entity), h.result)
    assert.deepEqual(h.calls, [[org, entity]])
  }
})

test('OB switcher cannot fall back after an authorization, entity or read failure', async () => {
  for (const error of ['UNAUTHORIZED', 'ORG_MEMBERSHIP_REQUIRED', 'MODULE_ACCESS_REQUIRED', 'OB_ORGANIZATION_MISMATCH', 'OB_ORGANIZATION_READ_FAILED']) {
    const h = harness(error)
    await assert.rejects(h.service.getOrganizationSwitcherContext('ob', 'b'), { message: error })
    assert.deepEqual(h.calls, [['b', undefined]])
  }
})
