import TuPrintPagedDocument from '@/components/tu/TuPrintPagedDocument'
import TuPublicReportToolbar from '@/components/tu/TuPublicReportToolbar'
import type { TuReportSnapshotPayloadV1 } from '@/lib/tu/reportSnapshot'

export default function TuPublicReportSnapshotView({
  snapshot,
  shareEndpoint,
  shareUrl,
  pdfDownloadUrl,
}: {
  snapshot: TuReportSnapshotPayloadV1
  shareEndpoint: string
  shareUrl: string
  pdfDownloadUrl: string | null
}) {
  const report = snapshot.report

  return (
    <main className="min-h-screen bg-neutral-100 text-gray-950 print:bg-white">
      <TuPublicReportToolbar
        shareEndpoint={shareEndpoint}
        shareUrl={shareUrl}
        pdfDownloadUrl={pdfDownloadUrl}
      />
      <TuPrintPagedDocument
        companyLogoUrl={report.companyLogoUrl}
        companyLogoAlt={report.companyLogoAlt}
        header={report.header}
        coverTitle={report.coverTitle}
        coverImage={report.coverImage}
        parties={report.parties}
        metaRows={report.metaRows}
        objectRows={report.objectRows}
        sections={report.sections}
        signature={report.signature}
        appendixImages={report.appendixImages}
        footer={report.footer}
      />
    </main>
  )
}
