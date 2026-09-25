import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

function load<T>(path: string, deps: Record<string, unknown> = {}): T {
  const output = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
  const compiled = { exports: {} }
  new Function('require', 'module', 'exports', output)((name: string) => {
    assert.ok(name in deps, name); return deps[name]
  }, compiled, compiled.exports)
  return compiled.exports as T
}
const helpers = load<typeof import('../src/lib/ob/publishedReport')>('src/lib/ob/publishedReport.ts', {
  '@/lib/report/reportSnapshotPayload': load('src/lib/report/reportSnapshotPayload.ts'),
  './publishedReportLink': load('src/lib/ob/publishedReportLink.ts'),
})
const inspectionId = '10000000-0000-4000-8000-000000000001'
const linkId = '10000000-0000-4000-8000-000000000002'
const access = { orgId: 'our-org', userId: 'our-user' }
const snapshot = { schemaVersion: 'v1', inspectionId, propertyId: 'property', reportSpec: [], reportData: { marker: 'published, not current draft' } }
function database(options: { owner?: boolean; assignment?: boolean; revoked?: boolean; foreign?: boolean; missing?: boolean; family?: string; snapshot?: unknown; fail?: string } = {}) {
  const calls: { table: string; filters: Record<string, unknown> }[] = []
  return {
    calls,
    admin: { from(table: string) {
      const filters: Record<string, unknown> = {}
      const query = {
        select: () => query, order: () => query, limit: () => query,
        eq: (key: string, value: unknown) => { filters[key] = value; return query },
        is: (key: string, value: unknown) => { filters[key] = value; return query },
        maybeSingle: async () => {
          calls.push({ table, filters })
          if (options.fail === table) return { data: null, error: Error('database failure') }
          const data = table === 'inspections' ? { property_id: 'property', inspection_family: options.family ?? 'OB' }
            : table === 'assignments' ? (options.assignment === false ? null : { id: 'assignment' })
            : table === 'properties' ? (options.owner ? { id: 'property' } : null)
            : options.revoked || options.foreign || options.missing ? null : { id: linkId, snapshot_payload: options.snapshot ?? snapshot }
          return { data, error: null }
        },
      }
      return query
    } } as unknown as Parameters<typeof helpers.getObPublishedReport>[0],
  }
}

test('reads exactly the selected active snapshot within the inspection and organization', async () => {
  const db = database()
  assert.equal(await helpers.getObPublishedReport(db.admin, inspectionId, linkId, access), snapshot)
  assert.deepEqual(db.calls.at(-1)?.filters, { id: linkId, inspection_id: inspectionId, org_id: access.orgId, revoked_at: null })
  assert.deepEqual(db.calls[1].filters, { inspection_id: inspectionId, org_id: access.orgId })
  assert.equal(helpers.obPublishedReportHref(inspectionId, null), null)
  assert.equal(helpers.obPublishedReportHref(inspectionId, linkId), `/ob/inspections/${inspectionId}/digital?report=${linkId}`)
})

test('owner fallback checks owner identity and unauthorized readers never load report contents', async () => {
  const denied = database({ assignment: false })
  assert.equal(await helpers.getObPublishedReport(denied.admin, inspectionId, linkId, access), null)
  assert.ok(!denied.calls.some(call => call.table === 'inspection_report_links'))
  const owner = database({ assignment: false, owner: true })
  assert.equal(await helpers.getObPublishedReport(owner.admin, inspectionId, linkId, access), snapshot)
  assert.deepEqual(owner.calls.find(call => call.table === 'properties')?.filters, { id: 'property', owner: access.userId })
})

test('missing, revoked, foreign, malformed, wrong-module and mismatched snapshots never fall back to live data', async () => {
  for (const options of [{ missing: true }, { revoked: true }, { foreign: true }, { family: 'TU' },
    { snapshot: {} }, { snapshot: { ...snapshot, inspectionId: 'foreign' } }, { snapshot: { ...snapshot, propertyId: 'foreign' } }]) {
    assert.equal(await helpers.getObPublishedReport(database(options).admin, inspectionId, linkId, access), null)
  }
  const invalid = database()
  assert.equal(await helpers.getObPublishedReport(invalid.admin, 'invalid', linkId, access), null)
  assert.equal(invalid.calls.length, 0)
  for (const table of ['inspections', 'assignments', 'properties', 'inspection_report_links']) {
    await assert.rejects(helpers.getObPublishedReport(database({ fail: table, assignment: table !== 'properties' }).admin, inspectionId, linkId, access))
  }
})

test('delivery metadata only exposes active links in the current organization and no link before publishing', async () => {
  const db = database()
  assert.equal(await helpers.getLatestObPublishedReportId(db.admin, inspectionId, access.orgId), linkId)
  assert.deepEqual(db.calls[0].filters, { inspection_id: inspectionId, org_id: access.orgId, revoked_at: null })
  assert.equal(await helpers.getLatestObPublishedReportId(database({ missing: true }).admin, inspectionId, access.orgId), null)
})

test('digital page authenticates before database access and renders the stored payload through the customer renderer', async () => {
  const path = 'src/app/ob/inspections/[id]/digital/page.tsx'
  for (const mode of ['allowed', 'unauthenticated', 'denied'] as const) {
    let reads = 0
    const view = () => null
    const page = load<{ default: (props: unknown) => Promise<{ type: unknown; props: { snapshot: unknown; shareUrl?: string } }> }>(path, {
      'next/navigation': { redirect: (url: string) => { throw Error('REDIRECT:' + url) }, notFound: () => { throw Error('NOT_FOUND') } },
      'react/jsx-runtime': { jsx: (type: unknown, props: unknown) => ({ type, props }) },
      '@/lib/assignments/server': { requireOrgContext: async () => {
        if (mode === 'unauthenticated') throw Error('UNAUTHORIZED')
        return access
      } },
      '@/lib/supabase/admin': { createSupabaseAdminClient: () => { reads++; return {} } },
      '@/lib/ob/publishedReport': { getObPublishedReport: async (_admin: unknown, id: string, report: string, context: unknown) => {
        assert.equal(id, inspectionId); assert.equal(report, linkId); assert.equal(context, access)
        return mode === 'denied' ? null : snapshot
      } },
      '@/components/report/ReportSnapshotView': { __esModule: true, default: view },
    })
    const result = page.default({ params: Promise.resolve({ id: inspectionId }), searchParams: Promise.resolve({ report: linkId }) })
    if (mode === 'allowed') {
      const element = await result
      assert.equal(element.type, view); assert.equal(element.props.snapshot, snapshot)
      assert.equal(element.props.shareUrl, undefined, 'Never offer an authenticated URL as a public sharing link')
    } else await assert.rejects(result, mode === 'denied' ? /NOT_FOUND/ : /REDIRECT:\/login/)
    assert.equal(reads, mode === 'unauthenticated' ? 0 : 1)
  }
})
