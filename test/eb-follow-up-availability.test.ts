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
    if (id === '@/lib/eb/reportNoteDisplay') return load('src/lib/eb/reportNoteDisplay.ts', {})
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
    inspection_lock_events: [], eb_follow_up_orders: [], profiles: [],
    organizations: [{ id: 'org', name: 'Test Seller', created_by: null, eb_follow_up_seller: seller }],
  }
  const errors: Record<string, string> = {}
  const failures: Record<string, Error> = {}
  const state = { clientConfigurationError: false, platformSellerAvailable: true }
  const reads: Array<{ table: string; filters: Array<[string, unknown]>; fields: string }> = []
  const admin = { from: (table: string) => {
    assert.ok(table in rows, `Unexpected table: ${table}`)
    let selected = [...rows[table]]
    const read = { table, filters: [] as Array<[string, unknown]>, fields: '' }
    reads.push(read)
    let maximum = Infinity
    const query = {
      select: (fields: string) => { read.fields = fields; return query },
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
      maybeSingle: async () => {
        if (failures[table]) throw failures[table]
        return { data: errors[table] ? null : selected.slice(0, maximum)[0] ?? null,
          error: errors[table] ? { code: errors[table], message: 'PRIVATE-DATABASE-DETAILS' } : null }
      },
    }
    return query
  }, rpc: () => { throw new Error('Unexpected mutation in read-only offer test') } }
  const server = load<typeof Server>('src/lib/eb/followUpServer.ts', {
    '@/lib/eb/followUp': shared,
    '@/lib/eb/followUpConfirmation': load('src/lib/eb/followUpConfirmation.ts', {}),
    '@/lib/supabase/admin': { createSupabaseAdminClient: () => {
      if (state.clientConfigurationError) throw new Error('PRIVATE-SERVER-CONFIGURATION')
      return admin
    } },
    '@/lib/assignments/tokens': { hashAssignmentToken: (value: string) => `hash:${value}` },
    '@/lib/eb/reportSnapshot': snapshots,
    '@/lib/eb/followUpDelivery': {},
    '@/lib/eb/followUpCustomer': { resolveEbFollowUpCustomer: async () => ({ email: 'buyer@example.test', source: 'confirmed' }) },
    '@/lib/eb/followUpSeller': { getEbFollowUpPlatformSeller: () => state.platformSellerAvailable ? seller : null },
    '@/lib/eb/customerSession': { readEbCustomerSession: async () => null },
    '@/lib/eb/customerLinks': {},
    '@/lib/eb/followUpTerms': {},
  })
  return { report, snapshot, rows, errors, failures, state, reads, seller, server, offer: () => server.getEbFollowUpOffer(token) }
}

for (const legacy of [false, true]) {
  test(`old ${legacy ? 'legacy eb_v1' : 'canonical'} delivery without copied lock timestamp remains purchasable`, async () => {
    const f = fixture(legacy)
    const before = JSON.stringify(f.snapshot)
    const offer = await f.offer()
    assert.equal(offer.available, true)
    assert.equal(offer.retryable, false)
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
    assert.equal(offer.retryable, false)
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
    const offer = await f.offer()
    assert.equal(offer.available, false)
    assert.equal(offer.retryable, false)
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
  assert.equal(offer.retryable, false)
  assert.match(offer.reason ?? '', /senast publicerade/)
})

test('feature flag, eligible notes and seller configuration remain required', async () => {
  const f = fixture()
  process.env.EB_FOLLOW_UP_ENABLED = 'false'
  try {
    const offer = await f.offer()
    assert.equal(offer.available, false)
    assert.equal(offer.retryable, false)
    assert.match(offer.reason ?? '', /inte aktiverad/)
    assert.equal(f.reads.some(read => read.table === 'organizations'), false)
  }
  finally { process.env.EB_FOLLOW_UP_ENABLED = 'true' }
  f.report.notes = []
  const noNotes = await f.offer()
  assert.match(noNotes.reason ?? '', /inga noteringar/)
  assert.equal(noNotes.retryable, false)
  const noSeller = fixture()
  noSeller.state.platformSellerAvailable = false
  const unconfigured = await noSeller.offer()
  assert.equal(unconfigured.available, false)
  assert.equal(unconfigured.retryable, false)
  assert.match(unconfigured.reason ?? '', /Säljaruppgifterna/)
})

test('external inspectors need no seller configuration and cannot replace the platform seller', async () => {
  const f = fixture()
  f.rows.organizations[0].eb_follow_up_seller = { name: 'External inspecting company', email: 'external@example.test' }
  f.failures.organizations = new Error('Tenant settings are unrelated')
  f.failures.profiles = new Error('Tenant profile is unrelated')
  const offer = await f.offer()
  assert.equal(offer.available, true)
  assert.deepEqual(offer.seller, f.seller)
  assert.equal(f.reads.some(read => ['organizations', 'profiles'].includes(read.table)), false)
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
    assert.equal(offer.retryable, false)
    assert.doesNotMatch(JSON.stringify(offer), /PRIVATE-BUYER/)
    assert.equal(f.reads.some(read => read.table === 'inspection_lock_events'), false)
  } finally { process.env.EB_FOLLOW_UP_ENABLED = 'true' }
})

test('missing sender/API credentials and schema/server setup are hidden, not temporary retry states', async () => {
  for (const key of ['ASSIGNMENTS_MAIL_FROM', 'RESEND_API_KEY']) {
    const saved = process.env[key]
    process.env[key] = ' '
    try {
      const offer = await fixture().offer()
      assert.equal(offer.available, false)
      assert.equal(offer.retryable, false)
      assert.match(offer.reason ?? '', /E-postutskicken/)
    } finally { process.env[key] = saved }
  }
  for (const [table, code] of [
    ['inspection_report_links', '42P01'], ['eb_follow_up_orders', 'PGRST205'],
    ['inspection_lock_events', '42501'],
  ]) {
    const f = fixture()
    f.rows.organizations[0].created_by = 'owner'
    f.errors[table] = code
    const offer = await f.offer()
    assert.equal(offer.available, false)
    assert.equal(offer.retryable, false)
    assert.match(offer.reason ?? '', /konfiguration/)
    assert.doesNotMatch(JSON.stringify(offer), /PRIVATE-|42P01|42703|PGRST|42501/)
  }
  const f = fixture()
  f.state.clientConfigurationError = true
  const offer = await f.offer()
  assert.equal(offer.available, false)
  assert.equal(offer.retryable, false)
  assert.doesNotMatch(JSON.stringify(offer), /PRIVATE-/)
})

test('temporary database failures and thrown network errors offer a safe retry', async () => {
  for (const table of ['inspection_report_links', 'eb_follow_up_orders', 'eb_projects', 'eb_inspection_details', 'inspection_lock_events']) {
    for (const thrown of [false, true]) {
      const f = fixture()
      f.rows.organizations[0].created_by = 'owner'
      if (thrown) f.failures[table] = new TypeError('fetch failed PRIVATE-SERVICE-TOKEN')
      else f.errors[table] = '57014'
      const offer = await f.offer()
      assert.equal(offer.available, false)
      assert.equal(offer.retryable, true)
      assert.equal(offer.alreadyActive, false)
      assert.equal(offer.priceOre, 59900)
      assert.match(offer.reason ?? '', /Försök igen/)
      assert.doesNotMatch(JSON.stringify(offer), /PRIVATE-|57014|fetch failed/)
    }
  }
})

test('paid access does not depend on new-sale notes, seller setup, mail setup or latest-version eligibility', async () => {
  const f = fixture()
  f.rows.eb_follow_up_orders.push({ id: 'paid', org_id: 'org', inspection_id: 'inspection', seller_snapshot: f.seller })
  f.rows.inspection_report_links.push({ ...f.rows.inspection_report_links[0], id: 'new-link', token_hash: 'new-token', created_at: '2026-09-09T10:00:00Z' })
  f.report.notes = []
  f.failures.organizations = new Error('PRIVATE-SERVER-FAILURE')
  const saved = process.env.RESEND_API_KEY
  delete process.env.RESEND_API_KEY
  try {
    const offer = await f.offer()
    assert.equal(offer.available, true)
    assert.equal(offer.alreadyActive, true)
    assert.equal(offer.retryable, false)
    assert.deepEqual(offer.seller, f.seller)
    assert.equal(f.reads.some(read => read.table === 'organizations'), false)
  } finally { process.env.RESEND_API_KEY = saved }
})

test('internal preview evaluates the selected existing link with organisation and inspection scope, without any bearer token', async () => {
  const f = fixture()
  const offer = await f.server.getEbFollowUpOfferForInspection({ orgId: 'org', inspectionId: 'inspection', reportLinkId: 'link' })
  assert.equal(offer.available, true)
  const selected = f.reads[0]
  assert.equal(selected.table, 'inspection_report_links')
  assert.deepEqual(selected.filters, [['revoked_at', null], ['id', 'link'], ['org_id', 'org'], ['inspection_id', 'inspection']])
  assert.doesNotMatch(selected.fields, /token/)
  assert.doesNotMatch(JSON.stringify(f.reads), /token_hash|hash:/)
  assert.doesNotMatch(JSON.stringify(offer), /PRIVATE-|report-token/)
  assert.deepEqual(offer, await f.offer())
})

test('internal preview cannot substitute another organisation, inspection, missing link or revoked link', async () => {
  for (const scope of [
    { orgId: 'other', inspectionId: 'inspection', reportLinkId: 'link' },
    { orgId: 'org', inspectionId: 'other', reportLinkId: 'link' },
    { orgId: 'org', inspectionId: 'inspection', reportLinkId: 'missing' },
    { orgId: '', inspectionId: 'inspection', reportLinkId: 'link' },
  ]) {
    const offer = await fixture().server.getEbFollowUpOfferForInspection(scope)
    assert.equal(offer.available, false)
    assert.equal(offer.retryable, false)
  }
  const f = fixture()
  f.rows.inspection_report_links[0].revoked_at = lockTime
  assert.equal((await f.server.getEbFollowUpOfferForInspection({ orgId: 'org', inspectionId: 'inspection', reportLinkId: 'link' })).available, false)
})
