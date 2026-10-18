export type DashboardRoutePoint = { id: string; latitude: number; longitude: number }

export type DashboardDrivingRoute = {
  status: 'ready' | 'unavailable' | 'insufficient_points'
  durationSeconds?: number
  distanceMeters?: number
  legs: Array<{ fromId: string; toId: string; durationSeconds: number; distanceMeters: number }>
  // GeoJSON order, also used by Leaflet's GeoJSON layer: longitude, latitude.
  geometry: Array<[number, number]>
}

type RouteValue = {
  durationSeconds: number
  distanceMeters: number
  legs: Array<{ durationSeconds: number; distanceMeters: number }>
  geometry: Array<[number, number]>
}
type RoutingState = {
  cache: Map<string, { value: RouteValue | null; expiresAt: number }>
  pending: Map<string, Promise<RouteValue | null>>
  queue: Promise<unknown>
  lastRequestAt: number
  unavailableUntil: number
}

// The public server permits moderate use, at most one request/second. Keep a
// shared queue/cache and allow switching to a private OSRM server as usage grows.
// https://routing.openstreetmap.de/about.html
const DEFAULT_PROVIDER = 'https://routing.openstreetmap.de/routed-car/route/v1/driving/'
const MAX_POINTS = 25
const MAX_CACHE_SIZE = 500
const MAX_PENDING = 50
const CACHE_TTL = 60 * 60 * 1000
const MISS_TTL = 5 * 60 * 1000
const REQUEST_TIMEOUT = 8000
const REQUEST_BUDGET = 20_000
const globalState = globalThis as typeof globalThis & { hushubDashboardRouting?: RoutingState }

function state(): RoutingState {
  return globalState.hushubDashboardRouting ??= {
    cache: new Map(), pending: new Map(), queue: Promise.resolve(), lastRequestAt: 0, unavailableUntil: 0,
  }
}

function coordinates(latitude: unknown, longitude: unknown): boolean {
  return typeof latitude === 'number' && Number.isFinite(latitude) && Math.abs(latitude) <= 90
    && typeof longitude === 'number' && Number.isFinite(longitude) && Math.abs(longitude) <= 180
}

function nonnegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function providerUrl(): URL | null {
  if (process.env.DASHBOARD_ROUTING_ENABLED === 'false') return null
  try {
    const url = new URL(process.env.DASHBOARD_ROUTING_URL || DEFAULT_PROVIDER)
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]'
    if (url.username || url.password || (url.protocol !== 'https:' && !(local && url.protocol === 'http:'))) return null
    url.hash = ''
    return url
  } catch { return null }
}

function parseRoute(payload: unknown, pointCount: number): RouteValue | null {
  if (!payload || typeof payload !== 'object') throw new Error('INVALID_ROUTE')
  const data = payload as { code?: unknown; routes?: unknown; waypoints?: unknown }
  if (data.code === 'NoRoute' || data.code === 'NoSegment') return null
  if (data.code !== 'Ok' || !Array.isArray(data.routes) || !data.routes.length
    || !Array.isArray(data.waypoints) || data.waypoints.length !== pointCount) throw new Error('INVALID_ROUTE')
  for (const waypoint of data.waypoints) {
    if (!waypoint || typeof waypoint !== 'object') throw new Error('INVALID_ROUTE')
    const candidate = waypoint as { distance?: unknown; location?: unknown }
    if (!nonnegative(candidate.distance) || candidate.distance > 2000 || !Array.isArray(candidate.location)
      || candidate.location.length !== 2 || !coordinates(candidate.location[1], candidate.location[0])) throw new Error('INVALID_ROUTE')
  }
  const route = data.routes[0] as { duration?: unknown; distance?: unknown; legs?: unknown; geometry?: unknown }
  if (!route || !nonnegative(route.duration) || !nonnegative(route.distance)
    || !Array.isArray(route.legs) || route.legs.length !== pointCount - 1) throw new Error('INVALID_ROUTE')
  const legs = route.legs.map((leg: unknown) => {
    if (!leg || typeof leg !== 'object') throw new Error('INVALID_ROUTE')
    const value = leg as { duration?: unknown; distance?: unknown }
    if (!nonnegative(value.duration) || !nonnegative(value.distance)) throw new Error('INVALID_ROUTE')
    return { durationSeconds: value.duration, distanceMeters: value.distance }
  })
  const durationSeconds = legs.reduce((sum, leg) => sum + leg.durationSeconds, 0)
  const distanceMeters = legs.reduce((sum, leg) => sum + leg.distanceMeters, 0)
  if (!Number.isFinite(durationSeconds) || !Number.isFinite(distanceMeters)
    || Math.abs(route.duration - durationSeconds) > Math.max(2, durationSeconds * 0.02)
    || Math.abs(route.distance - distanceMeters) > Math.max(2, distanceMeters * 0.02)) throw new Error('INVALID_ROUTE')
  const geometry = route.geometry as { type?: unknown; coordinates?: unknown } | null
  if (!geometry || geometry.type !== 'LineString' || !Array.isArray(geometry.coordinates)
    || geometry.coordinates.length < 2) throw new Error('INVALID_ROUTE')
  const line = geometry.coordinates.map((point: unknown): [number, number] => {
    if (!Array.isArray(point) || point.length !== 2 || !coordinates(point[1], point[0])) throw new Error('INVALID_ROUTE')
    return [point[0], point[1]]
  })
  return { durationSeconds, distanceMeters, legs, geometry: line }
}

function empty(status: 'unavailable' | 'insufficient_points'): DashboardDrivingRoute {
  return { status, legs: [], geometry: [] }
}

async function requestRoute(provider: URL, points: DashboardRoutePoint[], deadline: number): Promise<RouteValue | null> {
  const shared = state()
  const coordinateList = points.map(point => `${point.longitude},${point.latitude}`).join(';')
  provider.pathname = `${provider.pathname.replace(/\/$/, '')}/${coordinateList}`
  provider.searchParams.set('steps', 'false')
  provider.searchParams.set('geometries', 'geojson')
  provider.searchParams.set('overview', 'simplified')
  provider.searchParams.set('alternatives', 'false')
  provider.searchParams.set('radiuses', points.map(() => '2000').join(';'))
  const key = provider.href
  const cached = shared.cache.get(key)
  if (cached && cached.expiresAt > Date.now()) return cached.value
  if (cached) shared.cache.delete(key)
  const pending = shared.pending.get(key)
  if (pending) return pending
  if (shared.pending.size >= MAX_PENDING || Date.now() < shared.unavailableUntil) throw new Error('ROUTING_UNAVAILABLE')

  const request = shared.queue.catch(() => undefined).then(async () => {
    if (Date.now() >= deadline || Date.now() < shared.unavailableUntil) throw new Error('ROUTING_UNAVAILABLE')
    const waitMs = Math.max(0, 1100 - (Date.now() - shared.lastRequestAt))
    if (waitMs >= deadline - Date.now()) throw new Error('ROUTING_UNAVAILABLE')
    if (waitMs > 0) await new Promise<void>(resolve => setTimeout(resolve, waitMs))
    if (Date.now() >= deadline || Date.now() < shared.unavailableUntil) throw new Error('ROUTING_UNAVAILABLE')
    shared.lastRequestAt = Date.now()
    try {
      const response = await fetch(provider, {
        headers: { 'User-Agent': 'HushubDashboard/1.0 (+https://hushub.se)', Accept: 'application/json' },
        // Only coordinates and routing controls leave the application.
        signal: AbortSignal.timeout(Math.max(1, Math.min(REQUEST_TIMEOUT, deadline - Date.now()))),
        cache: 'no-store',
      })
      if (!response.ok) throw new Error('ROUTING_UNAVAILABLE')
      const value = parseRoute(await response.json(), points.length)
      shared.cache.set(key, { value, expiresAt: Date.now() + (value ? CACHE_TTL : MISS_TTL) })
      while (shared.cache.size > MAX_CACHE_SIZE) {
        const oldest = shared.cache.keys().next().value
        if (oldest === undefined) break
        shared.cache.delete(oldest)
      }
      return value
    } catch {
      shared.unavailableUntil = Date.now() + 60_000
      throw new Error('ROUTING_UNAVAILABLE')
    }
  })
  shared.queue = request
  shared.pending.set(key, request)
  try { return await request } finally { shared.pending.delete(key) }
}

export async function calculateDashboardRoute(points: DashboardRoutePoint[]): Promise<DashboardDrivingRoute> {
  if (points.length < 2) return empty('insufficient_points')
  if (points.length > MAX_POINTS || points.some(point => !coordinates(point.latitude, point.longitude))) return empty('unavailable')
  const provider = providerUrl()
  if (!provider) return empty('unavailable')
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    // Queued requests also have a finite caller budget. An expired queued request
    // is skipped before reaching the provider, rather than continuing in secret.
    const value = await Promise.race([
      requestRoute(provider, points, Date.now() + REQUEST_BUDGET),
      new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), REQUEST_BUDGET) }),
    ])
    if (!value) return empty('unavailable')
    return {
      status: 'ready', durationSeconds: value.durationSeconds, distanceMeters: value.distanceMeters,
      legs: value.legs.map((leg, index) => ({ fromId: points[index].id, toId: points[index + 1].id, ...leg })),
      geometry: value.geometry.map(point => [point[0], point[1]]),
    }
  } catch { return empty('unavailable') } finally { if (timer) clearTimeout(timer) }
}
