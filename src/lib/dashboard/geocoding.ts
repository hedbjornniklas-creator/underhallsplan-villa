import type { DashboardBooking } from './model'

export type DashboardMapLocation = {
  id: string
  status: 'located' | 'address_missing' | 'not_found' | 'unavailable'
  latitude?: number
  longitude?: number
  approximate?: boolean
}

type Coordinates = { latitude: number; longitude: number; approximate?: boolean }
type CachedLocation = { value: Coordinates | null; expiresAt: number }
type GeocoderState = {
  cache: Map<string, CachedLocation>
  pending: Map<string, Promise<Coordinates | null>>
  queue: Promise<unknown>
  lastRequestAt: number
  unavailableUntil: number
}

// The demo allows moderate project usage. Keep requests serialized, cache results,
// and make the provider replaceable with a private Photon instance as usage grows.
// https://github.com/komoot/photon#demo-server
const DEFAULT_PROVIDER = 'https://photon.komoot.io/api/'
const CACHE_TTL = 30 * 24 * 60 * 60 * 1000
const MISS_TTL = 6 * 60 * 60 * 1000
const MAX_CACHE_SIZE = 2000
const globalState = globalThis as typeof globalThis & { hushubDashboardGeocoder?: GeocoderState }

function state(): GeocoderState {
  return globalState.hushubDashboardGeocoder ??= {
    cache: new Map(),
    pending: new Map(),
    queue: Promise.resolve(),
    lastRequestAt: 0,
    unavailableUntil: 0,
  }
}

export function isDashboardCoordinate(latitude: unknown, longitude: unknown): boolean {
  return typeof latitude === 'number' && Number.isFinite(latitude) && Math.abs(latitude) <= 90
    && typeof longitude === 'number' && Number.isFinite(longitude) && Math.abs(longitude) <= 180
}

function normalized(value: unknown): string {
  return typeof value === 'string'
    ? value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
    : ''
}

function requestedLocality(address: string): string | null {
  const parts = normalized(address).split(',').map(part => part.trim()).filter(Boolean)
  // Dashboard data joins street and city with a comma. A lone free-text address
  // cannot be split reliably into a street and locality, so do not guess.
  while (parts.length > 1) {
    const finalPart = parts[parts.length - 1]
      .replace(/(?:^|\s+)(?:sverige|sweden|se)$/, '')
      .replace(/^(?:se[-\s]*)?\d{3}\s?\d{2}(?:\s+|$)/, '')
      .replace(/\s+(?:se[-\s]*)?\d{3}\s?\d{2}$/, '')
      .trim()
    if (!finalPart) {
      parts.pop()
      continue
    }
    return /^[\p{L}\s.:'’\-]+$/u.test(finalPart) ? finalPart : null
  }
  return null
}

// Do not accept a city/country fallback as the position of a booked property.
export function parsePhotonAddressLocation(payload: unknown, address: string): Coordinates | null {
  if (!payload || typeof payload !== 'object') return null
  const features = (payload as { features?: unknown }).features
  if (!Array.isArray(features)) return null
  const addressKey = normalized(address)
  const postcode = addressKey.match(/\b(\d{3})\s?(\d{2})\b/)
  const requestedHouse = addressKey.match(/\b\d+[a-z]?(?:\s?[-/]\s?\d+[a-z]?)?\b/)?.[0]
  const locality = requestedLocality(address)
  let streetFallback: Coordinates | null = null
  for (const feature of features) {
    if (!feature || typeof feature !== 'object') continue
    const { geometry, properties } = feature as {
      geometry?: { type?: unknown; coordinates?: unknown }
      properties?: Record<string, unknown>
    }
    if (geometry?.type !== 'Point' || !Array.isArray(geometry.coordinates) || !properties) continue
    const [longitude, latitude] = geometry.coordinates
    if (!isDashboardCoordinate(latitude, longitude)) continue
    const coordinates = { latitude: latitude as number, longitude: longitude as number }
    if (properties.countrycode && normalized(properties.countrycode) !== 'se') continue
    if (locality && !['city', 'town', 'village', 'locality', 'district']
      .some(key => normalized(properties[key]) === locality)) continue
    const street = normalized(properties.street)
    const candidateName = normalized(properties.name)
    const streetName = street || (properties.osm_key === 'highway' ? candidateName : '')
    if (!streetName || !addressKey.includes(streetName)) continue
    if (postcode && normalized(properties.postcode).replace(/\s/g, '') !== `${postcode[1]}${postcode[2]}`) continue
    const house = normalized(properties.housenumber).replace(/\s/g, '')
    const exactHouse = requestedHouse && house === requestedHouse.replace(/\s/g, '')
    if (exactHouse) return coordinates
    // A street match is useful but is explicitly labeled approximate in the map.
    streetFallback ??= { ...coordinates, approximate: true }
  }
  return streetFallback
}

function providerUrl(): URL | null {
  if (process.env.DASHBOARD_GEOCODING_ENABLED === 'false') return null
  try {
    const url = new URL(process.env.DASHBOARD_GEOCODING_URL || DEFAULT_PROVIDER)
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
    return url.protocol === 'https:' || (local && url.protocol === 'http:') ? url : null
  } catch {
    return null
  }
}

async function geocodeAddress(address: string, deadline: number): Promise<Coordinates | null> {
  const provider = providerUrl()
  if (!provider) throw new Error('DASHBOARD_GEOCODER_UNAVAILABLE')
  const shared = state()
  const key = `locality-v2:${provider.origin}${provider.pathname}:${normalized(address)}`
  const cached = shared.cache.get(key)
  if (cached && cached.expiresAt > Date.now()) return cached.value
  const existing = shared.pending.get(key)
  if (existing) return existing

  const request = shared.queue.catch(() => undefined).then(async () => {
    if (Date.now() >= deadline || Date.now() < shared.unavailableUntil) {
      throw new Error('DASHBOARD_GEOCODER_UNAVAILABLE')
    }
    const waitMs = Math.max(0, 1100 - (Date.now() - shared.lastRequestAt))
    if (waitMs > 0) await new Promise<void>(resolve => setTimeout(resolve, waitMs))
    if (Date.now() >= deadline) throw new Error('DASHBOARD_GEOCODER_UNAVAILABLE')
    shared.lastRequestAt = Date.now()
    provider.searchParams.set('q', address)
    provider.searchParams.set('limit', '5')
    provider.searchParams.set('countrycode', 'SE')
    provider.searchParams.append('layer', 'house')
    provider.searchParams.append('layer', 'street')
    try {
      const response = await fetch(provider, {
        headers: {
          'User-Agent': 'HushubDashboard/1.0 (+https://hushub.se)',
          Accept: 'application/json',
        },
        // Only a property address is sent. No booking/customer/user identifiers.
        signal: AbortSignal.timeout(Math.max(1, Math.min(6500, deadline - Date.now()))),
        cache: 'no-store',
      })
      if (!response.ok) throw new Error('DASHBOARD_GEOCODER_UNAVAILABLE')
      const value = parsePhotonAddressLocation(await response.json(), address)
      shared.cache.set(key, { value, expiresAt: Date.now() + (value ? CACHE_TTL : MISS_TTL) })
      while (shared.cache.size > MAX_CACHE_SIZE) {
        const oldest = shared.cache.keys().next().value
        if (oldest === undefined) break
        shared.cache.delete(oldest)
      }
      return value
    } catch {
      // Back off provider failures across requests; never persist incorrect coords.
      shared.unavailableUntil = Date.now() + 60_000
      throw new Error('DASHBOARD_GEOCODER_UNAVAILABLE')
    }
  })
  shared.queue = request
  shared.pending.set(key, request)
  try {
    return await request
  } finally {
    shared.pending.delete(key)
  }
}

export async function locateDashboardBookings(bookings: DashboardBooking[]): Promise<DashboardMapLocation[]> {
  // Avoid holding the request indefinitely when the provider is slow/unavailable.
  const deadline = Date.now() + 18_000
  const locations: DashboardMapLocation[] = []
  for (const booking of bookings) {
    if (isDashboardCoordinate(booking.latitude, booking.longitude)) {
      locations.push({ id: booking.id, status: 'located', latitude: booking.latitude, longitude: booking.longitude })
      continue
    }
    const address = booking.address?.replace(/\s+/g, ' ').trim()
    if (!address) {
      locations.push({ id: booking.id, status: 'address_missing' })
      continue
    }
    if (address.length > 350) {
      locations.push({ id: booking.id, status: 'not_found' })
      continue
    }
    try {
      const point = await geocodeAddress(address, deadline)
      locations.push(point ? { id: booking.id, status: 'located', ...point } : { id: booking.id, status: 'not_found' })
    } catch {
      locations.push({ id: booking.id, status: 'unavailable' })
    }
  }
  return locations
}
