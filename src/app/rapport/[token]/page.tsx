import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { hashAssignmentToken } from '@/lib/assignments/tokens'
import {
  isReportSnapshotPayloadV1,
  type ReportSnapshotPayloadV1,
} from '@/lib/report/pdfV2/renderStructuredPdfV2'
import ReportSnapshotView from '@/components/report/ReportSnapshotView'
import ReportShareButton from '@/components/report/ReportShareButton'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const metadata = {
  title: 'Besiktningsutlåtande',
  robots: {
    index: false,
    follow: false,
  },
}

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

export default async function PublicReportPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  const normalizedToken = token?.trim() ?? ''
  if (normalizedToken.length < 20) notFound()

  const admin = createSupabaseAdminClient()
  const tokenHash = hashAssignmentToken(normalizedToken)

  const { data, error } = await admin
    .from('inspection_report_links')
    .select(
      'id,created_at,revoked_at,snapshot_payload,pdf_status,pdf_error,pdf_base64,pdf_storage_bucket,pdf_storage_path'
    )
    .eq('token_hash', tokenHash)
    .maybeSingle()

  if (error) {
    throw new Error(error.message ?? 'Could not load report link.')
  }
  if (!data) notFound()
  if (data.revoked_at) return <InactiveReportLinkMessage />

  const snapshot: ReportSnapshotPayloadV1 | null = isReportSnapshotPayloadV1(data.snapshot_payload)
    ? data.snapshot_payload
    : null

  const pdfBase64 = String((data as Record<string, unknown>).pdf_base64 ?? '').trim()
  const pdfStorageBucket = String((data as Record<string, unknown>).pdf_storage_bucket ?? '').trim()
  const pdfStoragePath = String((data as Record<string, unknown>).pdf_storage_path ?? '').trim()
  const hasStoredPdf =
    pdfBase64.length > 0 || (pdfStorageBucket.length > 0 && pdfStoragePath.length > 0)
  const statusFromDb = normalizePdfStatus((data as Record<string, unknown>).pdf_status)
  const pdfStatus = hasStoredPdf ? 'ready' : statusFromDb
  const pdfError = String((data as Record<string, unknown>).pdf_error ?? '').trim() || null

  const pdfInlineUrl = `/api/reports/public/${encodeURIComponent(normalizedToken)}`
  const pdfDownloadUrl = pdfStatus === 'ready' && hasStoredPdf ? `${pdfInlineUrl}?download=1` : null
  const shareEndpoint = `/api/reports/public/${encodeURIComponent(normalizedToken)}`
  const shareUrl = `/rapport/${encodeURIComponent(normalizedToken)}`

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
            <p className="text-sm text-rose-700">
              PDF-generering misslyckades{pdfError ? `: ${pdfError}` : '.'}
            </p>
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
      pdfError={pdfError}
      showPdfActions
      shareEndpoint={shareEndpoint}
      shareUrl={shareUrl}
    />
  )
}


