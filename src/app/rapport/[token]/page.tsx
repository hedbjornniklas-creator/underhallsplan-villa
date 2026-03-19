import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { hashAssignmentToken } from '@/lib/assignments/tokens'
import {
  isReportSnapshotPayloadV1,
  type ReportSnapshotPayloadV1,
} from '@/lib/report/pdfV2/renderStructuredPdfV2'
import ReportSnapshotView from '@/components/report/ReportSnapshotView'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const metadata = {
  title: 'Besiktningsutlåtande',
  robots: {
    index: false,
    follow: false,
  },
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
    .select('id,created_at,revoked_at,snapshot_payload')
    .eq('token_hash', tokenHash)
    .maybeSingle()

  if (error) {
    throw new Error(error.message ?? 'Could not load report link.')
  }
  if (!data || data.revoked_at) notFound()

  const snapshot: ReportSnapshotPayloadV1 | null = isReportSnapshotPayloadV1(data.snapshot_payload)
    ? data.snapshot_payload
    : null

  const pdfInlineUrl = `/api/reports/public/${encodeURIComponent(normalizedToken)}`
  const pdfDownloadUrl = `${pdfInlineUrl}?download=1`

  if (!snapshot) {
    return (
      <main className="min-h-screen bg-slate-100 px-4 py-8">
        <div className="mx-auto max-w-3xl space-y-4 rounded-xl border border-slate-200 bg-white p-5">
          <h1 className="text-xl font-semibold text-slate-900">Besiktningsutlåtande</h1>
          <p className="text-sm text-slate-700">Rapporten är tillgänglig som PDF.</p>
          <div className="flex flex-wrap gap-2">
            <Link
              href={pdfInlineUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-50"
            >
              Öppna PDF
            </Link>
            <Link
              href={pdfDownloadUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
            >
              Ladda ner PDF
            </Link>
          </div>
        </div>
      </main>
    )
  }

  return (
    <ReportSnapshotView
      snapshot={snapshot}
      heading={snapshot.inspectionSide === 'apartment' ? 'L�genhetsbesiktning' : 'Besiktningsutl�tande'}
      pdfInlineUrl={pdfInlineUrl}
      pdfDownloadUrl={pdfDownloadUrl}
      showPdfActions
    />
  )
}

