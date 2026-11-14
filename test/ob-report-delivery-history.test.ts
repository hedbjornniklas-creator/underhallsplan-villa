import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import test from 'node:test'
import ts from 'typescript'

function load<T>(file: string, deps: Record<string, unknown> = {}): T {
  const code = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText
  const module = { exports: {} }
  new Function('require', 'module', 'exports', code)((name: string) => {
    assert.ok(name in deps, name); return deps[name]
  }, module, module.exports)
  return module.exports as T
}
const model = load<typeof import('../src/lib/ob/reportDeliveryHistory')>('src/lib/ob/reportDeliveryHistory.ts')
const server = load<typeof import('../src/lib/ob/reportDeliveryHistoryServer')>('src/lib/ob/reportDeliveryHistoryServer.ts')
const hash = (token: string) => createHash('sha256').update(token).digest('hex')
const id = '10000000-0000-4000-8000-000000000001'
const orgId = '10000000-0000-4000-8000-000000000002'
const inspectionId = '10000000-0000-4000-8000-000000000003'

test('timestamps explicitly use Swedish winter/summer time, not the viewer or server timezone', () => {
  assert.equal(model.formatObDeliveryDate('2026-11-06T07:24:54Z', true), '2026-11-06 08:24:54')
  assert.equal(model.formatObDeliveryDate('2026-07-06T07:24:54Z', true), '2026-07-06 09:24:54')
  assert.equal(model.formatObDeliveryDate(null), '-')
})

test('mail acceptance is never represented as delivery or reading; version PDF links are exact', () => {
  const sent = { type: 'sent', status: 'sent' } as any
  assert.equal(model.obDeliveryEventTitle(sent), 'Skickade utlåtande')
  assert.equal(model.obDeliveryEventTitle({ ...sent, status: 'failed' }), 'Misslyckat utskick')
  assert.equal(model.obReportVersionPdfHref(inspectionId, id), `/api/ob/inspections/${inspectionId}/published-report?report=${id}&archive=1`)
  const events = [{ id: 'sent:b', occurred_at: '2026-11-06T07:00:00Z' }, { id: 'sent:a', occurred_at: '2026-11-06T07:00:00Z' }] as any
  assert.deepEqual(model.mergeObDeliveryEvents(events, [events[0]]).map(event => event.id), ['sent:b', 'sent:a'])
})

test('recoverable customer link is stable, version-bound, revocable and does not rewrite stored tokens or snapshots', async () => {
  const crypto = await import('node:crypto')
  const previous = process.env.OB_REPORT_LINK_SIGNING_KEY
  process.env.OB_REPORT_LINK_SIGNING_KEY = 'synthetic-secret-for-tests-only'
  try {
    const tokens = load<typeof import('../src/lib/ob/reportShareToken')>('src/lib/ob/reportShareToken.ts', {
      'node:crypto': crypto, '@/lib/assignments/tokens': { hashAssignmentToken: hash },
    })
    const report = { id, orgId, inspectionId, tokenHash: hash('original-client-link') }
    const token = tokens.createObReportShareToken(report)
    assert.equal(token, tokens.createObReportShareToken(report))
    assert.notEqual(token, tokens.createObReportShareToken({ ...report, inspectionId: id }))
    let row: any = { id, org_id: orgId, inspection_id: inspectionId, token_hash: report.tokenHash, revoked_at: null }
    let reads = 0
    const db = { from(table: string) {
      assert.equal(table, 'inspection_report_links')
      const q = { select: () => q, eq: (field: string, value: string) => { assert.equal(field, 'id'); assert.equal(value, id); return q },
        maybeSingle: async () => { reads++; return { data: row, error: null } } }
      return q
    } } as any
    assert.equal(await tokens.resolveReportTokenHash(db, token), report.tokenHash)
    assert.equal(await tokens.resolveReportTokenHash(db, 'ordinary-existing-token'), hash('ordinary-existing-token'))
    assert.equal(reads, 1, 'ordinary OB/TU/EB token lookups do not add queries')
    assert.equal(await tokens.resolveReportTokenHash(db, token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A')), null)
    row = { ...row, org_id: inspectionId }
    assert.equal(await tokens.resolveReportTokenHash(db, token), null)
    row = { ...row, org_id: orgId, revoked_at: '2026-11-06T08:00:00Z' }
    assert.equal(await tokens.resolveReportTokenHash(db, token), null)
    assert.equal(await tokens.resolveReportTokenHash(db, 'ob1.bad.bad'), null)
    assert.deepEqual(report, { id, orgId, inspectionId, tokenHash: hash('original-client-link') })
  } finally {
    if (previous === undefined) delete process.env.OB_REPORT_LINK_SIGNING_KEY
    else process.env.OB_REPORT_LINK_SIGNING_KEY = previous
  }
})

test('history pagination is tenant-scoped, stable with equal timestamps and rejects injected cursors', async () => {
  const calls: any[] = []
  const rows = Array.from({ length: 21 }, (_, i) => ({ id: `sent:10000000-0000-4000-8000-${String(99-i).padStart(12, '0')}`,
    occurred_at: '2026-11-06T07:24:54.000Z' }))
  const db: any = { from(table: string) {
    const call: any = { table, filters: {} }; calls.push(call)
    const result = { data: table.endsWith('overview') ? { history_incomplete: true, last_recipients: [] } : rows, error: null }
    const q: any = { select: () => q, eq: (k: string,v: string) => { call.filters[k]=v; return q },
      order: () => q, limit: () => q, or: (value: string) => { call.or=value; return q },
      maybeSingle: async () => result, then: (resolve: any) => Promise.resolve(result).then(resolve) }
    return q
  } }
  const first = await server.readObDeliveryTimeline(db, orgId, inspectionId)
  assert.equal(first.entries.length, 20)
  assert.ok(first.nextCursor)
  assert.equal(first.overview.historyIncomplete, true)
  await server.readObDeliveryTimeline(db, orgId, inspectionId, first.nextCursor)
  for (const call of calls) assert.deepEqual(call.filters, { org_id: orgId, inspection_id: inspectionId })
  assert.ok(calls[2].or.includes('id.lt.sent:'))
  await assert.rejects(server.readObDeliveryTimeline(db, orgId, inspectionId, Buffer.from(JSON.stringify({ at: 'bad,or()', id })).toString('base64url')), /CURSOR_INVALID/)
})

test('copy is available before user gesture and never calls send, publish or unlock', () => {
  const source = readFileSync('src/components/ob/ObReportDeliveryStatus.tsx', 'utf8')
  const copy = source.slice(source.indexOf('async function copy()'), source.indexOf('return <div className="ob-copy-report"'))
  assert.match(copy, /navigator\.clipboard\.writeText\(url\)/)
  assert.doesNotMatch(copy, /fetch\(|send|publish|unlock/)
  assert.match(source, /readOnly type="url" aria-label="Kundlänk"/)
  const route = readFileSync('src/app/api/ob/inspections/[id]/report-delivery/route.ts', 'utf8')
  assert.doesNotMatch(route, /assignment \? await getDeliveryHistory/)
  assert.match(route, /inspection_id: input\.inspectionId/)
  assert.match(route, /report_link_id: input\.reportId/)
  assert.match(route, /frozen\?\.snapshot\.reportData \?\? await buildReportDataV2/)
  assert.match(route, /if \(!linkData\) \{/)
  assert.match(route, /if \(!frozen\) after/)
})
