import { notFound, redirect } from 'next/navigation'
import EbInspectionReportDraftClient from '@/components/eb/EbInspectionReportDraftClient'
import { requireModuleAccess } from '@/lib/access/server'
import { requireOrgContext } from '@/lib/assignments/server'
import { getEbInspectionReport, type EbInspectionReport } from '@/lib/eb/server'

export const dynamic = 'force-dynamic'

export default async function EbInspectionReportDraftPage({
  params,
}: {
  params: Promise<{ projectId: string; inspectionId: string }>
}) {
  const { projectId, inspectionId } = await params
  let report: EbInspectionReport | null = null

  try {
    await requireModuleAccess({
      productKey: 'dashboard',
      moduleKey: 'construction_inspections',
    })
    const context = await requireOrgContext()
    report = await getEbInspectionReport({
      orgId: context.orgId,
      requestedByUserId: context.userId,
      projectId,
      inspectionId,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okänt fel.'
    if (message === 'UNAUTHORIZED') {
      redirect('/login')
    }
    if (message === 'EB_PROJECT_NOT_FOUND' || message === 'EB_INSPECTION_NOT_FOUND') {
      notFound()
    }
    throw error
  }

  if (!report) {
    notFound()
  }

  return <EbInspectionReportDraftClient initialReport={report} />
}
