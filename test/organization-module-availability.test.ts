import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

function harness(data: { is_active: boolean } | null, error: unknown = null) {
  const calls: unknown[][] = []
  const query = {
    select: (...args: unknown[]) => { calls.push(['select', ...args]); return query },
    eq: (...args: unknown[]) => { calls.push(['eq', ...args]); return query },
    maybeSingle: async () => ({ data, error }),
  }
  const output = ts.transpileModule(readFileSync(new URL('../src/lib/organizations/moduleAvailability.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const compiled = { exports: {} as { hasOrganizationTuAccess: (org: string, scoped: boolean, global: boolean) => Promise<boolean> } }
  new Function('require', 'module', 'exports', output)((name: string) => {
    if (name === 'server-only') return {}
    if (name === '@/lib/supabase/admin') return { createSupabaseAdminClient: () => ({
      from: (table: string) => { calls.push(['from', table]); return query },
    }) }
    throw new Error(`Unexpected dependency: ${name}`)
  }, compiled, compiled.exports)
  return { ...compiled.exports, calls }
}

test('organization TU availability preserves untouched legacy but respects explicit on/off', async () => {
  for (const [data, expected] of [[null, true], [{ is_active: true }, true], [{ is_active: false }, false]] as const) {
    const h = harness(data)
    assert.equal(await h.hasOrganizationTuAccess('org-a', true, false), expected)
    assert.deepEqual(h.calls, [
      ['from', 'organization_enabled_modules'], ['select', 'is_active'],
      ['eq', 'org_id', 'org-a'], ['eq', 'module_key', 'technical_investigations'],
    ])
  }
})

test('organization TU availability fails closed on missing schema or provider failure', async () => {
  for (const error of [{ code: '42P01' }, { message: 'secret provider diagnostic' }]) {
    await assert.rejects(harness(null, error).hasOrganizationTuAccess('org-a', true, true), /^Error: MODULE_ACCESS_REQUIRED$/)
  }
})

test('managed TU needs personal scoped access; enabling never activates a legacy global grant', async () => {
  assert.equal(await harness(null).hasOrganizationTuAccess('legacy', false, true), true)
  assert.equal(await harness(null).hasOrganizationTuAccess('legacy', false, false), false)
  assert.equal(await harness({ is_active: true }).hasOrganizationTuAccess('managed', false, true), false)
  assert.equal(await harness({ is_active: true }).hasOrganizationTuAccess('managed', true, false), true)
  assert.equal(await harness({ is_active: false }).hasOrganizationTuAccess('managed', true, true), false)
})
