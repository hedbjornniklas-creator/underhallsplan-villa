import { createRoot } from 'react-dom/client'
import { useState } from 'react'
import EbFollowUpOrder from '../../src/components/eb/EbFollowUpOrder'
import EbPublicReportSnapshotView from '../../src/components/eb/EbPublicReportSnapshotView'
import type { EbInspectionReport } from '../../src/lib/eb/server'

const view = new URLSearchParams(location.search).get('view')
const report = {
  project: { title: 'Lokal testvilla', address: 'Testgatan 1', postalCode: '12345', city: 'Teststad',
    standardAgreement: 'Konsumententreprenad', notePrefix: 'Fel' },
  inspection: { variant: 'SLB', variantLabel: 'Slutbesiktning', sequenceNo: 1,
    date: '2026-09-07', inspectionTime: '10:00', previousInspections: [] },
  reportDraft: { noteHeadings: [], sections: [
    { key: 'summons', title: 'Kallelse', isRelevant: true, contentMode: 'editable', text: 'Originalrapporten förblir tillgänglig utan köp.' },
    ...(view === 'report-no-defects' ? [] : [{ key: 'defects_appendices', title: 'Fel och noteringar', isRelevant: true, text: '' }]),
  ] },
  notes: view === 'report-empty' ? [] : [{ id: 'test-note', noteNumber: 1, sortOrder: 1, noteText: 'En syntetisk notering för UI-testet.' }],
  markers: [], checkpoints: [], images: [],
  branding: { footer: { companyLines: ['Testföretag'], contactLines: [] }, besiktAppLogoUrl: '/test-logo.svg' },
} as unknown as EbInspectionReport

function SwitchingReport() {
  const [endpoint, setEndpoint] = useState('/mock-follow-up')
  return <main className="mx-auto max-w-5xl space-y-6 p-4 sm:p-8">
    <h1>Rapportbyte — lokal testdata</h1>
    <button type="button" onClick={() => setEndpoint('/mock-follow-up-other')}>Byt testrapport</button>
    <EbFollowUpOrder endpoint={endpoint} />
  </main>
}

createRoot(document.getElementById('root')!).render(
  view === 'switch-report' ? <SwitchingReport /> : view ? <EbPublicReportSnapshotView report={report}
    shareEndpoint={view === 'report-actions' ? '/mock-share' : null}
    shareUrl={view === 'report-actions' ? '/public-report' : null}
    pdfDownloadUrl={view === 'report-actions' ? '/mock-report.pdf' : null}
    pdfStatus={view === 'report-actions' ? 'ready' : undefined}
    customerAutoOpen={new URLSearchParams(location.search).get('customer') === '1'}
    followUpEndpoint={view === 'preview' ? null : '/mock-follow-up'} /> : <main className="mx-auto max-w-5xl space-y-6 p-4 sm:p-8">
    <h1 className="text-2xl font-semibold">Fastställt utlåtande — lokal testdata</h1>
    <p>Originalrapporten förblir tillgänglig utan köp.</p>
    <EbFollowUpOrder endpoint="/mock-follow-up" autoOpen={new URLSearchParams(location.search).get('customer') === '1'} />
  </main>,
)
