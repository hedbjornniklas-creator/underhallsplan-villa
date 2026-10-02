import { createRoot } from 'react-dom/client'
import TuDashboardClient from '../../src/components/tu/TuDashboardClient'
import { TU_STANDARD_REPORT_TEMPLATES } from '../../src/lib/tu/reportTemplates'
import { tuOverviewDemo, tuPreviewOrg } from './tu-overview-data'

declare global {
  interface Window {
    __tuOverviewTest: { fail: boolean; empty: boolean; wrongOrg: boolean; delay: number; reads: string[]; writes: number }
  }
}
const mode = new URLSearchParams(location.search).get('state')
window.__tuOverviewTest = { fail: mode === 'error', empty: mode === 'empty', wrongOrg: false, delay: 0, reads: [], writes: 0 }
window.fetch = async (input, init) => {
  if ((init?.method ?? 'GET') !== 'GET') {
    window.__tuOverviewTest.writes++
    throw Error('Preview: changes and deliveries are disabled')
  }
  const url = new URL(String(input), location.href)
  const state = { ...window.__tuOverviewTest }
  window.__tuOverviewTest.reads.push(url.pathname + url.search)
  await new Promise(resolve => setTimeout(resolve, state.delay))
  if (state.fail) return Response.json({ error: 'Do not expose internal diagnostics' }, { status: 503 })
  if (url.searchParams.get('orgId') !== tuPreviewOrg) return Response.json({}, { status: 403 })
  const { assignments, investigations } = tuOverviewDemo()
  if (!['/api/tu/assignments', '/api/tu/investigations'].includes(url.pathname)) return Response.json({}, { status: 404 })
  return Response.json({ org: { id: state.wrongOrg ? 'another-organization' : tuPreviewOrg },
    items: state.empty ? [] : url.pathname.endsWith('/assignments') ? assignments : investigations })
}
const data = tuOverviewDemo()
createRoot(document.getElementById('root')!).render(<>
  <div className="preview-notice">Förhandsvisning med testdata · Inte publicerad</div>
  <header className="preview-header">
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src="/report-assets/BesiktApp.png" alt="BesiktApp" /><span>Tekniska utredningar</span>
  </header>
  <TuDashboardClient organizationId={tuPreviewOrg} organizationName="Exempelbolaget AB"
    initialAssignments={mode ? [] : data.assignments} initialInvestigations={mode ? [] : data.investigations}
    initialReportTemplates={TU_STANDARD_REPORT_TEMPLATES} inspectorProfile={null} initialError={null} />
</>)
