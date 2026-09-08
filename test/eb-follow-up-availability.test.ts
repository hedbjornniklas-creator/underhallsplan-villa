import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import ts from 'typescript'
import type * as Server from '../src/lib/eb/followUpServer'
import type * as Shared from '../src/lib/eb/followUp'
import type * as Snapshots from '../src/lib/eb/reportSnapshot'

const require = createRequire(import.meta.url)
function load<T>(path: string, dependencies: Record<string, unknown>): T {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
  } }).outputText
  const compiledModule = { exports: {} }
  new Function('require', 'exports', 'module', compiled)((id: string) => {
    if (id in dependencies) return dependencies[id]
    if (id.startsWith('node:')) return require(id)
    throw new Error(`Unexpected I/O dependency: ${id}`)
  }, compiledModule.exports, compiledModule)
  return compiledModule.exports as T
}

const shared = load<typeof Shared>('src/lib/eb/followUp.ts', {})
const snapshots = load<typeof Snapshots>('src/lib/eb/reportSnapshot.ts', {})
const envKeys = ['EB_FOLLOW_UP_ENABLED', 'ASSIGNMENTS_MAIL_FROM', 'RESEND_API_KEY'] as const
const previous = Object.fromEntries(envKeys.map(key => [key, process.env[key]]))
before(() => {
  process.env.EB_FOLLOW_UP_ENABLED = 'true'
  process.env.ASSIGNMENTS_MAIL_FROM = 'test@example.test'
  process.env.RESEND_API_KEY = 'test-only-no-network'
})
after(() => {
  for (const key of envKeys) {
    if (previous[key] === undefined) delete process.env[key]
    else process.env[key] = previous[key]
  }
})

type Row = Record<string, unknown>
const token = 'existing-customer-report-token-long-enough'
const originalTime = '2021-01-01T10:00:00.000Z'
const lockTime = '2021-01-01T10:00:01.000Z'
function fixture(legacy = false) {
  const report = {
    project: { id: 'project' },
    inspection: { inspectionId: 'inspection', reportLockedAt: null as string | null, date: '2020-12-01' },
    notes: [{ id: 'b05e6965-ad80-4c0d-aa8c-f89cb97c54b8', inspectionId: 'inspection', noteText: 'Original published note' }],
    images: [], reportDraft: { sections: [] }, branding: {},
  }
  const snapshot = legacy
    ? { schemaVersion: 'eb_v1', createdAt: originalTime, ...report }
    : { schema: 'eb_report_snapshot_v1', module: 'EB', inspectionId: 'inspection', createdAt: originalTime, report }
  const seller = { name: 'Test Seller', orgNumber: '123456-7890', address: 'Test Street', email: 'seller@example.test' }
  const rows: Record<string, Row[]> = {
    inspection_report_links: [{ id: 'link', org_id: 'org', inspection_id: 'inspection', token_hash: `hash:${token}`,
      // A resend can be much newer than the frozen source snapshot.
      created_at: '2026-09-08T05:24:07Z', revoked_at: null, snapshot_payload: snapshot }],
    eb_projects: [{ id: 'project', org_id: 'org', client_email: 'PRIVATE-BUYER@example.test' }],
    eb_inspection_details: [{ org_id: 'org', inspection_id: 'inspection', eb_project_id: 'project', report_locked_at: lockTime }],
    inspection_lock_events: [], eb_follow_up_orders: [],
    organizations: [{ id: 'org', name: 'Test Seller', created_by: null, eb_follow_up_seller: seller }],
  }
  const errors: Record<string, string> = {}
  const reads: Array<{ table: string; filters: Array<[string, unknown]> }> = []
  const admin = { from: (table: string) => {
    assert.ok(table in rows, `Unexpected table: ${table}`)
    let selected = [...rows[table]]
    const read = { table, filters: [] as Array<[string, unknown]> }
    reads.push(read)
    let maximum = Infinity
    const query = {
      select: () => query,
      eq: (key: string, value: unknown) => {
        read.filters.push([key, value]); selected = selected.filter(row => row[key] === value); return query
      },
      is: (key: string, value: unknown) => query.eq(key, value),
      gte: (key: string, value: string) => {
        read.filters.push([key, value]); selected = selected.filter(row => Date.parse(String(row[key])) >= Date.parse(value)); return query
      },
      order: (key: string) => {
        selected.sort((a, b) => String(b[key]).localeCompare(String(a[key]))); return query
      },
      limit: (value: number) => { maximum = value; return query },
      maybeSingle: async () => ({ data: errors[table] ? null : selected.slice(0, maximum)[0] ?? null,
        error: errors[table] ? { code: errors[table] } : null }),
    }
    return query
  }, rpc: () => { throw new Error('Unexpected mutation in read-only offer test') } }
  const server = load<typeof Server>('src/lib/eb/followUpServer.ts', {
    '@/lib/eb/followUp': shared,
    '@/lib/supabase/admin': { createSupabaseAdminClient: () => admin },
    '@/lib/assignments/tokens': { hashAssignmentToken: (value: string) => `hash:${value}` },
    '@/lib/eb/reportSnapshot': snapshots,
    '@/lib/eb/followUpDelivery': {},
  })
  return { report, snapshot, rows, errors, reads, seller, server, offer: () => server.getEbFollowUpOffer(token) }
}

for (const legacy of [false, true]) {
  test(`old ${legacy ? 'legacy eb_v1' : 'canonical'} delivery without copied lock timestamp remains purchasable`, async () => {
    const f = fixture(legacy)
    const before = JSON.stringify(f.snapshot)
    const offer = await f.offer()
    assert.equal(offer.available, true)
    assert.equal(offer.priceOre, 59900)
    assert.equal(JSON.stringify(f.snapshot), before, 'Do not backfill or rewrite the delivered report')
    assert.equal(f.report.inspection.reportLockedAt, null)
    assert.doesNotMatch(JSON.stringify(offer), /PRIVATE-BUYER/)
    const audit = f.reads.find(read => read.table === 'inspection_lock_events')
    assert.deepEqual(audit?.filters, [['org_id', 'org'], ['inspection_id', 'inspection'], ['action', 'unlock'], ['performed_at', originalTime]])
  })
}

test('properly stamped published snapshots do not depend on the live draft or legacy audit fallback', async () => {
  const f = fixture()
  f.report.inspection.reportLockedAt = lockTime
  f.rows.eb_inspection_details[0].report_locked_at = null
  f.errors.inspection_lock_events = 'PGRST205'
  assert.equal((await f.offer()).available, true)
  assert.equal(f.reads.some(read => read.table === 'inspection_lock_events'), false)
})

test('unlocked, pending or malformed legacy report metadata cannot start a purchase', async () => {
  for (const lockedAt of [null, '', 'invalid', '2020-01-01T10:00:00Z']) {
    const f = fixture()
    f.rows.eb_inspection_details[0].report_locked_at = lockedAt
    const offer = await f.offer()
    assert.equal(offer.available, false)
    assert.match(offer.reason ?? '', /fastställande kunde inte bekräftas/)
    await assert.rejects(f.server.requestEbFollowUpCode({ token, email: 'buyer@example.test' }), /REPORT_NOT_FINALIZED/)
  }
  for (const timestamp of ['', 'invalid']) {
    const f = fixture()
    f.snapshot.createdAt = timestamp
    assert.equal((await f.offer()).available, false, 'A newer resend link is not evidence of source publication')
  }
})

test('unlock/relock after the source snapshot is rejected even with a new resend link', async () => {
  const f = fixture()
  f.rows.eb_inspection_details[0].report_locked_at = '2026-09-08T05:20:00Z'
  f.rows.inspection_lock_events.push({ id: 'unlock', org_id: 'org', inspection_id: 'inspection', action: 'unlock', performed_at: '2026-09-08T05:19:00Z' })
  assert.equal((await f.offer()).available, false)
})

test('older unlocks and other inspections or organisations do not block the matching lock cycle', async () => {
  const f = fixture()
  f.rows.inspection_lock_events.push(
    { id: 'old', org_id: 'org', inspection_id: 'inspection', action: 'unlock', performed_at: '2020-01-01T00:00:00Z' },
    { id: 'other-org', org_id: 'other', inspection_id: 'inspection', action: 'unlock', performed_at: '2026-01-01T00:00:00Z' },
    { id: 'other-inspection', org_id: 'org', inspection_id: 'other', action: 'unlock', performed_at: '2026-01-01T00:00:00Z' },
  )
  assert.equal((await f.offer()).available, true)
})

test('audit, schema, project scope and missing or revoked link failures remain closed', async () => {
  for (const table of ['inspection_lock_events', 'eb_follow_up_orders', 'eb_projects', 'eb_inspection_details']) {
    const f = fixture()
    f.errors[table] = 'PGRST205'
    assert.equal((await f.offer()).available, false)
  }
  for (const change of [
    (f: ReturnType<typeof fixture>) => { f.rows.eb_inspection_details[0].eb_project_id = 'other' },
    (f: ReturnType<typeof fixture>) => { f.rows.inspection_report_links[0].revoked_at = lockTime },
    (f: ReturnType<typeof fixture>) => { f.rows.inspection_report_links = [] },
    (f: ReturnType<typeof fixture>) => { f.report.inspection.inspectionId = 'other' },
    (f: ReturnType<typeof fixture>) => { f.rows.eb_inspection_details[0].org_id = 'other' },
  ]) {
    const f = fixture(); change(f)
    assert.equal((await f.offer()).available, false)
  }
})

test('a newer active report version still blocks a new order from the old link', async () => {
  const f = fixture()
  f.rows.inspection_report_links.push({ ...f.rows.inspection_report_links[0], id: 'new-link', token_hash: 'new-token', created_at: '2026-09-09T10:00:00Z' })
  const offer = await f.offer()
  assert.equal(offer.available, false)
  assert.match(offer.reason ?? '', /senast publicerade/)
})

test('feature flag, eligible notes and seller configuration remain required', async () => {
  const f = fixture()
  process.env.EB_FOLLOW_UP_ENABLED = 'false'
  try { assert.equal((await f.offer()).available, false) }
  finally { process.env.EB_FOLLOW_UP_ENABLED = 'true' }
  f.report.notes = []
  assert.match((await f.offer()).reason ?? '', /inga noteringar/)
  const noSeller = fixture()
  noSeller.rows.organizations[0].eb_follow_up_seller = null
  assert.equal((await noSeller.offer()).available, false)
})

test('existing paid access survives missing historical lock metadata and sales being disabled', async () => {
  const f = fixture()
  f.rows.eb_inspection_details[0].report_locked_at = null
  f.snapshot.createdAt = ''
  f.rows.eb_follow_up_orders.push({ id: 'paid', org_id: 'org', inspection_id: 'inspection', buyer_snapshot: { email: 'PRIVATE-BUYER@example.test' }, seller_snapshot: f.seller })
  process.env.EB_FOLLOW_UP_ENABLED = 'false'
  try {
    const offer = await f.offer()
    assert.equal(offer.alreadyActive, true)
    assert.equal(offer.available, true)
    assert.doesNotMatch(JSON.stringify(offer), /PRIVATE-BUYER/)
    assert.equal(f.reads.some(read => read.table === 'inspection_lock_events'), false)
  } finally { process.env.EB_FOLLOW_UP_ENABLED = 'true' }
})
