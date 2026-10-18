import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const read = (path: string) => readFileSync(path, 'utf8')
function load<T>(path: string, deps: Record<string, unknown> = {}): T {
  const source = ts.transpileModule(read(path), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const compiled = { exports: {} }
  new Function('require', 'module', 'exports', source)((name: string) => { assert.ok(name in deps, name); return deps[name] }, compiled, compiled.exports)
  return compiled.exports as T
}
const helper = load<typeof import('../src/lib/ob/legacyListRedirect')>('src/lib/ob/legacyListRedirect.ts')

test('both retired list routes redirect without queries, reads or mutations and preserve the org selection', async () => {
  for (const path of ['src/app/(dashboard)/ob/assignments/page.tsx', 'src/app/(dashboard)/inspections/page.tsx']) {
    const route = load<{ default: (props: { searchParams: Promise<{ orgId?: string | string[] }> }) => Promise<void> }>(path, {
      'next/navigation': { redirect: (url: string) => { throw Error(`REDIRECT:${url}`) } },
      '@/lib/ob/legacyListRedirect': helper,
    })
    for (const params of [{}, { orgId: 'org-a' }, { orgId: 'org-b' }, { orgId: ['org-a', 'org-b'] }, { orgId: 'https://evil.test/\n?a=b' }]) {
      await assert.rejects(route.default({ searchParams: Promise.resolve(params) }), error =>
        error instanceof Error && error.message === `REDIRECT:${helper.legacyObOverviewHref(params)}`)
    }
    assert.doesNotMatch(read(path), /fetch|supabase|\.from\(|useEffect|localStorage/)
  }
  assert.equal(helper.legacyObOverviewHref({}), '/ob')
  assert.equal(helper.legacyObOverviewHref({ orgId: ['one', 'two'] }), '/ob?orgId=one&orgId=two')
})

test('home and back navigation no longer point to the old generic lists; detail and create workflows stay intact', () => {
  const home = read('src/components/ob/ObHomeActions.tsx')
  assert.doesNotMatch(home, /withObOrganization\('\/ob\/assignments',|withObOrganization\('\/inspections',/)
  assert.match(home, /withObOrganization\('\/ob\/assignments\/new',/)
  for (const path of ['src/app/(dashboard)/ob/assignments/[id]/page.tsx',
    'src/app/(dashboard)/ob/assignments/new/NewAssignmentClient.tsx', 'src/app/(app)/properties/[id]/ob/[inspectionId]/page.tsx']) {
    const source = read(path)
    assert.match(source, /router\.push\(withObOrganization\('\/ob', orgId\)\)/)
    assert.doesNotMatch(source, /router\.push\(withObOrganization\('\/(?:inspections|ob\/assignments)',/)
  }
  assert.match(read('src/lib/ob/overview.ts'), /confirmationHref: assignment \? `\/ob\/assignments\/\$\{assignment\.id\}`/)
})
