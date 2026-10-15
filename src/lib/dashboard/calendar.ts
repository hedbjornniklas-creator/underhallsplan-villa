import type { DashboardBooking } from './model'

const STOCKHOLM = 'Europe/Stockholm'

export function isTentativeBooking(booking: DashboardBooking) {
  return booking.status === 'tentative'
}

export function bookingStatusLabel(booking: DashboardBooking) {
  return isTentativeBooking(booking)
    ? `Preliminärt${booking.confirmationStatus ? ` · ${booking.confirmationStatus}` : ''}`
    : 'Bekräftat'
}

export function bookingCountLabel(bookings: DashboardBooking[]) {
  const tentative = bookings.filter(isTentativeBooking).length
  const confirmed = bookings.length - tentative
  const parts = [`${confirmed} ${confirmed === 1 ? 'bekräftat' : 'bekräftade'}`]
  if (tentative) parts.push(`${tentative} ${tentative === 1 ? 'preliminärt' : 'preliminära'}`)
  return parts.join(' · ')
}

export function isCalendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T12:00:00Z`)
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value
}

export function bookingDate(value: string): string {
  if (isCalendarDate(value)) return value
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return ''
  return new Intl.DateTimeFormat('sv-SE', { timeZone: STOCKHOLM, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
}

export function shiftCalendarDate(value: string, days: number) {
  if (!isCalendarDate(value)) return value
  const date = new Date(`${value}T12:00:00Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

export function calendarWeek(value: string) {
  const date = new Date(`${value}T12:00:00Z`)
  const day = date.getUTCDay()
  const monday = shiftCalendarDate(value, -(day === 0 ? 6 : day - 1))
  return Array.from({ length: 7 }, (_, index) => shiftCalendarDate(monday, index))
}

export function calendarDateLabel(value: string, options: Intl.DateTimeFormatOptions = {}) {
  if (!isCalendarDate(value)) return 'Datum saknas'
  return new Date(`${value}T12:00:00Z`).toLocaleDateString('sv-SE', { timeZone: STOCKHOLM, ...options })
}

export function bookingTime(value: string | undefined) {
  if (!value || isCalendarDate(value)) return null
  const date = new Date(value)
  return Number.isFinite(date.getTime())
    ? date.toLocaleTimeString('sv-SE', { timeZone: STOCKHOLM, hour: '2-digit', minute: '2-digit' })
    : null
}

export function bookingTimeLabel(booking: DashboardBooking) {
  const start = bookingTime(booking.startsAt)
  const end = bookingTime(booking.endsAt)
  return start ? `${start}${end ? `–${end}` : ''}` : 'Tid ej angiven'
}

export function compareBookings(left: DashboardBooking, right: DashboardBooking) {
  const dateComparison = bookingDate(left.startsAt).localeCompare(bookingDate(right.startsAt))
  if (dateComparison) return dateComparison
  const timeComparison = (bookingTime(left.startsAt) ?? '99:99').localeCompare(bookingTime(right.startsAt) ?? '99:99')
  return timeComparison || left.id.localeCompare(right.id)
}

export function bookingLocation(booking: DashboardBooking) {
  if (booking.address?.trim()) return booking.address.trim()
  if (Number.isFinite(booking.latitude) && Number.isFinite(booking.longitude)
    && Math.abs(booking.latitude!) <= 90 && Math.abs(booking.longitude!) <= 180) {
    return `${booking.latitude},${booking.longitude}`
  }
  return null
}

export function bookingMapUrl(booking: DashboardBooking) {
  const location = bookingLocation(booking)
  if (!location) return null
  const params = new URLSearchParams({ api: '1', query: location })
  return `https://www.google.com/maps/search/?${params}`
}

// Google Maps supports three waypoints in mobile browsers. Larger days are
// split into consecutive legs so no appointment is silently left out.
export function directionsLinks(bookings: DashboardBooking[]) {
  const locations = bookings.filter(booking => !isTentativeBooking(booking)).map(bookingLocation).filter((location): location is string => Boolean(location))
  const links: string[] = []
  for (let index = 0; index < locations.length;) {
    let count = Math.min(4, locations.length - index)
    const build = (includeOrigin: boolean) => {
      const stops = locations.slice(index, index + count)
      const params = new URLSearchParams({ api: '1', travelmode: 'driving', destination: stops[stops.length - 1] })
      if (includeOrigin && index > 0) params.set('origin', locations[index - 1])
      if (stops.length > 1) params.set('waypoints', stops.slice(0, -1).join('|'))
      return `https://www.google.com/maps/dir/?${params}`
    }
    let href = build(true)
    while (href.length > 2048 && count > 1) { count -= 1; href = build(true) }
    // If two individually valid long addresses cannot share a URL, start this
    // leg from the device location. Keep the actual destination intact.
    if (href.length > 2048) href = build(false)
    links.push(href)
    index += count
  }
  return links
}
