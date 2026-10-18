import assert from 'node:assert/strict'
import test from 'node:test'
// @ts-expect-error Node strip-types requires an explicit TypeScript extension.
import { calculateDashboardRoute } from '../src/lib/dashboard/routing.ts'
import type { DashboardRoutePoint } from '../src/lib/dashboard/routing'

const points: DashboardRoutePoint[] = [
  { id: 'company-private', latitude: 59.33, longitude: 18.07 },
  { id: 'booking-private', latitude: 59.35, longitude: 18.08 },
  { id: 'next-private', latitude: 59.37, longitude: 18.09 },
]
const unavailable = { status: 'unavailable', legs: [], geometry: [] }
const payload = (input = points) => ({
  code: 'Ok',
  waypoints: input.map(point => ({ distance: 2, location: [point.longitude, point.latitude] })),
  routes: [{
    duration: (input.length - 1) * 600,
    distance: (input.length - 1) * 5000,
    legs: input.slice(1).map(() => ({ duration: 600, distance: 5000 })),
    geometry: { type: 'LineString', coordinates: input.map(point => [point.longitude, point.latitude]) },
  }],
})
const response = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } })

// Each case has its own in-memory provider state; production shares that state
// across callers so the cache and provider rate limit are effective together.
async function isolated(run: () => Promise<void>) {
  const originalFetch = globalThis.fetch
  const originalUrl = process.env.DASHBOARD_ROUTING_URL
  const originalEnabled = process.env.DASHBOARD_ROUTING_ENABLED
  const shared = globalThis as typeof globalThis & { hushubDashboardRouting?: unknown }
  delete shared.hushubDashboardRouting
  process.env.DASHBOARD_ROUTING_URL = 'https://router.example.test/route/v1/driving/'
  delete process.env.DASHBOARD_ROUTING_ENABLED
  try { await run() } finally {
    globalThis.fetch = originalFetch
    if (originalUrl === undefined) delete process.env.DASHBOARD_ROUTING_URL
    else process.env.DASHBOARD_ROUTING_URL = originalUrl
    if (originalEnabled === undefined) delete process.env.DASHBOARD_ROUTING_ENABLED
    else process.env.DASHBOARD_ROUTING_ENABLED = originalEnabled
    delete shared.hushubDashboardRouting
  }
}

test('driving route sends only ordered longitude/latitude coordinates and returns real provider legs', async () => isolated(async () => {
  let calls = 0
  globalThis.fetch = async (input, init) => {
    calls++
    const url = new URL(String(input))
    assert.equal(url.pathname, '/route/v1/driving/18.07,59.33;18.08,59.35;18.09,59.37')
    assert.equal(url.searchParams.get('steps'), 'false')
    assert.equal(url.searchParams.get('geometries'), 'geojson')
    assert.equal(url.searchParams.get('overview'), 'simplified')
    assert.equal(url.searchParams.get('alternatives'), 'false')
    assert.equal(url.searchParams.get('radiuses'), '2000;2000;2000')
    assert.equal(url.href.includes('private'), false)
    assert.equal(init?.cache, 'no-store')
    assert.match(String((init?.headers as Record<string, string>)['User-Agent']), /HushubDashboard.*hushub.se/)
    assert.ok(init?.signal)
    return response(payload())
  }
  assert.deepEqual(await calculateDashboardRoute(points), {
    status: 'ready', durationSeconds: 1200, distanceMeters: 10000,
    legs: [
      { fromId: 'company-private', toId: 'booking-private', durationSeconds: 600, distanceMeters: 5000 },
      { fromId: 'booking-private', toId: 'next-private', durationSeconds: 600, distanceMeters: 5000 },
    ],
    geometry: [[18.07, 59.33], [18.08, 59.35], [18.09, 59.37]],
  })
  assert.equal(calls, 1)
}))

test('zero or one point is insufficient and never fabricates zero travel time', async () => isolated(async () => {
  globalThis.fetch = async () => { throw new Error('Unexpected route request') }
  for (const input of [[], [points[0]]]) {
    assert.deepEqual(await calculateDashboardRoute(input), { status: 'insufficient_points', legs: [], geometry: [] })
  }
}))

test('invalid coordinates and more than 25 points are explicitly unavailable without truncation', async () => isolated(async () => {
  globalThis.fetch = async () => { throw new Error('Unexpected route request') }
  assert.deepEqual(await calculateDashboardRoute([points[0], { ...points[1], latitude: NaN }]), unavailable)
  assert.deepEqual(await calculateDashboardRoute([points[0], { ...points[1], longitude: 181 }]), unavailable)
  assert.deepEqual(await calculateDashboardRoute(Array.from({ length: 26 }, (_, index) => ({ ...points[0], id: String(index) }))), unavailable)
}))

test('provider opt-out and malformed or insecure provider configuration do not request routes', async () => isolated(async () => {
  globalThis.fetch = async () => { throw new Error('Unexpected route request') }
  process.env.DASHBOARD_ROUTING_ENABLED = 'false'
  assert.deepEqual(await calculateDashboardRoute(points), unavailable)
  delete process.env.DASHBOARD_ROUTING_ENABLED
  for (const url of ['not a URL', 'http://router.example.test/', 'https://user:password@router.example.test/']) {
    process.env.DASHBOARD_ROUTING_URL = url
    assert.deepEqual(await calculateDashboardRoute(points), unavailable)
  }
}))

test('route cache and concurrent deduplication preserve each caller own booking identifiers', async () => isolated(async () => {
  let calls = 0
  let release: (() => void) | undefined
  const gate = new Promise<void>(resolve => { release = resolve })
  globalThis.fetch = async () => { calls++; await gate; return response(payload()) }
  const first = calculateDashboardRoute(points)
  const newIds = points.map((point, index) => ({ ...point, id: `other-${index}` }))
  const second = calculateDashboardRoute(newIds)
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(calls, 1)
  release!()
  const [a, b] = await Promise.all([first, second])
  assert.equal(a.legs[0].fromId, 'company-private')
  assert.equal(b.legs[0].fromId, 'other-0')
  a.geometry[0][0] = 0
  const cached = await calculateDashboardRoute(newIds)
  assert.equal(cached.geometry[0][0], 18.07, 'caller mutations cannot corrupt the cache')
  assert.equal(calls, 1)
}))

test('NoRoute and NoSegment return no estimated durations and are negatively cached', async () => {
  for (const code of ['NoRoute', 'NoSegment']) await isolated(async () => {
    let calls = 0
    globalThis.fetch = async () => { calls++; return response({ code }) }
    assert.deepEqual(await calculateDashboardRoute(points), unavailable)
    assert.deepEqual(await calculateDashboardRoute(points), unavailable)
    assert.equal(calls, 1)
  })
})

test('non-OK HTTP and network failures back off subsequent requests', async () => {
  for (const failure of ['http', 'network']) await isolated(async () => {
    let calls = 0
    globalThis.fetch = async () => {
      calls++
      if (failure === 'network') throw new TypeError('Network failure')
      return new Response('', { status: 429 })
    }
    assert.deepEqual(await calculateDashboardRoute(points), unavailable)
    assert.deepEqual(await calculateDashboardRoute(points.slice(0, 2)), unavailable)
    assert.equal(calls, 1)
  })
})

test('timeout signal uses an eight second cap and timeout failures never produce travel times', async context => isolated(async () => {
  let timeoutMs = 0
  const controller = new AbortController()
  context.mock.method(AbortSignal, 'timeout', (milliseconds: number) => {
    timeoutMs = milliseconds
    queueMicrotask(() => controller.abort(new DOMException('Timed out', 'TimeoutError')))
    return controller.signal
  })
  globalThis.fetch = async (_input, init) => {
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(init?.signal?.aborted, true)
    throw init?.signal?.reason
  }
  assert.deepEqual(await calculateDashboardRoute(points), unavailable)
  assert.ok(timeoutMs > 0 && timeoutMs <= 8000)
}))

test('malformed provider data, incomplete legs and invalid geometry never produce a route', async () => {
  const invalid: unknown[] = [null, { code: 'Error' }, { code: 'Ok', routes: [], waypoints: [] }]
  const wrongLegs = payload(); wrongLegs.routes[0].legs.pop(); invalid.push(wrongLegs)
  const negative = payload(); negative.routes[0].legs[0].duration = -1; invalid.push(negative)
  const badTotal = payload(); badTotal.routes[0].duration = 1; invalid.push(badTotal)
  const wrongGeometry = payload(); wrongGeometry.routes[0].geometry.type = 'Point'; invalid.push(wrongGeometry)
  const badPoint = payload(); badPoint.routes[0].geometry.coordinates[0] = [181, 59]; invalid.push(badPoint)
  const shortGeometry = payload(); shortGeometry.routes[0].geometry.coordinates = [[18, 59]]; invalid.push(shortGeometry)
  const missingWaypoint = payload(); missingWaypoint.waypoints.pop(); invalid.push(missingWaypoint)
  const farSnap = payload(); farSnap.waypoints[0].distance = 2001; invalid.push(farSnap)
  for (const data of invalid) await isolated(async () => {
    globalThis.fetch = async () => response(data)
    assert.deepEqual(await calculateDashboardRoute(points), unavailable)
  })
})

test('legitimately identical locations retain provider zero-duration legs', async () => isolated(async () => {
  const same = [points[0], { ...points[0], id: 'same-location' }]
  const data = payload(same)
  data.routes[0].duration = 0; data.routes[0].distance = 0
  data.routes[0].legs = [{ duration: 0, distance: 0 }]
  globalThis.fetch = async () => response(data)
  const result = await calculateDashboardRoute(same)
  assert.equal(result.status, 'ready')
  assert.equal(result.legs[0].durationSeconds, 0)
}))

test('distinct route requests are serialized at no more than one per 1.1 seconds', async () => isolated(async () => {
  const startedAt: number[] = []
  let active = 0
  globalThis.fetch = async input => {
    startedAt.push(Date.now())
    assert.equal(active++, 0)
    await new Promise(resolve => setTimeout(resolve, 10))
    active--
    const count = new URL(String(input)).pathname.split(';').length
    return response(payload(points.slice(0, count)))
  }
  const results = await Promise.all([calculateDashboardRoute(points), calculateDashboardRoute(points.slice(0, 2))])
  assert.equal(results.every(result => result.status === 'ready'), true)
  assert.equal(startedAt.length, 2)
  assert.ok(startedAt[1] - startedAt[0] >= 1080, 'provider request starts are spaced at least 1.1 seconds apart')
}))
