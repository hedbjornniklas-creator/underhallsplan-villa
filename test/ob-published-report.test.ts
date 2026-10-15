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
  '@/lib/report/reportSnapshotPayload': load('src/lib/report/reportSnapshotPayload.ts', {
    '@/lib/ob/objectType': load('src/lib/ob/objectType.ts'),
  }),
  './publishedReportLink': load('src/lib/ob/publishedReportLink.ts'),
})
const inspectionId = '10000000-0000-4000-8000-000000000001'
const linkId = '10000000-0000-4000-8000-000000000002'
const access = { orgId: 'our-org', userId: 'our-user', canEdit: true }
const snapshot = { schemaVersion: 'v1', inspectionId, propertyId: 'property', reportSpec: [], reportData: { marker: 'published, not current draft' } }
function database(options: { binding?: boolean; bindingOrg?: string; revoked?: boolean; foreign?: boolean; missing?: boolean; family?: string | null; type?: string; snapshot?: unknown; fail?: string } = {}) {
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
          assert.ok(['inspections', 'ob_organization_bindings', 'inspection_report_links'].includes(table), `Unexpected authority fallback: ${table}`)
          const data = table === 'inspections' ? { property_id: 'property', inspection_family: options.family === undefined ? 'OB' : options.family, type: options.type ?? 'OB' }
            : table === 'ob_organization_bindings' ? (options.binding === false ? null : { inspection_id: inspectionId, org_id: options.bindingOrg ?? access.orgId })
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

test('authorized colleague reads use the immutable binding for both standalone and linked inspections', async () => {
  const colleague = database()
  const before = structuredClone(snapshot)
  assert.equal(await helpers.getObPublishedReport(colleague.admin, inspectionId, linkId, { ...access, canEdit: false }), snapshot)
  assert.deepEqual(colleague.calls.map(call => call.table), ['inspections', 'ob_organization_bindings', 'inspection_report_links'])
  assert.deepEqual(snapshot, before)
  for (const options of [{ binding: false }, { bindingOrg: 'foreign-org' }]) {
    const denied = database(options)
    assert.equal(await helpers.getObPublishedReport(denied.admin, inspectionId, linkId, access), null)
    assert.ok(!denied.calls.some(call => call.table === 'inspection_report_links'))
  }
})

test('missing, revoked, foreign, malformed, wrong-module and mismatched snapshots never fall back to live data', async () => {
  for (const options of [{ missing: true }, { revoked: true }, { foreign: true }, { family: 'TU' },
    { snapshot: {} }, { snapshot: { ...snapshot, inspectionId: 'foreign' } }, { snapshot: { ...snapshot, propertyId: 'foreign' } }]) {
    assert.equal(await helpers.getObPublishedReport(database(options).admin, inspectionId, linkId, access), null)
  }
  const invalid = database()
  assert.equal(await helpers.getObPublishedReport(invalid.admin, 'invalid', linkId, access), null)
  assert.equal(invalid.calls.length, 0)
  for (const table of ['inspections', 'ob_organization_bindings', 'inspection_report_links']) {
    await assert.rejects(helpers.getObPublishedReport(database({ fail: table }).admin, inspectionId, linkId, access))
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
  for (const mode of ['allowed', 'colleague', 'unauthenticated', 'forbidden', 'denied'] as const) {
    let reads = 0
    const context = { ...access, canEdit: mode !== 'colleague' }
    const view = () => null
    const page = load<{ default: (props: unknown) => Promise<{ type: unknown; props: { snapshot: unknown; shareUrl?: string; [key: string]: unknown } }> }>(path, {
      'next/navigation': { redirect: (url: string) => { throw Error('REDIRECT:' + url) }, notFound: () => { throw Error('NOT_FOUND') } },
      'react/jsx-runtime': { jsx: (type: unknown, props: unknown) => ({ type, props }) },
      '@/lib/ob/organizationBindings': { requireObInspectionReadContext: async (id: string, orgId: unknown) => {
        assert.equal(id, inspectionId)
        assert.equal(orgId, undefined, 'Old digital links must use their inspection binding, not a default organization')
        if (mode === 'unauthenticated') throw Error('UNAUTHORIZED')
        if (mode === 'forbidden') throw Error('OB_ORGANIZATION_FORBIDDEN')
        return context
      } },
      '@/lib/supabase/admin': { createSupabaseAdminClient: () => { reads++; return {} } },
      '@/lib/ob/publishedReport': { obPublishedPdfStatus: () => 'ready', getObPublishedReportRecord: async (_admin: unknown, id: string, report: string, suppliedContext: unknown) => {
        assert.equal(id, inspectionId); assert.equal(report, linkId); assert.equal(suppliedContext, context)
        return mode === 'denied' ? null : { snapshot }
      } },
      '@/components/report/ReportSnapshotView': { __esModule: true, default: view },
    })
    const result = page.default({ params: Promise.resolve({ id: inspectionId }), searchParams: Promise.resolve({ report: linkId }) })
    if (mode === 'allowed' || mode === 'colleague') {
      const element = await result
      assert.equal(element.type, view); assert.equal(element.props.snapshot, snapshot)
      assert.equal(element.props.shareUrl, undefined, 'Never offer an authenticated URL as a public sharing link')
      assert.equal(element.props.requireCustomerLink, true)
      assert.equal(element.props.showPdfActions, true)
      assert.equal(element.props.pdfStatus, 'ready')
      assert.ok(String(element.props.pdfDownloadUrl).includes(`report=${linkId}&orgId=${access.orgId}`))
      if (mode === 'colleague') assert.equal(element.props.shareEndpoint, undefined, 'Read access never enables public report sharing')
      else assert.ok(element.props.shareEndpoint)
    } else await assert.rejects(result, ['denied', 'forbidden'].includes(mode) ? /NOT_FOUND/ : /REDIRECT:\/login/)
    assert.equal(reads, ['unauthenticated', 'forbidden'].includes(mode) ? 0 : 1)
  }
})
