// @ts-expect-error Node strip-types requires the explicit extension.
import { obApiDomainBoundary } from './helpers/ob-api-domain-boundary.ts'
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import type * as Domain from '../src/lib/ob/overview'
import type * as Fixtures from './fixtures/ob-overview-data'
import type * as Loader from '../src/lib/ob/overviewLoader'
import type * as Query from '../src/lib/ob/overviewQuery'
import type * as Route from '../src/app/api/ob/overview/route'
import type { SupabaseClient } from '@supabase/supabase-js'
import type * as Billing from '../src/lib/ob/billing'

function load<T>(path: string, dependencies: Record<string, unknown> = {}): T {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const compiled = { exports: {} }
  new Function('require', 'module', 'exports', output)((name: string) => {
    const boundary = obApiDomainBoundary(name, dependencies)
    if (boundary !== undefined && !(name in dependencies)) return boundary
    if (name in dependencies) return dependencies[name]
    throw Error(`Unexpected dependency: ${name}`)
  }, compiled, compiled.exports)
  return compiled.exports as T
}
const billing = load<typeof Billing>('src/lib/ob/billing.ts')
const domain = load<typeof Domain>('src/lib/ob/overview.ts', { './billing': billing })
const query = load<typeof Query>('src/lib/ob/overviewQuery.ts')
const fixtures = load<typeof Fixtures>('test/fixtures/ob-overview-data.ts', {
  '../../src/lib/ob/overview': domain, '../../src/lib/ob/billing': billing,
})
const pdfCalls: { orgId: string; ids: string[] }[] = []
const loader = load<typeof Loader>('src/lib/ob/overviewLoader.ts', { './overview': domain,
  './billing': billing,
  '@/lib/supabase/admin': { createSupabaseAdminClient: () => ({}) },
  './overviewPdfs': { loadOverviewPdfIds: async (_client: unknown, orgId: string, ids: string[]) => {
    pdfCalls.push({ orgId, ids }); return new Set()
  } },
})
const options = query.parseOverviewQuery(new URLSearchParams())
const rawPage = {
  rows: [{ assignment: null, inspection: fixtures.overviewInspection(), workflow: null, canEdit: true,
    billing: { status: 'not_invoiced' } }],
  total: 51, counts: { all: 51, active: 50, closed: 1, 'to-invoice': 3 }, page: 2, pageSize: 10,
  billingAvailable: true,
}
function rpcClient(data: unknown, error: unknown = null) {
  const calls: { name: string; args: unknown }[] = []
  return { calls, client: {
    rpc: async (name: string, args: unknown) => { calls.push({ name, args }); return { data, error } },
    from: () => { throw Error('List must not fetch complete tables') },
  } as unknown as SupabaseClient }
}

test('query has bounded defaults and accepts all supported server filters', () => {
  assert.deepEqual(options, { search: '', filter: 'all', sort: 'date-desc', attentionOnly: false, showArchived: false, page: 1, pageSize: 10 })
  assert.deepEqual(query.parseOverviewQuery(new URLSearchParams('search=+Täby+&filter=closed&sort=customer&attentionOnly=true&showArchived=true&page=42&pageSize=50')),
    { search: 'Täby', filter: 'closed', sort: 'customer', attentionOnly: true, showArchived: true, page: 42, pageSize: 50 })
  assert.equal(query.parseOverviewQuery(new URLSearchParams('filter=to-invoice')).filter, 'to-invoice')
})

test('invalid page, page size, filter, boolean and excessive search fail explicitly', () => {
  for (const input of ['page=0', 'page=-1', 'page=1.5', 'page=1000000', 'pageSize=1000', 'filter=unknown', 'sort=unknown', 'attentionOnly=yes', 'showArchived=1', `search=${'a'.repeat(201)}`]) {
    assert.throws(() => query.parseOverviewQuery(new URLSearchParams(input)), query.InvalidOverviewQuery)
  }
})

test('one user-context RPC fetches one page and scopes PDF metadata to visible inspection IDs', async () => {
  const rpc = rpcClient(rawPage)
  const result = await loader.loadObOverview({ userClient: rpc.client, orgId: 'server-org', options: { ...options, page: 2, search: 'Täby' } })
  assert.equal(result.items.length, 1)
  assert.equal(result.items[0].id, 'inspection:inspection-1')
  assert.equal(result.total, 51)
  assert.equal(result.page, 2)
  assert.equal(result.billingAvailable, true)
  assert.deepEqual(result.items[0].billing, { status: 'not_invoiced' })
  assert.deepEqual(result.counts, rawPage.counts)
  assert.deepEqual(pdfCalls.at(-1), { orgId: 'server-org', ids: ['inspection-1'] })
  assert.deepEqual(rpc.calls, [{ name: 'ob_overview_page', args: {
    p_org_id: 'server-org', p_search: 'Täby', p_filter: 'all', p_sort: 'date-desc',
    p_attention_only: false, p_show_archived: false, p_page: 2, p_page_size: 10,
  } }])
})

test('page loader retains legacy and authoritative paused-workflow rendering', async () => {
  const assignment = fixtures.overviewAssignment({ inspection_id: 'inspection-1' })
  const workflow = { inspection_id: 'inspection-1', current_assignment_id: assignment.id, initial_assignment_id: assignment.id,
    needsReview: true, paused: true, reason: 'Uppdatera uppdraget' }
  const rpc = rpcClient({ ...rawPage, rows: [{ assignment, inspection: fixtures.overviewInspection(), workflow, canEdit: true,
    billing: { status: 'not_invoiced' } }] })
  const result = await loader.loadObOverview({ userClient: rpc.client, orgId: 'org', options })
  assert.deepEqual(result.items, domain.buildObOverview([assignment], [fixtures.overviewInspection()], [workflow],
    new Map([['inspection-1', billing.emptyObInspectionBilling()]])).map(item => ({ ...item, canEdit: true })))
})

test('only visible inspections with stored PDFs receive authenticated download links', async () => {
  const pdfLoader = load<typeof Loader>('src/lib/ob/overviewLoader.ts', { './overview': domain,
    './billing': billing,
    '@/lib/supabase/admin': { createSupabaseAdminClient: () => ({}) },
    './overviewPdfs': { loadOverviewPdfIds: async () => new Set(['inspection-1', 'foreign-inspection']) },
  })
  const rpc = rpcClient({ ...rawPage, rows: [
    rawPage.rows[0],
    { assignment: fixtures.overviewAssignment({ id: 'without-inspection' }), inspection: null, workflow: null, canEdit: true },
  ] })
  const result = await pdfLoader.loadObOverview({ userClient: rpc.client, orgId: 'org', options })
  assert.equal(result.items[0].pdfHref, '/api/report-v2/inspection-1/pdf')
  assert.equal(result.items[0].inspection, 'Pågår', 'a stored PDF is not the same as a completed inspection')
  assert.equal(result.items[1].pdfHref, undefined)
  assert.doesNotMatch(JSON.stringify(result), /foreign-inspection|pdf_base64|token/)
})

test('missing migration/query error fails closed rather than reverting to all-data reads', async () => {
  const rpc = rpcClient(null, { code: 'PGRST202', message: 'function missing' })
  await assert.rejects(loader.loadObOverview({ userClient: rpc.client, orgId: 'org', options }), loader.ObOverviewBillingConfigurationError)
  assert.equal(rpc.calls.length, 1)
})

test('legacy RPC responses explicitly require migration instead of guessing billing, totals or re-filtering a local page', async () => {
  const legacy = { ...rawPage, billingAvailable: undefined }
  for (const filter of ['all', 'active', 'closed', 'to-invoice'] as const) {
    for (const data of [legacy, { ...rawPage, billingAvailable: false }]) {
      const rpc = rpcClient(data)
      const beforePdf = pdfCalls.length
      await assert.rejects(loader.loadObOverview({ userClient: rpc.client, orgId: 'org', options: { ...options, filter } }),
        { code: 'OB_OVERVIEW_BILLING_CONFIGURATION', message: 'Databasstödet för fakturamarkering behöver installeras innan listan kan visas korrekt.' })
      assert.equal(rpc.calls.length, 1)
      assert.equal(pdfCalls.length, beforePdf, 'Unverified legacy entity IDs must not reach privileged metadata reads')
    }
  }
})

test('billing-aware server pagination preserves full totals and does not confuse list completion with inspection status', async () => {
  const completed = { ...fixtures.overviewInspection(), status: 'completed' }
  const unbilledRow = { ...rawPage.rows[0], inspection: completed }
  for (const filter of ['all', 'active', 'to-invoice'] as const) {
    const counts = { all: 88, active: 75, closed: 13, 'to-invoice': 61 }
    const rpc = rpcClient({ ...rawPage, rows: [unbilledRow], counts, total: counts[filter], page: 7 })
    const result = await loader.loadObOverview({ userClient: rpc.client, orgId: 'org', options: {
      ...options, filter, page: 7, attentionOnly: filter === 'to-invoice',
    } })
    assert.equal(result.total, counts[filter])
    assert.equal(result.page, 7)
    assert.deepEqual(result.counts, counts)
    assert.equal(result.items[0].inspection, 'Klar')
    assert.equal(result.items[0].closed, false)
    assert.equal(result.items[0].billing?.status, 'not_invoiced')
    assert.equal((rpc.calls[0].args as { p_attention_only: boolean }).p_attention_only, false)
  }
  const paidRow = { ...unbilledRow, billing: {
    ...billing.emptyObInspectionBilling(), status: 'invoiced', invoicedAt: '2026-11-07T12:00:00Z',
  } }
  const closed = await loader.loadObOverview({ userClient: rpcClient({ ...rawPage,
    rows: [paidRow], total: rawPage.counts.closed }).client, orgId: 'org', options: { ...options, filter: 'closed' } })
  assert.equal(closed.items[0].closed, true)
  assert.equal(closed.items[0].inspection, 'Klar')
})

test('malformed billing, absent fourth count and wrong server-filter membership fail closed', async () => {
  const row = rawPage.rows[0]
  const invalidRows = [
    { ...row, billing: undefined }, { ...row, billing: null },
    { ...row, billing: billing.unavailableObInspectionBilling() },
    { ...row, billing: { status: 'unknown' } },
    { ...row, inspection: null, assignment: fixtures.overviewAssignment() },
  ]
  for (const invalidRow of invalidRows) await assert.rejects(loader.loadObOverview({
    userClient: rpcClient({ ...rawPage, rows: [invalidRow] }).client, orgId: 'org', options,
  }))
  const legacyCounts = { all: rawPage.counts.all, active: rawPage.counts.active, closed: rawPage.counts.closed }
  await assert.rejects(loader.loadObOverview({ userClient: rpcClient({ ...rawPage, counts: legacyCounts }).client, orgId: 'org', options }))
  for (const filter of ['closed', 'to-invoice'] as const) await assert.rejects(loader.loadObOverview({
    userClient: rpcClient({ ...rawPage, total: rawPage.counts[filter] }).client, orgId: 'org', options: { ...options, filter },
  }), /urval/)
})

test('overview responses expose the exact same status-only projection for owner and read-only colleague rows', async () => {
  const privateBilling = { ...billing.emptyObInspectionBilling(), status: 'invoiced',
    invoicedAt: '2026-11-07T12:00:00Z', invoiceNumber: 'PRIVATE-INVOICE-123',
    updatedAt: '2026-11-07T12:00:00Z', updatedByName: 'PRIVATE-USER', revision: 17 }
  for (const canEdit of [true, false]) {
    const rpc = rpcClient({ ...rawPage, rows: [{ ...rawPage.rows[0], canEdit, billing: privateBilling }] })
    const result = await loader.loadObOverview({ userClient: rpc.client, orgId: 'org', options })
    assert.deepEqual(result.items[0].billing, { status: 'invoiced' })
    assert.equal(result.items[0].canEdit, canEdit)
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE-|invoiceNumber|invoicedAt|updatedAt|updatedByName|revision/)
  }
})

test('colleague overview rows retain read-only permission and link to the report preview', async () => {
  const rpc = rpcClient({ ...rawPage, rows: [{ ...rawPage.rows[0], canEdit: false }] })
  const result = await loader.loadObOverview({ userClient: rpc.client, orgId: 'org', options })
  assert.equal(result.items[0].canEdit, false)
  assert.match(result.items[0].inspectionHref!, /^\/utlatande\/[^/]+\/inspection-1$/)
  assert.equal(result.items[0].confirmationAction, 'Visa bekräftelse')
})

test('invalid counts, oversized payloads, duplicate identities and mixed workflows fail closed', async () => {
  const cases = [null, { ...rawPage, total: -1 }, { ...rawPage, page: 0 }, { ...rawPage, pageSize: 50 },
    { ...rawPage, counts: { all: 51, active: 1, closed: 1 } },
    { ...rawPage, rows: Array(11).fill(rawPage.rows[0]) },
    { ...rawPage, rows: [rawPage.rows[0], rawPage.rows[0]] },
    { ...rawPage, rows: [{ ...rawPage.rows[0], canEdit: undefined }] },
    { ...rawPage, rows: [{ assignment: null, inspection: null, workflow: null }] },
    { ...rawPage, rows: [{ assignment: fixtures.overviewAssignment(), inspection: fixtures.overviewInspection(),
      workflow: { current_assignment_id: 'replacement' } }] },
  ]
  for (const data of cases) {
    await assert.rejects(loader.loadObOverview({ userClient: rpcClient(data).client, orgId: 'org', options }))
  }
})

function route(dependencies: Record<string, unknown>) {
  return load<typeof Route>('src/app/api/ob/overview/route.ts', {
    'next/server': { NextResponse: Response }, '@/lib/ob/overviewQuery': query, ...dependencies,
  })
}

test('API authenticates before opening any data client or parsing parameters', async () => {
  for (const [code, status] of [['UNAUTHORIZED', 401], ['ORG_MEMBERSHIP_REQUIRED', 403]] as const) {
    const forbidden = () => { throw Error('Premature database read') }
    const api = route({ '@/lib/assignments/server': { requireOrgContext: async () => { throw Error(code) } },
      '@/lib/supabase/server': { createSupabaseServerClient: forbidden }, '@/lib/ob/overviewLoader': { loadObOverview: forbidden } })
    const response = await api.GET(new Request('https://example.test/api/ob/overview?page=-1'))
    assert.equal(response.status, status)
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store')
  }
})

test('API rejects malformed queries before data access', async () => {
  const api = route({ '@/lib/assignments/server': { requireOrgContext: async () => ({ userId: 'me', orgId: 'org' }) },
    '@/lib/supabase/server': { createSupabaseServerClient: () => { throw Error('Unexpected database read') } },
    '@/lib/ob/overviewLoader': { loadObOverview: () => { throw Error('Unexpected loader') } } })
  const response = await api.GET(new Request('https://example.test/api/ob/overview?pageSize=999'))
  assert.equal(response.status, 400)
})

test('API uses authenticated client and server-derived organization, returning paging metadata', async () => {
  const payload = { items: [], total: 0, counts: { all: 0, active: 0, closed: 0 }, page: 1, pageSize: 10 }
  const api = route({ '@/lib/assignments/server': { requireOrgContext: async () => ({ userId: 'me', orgId: 'org' }) },
    '@/lib/supabase/server': { createSupabaseServerClient: () => 'user' },
    '@/lib/ob/overviewLoader': { loadObOverview: async (input: unknown) => {
      assert.deepEqual(input, { userClient: 'user', orgId: 'org', options: { ...options, search: 'vinden' } })
      return payload
    } } })
  const response = await api.GET(new Request('https://example.test/api/ob/overview?search=vinden&orgId=other&userId=other'))
  assert.deepEqual(await response.json(), payload)
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store')
})

test('API exposes a specific recoverable migration error instead of a generic failure or incomplete legacy list', async () => {
  const api = route({ '@/lib/assignments/server': { requireOrgContext: async () => ({ userId: 'me', orgId: 'org' }) },
    '@/lib/supabase/server': { createSupabaseServerClient: () => 'user' },
    '@/lib/ob/overviewLoader': { loadObOverview: async () => { throw new loader.ObOverviewBillingConfigurationError() } } })
  const response = await api.GET(new Request('https://example.test/api/ob/overview?filter=to-invoice'))
  assert.equal(response.status, 503)
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store')
  assert.deepEqual(await response.json(), { code: 'OB_OVERVIEW_BILLING_CONFIGURATION',
    error: 'Databasstödet för fakturamarkering behöver installeras innan listan kan visas korrekt.' })
})
