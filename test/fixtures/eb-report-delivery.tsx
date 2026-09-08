import { createRoot } from 'react-dom/client'
import EbReportDeliveryDialog from '../../src/components/eb/EbReportDeliveryDialog'
import { EbToastProvider } from '../../src/components/eb/EbToastProvider'
import type { EbInspectionSummary } from '../../src/lib/eb/server'

const inspection = {
  inspectionId: 'test-inspection', variantLabel: 'Slutbesiktning', reportLockedAt: '2026-09-08T09:00:00Z',
  reportPdfStatus: 'ready', reportPdfError: null, reportPdfDownloadUrl: null,
  reportPdfCreatedAt: '2026-09-08T09:00:00Z', reportDeliveryStatus: 'not_sent',
} as unknown as EbInspectionSummary
const noop = () => undefined

createRoot(document.getElementById('root')!).render(
  <EbToastProvider>
    <EbReportDeliveryDialog open projectId="test-project" inspection={inspection}
      initialAction={new URLSearchParams(location.search).has('unlock') ? 'unlock' : 'delivery'}
      onClose={noop} onProjectUpdated={noop} onChanged={noop} />
  </EbToastProvider>,
)
