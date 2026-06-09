import { notFound, redirect } from 'next/navigation'
import TuPublicReportSnapshotView from '@/components/tu/TuPublicReportSnapshotView'
import TuPrintPagedDocument from '@/components/tu/TuPrintPagedDocument'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { getTuInvestigationById, requireTuContext } from '@/lib/tu/server'
import {
  isTuReportSnapshotPayloadV1,
  type TuReportSnapshotPayloadV1,
} from '@/lib/tu/reportSnapshot'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
const DELIVERY_DOCUMENT_SIGNED_URL_TTL_SECONDS = 60 * 10

function normalizePdfStatus(value: unknown): 'pending' | 'processing' | 'ready' | 'failed' {
  const normalized = String(value ?? '').trim().toLowerCase()
  if (normalized === 'processing') return 'processing'
  if (normalized === 'ready') return 'ready'
  if (normalized === 'failed') return 'failed'
  return 'pending'
}

type ReportLinkRow = {
  snapshot_payload: unknown
  pdf_status: string | null
  pdf_base64: string | null
  pdf_storage_bucket: string | null
  pdf_storage_path: string | null
}

export default async function TuInvestigationDigitalReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ inspectionId: string }>
  searchParams?: Promise<{ pdf?: string }>
}) {
  const { inspectionId } = await params
  const resolvedSearchParams = await searchParams
  const isPdfRender = resolvedSearchParams?.pdf === '1'

  try {
    const context = await requireTuContext()
    const investigation = await getTuInvestigationById({
      orgId: context.orgId,
      inspectionId,
      inspectorProfileId: context.userId,
    })
    if (!investigation) notFound()

    const admin = createSupabaseAdminClient()
    const { data, error } = await admin
      .from('inspection_report_links')
      .select('snapshot_payload,pdf_status,pdf_base64,pdf_storage_bucket,pdf_storage_path')
      .eq('inspection_id', inspectionId)
      .is('revoked_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) throw new Error(error.message ?? 'Kunde inte hämta digitalt utlåtande.')
    if (!data) notFound()

    const row = data as ReportLinkRow
    const snapshot: TuReportSnapshotPayloadV1 | null = isTuReportSnapshotPayloadV1(row.snapshot_payload)
      ? row.snapshot_payload
      : null
    if (!snapshot) notFound()

    const hasStoredPdf =
      String(row.pdf_base64 ?? '').trim().length > 0 ||
      (String(row.pdf_storage_bucket ?? '').trim().length > 0 &&
        String(row.pdf_storage_path ?? '').trim().length > 0)
    const pdfStatus = hasStoredPdf ? 'ready' : normalizePdfStatus(row.pdf_status)
    const pdfDownloadUrl =
      pdfStatus === 'ready' && hasStoredPdf
        ? `/api/report-v2/${encodeURIComponent(inspectionId)}/pdf`
        : null
    const deliveryDocuments = (
      await Promise.all(
        (snapshot.deliveryDocuments ?? []).map(async (document) => {
          const bucket = document.storageBucket?.trim()
          const path = document.filePath?.trim()
          if (!bucket || !path) return null

          const { data: signedDocument } = await admin.storage
            .from(bucket)
            .createSignedUrl(path, DELIVERY_DOCUMENT_SIGNED_URL_TTL_SECONDS)
          const downloadUrl = signedDocument?.signedUrl ?? null
          if (!downloadUrl) return null

          return {
            id: document.id,
            title: document.title,
            fileName: document.fileName,
            contentType: document.contentType,
            fileSizeBytes: document.fileSizeBytes,
            createdAt: document.createdAt,
            downloadUrl,
          }
        })
      )
    ).filter((document): document is NonNullable<typeof document> => Boolean(document))

    if (isPdfRender) {
      return (
        <main className="min-h-screen bg-white text-gray-950">
          <TuPrintPagedDocument
            companyLogoUrl={snapshot.report.companyLogoUrl}
            companyLogoAlt={snapshot.report.companyLogoAlt}
            header={snapshot.report.header}
            coverTitle={snapshot.report.coverTitle}
            coverImage={snapshot.report.coverImage}
            parties={snapshot.report.parties}
            metaRows={snapshot.report.metaRows}
            objectRows={snapshot.report.objectRows}
            sections={snapshot.report.sections}
            signature={snapshot.report.signature}
            appendixImages={snapshot.report.appendixImages}
            footer={snapshot.report.footer}
          />
        </main>
      )
    }

    return (
      <TuPublicReportSnapshotView
        snapshot={snapshot}
        pdfDownloadUrl={pdfDownloadUrl}
        shareEndpoint={null}
        shareUrl={`/tu/investigations/${encodeURIComponent(inspectionId)}/digital`}
        deliveryDocuments={deliveryDocuments}
      />
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okänt fel.'
    if (message === 'UNAUTHORIZED') redirect('/login')
    if (message === 'ORG_MEMBERSHIP_REQUIRED') redirect('/dashboard')
    if (message === 'TU_INVESTIGATION_NOT_FOUND') notFound()
    throw error
  }
}
