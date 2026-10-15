import assert from 'node:assert/strict'
import test from 'node:test'
// @ts-expect-error Node strip-types requires explicit TypeScript extensions.
import { bookingCountLabel, bookingDate, bookingStatusLabel, bookingTimeLabel, calendarWeek, compareBookings, directionsLinks, isCalendarDate, isTentativeBooking, shiftCalendarDate } from '../src/lib/dashboard/calendar.ts'
import type { DashboardBooking } from '../src/lib/dashboard/model'

function booking(id: string, startsAt: string, address = id): DashboardBooking {
  return { id, startsAt, address, moduleId: 'ob', title: id, href: `/ob/${id}` }
}

test('calendar weeks include weekends and cross month/year and daylight saving boundaries', () => {
  assert.deepEqual(calendarWeek('2026-01-01'), ['2025-12-29', '2025-12-30', '2025-12-31', '2026-01-01', '2026-01-02', '2026-01-03', '2026-01-04'])
  assert.equal(shiftCalendarDate('2026-03-29', 1), '2026-03-30')
  assert.equal(shiftCalendarDate('2026-10-25', -1), '2026-10-24')
  assert.equal(isCalendarDate('2026-02-30'), false)
  assert.equal(isCalendarDate('2024-02-29'), true)
})

test('appointments are grouped and displayed by Swedish local time even across UTC midnight', () => {
  assert.equal(bookingDate('2026-10-11T22:30:00Z'), '2026-10-12')
  assert.equal(bookingTimeLabel(booking('visit', '2026-10-11T22:30:00Z')), '00:30')
  assert.equal(bookingTimeLabel(booking('unknown', '2026-10-12')), 'Tid ej angiven')
  const bookings = [booking('unknown', '2026-10-12'), booking('later', '2026-10-12T13:00:00+02:00'), booking('earlier', '2026-10-12T09:00:00+02:00')]
  assert.deepEqual(bookings.sort(compareBookings).map(item => item.id), ['earlier', 'later', 'unknown'])
})

test('directions preserve every stop and chronological order within the mobile waypoint limit', () => {
  const bookings = Array.from({ length: 11 }, (_, index) => booking(`visit-${index}`, '2026-10-12', `Gatan ${index + 1}, Stockholm`))
  const links = directionsLinks(bookings)
  assert.equal(links.length, 3)
  const destinations: string[] = []
  for (const link of links) {
    const params = new URL(link).searchParams
    const waypoints = params.get('waypoints')?.split('|') ?? []
    assert.ok(waypoints.length <= 3)
    assert.equal(params.get('api'), '1')
    assert.equal(params.get('travelmode'), 'driving')
    destinations.push(...waypoints, params.get('destination')!)
  }
  assert.deepEqual(destinations, bookings.map(item => item.address))
  assert.equal(new URL(links[1]).searchParams.get('origin'), bookings[3].address)
})

test('encoded long Swedish addresses split into smaller legs instead of dropping stops', () => {
  const bookings = Array.from({ length: 4 }, (_, index) => booking(`${index}`, '2026-10-12', `${'Äng'.repeat(80)}vägen ${index + 1}, Södertälje`))
  const links = directionsLinks(bookings)
  assert.ok(links.length > 1)
  const destinations = links.flatMap(link => {
    assert.ok(link.length <= 2048)
    const params = new URL(link).searchParams
    return [...(params.get('waypoints')?.split('|') ?? []), params.get('destination')!]
  })
  assert.deepEqual(destinations, bookings.map(item => item.address))
})

test('a missing address creates no invented map location or destination', () => {
  assert.deepEqual(directionsLinks([{ ...booking('missing', '2026-10-12'), address: undefined }]), [])
  const result = directionsLinks([{ ...booking('coordinates', '2026-10-12'), address: undefined, latitude: 59.3, longitude: 18.1 }])
  assert.equal(new URL(result[0]).searchParams.get('destination'), '59.3,18.1')
})

test('tentative slots have explicit labels while legacy bookings remain confirmed', () => {
  const confirmed = booking('confirmed', '2026-10-12')
  const tentative: DashboardBooking = { ...booking('sent', '2026-10-12'), status: 'tentative', confirmationStatus: 'Inväntar kund' }
  assert.equal(isTentativeBooking(confirmed), false)
  assert.equal(bookingStatusLabel(confirmed), 'Bekräftat')
  assert.equal(bookingStatusLabel(tentative), 'Preliminärt · Inväntar kund')
  assert.equal(bookingCountLabel([confirmed, tentative]), '1 bekräftat · 1 preliminärt')
  assert.equal(bookingCountLabel([tentative, tentative]), '0 bekräftade · 2 preliminära')
})

test('tentative addresses and coordinates never enter driving directions', () => {
  const first = booking('first', '2026-10-12', 'Första gatan 1')
  const tentative: DashboardBooking = { ...booking('tentative', '2026-10-12', 'Preliminära gatan 2'), status: 'tentative', latitude: 59.4, longitude: 18.2 }
  const last = booking('last', '2026-10-12', 'Sista gatan 3')
  assert.deepEqual(directionsLinks([first, tentative, last]), directionsLinks([first, last]))
  assert.deepEqual(directionsLinks([tentative]), [])
})
