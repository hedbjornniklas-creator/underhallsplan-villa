import { createRoot } from 'react-dom/client'
import ReportSnapshotView from '../../src/components/report/ReportSnapshotView'
import { snapshotWithBuildings } from './report-snapshot-buildings-data'
import { buildReportSpec } from '../../src/lib/report/reportSpec'

const snapshot = snapshotWithBuildings()
const params = new URLSearchParams(location.search)
const internal = params.has('internal')
if (params.has('consistency')) {
  snapshot.inspectionSide = 'seller'
  snapshot.reportData.mock.inspection_conditions = { furnishing_level: params.get('furnishing') ?? 'omoblerad' }
  snapshot.reportData.mock.inspections.assignment_confirmation_date = '2026-10-20'
  snapshot.reportSpec = buildReportSpec({ layoutVersion: 2, inspectionSide: 'seller',
    dynamicAppendices: { buildings: snapshot.reportData.mock.appendices.buildings } })
}
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
