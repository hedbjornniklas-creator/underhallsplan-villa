import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const uiPath = 'src/app/(app)/admin/access/organisations/OrganizationAdministrationClient.tsx'
const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
function load<T>(path: string, dependencies: Record<string, unknown>): T {
  const compiled = ts.transpileModule(source(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
  const mod = { exports: {} }
  new Function('require', 'module', 'exports', compiled)((name: string) => {
    if (Object.hasOwn(dependencies, name)) return dependencies[name]
    throw new Error(`Unexpected import ${name}`)
  }, mod, mod.exports)
  return mod.exports as T
}

test('organization admin page requires explicit global access-management gate', async () => {
  const calls: unknown[] = []
  const jsx = (type: unknown, props: unknown) => ({ type, props })
  const page = load<{ default: () => Promise<unknown> }>('src/app/(app)/admin/access/organisations/page.tsx', {
    'react/jsx-runtime': { jsx, jsxs: jsx }, 'next/navigation': { redirect: () => { throw new Error('REDIRECT') } },
    '@/lib/access/server': { requireModuleAccess: async (scope: unknown) => { calls.push(scope) } },
    './OrganizationAdministrationClient': { default: 'Client' },
  })
  await page.default()
  assert.deepEqual(calls, [{ productKey: 'hushub_admin', moduleKey: 'access_management', scopeType: 'global' }])
})

test('draft comparison is order independent and checks role, membership and modules separately', () => {
  const ui = load<{ sameModules: (a: string[], b: string[]) => boolean; sameMember: (a: object, b: object) => boolean }>(uiPath, {
    react: {}, 'react/jsx-runtime': {}, 'next/link': {},
  })
  assert.equal(ui.sameModules(['b', 'a'], ['a', 'b']), true)
  const member = { role: 'inspector', isActive: true, modules: [] }
  assert.equal(ui.sameMember(member, { ...member }), true)
  assert.equal(ui.sameMember(member, { ...member, role: 'admin' }), false)
  assert.equal(ui.sameMember(member, { ...member, isActive: false }), false)
  assert.equal(ui.sameMember(member, { ...member, modules: ['technical_investigations'] }), false)
})

test('all central navigation surfaces expose organizations without replacing global module controls', () => {
  for (const file of ['src/app/(app)/admin/AdminLandingClient.tsx', 'src/app/(app)/admin/access/AccessManagementClient.tsx']) {
    assert.match(source(file), /\/admin\/access\/organisations/)
  }
  const access = source('src/app/(app)/admin/access/AccessManagementClient.tsx')
  assert.match(access, /Detta är en profiltext, inte medlemskap eller behörighet/)
  assert.match(access, /Öppna organisationshantering i ny flik/)
  assert.match(access, /scopeType: 'global'/)
})

test('write UI remains explicit, preserves optimistic baselines and freezes create retries', () => {
  const ui = source(uiPath)
  assert.match(ui, /window\.confirm/)
  assert.match(ui, /expectedModules: detail\.organization\.modules/)
  assert.match(ui, /memberBaselines\[profileId\]/)
  assert.match(ui, /pendingEdits\.current/)
  assert.match(ui, /generation !== detailGeneration\.current \|\| id !== selectedRef\.current/)
  assert.match(ui, /if \(!createAttempted\) setCreate/)
  assert.match(ui, /fieldset disabled=\{createAttempted\}/)
  assert.match(ui, /väntande TU-inbjudningar återkallas/)
  assert.match(ui, /ÖB och EB lämnas oförändrade/)
  assert.match(ui, /Ingen e-post skickas här/)
})
