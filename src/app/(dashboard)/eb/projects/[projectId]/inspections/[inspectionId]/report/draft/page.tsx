import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

export default async function EbInspectionReportDraftPage({
  params,
}: {
  params: Promise<{ projectId: string; inspectionId: string }>
}) {
  const { projectId, inspectionId } = await params
  redirect(`/eb/projects/${projectId}/inspections/${inspectionId}/perform`)
}
