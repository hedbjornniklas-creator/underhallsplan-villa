import EbInspectionReportView from '@/components/eb/EbInspectionReportView'
import { EbToastProvider } from '@/components/eb/EbToastProvider'
import ReportRenderer from '@/components/report/ReportRenderer'
import TuPrintPagedDocument from '@/components/tu/TuPrintPagedDocument'
import {
  getEbInspectionReportFromSnapshot,
  sanitizeEbReportForPublicDelivery,
} from '@/lib/eb/reportSnapshot'
import { isReportSnapshotPayloadV1 } from '@/lib/report/reportSnapshotPayload'
import { isTuReportSnapshotPayloadV1 } from '@/lib/tu/reportSnapshot'

type ReportSnapshotPrintDocumentProps = {
  snapshot: unknown
}

export function isPrintableReportSnapshot(snapshot: unknown) {
  return Boolean(
    getEbInspectionReportFromSnapshot(snapshot) ||
      isTuReportSnapshotPayloadV1(snapshot) ||
      isReportSnapshotPayloadV1(snapshot)
  )
}

/** Renders the frozen print layout stored when a report link was created. */
export default function ReportSnapshotPrintDocument({
  snapshot,
}: ReportSnapshotPrintDocumentProps) {
  const ebReportSnapshot = getEbInspectionReportFromSnapshot(snapshot)
  if (ebReportSnapshot) {
    const report = sanitizeEbReportForPublicDelivery(ebReportSnapshot)
    return (
      <EbToastProvider>
        <EbInspectionReportView report={report} showInternalActions={false} />
      </EbToastProvider>
    )
  }

  if (isTuReportSnapshotPayloadV1(snapshot)) {
    const report = snapshot.report
    return (
      <main className="min-h-screen bg-white text-gray-950">
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

  if (isReportSnapshotPayloadV1(snapshot)) {
    return (
      <ReportRenderer
        spec={snapshot.reportSpec}
        mockData={snapshot.reportData}
        rootClassName="report-root--pdf"
        inspectionSide={snapshot.inspectionSide}
      />
    )
  }

  throw new Error('REPORT_SNAPSHOT_NOT_PRINTABLE')
}
