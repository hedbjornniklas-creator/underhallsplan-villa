import { notFound, redirect } from 'next/navigation'
import TuPublicReportSnapshotView from '@/components/tu/TuPublicReportSnapshotView'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { getTuInvestigationById, requireTuContext } from '@/lib/tu/server'
import {
  isTuReportSnapshotPayloadV1,
  type TuReportSnapshotPayloadV1,
} from '@/lib/tu/reportSnapshot'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

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
}: {
  params: Promise<{ inspectionId: string }>
}) {
  const { inspectionId } = await params

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

    return (
      <TuPublicReportSnapshotView
        snapshot={snapshot}
        pdfDownloadUrl={pdfDownloadUrl}
        shareEndpoint={null}
        shareUrl={`/tu/investigations/${encodeURIComponent(inspectionId)}/digital`}
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
