import { headers } from 'next/headers'
import { notFound } from 'next/navigation'

import ReportSnapshotPrintDocument, {
  isPrintableReportSnapshot,
} from '@/components/report/ReportSnapshotPrintDocument'
import {
  INTERNAL_REPORT_RENDER_AUTH_HEADER,
  verifyInternalReportRenderAuthorization,
} from '@/lib/report/internalRenderAuth'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const metadata = {
  title: 'Intern rapportåtergivning',
  robots: {
    index: false,
    follow: false,
  },
}

export default async function InternalReportRenderPage({
  params,
}: {
  params: Promise<{ linkId: string }>
}) {
  const { linkId } = await params
  const requestHeaders = await headers()
  const isAuthorized = verifyInternalReportRenderAuthorization({
    linkId,
    authorization: requestHeaders.get(INTERNAL_REPORT_RENDER_AUTH_HEADER),
  })
  if (!isAuthorized) notFound()

  const admin = createSupabaseAdminClient()
  const { data, error } = await admin
    .from('inspection_report_links')
    .select('id,revoked_at,snapshot_payload')
    .eq('id', linkId)
    .maybeSingle()

  if (error) throw new Error(error.message ?? 'Could not load report snapshot.')
  if (!data || data.revoked_at || !isPrintableReportSnapshot(data.snapshot_payload)) notFound()

  return <ReportSnapshotPrintDocument snapshot={data.snapshot_payload} />
}
