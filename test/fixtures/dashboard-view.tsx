import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import DashboardV1Client, { DashboardContent } from '../../src/app/(dashboard)/dashboard-v1/DashboardV1Client'
import { bookingDate, compareBookings } from '../../src/lib/dashboard/calendar'

const organizationId = '11111111-1111-4111-8111-111111111111'
const scoped = (path: string) => `${path}?orgId=${organizationId}`
const modules = [
  { id: 'ob' as const, code: 'ÖB', title: 'Överlåtelsebesiktning', href: scoped('/ob'), active: true, activeCount: 7, actionCount: 2 },
  { id: 'eb' as const, code: 'EB', title: 'Entreprenadbesiktning', href: scoped('/eb'), active: true, activeCount: 4, actionCount: 1 },
  { id: 'tu' as const, code: 'TU', title: 'Tekniska utredningar', href: scoped('/tu'), active: true, activeCount: 3, actionCount: 1 },
  { id: 'moisture' as const, code: 'FS', title: 'Fuktsäkerhet', href: scoped('/fuktsakerhet'), active: false, activeCount: 0, actionCount: 0 },
  { id: 'tasks' as const, code: 'UA', title: 'Uppdrag', href: scoped('/uppdrag'), active: true, activeCount: 2, actionCount: 1 },
]
const actions = [
  { id: 'ob-report', moduleId: 'ob' as const, title: 'Tallstigen 12', subtitle: 'Exempelvilla · Överlåtelsebesiktning', nextStep: 'Färdigställ utlåtandet och skicka till kunden.', category: 'inspection' as const, href: scoped('/ob/inspections/test-ob'), actionLabel: 'Fortsätt besiktning', dueDate: '2026-10-11', priority: 'overdue' as const },
  { id: 'ob-confirmation', moduleId: 'ob' as const, title: 'Uppdragsbekräftelse · Parkvägen 7', subtitle: 'Exempelkund', nextStep: 'Kontrollera underlaget och skicka uppdragsbekräftelsen.', category: 'confirmation' as const, href: scoped('/ob/assignments/test-confirmation'), actionLabel: 'Granska bekräftelse', dueDate: '2026-10-12', priority: 'today' as const },
  { id: 'eb-inspection', moduleId: 'eb' as const, title: 'Kvarteret Björken', subtitle: 'Exempelprojekt · Entreprenadbesiktning', nextStep: 'Slutför besiktningen innan utlåtandet kan skickas.', category: 'inspection' as const, href: scoped('/eb/projects/test-eb'), actionLabel: 'Öppna besiktning', dueDate: '2026-10-14', priority: 'normal' as const },
  { id: 'tu-confirmation', moduleId: 'tu' as const, title: 'Utredning · Storgatan 24', subtitle: 'Exempelfastighet', nextStep: 'Kunden har godkänt uppdraget. Starta den tekniska utredningen.', category: 'confirmation' as const, href: scoped('/tu/assignments/test-tu'), actionLabel: 'Starta utredning', priority: 'normal' as const },
  { id: 'task-followup', moduleId: 'tasks' as const, title: 'Följ upp offert · Brf Exemplet', nextStep: 'Kontrollera underlaget för nästa steg.', category: 'other' as const, href: scoped('/uppdrag/test-task/kund'), actionLabel: 'Öppna uppdrag', priority: 'normal' as const },
  // Defensive check: a foreign/disabled record must never become a link.
  { id: 'restricted-action', moduleId: 'moisture' as const, title: 'DOLD KUNDUPPGIFT', nextStep: 'Får inte visas', category: 'other' as const, href: scoped('/fuktsakerhet/projekt/forbidden'), actionLabel: 'Otillåten', priority: 'normal' as const },
]
const bookings = [
  { id: 'booking-ob', moduleId: 'ob' as const, title: 'Tallstigen 12', startsAt: '2026-10-12T07:00:00.000Z', endsAt: '2026-10-12T09:00:00.000Z', href: scoped('/ob/inspections/test-ob'), address: 'Tallstigen 12, Nacka', latitude: 59.3107, longitude: 18.1817 },
  { id: 'booking-tentative', moduleId: 'ob' as const, title: 'Äppelvägen 5', startsAt: '2026-10-12T08:30:00.000Z', href: scoped('/ob/assignments/test-tentative'), address: 'Äppelvägen 5, Täby', status: 'tentative' as const, confirmationStatus: 'Inväntar kund' },
  { id: 'booking-eb', moduleId: 'eb' as const, title: 'Kvarteret Björken', startsAt: '2026-10-12T11:00:00.000Z', href: scoped('/eb/projects/test-eb'), address: 'Björkvägen 8, Stockholm', latitude: 59.3371, longitude: 18.0897 },
  { id: 'booking-tu', moduleId: 'tu' as const, title: 'Storgatan 24', startsAt: '2026-10-12T13:30:00.000Z', href: scoped('/tu/investigations/test-tu'), address: 'Storgatan 24, Solna' },
  { id: 'booking-midweek', moduleId: 'tu' as const, title: 'Torsdagsutredningen', startsAt: '2026-10-15T08:00:00.000Z', href: scoped('/tu/investigations/test-midweek'), address: 'Exempelgatan 3, Solna' },
  { id: 'booking-lastweek', moduleId: 'ob' as const, title: 'Förra veckans villa', startsAt: '2026-10-05T07:00:00.000Z', href: scoped('/ob/inspections/test-lastweek'), address: 'Exempelvägen 1' },
  { id: 'booking-nextweek', moduleId: 'eb' as const, title: 'Nästa veckas besiktning', startsAt: '2026-10-19T07:00:00.000Z', href: scoped('/eb/projects/test-nextweek'), address: 'Exempelvägen 2' },
  { id: 'restricted-booking', moduleId: 'moisture' as const, title: 'DOLD BOKNING', startsAt: '2026-10-12T07:00:00.000Z', href: scoped('/fuktsakerhet/projekt/forbidden'), address: 'DOLD ADRESS' },
]
const draftBookings = [
  { id: 'booking-draft-ob', moduleId: 'ob' as const, title: 'Klövervägen 3', startsAt: '2026-10-12T08:00:00.000Z', href: scoped('/ob/assignments/test-draft-ob'), address: 'Klövervägen 3, Nacka', status: 'tentative' as const, confirmationStatus: 'Bekräftelse ej skickad' },
  { id: 'booking-draft-eb', moduleId: 'eb' as const, title: 'Kvarteret Linden', startsAt: '2026-10-12T10:15:00.000Z', href: scoped('/eb/projects/test-draft-eb'), address: 'Lindvägen 6, Stockholm', status: 'tentative' as const, confirmationStatus: 'Bekräftelse ej skickad' },
  { id: 'booking-draft-tu', moduleId: 'tu' as const, title: 'Utredning · Ekvägen 11', startsAt: '2026-10-12T11:30:00.000Z', href: scoped('/tu/assignments/test-draft-tu'), address: 'Ekvägen 11, Solna', status: 'tentative' as const, confirmationStatus: 'Bekräftelse ej skickad' },
  { id: 'booking-draft-case', moduleId: 'tasks' as const, title: 'Platsbesök · Brf Syrenen', startsAt: '2026-10-12T13:00:00.000Z', href: '/uppdrag/test-draft-case', address: 'Syrenvägen 9, Bromma', status: 'tentative' as const, confirmationStatus: 'Planerat platsbesök' },
]

const state = new URLSearchParams(location.search).get('state')
const data = {
  organizationId, today: '2026-10-12', modules,
  actions: state === 'empty' ? [] : state === 'long' ? [...actions, ...Array.from({ length: 7 }, (_, index) => ({
    ...actions[0], id: `extra-${index}`, title: `Exempeluppdrag ${index + 1}`, priority: 'normal' as const,
  }))] : actions,
  bookings: state === 'empty' ? [] : state === 'multi-module-drafts' ? draftBookings : state === 'tentative-only' ? bookings.filter(booking => booking.id === 'booking-tentative') : state === 'travel-known-coordinates' ? bookings.map(booking => ({ ...booking, latitude: 59.3107, longitude: 18.1817 })) : bookings,
  issues: [],
}
declare global { interface Window { __dashboardTest: { refreshes: number; writes: number; requests: string[]; fail: boolean; failureStatus: number; wrongOrg: boolean; delay: number; confirmTentative: boolean; travelFail: boolean; travelWrongOrg: boolean; travelWrongDate: boolean; travelDelay: number; travelMissingOrigin: boolean } } }
window.__dashboardTest = { refreshes: 0, writes: 0, requests: [], fail: state === 'client-error', failureStatus: 503, wrongOrg: false, delay: 0, confirmTentative: false, travelFail: state === 'travel-error', travelWrongOrg: state === 'travel-wrong-org', travelWrongDate: state === 'travel-wrong-date', travelDelay: 0, travelMissingOrigin: state === 'travel-missing-origin' || state === 'client-travel-missing-origin' }
window.fetch = async (input, init) => {
  const url = new URL(String(input), location.href)
  window.__dashboardTest.requests.push(`${url.pathname}${url.search}`)
  if ((init?.method ?? 'GET') !== 'GET') { window.__dashboardTest.writes++; throw Error('Synthetic preview blocks changes') }
  if (url.pathname === '/api/dashboard') {
    await new Promise(resolve => setTimeout(resolve, window.__dashboardTest.delay))
    if (window.__dashboardTest.fail) return Response.json({ error: 'Översikten kunde inte hämtas. Försök igen.' }, { status: window.__dashboardTest.failureStatus })
    return Response.json({ ...data,
      bookings: data.bookings.map(booking => window.__dashboardTest.confirmTentative && booking.id === 'booking-tentative'
        ? { ...booking, status: 'confirmed', confirmationStatus: undefined, href: scoped('/ob/inspections/test-tentative-converted') }
        : booking),
      organizationId: window.__dashboardTest.wrongOrg ? 'foreign-organization' : organizationId,
    })
  }
  if (url.pathname === '/api/dashboard/map') return Response.json({
    organizationId, date: url.searchParams.get('date'),
    locations: url.searchParams.get('date') === data.today ? state === 'multi-module-drafts' ? [
      { id: 'booking-draft-ob', latitude: 59.3107, longitude: 18.1817, status: 'located' },
      { id: 'booking-draft-eb', latitude: 59.3371, longitude: 18.0897, status: 'located' },
      { id: 'booking-draft-tu', latitude: 59.3604, longitude: 18.0249, status: 'located' },
      { id: 'booking-draft-case', latitude: 59.3407, longitude: 17.9517, status: 'located' },
    ] : [
      { id: 'booking-ob', latitude: 59.3107, longitude: 18.1817, status: 'located' },
      { id: 'booking-tentative', latitude: 59.4404, longitude: 18.0694, status: 'located' },
      { id: 'booking-eb', latitude: 59.3371, longitude: 18.0897, status: 'located' },
      { id: 'booking-tu', latitude: 59.3604, longitude: 18.0249, status: 'located' },
    ] : [],
  })
  if (url.pathname === '/api/dashboard/travel') {
    await new Promise(resolve => setTimeout(resolve, window.__dashboardTest.travelDelay))
    if (window.__dashboardTest.travelFail) return Response.json({ error: 'Restiden kunde inte hämtas. Försök igen.' }, { status: 503 })
    const selectedIds = url.searchParams.getAll('bookingId')
    const includesTentative = url.searchParams.get('includeTentative') !== '0'
    const selected = data.bookings.filter(booking => booking.moduleId !== 'moisture'
      && bookingDate(booking.startsAt) === url.searchParams.get('date')
      && selectedIds.includes(booking.id)
      && (includesTentative || !('status' in booking && booking.status === 'tentative' && !(window.__dashboardTest.confirmTentative && booking.id === 'booking-tentative'))))
      .sort(compareBookings)
    const legs = selected.map((booking, index) => ({
      fromId: index === 0 ? 'company-origin' : selected[index - 1].id,
      toId: booking.id, durationSeconds: (index + 1) * 600, distanceMeters: (index + 1) * 5000,
    }))
    const locations = ['Kontorsvägen 1, Stockholm', ...selected.map(booking => booking.address!)]
    const directionsLinks = selected.length ? [`https://www.google.com/maps/dir/?${new URLSearchParams({
      api: '1', travelmode: 'driving', origin: locations[0], destination: locations.at(-1)!,
      ...(locations.length > 2 ? { waypoints: locations.slice(1, -1).join('|') } : {}),
    })}`] : []
    return Response.json({
      organizationId: window.__dashboardTest.travelWrongOrg ? 'foreign-organization' : organizationId,
      date: window.__dashboardTest.travelWrongDate ? '2026-10-01' : url.searchParams.get('date'),
      bookingIds: selected.map(booking => booking.id), includesTentative,
      origin: window.__dashboardTest.travelMissingOrigin
        ? { status: 'address_missing', label: 'Företaget' }
        : { status: 'located', label: 'Företaget', address: 'Kontorsvägen 1, Stockholm', latitude: 59.3, longitude: 18.1 },
      route: window.__dashboardTest.travelMissingOrigin
        ? { status: 'origin_missing', legs: [], geometry: [] }
        : { status: 'ready', durationSeconds: legs.reduce((total, leg) => total + leg.durationSeconds, 0), distanceMeters: legs.reduce((total, leg) => total + leg.distanceMeters, 0), legs, geometry: [] },
      directionsLinks: window.__dashboardTest.travelMissingOrigin ? [] : directionsLinks,
    })
  }
  return Response.json({}, { status: 404 })
}

function Preview() {
  const [refreshing, setRefreshing] = useState(false)
  async function refresh() {
    window.__dashboardTest.refreshes++
    setRefreshing(true)
    await new Promise(resolve => setTimeout(resolve, 100))
    setRefreshing(false)
  }
  return <>
    <div className="preview-notice">Förhandsvisning med testdata · Inte publicerad</div>
    <header className="preview-header"><a href="/dashboard-v1">HusHub</a><span>Exempelbolaget AB</span></header>
    {state?.startsWith('client') ? <DashboardV1Client /> : <DashboardContent data={data} onRefresh={refresh} refreshing={refreshing} />}
  </>
}
createRoot(document.getElementById('root')!).render(<Preview />)
