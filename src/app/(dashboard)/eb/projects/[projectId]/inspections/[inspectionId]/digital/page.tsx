import { notFound, redirect } from 'next/navigation'
import EbInspectionReportView from '@/components/eb/EbInspectionReportView'
import EbPublicReportSnapshotView from '@/components/eb/EbPublicReportSnapshotView'
import { EbToastProvider } from '@/components/eb/EbToastProvider'
import { requireModuleAccess } from '@/lib/access/server'
import { requireOrgContext } from '@/lib/assignments/server'
import {
  getEbInspectionReportFromSnapshot,
  isEbReportSnapshotPayloadV1,
} from '@/lib/eb/reportSnapshot'
import { getEbProjectById } from '@/lib/eb/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const DELIVERY_DOCUMENT_SIGNED_URL_TTL_SECONDS = 60 * 10

type ReportLinkRow = {
  created_at: string | null
  snapshot_payload: unknown
  pdf_status: string | null
  pdf_base64: string | null
  pdf_storage_bucket: string | null
  pdf_storage_path: string | null
}

function normalizePdfStatus(value: unknown): 'pending' | 'processing' | 'ready' | 'failed' {
  const normalized = String(value ?? '').trim().toLowerCase()
  if (normalized === 'processing') return 'processing'
  if (normalized === 'ready') return 'ready'
  if (normalized === 'failed') return 'failed'
  return 'pending'
}

async function requireEbContext() {
  await requireModuleAccess({
    productKey: 'dashboard',
    moduleKey: 'construction_inspections',
  })
  return requireOrgContext()
}

export default async function EbInspectionDigitalReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string; inspectionId: string }>
  searchParams?: Promise<{ pdf?: string }>
}) {
  const { projectId, inspectionId } = await params
  const resolvedSearchParams = await searchParams
  const isPdfRender = resolvedSearchParams?.pdf === '1'

  try {
    const context = await requireEbContext()
    const project = await getEbProjectById({ orgId: context.orgId, projectId })
    if (!project || !project.inspections.some((inspection) => inspection.inspectionId === inspectionId)) {
      notFound()
    }

    const admin = createSupabaseAdminClient()
    const { data, error } = await admin
      .from('inspection_report_links')
      .select(
        'created_at,snapshot_payload,pdf_status,pdf_base64,pdf_storage_bucket,pdf_storage_path'
      )
      .eq('org_id', context.orgId)
      .eq('inspection_id', inspectionId)
      .is('revoked_at', null)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) throw new Error(error.message ?? 'Kunde inte hämta digitalt EB-utlåtande.')
    if (!data) notFound()

    const row = data as ReportLinkRow
    const report = getEbInspectionReportFromSnapshot(row.snapshot_payload)
    if (!report || report.project.id !== projectId || report.inspection.inspectionId !== inspectionId) {
      notFound()
    }

    const snapshot = isEbReportSnapshotPayloadV1(row.snapshot_payload)
      ? row.snapshot_payload
      : null
    const hasStoredPdf =
      String(row.pdf_base64 ?? '').trim().length > 0 ||
      (String(row.pdf_storage_bucket ?? '').trim().length > 0 &&
        String(row.pdf_storage_path ?? '').trim().length > 0)
    const pdfStatus = hasStoredPdf ? 'ready' : normalizePdfStatus(row.pdf_status)
    const pdfDownloadUrl =
      pdfStatus === 'ready' && hasStoredPdf
        ? `/api/report-v2/${encodeURIComponent(inspectionId)}/pdf`
        : null

    if (isPdfRender) {
      return (
        <EbToastProvider>
          <EbInspectionReportView report={report} showInternalActions={false} />
        </EbToastProvider>
      )
    }

    const deliveryDocuments = (
      await Promise.all(
        (snapshot?.deliveryDocuments ?? []).map(async (document) => {
          const bucket = document.storageBucket?.trim()
          const path = document.filePath?.trim()
          if (!bucket || !path) return null

          const { data: signedDocument } = await admin.storage
            .from(bucket)
            .createSignedUrl(path, DELIVERY_DOCUMENT_SIGNED_URL_TTL_SECONDS)
          if (!signedDocument?.signedUrl) return null

          return {
            id: document.id,
            title: document.title,
            fileName: document.fileName,
            contentType: document.contentType,
            fileSizeBytes: document.fileSizeBytes,
            createdAt: document.createdAt,
            downloadUrl: signedDocument.signedUrl,
          }
        })
      )
    ).filter((document): document is NonNullable<typeof document> => Boolean(document))

    return (
      <EbPublicReportSnapshotView
        report={report}
        publishedAt={snapshot?.createdAt ?? row.created_at}
        pdfDownloadUrl={pdfDownloadUrl}
        pdfStatus={pdfStatus}
        pdfError={null}
        shareEndpoint={null}
        shareUrl={null}
        deliveryDocuments={deliveryDocuments}
      />
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okänt fel.'
    if (message === 'UNAUTHORIZED') redirect('/login')
    if (message === 'ORG_MEMBERSHIP_REQUIRED') redirect('/dashboard')
    if (message === 'MODULE_ACCESS_REQUIRED') redirect('/dashboard')
    throw error
  }
}
