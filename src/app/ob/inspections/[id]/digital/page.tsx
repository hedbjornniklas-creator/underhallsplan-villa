import { notFound, redirect } from 'next/navigation'
import { requireOrgContext } from '@/lib/assignments/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { getObPublishedReport } from '@/lib/ob/publishedReport'
import ReportSnapshotView from '@/components/report/ReportSnapshotView'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const metadata = {
  title: 'Publicerat digitalt utlåtande',
  robots: { index: false, follow: false },
}

export default async function ObPublishedDigitalReport({ params, searchParams }: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ report?: string }>
}) {
  const { id } = await params
  const { report } = await searchParams
  if (typeof report !== 'string') notFound()
  let access
  try { access = await requireOrgContext() }
  catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') redirect('/login')
    if (error instanceof Error && error.message === 'ORG_MEMBERSHIP_REQUIRED') notFound()
    throw error
  }
  const snapshot = await getObPublishedReport(createSupabaseAdminClient(), id, report, access)
  if (!snapshot) notFound()
  // Use the customer's digital renderer and frozen payload, never live inspection data.
  return <ReportSnapshotView snapshot={snapshot} showPdfActions={false} />
}
