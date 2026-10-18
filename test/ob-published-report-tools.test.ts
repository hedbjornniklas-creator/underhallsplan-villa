import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import ts from 'typescript'

function load<T>(file: string, deps: Record<string, unknown>): T {
  const source = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText
  const compiled = { exports: {} }
  new Function('require', 'module', 'exports', source)((name: string) => {
    assert.ok(name in deps, name); return deps[name]
  }, compiled, compiled.exports)
  return compiled.exports as T
}
const hash = (token: string) => createHash('sha256').update(token).digest('hex')
const http = load<Record<string, unknown>>('src/lib/organizations/administrationHttp.ts', {})
const failures = load<Record<string, unknown>>('src/lib/ob/organizationHttp.ts', {
  '@/lib/organizations/administrationHttp': http,
})
const files = load<Record<string, unknown>>('src/lib/report/reportFileName.ts', {})
const token = 'a'.repeat(40)
const url = 'https://hushub.se/api/ob/inspections/inspection/published-report?report=selected-version'
const context = { params: Promise.resolve({ id: 'inspection' }) }
type Route = { GET: (request: Request, context: unknown) => Promise<Response>; POST: (request: Request, context: unknown) => Promise<Response> }
function harness({ denied = false, colleague = false, missing = false, side = 'buyer', state = 'ready', storage = false, mailStatus = 200 } = {}) {
  const calls = { reads: 0, signed: [] as unknown[][], shares: [] as { token: string; body: unknown }[] }
  const pdf = '%PDF-1.7\nFrozen selected-version bytes'
  const report = { snapshot: { inspectionSide: side, reportData: { mock: { inspections: {
    assignment_number: '2026-0101-01', date: '2026-01-01',
  } } } }, tokenHash: hash(token), pdfStatus: state, pdfBase64: storage || state !== 'ready' ? '' : Buffer.from(pdf).toString('base64'),
  pdfStorageBucket: storage ? 'inspection-reports' : '', pdfStoragePath: storage ? 'frozen/selected.pdf' : '' }
  const route = load<Route>('src/app/api/ob/inspections/[id]/published-report/route.ts', {
    'next/server': { NextResponse: { redirect: (location: string, init: ResponseInit) => new Response(null, { ...init, headers: { ...init.headers, Location: location } }) } },
    '@/lib/assignments/tokens': { hashAssignmentToken: hash },
    '@/lib/ob/organizationBindings': {
      requireObInspectionReadContext: async () => { if (denied) throw Error('UNAUTHORIZED'); return { orgId: 'org', userId: 'user', canEdit: !colleague } },
      requireObInspectionContext: async () => {
        if (denied) throw Error('UNAUTHORIZED')
        if (colleague) throw Error('OB_ORGANIZATION_FORBIDDEN')
        return { orgId: 'org', userId: 'user' }
      },
    },
    '@/lib/ob/organizationHttp': failures,
    '@/lib/ob/publishedReport': { getObPublishedReportRecord: async (_db: unknown, id: string, reportId: string) => {
      assert.equal(id, 'inspection'); assert.equal(reportId, 'selected-version'); calls.reads++; return missing ? null : report
    }, obPublishedPdfStatus: (value: typeof report) => value.pdfBase64 || value.pdfStoragePath ? 'ready' : value.pdfStatus },
    '@/lib/organizations/administrationHttp': http,
    '@/lib/supabase/admin': { createSupabaseAdminClient: () => ({ storage: { from: (bucket: string) => ({
      createSignedUrl: async (...args: unknown[]) => { calls.signed.push([bucket, ...args]); return { data: { signedUrl: 'https://storage.example.test/frozen.pdf' }, error: null } },
    }) } }) },
    '@/lib/report/reportFileName': files,
    '@/app/api/reports/public/[token]/route': { POST: async (request: Request, context: { params: Promise<{ token: string }> }) => {
      calls.shares.push({ token: (await context.params).token, body: await request.json() })
      return Response.json(mailStatus === 200 ? { ok: true } : { error: 'Mail unavailable' }, { status: mailStatus })
    } },
  })
  const post = (body: unknown, origin = 'https://hushub.se') => route.POST(new Request(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin }, body: JSON.stringify(body),
  }), context)
  return { route, calls, pdf, post }
}

test('exact-version PDF download returns stored bytes and uses the frozen STB/OB filename', async () => {
  for (const side of ['buyer', 'status']) {
    const { route, pdf, calls } = harness({ side })
    const response = await route.GET(new Request(url), context)
    assert.equal(response.status, 200)
    assert.equal(await response.text(), pdf)
    assert.ok(decodeURIComponent(response.headers.get('content-disposition')!).includes(side === 'status' ? 'STB' : 'ÖB'))
    assert.equal(response.headers.get('cache-control'), 'private, no-store, max-age=0')
    assert.deepEqual(calls.shares, [])
  }
  const { route, calls } = harness({ storage: true })
  const response = await route.GET(new Request(url), context)
  assert.equal(response.status, 302)
  assert.deepEqual(calls.signed, [['inspection-reports', 'frozen/selected.pdf', 120, { download: 'Utlåtande ÖB 2026-0101-01.pdf' }]])
})

test('an authorized colleague can download the frozen PDF, but cannot validate or forward its customer link', async () => {
  const { route, post, calls, pdf } = harness({ colleague: true })
  const response = await route.GET(new Request(url), context)
  assert.equal(response.status, 200)
  assert.equal(await response.text(), pdf)
  const reads = calls.reads
  for (const action of ['validate-link', 'share']) {
    assert.equal((await post({ action, publicUrl: `https://hushub.se/rapport/${token}`, email: 'recipient@example.test' })).status, 403)
  }
  assert.equal(calls.reads, reads, 'write authorization is checked before reading report metadata')
  assert.deepEqual(calls.shares, [])
})

test('PDF pending and failed never return another ready version; missing and unauthorized reports fail closed', async () => {
  for (const state of ['pending', 'processing', 'failed']) {
    const { route } = harness({ state })
    const status = await route.GET(new Request(url + '&status=1'), context)
    assert.deepEqual(await status.json(), { status: state })
    assert.equal((await route.GET(new Request(url), context)).status, 409)
  }
  for (const options of [{ denied: true }, { missing: true }]) {
    const { route, calls } = harness(options)
    assert.equal((await route.GET(new Request(url), context)).status, options.denied ? 401 : 404)
    if (options.denied) assert.equal(calls.reads, 0)
    assert.deepEqual(calls.signed, [])
  }
})

test('sharing verifies original public token against the selected version before copying or sending', async () => {
  const { post, calls } = harness()
  const publicUrl = `https://hushub.se/rapport/${token}`
  const validate = await post({ action: 'validate-link', publicUrl })
  assert.deepEqual(await validate.json(), { shareUrl: publicUrl })
  assert.deepEqual(calls.shares, [])
  assert.equal((await post({ action: 'share', publicUrl, email: 'recipient@example.test' })).status, 200)
  assert.deepEqual(calls.shares, [{ token, body: { email: 'recipient@example.test' } }])
  for (const invalid of ['', 'https://evil.example/rapport/' + token, 'https://hushub.se/rapport/' + 'b'.repeat(40),
    publicUrl + '?extra=1', publicUrl + '#fragment', 'https://user:secret@hushub.se/rapport/' + token]) {
    assert.equal((await post({ action: 'share', publicUrl: invalid, email: 'recipient@example.test' })).status, 400)
  }
  assert.equal(calls.shares.length, 1)
  assert.equal((await post({ action: 'share', publicUrl, email: 'recipient@example.test' }, 'https://evil.example')).status, 403)
  assert.equal(calls.shares.length, 1)
})

test('private sharing requires inspection authorization and preserves the existing sender errors', async () => {
  const denied = harness({ denied: true })
  assert.equal((await denied.post({ action: 'share', publicUrl: `https://hushub.se/rapport/${token}` })).status, 401)
  assert.deepEqual(denied.calls.shares, [])
  const failed = harness({ mailStatus: 502 })
  assert.equal((await failed.post({ action: 'share', publicUrl: `https://hushub.se/rapport/${token}`, email: 'recipient@example.test' })).status, 502)
})
