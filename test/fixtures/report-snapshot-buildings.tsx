import { createRoot } from 'react-dom/client'
import ReportSnapshotView from '../../src/components/report/ReportSnapshotView'
import { snapshotWithBuildings } from './report-snapshot-buildings-data'

const snapshot = snapshotWithBuildings()
const params = new URLSearchParams(location.search)
const internal = params.has('internal')
if (params.has('status')) {
  snapshot.inspectionSide = 'status'
  snapshot.reportData.mock.status_report = { assignmentNotice: 'Fryst uppdragstext.', visualConditions: 'Frysta förutsättningar.',
    oralInformation: 'Frysta muntliga uppgifter.', ownerInformation: 'Frysta ägaruppgifter.', terms: 'Frysta statusvillkor.' }
}
const calls: unknown[] = []
Object.assign(window, { reportShareCalls: calls })
const nativeFetch = window.fetch.bind(window)
window.fetch = async (url, options) => {
  if (String(url) !== '/fixture-share') return nativeFetch(url, options)
  const body = JSON.parse(String(options?.body))
  calls.push(body)
  if (body.publicUrl?.includes('wrong')) return Response.json({ error: 'Länken hör inte till den öppnade rapportversionen.' }, { status: 400 })
  return Response.json(body.action === 'validate-link' ? { shareUrl: body.publicUrl } : { ok: true })
}
if (new URLSearchParams(location.search).has('photos')) {
  snapshot.reportData.mock.interior.blocks[0].photoUrls = [
    '/fixture-landscape.png', '/fixture-portrait.png', '/fixture-square.png',
    '/fixture-landscape.png', '/fixture-portrait.png', '/fixture-square.png', '/fixture-landscape.png',
  ]
}
if (new URLSearchParams(location.search).has('single')) {
  Object.assign(snapshot.reportData.mock, { appendices: {} })
}
createRoot(document.getElementById('root')!).render(<ReportSnapshotView snapshot={snapshot}
  pdfDownloadUrl="/fixture.pdf" pdfStatus="ready" shareEndpoint="/fixture-share"
  shareUrl={internal ? undefined : '/rapport/test-public-token-1234567890'} requireCustomerLink={internal} />)
