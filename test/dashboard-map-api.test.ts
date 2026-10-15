import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'
import type { DashboardBooking } from '../src/lib/dashboard/model'
// @ts-expect-error Node strip-types requires an explicit TypeScript extension.
import { getStockholmDate } from '../src/lib/dashboard/model.ts'

const orgId = '11111111-1111-4111-8111-111111111111'
const records: DashboardBooking[] = [
  { id: 'today-ob', moduleId: 'ob', title: 'Synlig besiktning', href: '/ob', startsAt: '2026-10-12', address: 'Testgatan 1, Teststad' },
  { id: 'today-tu', moduleId: 'tu', title: 'Synlig utredning', href: '/tu', startsAt: '2026-10-11T22:30:00Z', address: 'Testgatan 2, Teststad' },
  { id: 'tomorrow', moduleId: 'eb', title: 'Annat datum', href: '/eb', startsAt: '2026-10-13', address: 'Testgatan 3, Teststad' },
  { id: 'tentative', moduleId: 'ob', title: 'Skickad bekräftelse', href: '/ob/assignments/sent', startsAt: '2026-10-12', address: 'Preliminära gatan 4, Teststad', status: 'tentative' },
]

function harness(error?: string) {
  const reads: unknown[] = []
  const lookups: DashboardBooking[][] = []
  const dependencies: Record<string, unknown> = {
    'next/server': { NextResponse: { json: Response.json } },
    '@/lib/dashboard/server': {
      getStockholmDate,
      getDashboardData: async (selected?: unknown) => {
        reads.push(selected)
        if (error) throw new Error(error)
        return { organizationId: orgId, bookings: records }
      },
    },
    '@/lib/dashboard/geocoding': { locateDashboardBookings: async (rows: DashboardBooking[]) => {
      lookups.push(rows)
      return rows.map(row => ({ id: row.id, status: 'located', latitude: 59.33, longitude: 18.07 }))
    } },
  }
  const output = ts.transpileModule(readFileSync(new URL('../src/app/api/dashboard/map/route.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const compiled = { exports: {} }
  new Function('require', 'module', 'exports', output)((name: string) => {
    if (!(name in dependencies)) throw new Error(`Unexpected dependency: ${name}`)
    return dependencies[name]
  }, compiled, compiled.exports)
  return { route: compiled.exports as { GET(request: Request): Promise<Response> }, reads, lookups }
}

const request = (query: string) => new Request(`https://hushub.test/api/dashboard/map?${query}`)

test('map only geocodes server-authorized records for the selected Stockholm date', async () => {
  const h = harness()
  const response = await h.route.GET(request(`orgId=${orgId}&date=2026-10-12`))
  assert.equal(response.status, 200)
  assert.deepEqual(h.reads, [orgId])
  assert.deepEqual(h.lookups[0].map(row => row.id), ['today-ob', 'today-tu'])
  const result = await response.json()
  assert.equal(result.date, '2026-10-12')
  assert.equal(result.organizationId, orgId)
  assert.equal(result.locations.length, 2)
  assert.equal(response.headers.get('cache-control'), 'private, no-store, max-age=0')
  assert.equal('bookings' in result, false)
})

test('booking selection only narrows authorized records and never admits unknown IDs', async () => {
  const h = harness()
  const response = await h.route.GET(request('date=2026-10-12&bookingId=today-tu&bookingId=other-org-id&bookingId=tomorrow'))
  assert.equal(response.status, 200)
  assert.deepEqual(h.lookups[0].map(row => row.id), ['today-tu'])
  assert.deepEqual(h.reads, [undefined])
})

test('tentative slots cannot be geocoded even when selected explicitly', async () => {
  const h = harness()
  const response = await h.route.GET(request('date=2026-10-12&bookingId=tentative'))
  assert.equal(response.status, 200)
  assert.deepEqual(h.lookups[0], [])
  assert.deepEqual((await response.json()).locations, [])
})

test('arbitrary addresses, ambiguous organization/date and malformed dates fail before readers or geocoding', async () => {
  for (const query of [
    'date=2026-10-12&address=Somewhere', 'date=2026-10-12&q=Somewhere',
    `date=2026-10-12&orgId=${orgId}&orgId=${orgId}`, 'date=2026-10-12&date=2026-10-13',
    'date=2026-02-30', 'date=12-10-2026', '',
  ]) {
    const h = harness()
    const response = await h.route.GET(request(query))
    assert.equal(response.status, 400, query)
    assert.equal(h.reads.length, 0)
    assert.equal(h.lookups.length, 0)
  }
})

test('auth, org membership and unavailable organization failures never reach geocoding', async () => {
  for (const [code, status] of [
    ['UNAUTHORIZED', 401], ['ORG_SELECTION_INVALID', 400], ['ORG_MEMBERSHIP_REQUIRED', 403],
    ['MODULE_ACCESS_REQUIRED', 403], ['DASHBOARD_ORGANIZATION_UNSUPPORTED', 400],
  ] as const) {
    const h = harness(code)
    const response = await h.route.GET(request(`date=2026-10-12&orgId=${orgId}`))
    assert.equal(response.status, status, code)
    assert.equal(h.lookups.length, 0)
    if (code === 'DASHBOARD_ORGANIZATION_UNSUPPORTED') assert.match((await response.json()).error, /standardorganisation/)
    assert.equal(response.headers.get('cache-control'), 'private, no-store, max-age=0')
  }
})

test('unexpected internal errors do not expose database/provider details', async () => {
  const h = harness('database-password and private-host')
  const response = await h.route.GET(request('date=2026-10-12'))
  assert.equal(response.status, 500)
  assert.doesNotMatch(await response.text(), /database-password|private-host/)
  assert.equal(h.lookups.length, 0)
})
