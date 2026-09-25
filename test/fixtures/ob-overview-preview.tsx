import { createRoot } from 'react-dom/client'
import Page from '../../src/app/(dashboard)/ob/page'
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
window.fetch = async (input, init) => {
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
  const items = overviewDemoItems()
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

createRoot(document.getElementById('root')!).render(<>
  <div className="preview-notice">Förhandsvisning med testdata · Inte publicerad</div>
  <header className="preview-header">
    {/* Standalone fixture: no Next image optimizer is running. */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src="/report-assets/BesiktApp.png" alt="BesiktApp" /><span>Överlåtelsebesiktning</span>
  </header>
  <Page />
</>)
