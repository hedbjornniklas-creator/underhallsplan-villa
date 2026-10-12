import assert from 'node:assert/strict'
import test from 'node:test'
// @ts-expect-error Node strip-types requires an explicit TypeScript extension.
import { isDashboardCoordinate, locateDashboardBookings, parsePhotonAddressLocation } from '../src/lib/dashboard/geocoding.ts'
import type { DashboardBooking } from '../src/lib/dashboard/model'

const point = (properties: Record<string, unknown> = {}, coordinates: unknown[] = [18.07, 59.33]) => ({
  type: 'Feature', geometry: { type: 'Point', coordinates },
  properties: { countrycode: 'SE', street: 'Testgatan', housenumber: '12', postcode: '12345', city: 'Teststad', ...properties },
})
const booking = (id: string, fields: Partial<DashboardBooking> = {}): DashboardBooking => ({
  id, moduleId: 'ob', title: 'Privat kundnamn ska inte skickas', href: '/ob', startsAt: '2026-10-12', ...fields,
})

test('validates finite geographic coordinates including zero', () => {
  assert.equal(isDashboardCoordinate(0, 0), true)
  assert.equal(isDashboardCoordinate(59.33, 18.07), true)
  assert.equal(isDashboardCoordinate(NaN, 18), false)
  assert.equal(isDashboardCoordinate(91, 18), false)
  assert.equal(isDashboardCoordinate(59, Infinity), false)
  assert.equal(isDashboardCoordinate('59', 18), false)
})

test('Photon parsing preserves longitude/latitude order and prefers matching house', () => {
  assert.deepEqual(parsePhotonAddressLocation({ features: [point({ housenumber: '10' }), point({}, [18.08, 59.34])] }, 'Testgatan 12, 123 45 Teststad'), {
    latitude: 59.34, longitude: 18.08,
  })
})

test('city-only, foreign, unmatched street/postcode and invalid coordinates never become property markers', () => {
  const address = 'Testgatan 12, 12345 Teststad'
  const rejected = [
    { type: 'Feature', geometry: { type: 'Point', coordinates: [18.07, 59.33] }, properties: { countrycode: 'SE', name: 'Teststad', osm_key: 'place', osm_value: 'city' } },
    point({ countrycode: 'DE' }), point({ street: 'Annan gata' }), point({ postcode: '54321' }), point({}, [181, 59.33]),
  ]
  for (const feature of rejected) assert.equal(parsePhotonAddressLocation({ features: [feature] }, address), null)
  assert.equal(parsePhotonAddressLocation(null, address), null)
})

test('a street fallback is explicitly approximate', () => {
  assert.deepEqual(parsePhotonAddressLocation({ features: [point({ housenumber: undefined, osm_key: 'highway' })] }, 'Testgatan 12, 12345 Teststad'), {
    latitude: 59.33, longitude: 18.07, approximate: true,
  })
  assert.deepEqual(parsePhotonAddressLocation({ features: [point({ street: undefined, name: 'Testgatan', housenumber: undefined, osm_key: 'highway' })] }, 'Testgatan 12, 12345 Teststad'), {
    latitude: 59.33, longitude: 18.07, approximate: true,
  })
})

test('matching street and house in a different city is rejected when the address has no postcode', () => {
  const wrongCity = point({ city: 'Annan stad' })
  const matchingCity = point({ city: 'Teststad' }, [18.08, 59.34])
  assert.equal(parsePhotonAddressLocation({ features: [wrongCity] }, 'Testgatan 12, Teststad'), null)
  assert.deepEqual(parsePhotonAddressLocation({ features: [wrongCity, matchingCity] }, 'Testgatan 12, Teststad'), {
    latitude: 59.34, longitude: 18.08,
  })
  assert.equal(parsePhotonAddressLocation({ features: [point({ city: 'Annan stad', housenumber: undefined })] }, 'Testgatan 12, Teststad'), null)
  assert.equal(parsePhotonAddressLocation({ features: [point({ city: undefined })] }, 'Testgatan 12, Teststad'), null)
})

test('postcode and country suffixes keep the requested locality constraint', () => {
  for (const address of [
    'Testgatan 12, 123 45 Teststad', 'Testgatan 12, 12345, Teststad',
    'Testgatan 12, Teststad, Sverige', 'Testgatan 12, SE-12345 Teststad, Sweden',
    'Testgatan 12, Teststad 12345, SE', 'Testgatan 12, Teststad Sverige',
  ]) {
    assert.deepEqual(parsePhotonAddressLocation({ features: [point()] }, address), { latitude: 59.33, longitude: 18.07 }, address)
    assert.equal(parsePhotonAddressLocation({ features: [point({ city: 'Annan stad' })] }, address), null, address)
  }
})

test('city, town, village, locality and district names can identify a requested place', () => {
  for (const key of ['city', 'town', 'village', 'locality', 'district']) {
    assert.deepEqual(parsePhotonAddressLocation({ features: [point({ city: 'Stockholm', [key]: 'Årsta' })] }, 'Testgatan 12, Årsta'), {
      latitude: 59.33, longitude: 18.07,
    }, key)
  }
  assert.deepEqual(parsePhotonAddressLocation({ features: [point({ city: 'GÖTEBORG' })] }, 'Testgatan 12, Göteborg'), {
    latitude: 59.33, longitude: 18.07,
  })
  assert.equal(parsePhotonAddressLocation({ features: [point({ city: 'Stockholm', district: 'Årsta' })] }, 'Testgatan 12, Solna'), null)
})

test('known coordinates and absent addresses do not call an external geocoder', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => { throw new Error('Unexpected geocoder request') }
  try {
    assert.deepEqual(await locateDashboardBookings([
      booking('located', { latitude: 59.33, longitude: 18.07 }), booking('missing'),
    ]), [
      { id: 'located', status: 'located', latitude: 59.33, longitude: 18.07 }, { id: 'missing', status: 'address_missing' },
    ])
  } finally { globalThis.fetch = originalFetch }
})

test('provider opt-out degrades to unavailable without leaking an address', async () => {
  const originalEnabled = process.env.DASHBOARD_GEOCODING_ENABLED
  const originalFetch = globalThis.fetch
  process.env.DASHBOARD_GEOCODING_ENABLED = 'false'
  globalThis.fetch = async () => { throw new Error('Unexpected geocoder request') }
  try {
    assert.deepEqual(await locateDashboardBookings([booking('disabled', { address: 'Testgatan 12' })]), [{ id: 'disabled', status: 'unavailable' }])
  } finally {
    globalThis.fetch = originalFetch
    if (originalEnabled === undefined) delete process.env.DASHBOARD_GEOCODING_ENABLED
    else process.env.DASHBOARD_GEOCODING_ENABLED = originalEnabled
  }
})

test('cache avoids repeated requests; provider receives only address and search controls', async () => {
  const originalFetch = globalThis.fetch
  const originalProvider = process.env.DASHBOARD_GEOCODING_URL
  process.env.DASHBOARD_GEOCODING_URL = 'https://geocoder.example.test/api/'
  const urls: URL[] = []
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input))
    urls.push(url)
    assert.match(String((init?.headers as Record<string, string>)['User-Agent']), /HushubDashboard/)
    return new Response(JSON.stringify({ features: [point()] }), { headers: { 'content-type': 'application/json' } })
  }
  try {
    const rows = await locateDashboardBookings([
      booking('one', { address: 'Testgatan 12, 12345 Teststad' }), booking('two', { address: 'Testgatan 12, 12345 Teststad' }),
    ])
    assert.equal(rows.length, 2)
    assert.equal(rows.every(row => row.status === 'located'), true)
    assert.equal(urls.length, 1)
    assert.equal(urls[0].searchParams.get('q'), 'Testgatan 12, 12345 Teststad')
    assert.equal(urls[0].searchParams.get('countrycode'), 'SE')
    assert.deepEqual(urls[0].searchParams.getAll('layer'), ['house', 'street'])
    assert.equal(urls[0].href.includes('Privat'), false)
    assert.equal(urls[0].href.includes('one'), false)
  } finally {
    globalThis.fetch = originalFetch
    if (originalProvider === undefined) delete process.env.DASHBOARD_GEOCODING_URL
    else process.env.DASHBOARD_GEOCODING_URL = originalProvider
  }
})
