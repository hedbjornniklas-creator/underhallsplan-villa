import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import type * as Domain from '../src/lib/ob/overview'
import type * as Fixtures from './fixtures/ob-overview-data'
import type * as Loader from '../src/lib/ob/overviewLoader'
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
const { overviewAssignment: assignment, overviewInspection: inspection } = load<typeof Fixtures>('test/fixtures/ob-overview-data.ts', {
  '../../src/lib/ob/overview': domain,
})
const { buildObOverview: build, selectObOverview: select } = domain
const loader = load<typeof Loader>('src/lib/ob/overviewLoader.ts', { './overview': domain })
const options = { search: '', filter: 'all' as const, sort: 'date-desc' as const, attentionOnly: false, showArchived: false }

test('early start shows waiting for customer AND ongoing in one row', () => {
  const rows = build([assignment({ inspection_id: 'inspection-1' })], [inspection()], [])
  assert.equal(rows.length, 1)
  assert.equal(rows[0].confirmation, 'Inväntar kund')
  assert.equal(rows[0].inspection, 'Pågår')
  assert.equal(rows[0].closed, false)
  assert.equal(rows[0].inspectionHref, '/properties/property-1/ob/inspection-1')
})
test('conversion is not a completed inspection', () => {
  const [row] = build([assignment({ inspection_id: 'inspection-1', status: 'completed', accepted_at: '2026-09-20',
    booked_at: '2026-09-20', approvalVerified: true })], [inspection()], [])
  assert.equal(row.confirmation, 'Godkänd och accepterad')
  assert.equal(row.inspection, 'Pågår')
  assert.equal(row.closed, false)
})
test('booked without acceptance evidence does not imply approval', () => {
  const [row] = build([assignment({ status: 'booked', accepted_at: '2026-09-20', booked_at: '2026-09-20' })], [], [])
  assert.match(row.confirmation, /kontrolleras/)
  assert.ok(row.attention.length)
})
test('approved by customer has an explicit accept action', () => {
  const [row] = build([assignment({ status: 'ordered', accepted_at: '2026-09-20', approvalVerified: true })], [], [])
  assert.equal(row.confirmation, 'Godkänd av kund')
  assert.equal(row.confirmationAction, 'Acceptera uppdrag')
  assert.equal(row.confirmationHref, '/ob/assignments/assignment-1')
})
test('accepted assignment without an inspection points to the existing start flow', () => {
  const [row] = build([assignment({ status: 'booked', accepted_at: '2026-09-20', booked_at: '2026-09-20', approvalVerified: true })], [], [])
  assert.equal(row.confirmationAction, 'Starta besiktning')
  assert.equal(row.confirmationHref, '/ob/assignments/assignment-1')
})
test('archiving a confirmation does not hide its ongoing inspection', () => {
  const [row] = build([assignment({ inspection_id: 'inspection-1', archived_at: '2026-09-20' })], [inspection()], [])
  assert.equal(row.archived, false)
  assert.match(row.confirmation, /Arkiverad/)
  assert.equal(select([row], options).length, 1)
})
test('reissue uses workflow pointer and retains a single inspection row', () => {
  const rows = build([
    assignment({ id: 'old', inspection_id: 'inspection-1', status: 'cancelled' }),
    assignment({ id: 'middle', inspection_id: 'inspection-1', status: 'cancelled' }),
    assignment({ id: 'current', inspection_id: 'inspection-1', status: 'draft' }),
  ], [inspection()], [{ inspection_id: 'inspection-1', initial_assignment_id: 'old', current_assignment_id: 'current',
    paused: true, needsReview: true, reason: 'Uppdatera uppdraget' }])
  assert.equal(rows.length, 1)
  assert.equal(rows[0].confirmation, 'Utkast')
  assert.equal(rows[0].confirmationHref, '/ob/assignments/current')
})
test('workflow can link current assignment even without its inspection_id', () => {
  const rows = build([assignment()], [inspection()], [{ inspection_id: 'inspection-1', initial_assignment_id: 'assignment-1',
    current_assignment_id: 'assignment-1', paused: false, needsReview: true, reason: null }])
  assert.equal(rows.length, 1)
})
test('multiple inspections on the same property are never merged by address', () => {
  assert.equal(build([], [inspection(), inspection({ id: 'second' })], []).length, 2)
})
test('unlinked legacy inspection is retained and not labelled approved', () => {
  const [row] = build([], [inspection({ status: 'completed' })], [])
  assert.equal(row.confirmation, 'Ingen kopplad')
  assert.equal(row.confirmationHref, null)
  assert.equal(row.closed, true)
})
test('inaccessible linked inspection gets no link and is not labelled not started', () => {
  const [row] = build([assignment({ inspection_id: 'secret' })], [], [])
  assert.equal(row.inspection, 'Ej tillgänglig')
  assert.equal(row.inspectionHref, null)
})
test('unknown inspection status stays visible and actionable', () => {
  const [row] = build([], [inspection({ status: 'future-status' })], [])
  assert.equal(row.inspection, 'Status saknas')
  assert.equal(row.closed, false)
  assert.ok(row.attention.length)
})
test('expired link and unresolved technical failure require action', () => {
  const [row] = build([assignment({ activeLink: false, linkIssue: true })], [], [])
  assert.equal(row.confirmation, 'Länk behöver förnyas')
  assert.equal(row.attention.length, 2)
})
test('cancellation does not close an already ongoing inspection', () => {
  const [row] = build([assignment({ status: 'cancelled', inspection_id: 'inspection-1' })], [inspection()], [])
  assert.equal(row.closed, false)
})
test('reconciliation is flagged using authoritative workflow state', () => {
  const [row] = build([assignment({ inspection_id: 'inspection-1', status: 'booked', approvalVerified: true,
    accepted_at: '2026-09-20', booked_at: '2026-09-20' })], [inspection()], [{ inspection_id: 'inspection-1',
    initial_assignment_id: 'assignment-1', current_assignment_id: 'assignment-1', paused: false, needsReview: true, reason: null }])
  assert.ok(row.attention.some(reason => reason.includes('Stäm av')))
})
test('filters and search use both domains and inspection snapshot metadata', () => {
  const rows = build([assignment({ id: 'draft', status: 'draft' })], [inspection(), inspection({ id: 'done', status: 'completed' }),
    inspection({ id: 'archive', status: 'archived' })], [])
  assert.equal(select(rows, options).length, 3)
  assert.equal(select(rows, { ...options, filter: 'closed' }).length, 1)
  assert.equal(select(rows, { ...options, showArchived: true }).length, 4)
  assert.equal(select(rows, { ...options, attentionOnly: true }).length, 1)
  assert.equal(select(rows, { ...options, search: '2026-0925-01 täby' }).length, 2)
  assert.equal(select(rows, { ...options, search: 'saknas' }).length, 0)
})
test('missing dates sort last with stable tie breakers in either direction', () => {
  const rows = build([], [inspection({ id: 'a', date: null }), inspection({ id: 'b' }), inspection({ id: 'c', date: '2026-09-01' })], [])
  assert.deepEqual(select(rows, options).map(row => row.id), ['inspection:b', 'inspection:c', 'inspection:a'])
  assert.deepEqual(select(rows, { ...options, sort: 'date-asc' }).map(row => row.id), ['inspection:c', 'inspection:b', 'inspection:a'])
})
test('page reader crosses Supabase default 1000-row limit and fails closed on query error', async () => {
  const values = Array.from({ length: 1203 }, (_, id) => ({ id }))
  assert.equal((await loader.readOverviewPages(async (from, to) => ({ data: values.slice(from, to + 1), error: null }))).length, 1203)
  await assert.rejects(loader.readOverviewPages(async () => ({ data: null, error: { message: 'denied' } })), /denied/)
})

type Row = Record<string, unknown>
function client(tables: Record<string, Row[]>, calls: string[], rpcAssignment = 'assignment-1') {
  return {
    from(table: string) {
      calls.push(table)
      let rows = tables[table] ?? []
      const query = {
        select: () => query,
        eq: (key: string, value: unknown) => { rows = rows.filter(row => row[key] === value); return query },
        in: (key: string, values: unknown[]) => { rows = rows.filter(row => values.includes(row[key])); return query },
        is: (key: string, value: unknown) => { rows = rows.filter(row => (row[key] ?? null) === value); return query },
        order: () => query,
        range: async (from: number, to: number) => ({ data: rows.slice(from, to + 1).map(row => ({ ...row })), error: null }),
      }
      return query
    },
    rpc: async () => ({ data: { assignmentId: rpcAssignment, needsReview: false, paused: false, reason: null }, error: null }),
  } as unknown as SupabaseClient
}
test('loader scopes assignments to organization/OB, inspections to owner/OB, and honors snapshots', async () => {
  const adminCalls: string[] = [], userCalls: string[] = []
  const admin = client({
    assignments: [
      { ...assignment(), org_id: 'org', assignment_type: 'OB' },
      { ...assignment({ id: 'foreign' }), org_id: 'other', assignment_type: 'OB' },
      { ...assignment({ id: 'tu' }), org_id: 'org', assignment_type: 'TU' },
    ],
    assignment_links: [{ id: 'link', assignment_id: 'assignment-1', expires_at: '2099-01-01', used_at: null, revoked_at: null }],
  }, adminCalls)
  const userClient = client({
    properties: [{ id: 'property-1', owner: 'me', address: 'Current property address' }, { id: 'other', owner: 'someone' }],
    inspections: [{ ...inspection(), inspection_family: 'OB' }, { ...inspection({ id: 'forbidden', property_id: 'other' }), inspection_family: 'OB' },
      { ...inspection({ id: 'tu' }), inspection_family: 'TU' }],
    ob_property_snapshot: [{ inspection_id: 'inspection-1', address: 'Historical snapshot', city: 'Täby', client_name: 'Snapshot customer' }],
  }, userCalls)
  const rows = await loader.loadObOverview({ admin, userClient, userId: 'me', orgId: 'org' })
  assert.equal(rows.length, 2)
  assert.equal(rows.find(row => row.id === 'inspection:inspection-1')?.address, 'Historical snapshot')
  assert.equal(rows.find(row => row.id === 'assignment:assignment-1')?.confirmation, 'Inväntar kund')
  assert.ok(!adminCalls.includes('inspections'))
  assert.ok(!adminCalls.includes('properties'))
  assert.deepEqual(userCalls, ['properties', 'inspections', 'ob_property_snapshot'])
})
test('concurrent reissue fails rather than combining two versions', async () => {
  const admin = client({ assignments: [{ ...assignment(), org_id: 'org', assignment_type: 'OB' }],
    ob_assignment_workflows: [{ inspection_id: 'inspection-1', current_assignment_id: 'assignment-1', initial_assignment_id: 'assignment-1', org_id: 'org' }],
  }, [], 'replacement')
  await assert.rejects(loader.loadObOverview({ admin, userClient: client({}, []), orgId: 'org', userId: 'me' }), /ändrades/)
})

test('API requires authentication/membership before creating either data client', async () => {
  for (const [code, status] of [['UNAUTHORIZED', 401], ['ORG_MEMBERSHIP_REQUIRED', 403]] as const) {
    const forbidden = () => { throw Error('Data access before authentication') }
    const route = load<typeof Route>('src/app/api/ob/overview/route.ts', {
      'next/server': { NextResponse: Response },
      '@/lib/assignments/server': { requireOrgContext: async () => { throw Error(code) } },
      '@/lib/supabase/admin': { createSupabaseAdminClient: forbidden },
      '@/lib/supabase/server': { createSupabaseServerClient: forbidden },
      '@/lib/ob/overviewLoader': { loadObOverview: forbidden },
    })
    const response = await route.GET()
    assert.equal(response.status, status)
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store')
  }
})
test('API uses server-derived user and organization and returns no-store data', async () => {
  const route = load<typeof Route>('src/app/api/ob/overview/route.ts', {
    'next/server': { NextResponse: Response },
    '@/lib/assignments/server': { requireOrgContext: async () => ({ userId: 'me', orgId: 'org' }) },
    '@/lib/supabase/admin': { createSupabaseAdminClient: () => 'admin' },
    '@/lib/supabase/server': { createSupabaseServerClient: () => 'user' },
    '@/lib/ob/overviewLoader': { loadObOverview: async (input: unknown) => {
      assert.deepEqual(input, { userId: 'me', orgId: 'org', admin: 'admin', userClient: 'user' })
      return []
    } },
  })
  const response = await route.GET()
  assert.deepEqual(await response.json(), { items: [] })
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store')
})
