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

function load<T>(path: string, dependencies: Record<string, unknown> = {}): T {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const compiled = { exports: {} }
  new Function('require', 'module', 'exports', output)((name: string) => {
    if (name in dependencies) return dependencies[name]
    throw Error(`Unexpected dependency: ${name}`)
  }, compiled, compiled.exports)
  return compiled.exports as T
}
const domain = load<typeof Domain>('src/lib/ob/overview.ts')
const query = load<typeof Query>('src/lib/ob/overviewQuery.ts')
const fixtures = load<typeof Fixtures>('test/fixtures/ob-overview-data.ts', { '../../src/lib/ob/overview': domain })
const loader = load<typeof Loader>('src/lib/ob/overviewLoader.ts', { './overview': domain })
const options = query.parseOverviewQuery(new URLSearchParams())
const rawPage = {
  rows: [{ assignment: null, inspection: fixtures.overviewInspection(), workflow: null }],
  total: 51, counts: { all: 51, active: 50, closed: 1 }, page: 2, pageSize: 10,
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
})

test('invalid page, page size, filter, boolean and excessive search fail explicitly', () => {
  for (const input of ['page=0', 'page=-1', 'page=1.5', 'page=1000000', 'pageSize=1000', 'filter=unknown', 'sort=unknown', 'attentionOnly=yes', 'showArchived=1', `search=${'a'.repeat(201)}`]) {
    assert.throws(() => query.parseOverviewQuery(new URLSearchParams(input)), query.InvalidOverviewQuery)
  }
})

test('one user-context RPC fetches one page without admin or table reads', async () => {
  const rpc = rpcClient(rawPage)
  const result = await loader.loadObOverview({ userClient: rpc.client, orgId: 'server-org', options: { ...options, page: 2, search: 'Täby' } })
  assert.equal(result.items.length, 1)
  assert.equal(result.items[0].id, 'inspection:inspection-1')
  assert.equal(result.total, 51)
  assert.equal(result.page, 2)
  assert.deepEqual(result.counts, rawPage.counts)
  assert.deepEqual(rpc.calls, [{ name: 'ob_overview_page', args: {
    p_org_id: 'server-org', p_search: 'Täby', p_filter: 'all', p_sort: 'date-desc',
    p_attention_only: false, p_show_archived: false, p_page: 2, p_page_size: 10,
  } }])
})

test('page loader retains legacy and authoritative paused-workflow rendering', async () => {
  const assignment = fixtures.overviewAssignment({ inspection_id: 'inspection-1' })
  const workflow = { inspection_id: 'inspection-1', current_assignment_id: assignment.id, initial_assignment_id: assignment.id,
    needsReview: true, paused: true, reason: 'Uppdatera uppdraget' }
  const rpc = rpcClient({ ...rawPage, rows: [{ assignment, inspection: fixtures.overviewInspection(), workflow }] })
  const result = await loader.loadObOverview({ userClient: rpc.client, orgId: 'org', options })
  assert.deepEqual(result.items, domain.buildObOverview([assignment], [fixtures.overviewInspection()], [workflow]))
})

test('missing migration/query error fails closed rather than reverting to all-data reads', async () => {
  const rpc = rpcClient(null, { code: 'PGRST202', message: 'function missing' })
  await assert.rejects(loader.loadObOverview({ userClient: rpc.client, orgId: 'org', options }), /Kunde inte läsa/)
  assert.equal(rpc.calls.length, 1)
})

test('invalid counts, oversized payloads, duplicate identities and mixed workflows fail closed', async () => {
  const cases = [null, { ...rawPage, total: -1 }, { ...rawPage, page: 0 }, { ...rawPage, pageSize: 50 },
    { ...rawPage, counts: { all: 51, active: 1, closed: 1 } },
    { ...rawPage, rows: Array(11).fill(rawPage.rows[0]) },
    { ...rawPage, rows: [rawPage.rows[0], rawPage.rows[0]] },
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
