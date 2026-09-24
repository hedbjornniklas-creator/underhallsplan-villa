import { createRoot } from 'react-dom/client'
import Page from '../../src/app/(dashboard)/ob/page'
import { overviewDemoItems } from './ob-overview-data'

declare global {
  interface Window {
    __obOverviewTest: { fail: boolean; empty: boolean; delay: number; reads: number; writes: number }
  }
}
const state = new URL(location.href).searchParams.get('state')
window.__obOverviewTest = { fail: state === 'error', empty: state === 'empty', delay: 0, reads: 0, writes: 0 }
window.fetch = async (input, init) => {
  if ((init?.method ?? 'GET') !== 'GET') {
    window.__obOverviewTest.writes++
    throw Error('This preview does not send or save anything')
  }
  if (String(input) !== '/api/ob/overview') return Response.json({}, { status: 404 })
  window.__obOverviewTest.reads++
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
  return responseState.fail
    ? Response.json({ error: 'Uppdragslistan kunde inte hämtas. Försök igen.' }, { status: 503 })
    : Response.json({ items: responseState.empty ? [] : items })
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
