import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'
import type { DashboardBooking } from '../src/lib/dashboard/model'
// @ts-expect-error Node strip-types requires the extension.
import { getStockholmDate } from '../src/lib/dashboard/model.ts'
// @ts-expect-error Node strip-types requires the extension.
import * as calendar from '../src/lib/dashboard/calendar.ts'

const orgId = '11111111-1111-4111-8111-111111111111'
const records: DashboardBooking[] = [
  { id: 'later', moduleId: 'tu', title: 'Utredning', href: '/tu', startsAt: '2026-10-15T13:30:00+02:00', address: 'Testgatan 2, Stockholm' },
  { id: 'draft', moduleId: 'ob', title: 'Utkast', href: '/ob', startsAt: '2026-10-15T12:30:00+02:00', address: 'Testgatan 1, Stockholm', status: 'tentative' },
  { id: 'tomorrow', moduleId: 'ob', title: 'I morgon', href: '/ob', startsAt: '2026-10-16', address: 'Testgatan 3, Stockholm' },
]
function harness({ error = '', companyAddress = 'Kontorsgatan 1', missingId = '', bookings = records, approximate = false } = {}) {
  const reads: unknown[] = [], companyReads: string[] = [], lookups: DashboardBooking[][] = [], routes: Array<Array<{ id: string }>> = []
  const deps: Record<string, unknown> = {
    'next/server': { NextResponse: { json: Response.json } },
    '@/lib/dashboard/calendar': calendar,
    '@/lib/dashboard/server': { getStockholmDate, getDashboardData: async (selected?: unknown) => {
      reads.push(selected); if (error) throw Error(error)
      return { organizationId: orgId, bookings }
    } },
    '@/lib/organizations/companyProfile': { readOrganizationBranding: async (selected: string) => {
      companyReads.push(selected); return { address: companyAddress, postalCode: '123 45', city: 'Stockholm' }
    } },
    '@/lib/dashboard/geocoding': { isDashboardCoordinate: (lat: unknown, lng: unknown) => typeof lat === 'number' && Number.isFinite(lat)
      && typeof lng === 'number' && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180,
    locateDashboardBookings: async (rows: DashboardBooking[]) => {
      lookups.push(rows)
      return rows.map((row, index) => row.id === missingId ? { id: row.id, status: 'not_found' }
        : { id: row.id, status: 'located', latitude: 59.3 + index / 100, longitude: 18.1, approximate })
    } },
    '@/lib/dashboard/routing': { calculateDashboardRoute: async (points: Array<{ id: string }>) => {
      routes.push(points)
      return { status: 'ready', durationSeconds: 900 * (points.length - 1), distanceMeters: 10000 * (points.length - 1), geometry: [],
        legs: points.slice(1).map((point, index) => ({ fromId: points[index].id, toId: point.id, durationSeconds: 900, distanceMeters: 10000 })) }
    } },
  }
  const compiled = { exports: {} }
  const output = ts.transpileModule(readFileSync(new URL('../src/app/api/dashboard/travel/route.ts', import.meta.url), 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  new Function('require', 'module', 'exports', output)((name: string) => {
    if (!(name in deps)) throw Error(`Unexpected dependency ${name}`)
    return deps[name]
  }, compiled, compiled.exports)
  return { route: compiled.exports as { GET(request: Request): Promise<Response> }, reads, companyReads, lookups, routes }
}
const request = (query: string) => new Request(`https://hushub.test/api/dashboard/travel?${query}`)

test('travel starts at this organization company and preserves appointment time order including selected drafts', async () => {
  const h = harness()
  const response = await h.route.GET(request(`date=2026-10-15&orgId=${orgId}&includeTentative=1&bookingId=later&bookingId=draft&bookingId=foreign&bookingId=tomorrow`))
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.deepEqual(body.bookingIds, ['draft', 'later'])
  assert.deepEqual(h.companyReads, [orgId])
  assert.deepEqual(h.routes[0].map(point => point.id), ['company-origin', 'draft', 'later'])
  assert.equal(body.route.durationSeconds, 1800)
  assert.equal(body.origin.address, 'Kontorsgatan 1, 123 45 Stockholm')
  assert.equal(new URL(body.directionsLinks[0]).searchParams.get('origin'), body.origin.address)
  assert.equal(response.headers.get('cache-control'), 'private, no-store, max-age=0')
})
test('one tentative appointment has a company-to-visit leg, and disabling tentative excludes it', async () => {
  const h = harness()
  const response = await h.route.GET(request('date=2026-10-15&includeTentative=1&bookingId=draft'))
  assert.deepEqual((await response.json()).route.legs.map((leg: { fromId: string; toId: string }) => [leg.fromId, leg.toId]), [['company-origin', 'draft']])
  const confirmed = await h.route.GET(request('date=2026-10-15&includeTentative=0'))
  assert.deepEqual((await confirmed.json()).bookingIds, ['later'])
})
test('no jobs, missing company, or any unresolved stop never produce a fabricated or incomplete total', async () => {
  for (const [config, expected] of [
    [{ bookings: [] as DashboardBooking[] }, 'insufficient_points'], [{ companyAddress: '' }, 'origin_missing'],
    [{ missingId: 'draft' }, 'locations_missing'], [{ missingId: 'company-origin' }, 'origin_missing'],
  ] as const) {
    const h = harness(config)
    const response = await h.route.GET(request('date=2026-10-15&includeTentative=1'))
    const body = await response.json()
    assert.equal(body.route.status, expected)
    assert.equal(body.route.durationSeconds, undefined)
    assert.deepEqual(h.routes, [])
  }
})
test('invalid dates, arbitrary origins/coordinates, duplicate selection fields fail before private readers', async () => {
  for (const query of ['date=2026-02-30', 'date=2026-10-15&origin=Somewhere', 'date=2026-10-15&latitude=59',
    'date=2026-10-15&date=2026-10-16', 'date=2026-10-15&includeTentative=true',
    'date=2026-10-15&includeTentative=1&includeTentative=0', `date=2026-10-15&orgId=${orgId}&orgId=${orgId}`]) {
    const h = harness()
    assert.equal((await h.route.GET(request(query))).status, 400)
    assert.deepEqual(h.reads, [])
  }
})
test('auth and organization failures never fetch a company location or invoke geocoding/routing', async () => {
  for (const [error, status] of [['UNAUTHORIZED', 401], ['ORG_MEMBERSHIP_REQUIRED', 403], ['MODULE_ACCESS_REQUIRED', 403],
    ['ORG_SELECTION_INVALID', 400], ['DASHBOARD_ORGANIZATION_UNSUPPORTED', 400]] as const) {
    const h = harness({ error })
    assert.equal((await h.route.GET(request('date=2026-10-15'))).status, status)
    assert.deepEqual(h.companyReads, []); assert.deepEqual(h.lookups, []); assert.deepEqual(h.routes, [])
  }
})
test('unexpected internal errors do not leak credentials or provider information', async () => {
  const h = harness({ error: 'secret-password/private-provider' })
  const response = await h.route.GET(request('date=2026-10-15'))
  assert.equal(response.status, 500)
  assert.doesNotMatch(await response.text(), /secret-password|private-provider/)
})

test('approximate company or street positions retain their precision warning in the result', async () => {
  const h = harness({ approximate: true })
  const body = await (await h.route.GET(request('date=2026-10-15&includeTentative=1'))).json()
  assert.equal(body.route.status, 'ready')
  assert.equal(body.approximate, true)
})
