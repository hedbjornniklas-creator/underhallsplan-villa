import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { hashAssignmentToken } from '@/lib/assignments/tokens'
import {
  isReportSnapshotPayloadV1,
  type ReportSnapshotPayloadV1,
} from '@/lib/report/reportSnapshotPayload'
import ReportSnapshotView from '@/components/report/ReportSnapshotView'
import ReportSnapshotPrintDocument, {
  isPrintableReportSnapshot,
} from '@/components/report/ReportSnapshotPrintDocument'
import ReportShareButton from '@/components/report/ReportShareButton'
import EbPublicReportSnapshotView from '@/components/eb/EbPublicReportSnapshotView'
import {
  getEbInspectionReportFromSnapshot,
  isEbReportSnapshotPayloadV1,
  sanitizeEbReportForPublicDelivery,
} from '@/lib/eb/reportSnapshot'
import TuPublicReportSnapshotView from '@/components/tu/TuPublicReportSnapshotView'
import {
  isTuReportSnapshotPayloadV1,
  type TuReportSnapshotPayloadV1,
} from '@/lib/tu/reportSnapshot'

function normalizePdfStatus(value: unknown): 'pending' | 'processing' | 'ready' | 'failed' {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase()
  if (normalized === 'processing') return 'processing'
  if (normalized === 'ready') return 'ready'
  if (normalized === 'failed') return 'failed'
  return 'pending'
}

function InactiveReportLinkMessage() {
  return (
    <main className="min-h-screen bg-slate-100 px-4 py-8">
      <div className="mx-auto max-w-3xl space-y-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Besiktningsutlåtande
        </div>
        <h1 className="text-xl font-semibold text-slate-900">
          Länken är inte längre aktiv
        </h1>
        <p className="text-sm leading-6 text-slate-700">
          Det här utlåtandet har ersatts av en nyare länk eller återkallats. Kontakta din
          besiktningsman för att få aktuell länk till utlåtandet.
        </p>
        <p className="text-xs leading-5 text-slate-500">
          Om du har fått länken via mejl kan mejlet avse en äldre version av utlåtandet.
        </p>
      </div>
    </main>
  )
}

/** Buyer access is supplied only by the server-validated personal report route. */
export default async function PublicReportPageContent({
  publicToken,
  isPdfRender = false,
  buyerFollowUpEndpoint,
  buyerAccessExpired = false,
}: {
  publicToken: string
  isPdfRender?: boolean
  buyerFollowUpEndpoint?: string
  buyerAccessExpired?: boolean
}) {
  const normalizedToken = publicToken?.trim() ?? ''
  if (normalizedToken.length < 20) notFound()

  const admin = createSupabaseAdminClient()
  const tokenHash = hashAssignmentToken(normalizedToken)

  const { data, error } = await admin
    .from('inspection_report_links')
    .select(
      'id,created_at,revoked_at,snapshot_payload,pdf_status,pdf_base64,pdf_storage_bucket,pdf_storage_path'
    )
    .eq('token_hash', tokenHash)
    .maybeSingle()

  if (error) {
    throw new Error(error.message ?? 'Could not load report link.')
  }
  if (!data) notFound()
  if (data.revoked_at) return <InactiveReportLinkMessage />

  const tuSnapshot: TuReportSnapshotPayloadV1 | null = isTuReportSnapshotPayloadV1(data.snapshot_payload)
    ? data.snapshot_payload
    : null
  const snapshot: ReportSnapshotPayloadV1 | null = isReportSnapshotPayloadV1(data.snapshot_payload)
    ? data.snapshot_payload
    : null
  const ebSnapshot = isEbReportSnapshotPayloadV1(data.snapshot_payload)
    ? data.snapshot_payload
    : null
  const ebReportSnapshot = getEbInspectionReportFromSnapshot(data.snapshot_payload)
  const ebReport = ebReportSnapshot
    ? sanitizeEbReportForPublicDelivery(ebReportSnapshot)
    : null

  if (isPdfRender && isPrintableReportSnapshot(data.snapshot_payload)) {
    return <ReportSnapshotPrintDocument snapshot={data.snapshot_payload} />
  }

  const pdfBase64 = String((data as Record<string, unknown>).pdf_base64 ?? '').trim()
  const pdfStorageBucket = String((data as Record<string, unknown>).pdf_storage_bucket ?? '').trim()
  const pdfStoragePath = String((data as Record<string, unknown>).pdf_storage_path ?? '').trim()
  const hasStoredPdf =
    pdfBase64.length > 0 || (pdfStorageBucket.length > 0 && pdfStoragePath.length > 0)
  const statusFromDb = normalizePdfStatus((data as Record<string, unknown>).pdf_status)
  const pdfStatus = hasStoredPdf ? 'ready' : statusFromDb

  const pdfInlineUrl = `/api/reports/public/${encodeURIComponent(normalizedToken)}`
  const pdfDownloadUrl = `${pdfInlineUrl}?download=1`
  const pdfStatusEndpoint = `${pdfInlineUrl}?status=1`
  const shareEndpoint = `/api/reports/public/${encodeURIComponent(normalizedToken)}`
  const shareUrl = `/rapport/${encodeURIComponent(normalizedToken)}`

  if (ebReport) {
    const deliveryDocuments = (ebSnapshot?.deliveryDocuments ?? []).map((document) => ({
      id: document.id,
      title: document.title,
      fileName: document.fileName,
      contentType: document.contentType,
      fileSizeBytes: document.fileSizeBytes,
      createdAt: document.createdAt,
      downloadUrl: `/api/reports/public/${encodeURIComponent(normalizedToken)}?documentId=${encodeURIComponent(document.id)}&download=1`,
    }))

    const reportView = (
      <EbPublicReportSnapshotView
        report={ebReport}
        publishedAt={ebSnapshot?.createdAt ?? null}
        pdfDownloadUrl={pdfDownloadUrl}
        pdfStatus={pdfStatus}
        pdfStatusEndpoint={pdfStatusEndpoint}
        shareEndpoint={shareEndpoint}
        shareUrl={shareUrl}
        deliveryDocuments={deliveryDocuments}
        followUpEndpoint={buyerAccessExpired ? undefined : buyerFollowUpEndpoint}
      />
    )
    if (!buyerAccessExpired) return reportView
    return (
      <>
        <div role="status" className="border-b border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-950 print:hidden">
          <p className="mx-auto max-w-7xl">
            Din personliga beställarlänk har gått ut. Du kan fortfarande läsa och dela utlåtandet.
            Kontakta besiktningsmannen för en ny personlig länk till beställarfunktionerna.
          </p>
        </div>
        {reportView}
      </>
    )
  }

  if (tuSnapshot) {
    const deliveryDocuments = (tuSnapshot.deliveryDocuments ?? []).map((document) => ({
      id: document.id,
      title: document.title,
      fileName: document.fileName,
      contentType: document.contentType,
      fileSizeBytes: document.fileSizeBytes,
      createdAt: document.createdAt,
      downloadUrl: `/api/reports/public/${encodeURIComponent(normalizedToken)}?documentId=${encodeURIComponent(document.id)}&download=1`,
    }))

    return (
      <TuPublicReportSnapshotView
        snapshot={tuSnapshot}
        pdfDownloadUrl={pdfDownloadUrl}
        pdfStatus={pdfStatus}
        pdfStatusEndpoint={pdfStatusEndpoint}
        shareEndpoint={shareEndpoint}
        shareUrl={shareUrl}
        deliveryDocuments={deliveryDocuments}
      />
    )
  }

  if (!snapshot) {
    return (
      <main className="min-h-screen bg-slate-100 px-4 py-8">
        <div className="mx-auto max-w-3xl space-y-4 rounded-xl border border-slate-200 bg-white p-5">
          <h1 className="text-xl font-semibold text-slate-900">Besiktningsutlåtande</h1>
          {pdfStatus === 'ready' && pdfDownloadUrl ? (
            <div className="flex flex-wrap gap-2">
              <ReportShareButton shareEndpoint={shareEndpoint} shareUrl={shareUrl} />
              <Link
                href={pdfDownloadUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
              >
                Ladda ner PDF
              </Link>
            </div>
          ) : pdfStatus === 'pending' || pdfStatus === 'processing' ? (
            <p className="text-sm text-amber-700">PDF genereras fortfarande i bakgrunden. Försök igen om en stund.</p>
          ) : pdfStatus === 'failed' ? (
            <p className="text-sm text-rose-700">PDF-filen kunde inte skapas. Kontakta avsändaren.</p>
          ) : (
            <p className="text-sm text-slate-700">Rapporten är ännu inte tillgänglig som PDF.</p>
          )}
        </div>
      </main>
    )
  }

  return (
    <ReportSnapshotView
      snapshot={snapshot}
      heading={snapshot.inspectionSide === 'apartment' ? 'Lägenhetsbesiktning' : 'Besiktningsutlåtande'}
      pdfInlineUrl={pdfInlineUrl}
      pdfDownloadUrl={pdfDownloadUrl}
      pdfStatus={pdfStatus}
      pdfStatusEndpoint={pdfStatusEndpoint}
      showPdfActions
      shareEndpoint={shareEndpoint}
      shareUrl={shareUrl}
    />
  )
}
