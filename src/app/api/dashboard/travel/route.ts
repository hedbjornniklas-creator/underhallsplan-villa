import { NextResponse } from 'next/server'
import { getDashboardData, getStockholmDate } from '@/lib/dashboard/server'
import { bookingLocation, compareBookings, directionsLinks, isTentativeBooking } from '@/lib/dashboard/calendar'
import { isDashboardCoordinate, locateDashboardBookings } from '@/lib/dashboard/geocoding'
import { calculateDashboardRoute } from '@/lib/dashboard/routing'
import { readOrganizationBranding } from '@/lib/organizations/companyProfile'
import type { DashboardBooking } from '@/lib/dashboard/model'
import type { DashboardTravelResponse } from '@/lib/dashboard/travel'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60
const headers = { 'Cache-Control': 'private, no-store, max-age=0' }

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams
  const date = params.get('date')
  const includesTentative = params.get('includeTentative') === '1'
  if ([...params.keys()].some(key => !['date', 'orgId', 'bookingId', 'includeTentative'].includes(key))
    || ['date', 'orgId', 'includeTentative'].some(key => params.getAll(key).length > 1)
    || (params.has('includeTentative') && !['0', '1'].includes(params.get('includeTentative')!))
    || params.getAll('bookingId').length > 100
    || !date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || getStockholmDate(date) !== date) {
    return NextResponse.json({ error: 'Välj ett giltigt datum och uppdrag för restiden.' }, { status: 400, headers })
  }
  try {
    const dashboard = await getDashboardData(params.get('orgId') ?? undefined)
    if (!dashboard.organizationId) throw new Error('ORG_MEMBERSHIP_REQUIRED')
    const selectedIds = new Set(params.getAll('bookingId'))
    // A caller can narrow authorized bookings, never supply an arbitrary origin,
    // address or coordinate. The company belongs to this validated organization.
    const bookings = dashboard.bookings.filter(booking => getStockholmDate(booking.startsAt) === date
      && (includesTentative || !isTentativeBooking(booking))
      && (selectedIds.size === 0 || selectedIds.has(booking.id))).sort(compareBookings)
    const response: DashboardTravelResponse = {
      organizationId: dashboard.organizationId, date, bookingIds: bookings.map(booking => booking.id), includesTentative,
      origin: { label: 'Företaget', status: 'address_missing' },
      route: { status: 'insufficient_points', legs: [], geometry: [] }, directionsLinks: [],
    }
    if (!bookings.length) return NextResponse.json(response, { headers })
    const company = await readOrganizationBranding(dashboard.organizationId)
    const street = company?.address?.trim()
    const address = street ? [street, [company?.postalCode?.trim(), company?.city?.trim()].filter(Boolean).join(' ')].filter(Boolean).join(', ') : undefined
    response.origin.address = address
    if (!address) {
      response.route.status = 'origin_missing'
      return NextResponse.json(response, { headers })
    }
    if (bookings.every(booking => bookingLocation(booking))) {
      response.directionsLinks = directionsLinks(bookings, { includeTentative: includesTentative, origin: address })
    }
    const originBooking: DashboardBooking = { id: 'company-origin', moduleId: bookings[0].moduleId,
      title: 'Företaget', href: '/settings/organisation', startsAt: date, address }
    const locations = await locateDashboardBookings([originBooking, ...bookings])
    response.approximate = locations.some(location => location.approximate === true)
    const byId = new Map(locations.map(location => [location.id, location]))
    const origin = byId.get('company-origin')
    response.origin = { ...response.origin, status: origin?.status ?? 'unavailable', latitude: origin?.latitude, longitude: origin?.longitude }
    if (origin?.status !== 'located' || !isDashboardCoordinate(origin.latitude, origin.longitude)) {
      response.route.status = 'origin_missing'
      return NextResponse.json(response, { headers })
    }
    if (bookings.some(booking => {
      const location = byId.get(booking.id)
      return location?.status !== 'located' || !isDashboardCoordinate(location.latitude, location.longitude)
    })) {
      response.route.status = 'locations_missing'
      return NextResponse.json(response, { headers })
    }
    response.route = await calculateDashboardRoute([originBooking, ...bookings].map(booking => {
      const location = byId.get(booking.id)!
      return { id: booking.id, latitude: location.latitude!, longitude: location.longitude! }
    }))
    return NextResponse.json(response, { headers })
  } catch (error) {
    const code = error instanceof Error ? error.message : ''
    const status = code === 'UNAUTHORIZED' ? 401
      : ['ORG_SELECTION_INVALID', 'DASHBOARD_ORGANIZATION_UNSUPPORTED'].includes(code) ? 400
        : ['ORG_MEMBERSHIP_REQUIRED', 'MODULE_ACCESS_REQUIRED'].includes(code) ? 403 : 500
    return NextResponse.json({ error: status === 500 ? 'Restiden kunde inte beräknas just nu.' : 'Du saknar åtkomst till de här uppdragen.' }, { status, headers })
  }
}
