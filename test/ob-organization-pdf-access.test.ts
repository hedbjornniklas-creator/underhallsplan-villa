import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

const ID = '11111111-1111-4111-8111-111111111111'
const ORG = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const OTHER = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
function harness(options: { signedIn?: boolean; bindingError?: string; family?: string | null; type?: string } = {}) {
  const calls: string[] = []
  const selectors: unknown[] = []
  const admin = { from(table: string) {
    calls.push(table)
    const filters: Record<string, unknown> = {}
    const result = () => ({ error: null, data: table === 'inspections'
      ? { id: ID, inspection_family: options.family === undefined ? 'OB' : options.family, type: options.type ?? 'OB', property_id: 'property', status: 'completed' }
      : table === 'inspection_report_links' ? [{ id: 'report', pdf_base64: Buffer.from('%PDF-original-frozen-document').toString('base64'), pdf_status: 'ready' }]
      : { id: 'assignment', sequence_no: 1, inspection_id: ID } })
    const query = { select: () => query, eq: (key: string, value: unknown) => { filters[key] = value; return query },
      is: () => query, order: () => query, limit: () => query,
      maybeSingle: async () => result(),
      then: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => {
        if (table === 'inspection_report_links') assert.deepEqual(filters, { org_id: ORG, inspection_id: ID })
        return Promise.resolve(result()).then(resolve, reject)
      },
    }
    return query
  } }
  const context = { orgId: ORG, userId: 'owner' }
  const dependencies: Record<string, unknown> = {
    'next/server': { NextResponse: Response },
    '@/lib/supabase/admin': { createSupabaseAdminClient: () => admin },
    '@/lib/supabase/server': { createSupabaseServerClient: () => ({ auth: { getUser: async () => {
      calls.push('auth'); return { data: { user: options.signedIn === false ? null : { id: 'owner' } }, error: null }
    } } }) },
    '@/lib/ob/organizationBindings': { requireObInspectionContext: async (id: string, orgId: unknown) => {
      calls.push('binding'); selectors.push([id, orgId])
      if (options.bindingError) throw new Error(options.bindingError)
      return context
    } },
    '@/lib/assignments/server': { requireOrgContext: async (orgId: unknown) => {
      calls.push('legacy-org'); selectors.push(orgId); return context
    } },
    '@/lib/tu/server': { requireTuContext: async (orgId: unknown) => { calls.push('tu-org'); selectors.push(orgId); return context } },
    '@/lib/ob/assignmentWorkflowServer': { getObAssignmentWorkflow: async (_id: string, orgId: string) => {
      assert.equal(orgId, ORG); return { canDeliver: true }
    } },
    '@/lib/report/reportFileName': { buildReportPdfFileName: () => 'original.pdf' },
    '@/lib/eb/reportSnapshot': { getEbInspectionReportFromSnapshot: () => null },
  }
  const code = ts.transpileModule(readFileSync('src/app/api/report-v2/[inspectionId]/pdf/route.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const compiled = { exports: {} as { GET: (r: Request, c: unknown) => Promise<Response> } }
  new Function('require', 'module', 'exports', code)((name: string) => {
    assert.ok(Object.hasOwn(dependencies, name), name); return dependencies[name]
  }, compiled, compiled.exports)
  return { calls, selectors, get: (search = '') => compiled.exports.GET(new Request(`https://hushub.test/api/report-v2/${ID}/pdf${search}`),
    { params: Promise.resolve({ inspectionId: ID }) }) }
}

test('old OB PDF links resolve immutable organization before accessing frozen PDF and never bootstrap a default organization', async () => {
  for (const options of [{}, { family: null, type: 'STATUS' }]) {
    const h = harness(options)
    const response = await h.get()
    assert.equal(response.status, 200)
    assert.equal(await response.text(), '%PDF-original-frozen-document')
    assert.deepEqual(h.calls, ['auth', 'inspections', 'binding', 'inspection_report_links'])
    assert.deepEqual(h.selectors, [[ID, undefined]])
  }
})

test('wrong-org, non-owner, missing membership and unbound OB PDF requests cannot read archived content', async () => {
  for (const [bindingError, status] of [['OB_ORGANIZATION_MISMATCH', 409], ['OB_ORGANIZATION_FORBIDDEN', 403],
    ['ORG_MEMBERSHIP_REQUIRED', 403], ['MODULE_ACCESS_REQUIRED', 403], ['OB_ORGANIZATION_UNASSIGNED', 409], ['OB_ORGANIZATION_READ_FAILED', 503]]) {
    const h = harness({ bindingError: String(bindingError) })
    assert.equal((await h.get(`?orgId=${OTHER}`)).status, status)
    assert.deepEqual(h.calls, ['auth', 'inspections', 'binding'])
    assert.deepEqual(h.selectors, [[ID, OTHER]])
  }
})

test('unauthenticated PDF requests read no inspection or report data', async () => {
  const h = harness({ signedIn: false })
  assert.equal((await h.get()).status, 401)
  assert.deepEqual(h.calls, ['auth'])
})

test('TU and EB PDF branches retain their existing contexts and do not enter OB binding authorization', async () => {
  for (const family of ['TU', 'EB']) {
    const h = harness({ family })
    assert.equal((await h.get(`?orgId=${ORG}`)).status, 200)
    assert.ok(h.calls.includes(family === 'TU' ? 'tu-org' : 'legacy-org'))
    assert.ok(!h.calls.includes('binding'))
    assert.deepEqual(h.selectors, [ORG])
  }
})
