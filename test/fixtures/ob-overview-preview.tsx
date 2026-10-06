import { createRoot } from 'react-dom/client'
import { useEffect, useState } from 'react'
import { AppToastProvider } from '../../src/components/ui/AppToastProvider'
import { homeTest } from './ob-overview-client'
import Page from '../../src/app/(dashboard)/ob/page'
import ActiveOrganizationSwitcher from '../../src/components/organizations/ActiveOrganizationSwitcher'
import { overviewDemoItems } from './ob-overview-data'
import { selectObOverview, type OverviewFilter, type OverviewSort } from '../../src/lib/ob/overview'

declare global {
  interface Window {
    __obOverviewTest: { fail: boolean; empty: boolean; delay: number; reads: number; writes: number; urls: string[]; pageLengths: number[]; clockOffset: number }
  }
}
const state = new URL(location.href).searchParams.get('state')
window.__obOverviewTest = { fail: state === 'error', empty: state === 'empty', delay: 0, reads: 0, writes: 0, urls: [], pageLengths: [], clockOffset: 0 }
const realNow = Date.now
Date.now = () => realNow() + window.__obOverviewTest.clockOffset
const organizations = [
  { id: '11111111-1111-4111-8111-111111111111', name: 'Besiktningsbolaget Stockholm · test', isDefault: true },
  { id: '22222222-2222-4222-8222-222222222222', name: 'Hushub 1 · test', isDefault: false },
]
window.fetch = async (input, init) => {
  const requestUrl = new URL(String(input), location.href)
  const selectedOrganization = organizations.find(row => row.id === requestUrl.searchParams.get('orgId')) ?? organizations[0]
  if (requestUrl.pathname === '/api/organizations/context') {
    await new Promise(resolve => setTimeout(resolve, 350))
    if (requestUrl.searchParams.has('orgId') && !organizations.some(row => row.id === requestUrl.searchParams.get('orgId'))) return Response.json({ error: 'Du saknar tillgång till organisationen.' }, { status: 403 })
    return Response.json({ organization: selectedOrganization, organizations })
  }
  if (requestUrl.pathname === '/api/ob/profile-card') return Response.json({ workspace: {
    profileId: 'preview-user', organization: selectedOrganization,
    card: new URLSearchParams(location.search).has('missing-profile') ? { displayName: '', email: '', companyName: '' } :
      { displayName: 'Testperson', email: 'test@example.invalid', companyName: selectedOrganization.name },
  } })
  if (requestUrl.pathname === '/api/ob/inspections' && init?.method === 'POST' && new URLSearchParams(location.search).has('actions')) {
    homeTest.requests.push({ url: String(input), body: JSON.parse(String(init.body)) })
    await new Promise(resolve => setTimeout(resolve, homeTest.delay))
    if (homeTest.createFailAt) return Response.json({ error: 'Syntetiskt skapandefel. Inget har sparats.' }, { status: 503 })
    window.dispatchEvent(new CustomEvent('ob-preview-created', { detail: selectedOrganization }))
    return Response.json({ propertyId: 'new-property', inspectionId: 'new-inspection', orgId: selectedOrganization.id })
  }
  if (new URLSearchParams(location.search).has('actions') && requestUrl.pathname === '/api/ob/assignments/quick-send' && init?.method === 'POST') {
    homeTest.requests.push({ url: String(input), body: JSON.parse(String(init.body)) })
    await new Promise(resolve => setTimeout(resolve, homeTest.delay))
    return Response.json(homeTest.quickStatus === 200 ? { ok: true } :
      { error: 'Syntetiskt utskicksfel', acceptUrl: '/synthetic-customer-link' }, { status: homeTest.quickStatus })
  }
  if ((init?.method ?? 'GET') !== 'GET') {
    window.__obOverviewTest.writes++
    throw Error('This preview does not send or save anything')
  }
  const url = new URL(String(input), location.href)
  if (url.pathname !== '/api/ob/overview') return Response.json({}, { status: 404 })
  window.__obOverviewTest.reads++
  window.__obOverviewTest.urls.push(url.search)
  const responseState = { ...window.__obOverviewTest }
  await new Promise(resolve => setTimeout(resolve, responseState.delay))
  const items = selectedOrganization.id === organizations[0].id ? overviewDemoItems() : overviewDemoItems().slice(0, 1).map(item => ({ ...item, id: 'inspection:other-org', address: 'Hushub 1:s testuppdrag', customer: 'Testkund i Hushub 1' }))
  items.filter(item => item.inspection === 'Klar').forEach(item => {
    item.pdfHref = `/api/report-v2/${item.id.replace('inspection:', '')}/pdf`
  })
  if (new URL(location.href).searchParams.get('density') === 'stress') {
    Object.assign(items[0], {
      date: null, assignmentNumber: '', city: '',
      address: 'Södra Strandpromenaden vid Östra Långholmens allé 128 B, gårdshuset',
      customer: 'mycket-langt-kundnamn-for-att-testa-tabellens-fullstandiga-text@example.invalid',
      confirmation: 'Arkiverad · Godkännande behöver kontrolleras',
      attention: ['Arbetet är pausat. Uppdragsbekräftelsen behöver vara aktuell och skickad.', 'Stäm av kundens uppgifter i besiktningen'],
      marker: 'attention',
    })
  }
  if (responseState.fail) return Response.json({ error: 'Uppdragslistan kunde inte hämtas. Försök igen.' }, { status: 503 })
  const options = { search: url.searchParams.get('search') ?? '', filter: (url.searchParams.get('filter') ?? 'all') as OverviewFilter,
    sort: (url.searchParams.get('sort') ?? 'date-desc') as OverviewSort,
    attentionOnly: url.searchParams.get('attentionOnly') === 'true', showArchived: url.searchParams.get('showArchived') === 'true' }
  const available = responseState.empty ? [] : items
  const selected = selectObOverview(available, options)
  const counts = { all: selectObOverview(available, { ...options, filter: 'all' }).length,
    active: selectObOverview(available, { ...options, filter: 'active' }).length,
    closed: selectObOverview(available, { ...options, filter: 'closed' }).length }
  const pageSize = Number(url.searchParams.get('pageSize') ?? 10)
  const page = Math.max(1, Math.min(Number(url.searchParams.get('page') ?? 1), Math.max(1, Math.ceil(selected.length / pageSize))))
  const pageItems = selected.slice((page - 1) * pageSize, page * pageSize)
  window.__obOverviewTest.pageLengths.push(pageItems.length)
  return Response.json({ items: pageItems, total: selected.length, counts, page, pageSize })
}

function SyntheticMutationReceipt() {
  const [created, setCreated] = useState<{ id: string; name: string } | null>(null)
  useEffect(() => {
    const onCreated = (event: Event) => setCreated((event as CustomEvent<{ id: string; name: string }>).detail)
    const clear = () => setCreated(null)
    window.addEventListener('ob-preview-created', onCreated)
    window.addEventListener('popstate', clear)
    return () => { window.removeEventListener('ob-preview-created', onCreated); window.removeEventListener('popstate', clear) }
  }, [])
  return created ? <aside role="status" className="mx-4 mt-4 rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-emerald-950">
    <strong>Syntetisk besiktning skapad för {created.name}</strong>
    <p>Organisation i skapandebegäran: {created.id}</p>
    <p>Endast testdata i webbfönstret. Ingen riktig besiktning, kund eller faktura har skapats.</p>
  </aside> : null
}

createRoot(document.getElementById('root')!).render(<AppToastProvider>
  <div className="preview-notice">Förhandsvisning med testdata · Inte publicerad</div>
  <header className="preview-header">
    {/* Standalone fixture: no Next image optimizer is running. */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src="/report-assets/BesiktApp.png" alt="BesiktApp" /><ActiveOrganizationSwitcher isLoggedIn displayName="Testperson" email="test@example.invalid" compact={false} />
  </header>
  <SyntheticMutationReceipt />
  <Page />
</AppToastProvider>)
