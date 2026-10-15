import { notFound, redirect } from 'next/navigation'
import { requireObInspectionReadContext } from '@/lib/ob/organizationBindings'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { getObPublishedReportRecord, obPublishedPdfStatus } from '@/lib/ob/publishedReport'
import ReportSnapshotView from '@/components/report/ReportSnapshotView'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const metadata = {
  title: 'Publicerat digitalt utlåtande',
  robots: { index: false, follow: false },
}

export default async function ObPublishedDigitalReport({ params, searchParams }: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ report?: string | string[]; orgId?: string | string[] }>
}) {
  const { id } = await params
  const { report, orgId } = await searchParams
  if (typeof report !== 'string') notFound()
  let access
  try { access = await requireObInspectionReadContext(id, orgId) }
  catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') redirect('/login')
    if (error instanceof Error && ['ORG_MEMBERSHIP_REQUIRED', 'MODULE_ACCESS_REQUIRED',
      'OB_ORGANIZATION_FORBIDDEN', 'OB_ORGANIZATION_MISMATCH', 'ORG_SELECTION_INVALID',
      'OB_INSPECTION_INVALID', 'OB_ORGANIZATION_UNASSIGNED'].includes(error.message)) notFound()
    throw error
  }
  const published = await getObPublishedReportRecord(createSupabaseAdminClient(), id, report, access)
  if (!published) notFound()
  const endpoint = `/api/ob/inspections/${encodeURIComponent(id)}/published-report?report=${encodeURIComponent(report)}&orgId=${encodeURIComponent(access.orgId)}`
  // Use the customer's digital renderer and frozen payload, never live inspection data.
  return <ReportSnapshotView snapshot={published.snapshot} showPdfActions
    pdfDownloadUrl={endpoint} pdfStatus={obPublishedPdfStatus(published)} pdfStatusEndpoint={`${endpoint}&status=1`}
    shareEndpoint={access.canEdit ? endpoint : undefined} requireCustomerLink />
}
