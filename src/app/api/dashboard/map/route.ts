import { NextResponse } from 'next/server'
import { getDashboardData, getStockholmDate } from '@/lib/dashboard/server'
import { locateDashboardBookings } from '@/lib/dashboard/geocoding'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const privateHeaders = { 'Cache-Control': 'private, no-store, max-age=0' }

export async function GET(request: Request) {
  const url = new URL(request.url)
  const params = url.searchParams
  if ([...params.keys()].some(key => !['date', 'orgId', 'bookingId'].includes(key))
    || params.getAll('orgId').length > 1 || params.getAll('date').length > 1) {
    return NextResponse.json({ error: 'Välj ett giltigt datum och en organisation för kartan.' }, { status: 400, headers: privateHeaders })
  }
  const date = url.searchParams.get('date')
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || getStockholmDate(date) !== date) {
    return NextResponse.json({ error: 'Välj ett giltigt datum för kartan.' }, { status: 400, headers: privateHeaders })
  }
  try {
    // Never accept arbitrary addresses from the browser. Reload permission-scoped
    // data before geocoding the selected day's confirmed and tentative assignments.
    const dashboard = await getDashboardData(url.searchParams.get('orgId') ?? undefined)
    const selectedIds = new Set(url.searchParams.getAll('bookingId'))
    const bookings = dashboard.bookings.filter(booking => getStockholmDate(booking.startsAt) === date
      && (selectedIds.size === 0 || selectedIds.has(booking.id)))
    return NextResponse.json({
      organizationId: dashboard.organizationId,
      date,
      locations: await locateDashboardBookings(bookings),
    }, { headers: privateHeaders })
  } catch (error) {
    const code = error instanceof Error ? error.message : ''
    const status = code === 'UNAUTHORIZED' ? 401
      : ['ORG_SELECTION_INVALID', 'DASHBOARD_ORGANIZATION_UNSUPPORTED'].includes(code) ? 400
        : ['ORG_MEMBERSHIP_REQUIRED', 'MODULE_ACCESS_REQUIRED'].includes(code) ? 403 : 500
    const message = code === 'DASHBOARD_ORGANIZATION_UNSUPPORTED'
      ? 'Startsidan visar din standardorganisation. Öppna respektive arbetsområde för att byta organisation.'
      : status === 500 ? 'Kartan kunde inte laddas just nu.' : 'Du saknar åtkomst till de här uppdragen.'
    return NextResponse.json({ error: message }, {
      status,
      headers: privateHeaders,
    })
  }
}
