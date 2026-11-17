import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
// @ts-expect-error Node's strip-types runner needs the explicit TypeScript extension.
import { loadTuModule } from './helpers/load-tu-module.ts'
// @ts-expect-error Node's strip-types runner needs the explicit TypeScript extension.
import { legacyTuOverviewHref } from '../src/lib/tu/legacyListRedirect.ts'

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

for (const list of ['assignments', 'investigations']) {
  test(`legacy TU ${list} list redirects to the overview with its organization intact`, async () => {
    const page = loadTuModule<{ default: (props: { searchParams: Promise<object> }) => Promise<void> }>(
      `src/app/(dashboard)/tu/${list}/page.tsx`,
      { 'next/navigation': { redirect: (href: string) => { throw new Error(href) } } },
    )
    for (const params of [{}, { orgId: 'org-1' }, { orgId: 'org & test' }, { orgId: ['org-1', 'org-2'] }, { orgId: '' }]) {
      await assert.rejects(page.default({ searchParams: Promise.resolve(params) }), { message: legacyTuOverviewHref(params) })
    }
  })
}

test('legacy redirect preserves duplicate organization selections instead of bypassing validation', () => {
  assert.equal(legacyTuOverviewHref({}), '/tu')
  const url = new URL(legacyTuOverviewHref({ orgId: ['org & test', 'other'] }), 'https://example.test')
  assert.equal(url.pathname, '/tu')
  assert.deepEqual(url.searchParams.getAll('orgId'), ['org & test', 'other'])
})

test('TU detail back links return directly to the unified overview', () => {
  const investigation = read('src/components/tu/TuInvestigationEditorClient.tsx')
  const assignment = read('src/app/(dashboard)/tu/assignments/[id]/page.tsx')
  assert.match(investigation, /href=\{organizationUrl\('\/tu', investigation\.orgId\)\}/)
  assert.match(assignment, /organizationUrl\('\/tu', organizationId\)/)
  for (const source of [investigation, assignment]) {
    assert.match(source, /Till TU-översikten/)
    assert.doesNotMatch(source, /organizationUrl\('\/tu\/(?:assignments|investigations)'/)
  }
})

test('overview no longer offers the retired lists, but keeps detail actions', () => {
  const dashboard = read('src/components/tu/TuDashboardClient.tsx')
  assert.doesNotMatch(dashboard, /Alla uppdragsbekräftelser|Alla utredningar/)
  const overview = read('src/components/tu/TuOverview.tsx')
  for (const action of ['item.confirmationHref', 'item.investigationHref', 'TuAssignmentActions', 'TuCopyInvestigationLink']) {
    assert.ok(overview.includes(action), action)
  }
})
