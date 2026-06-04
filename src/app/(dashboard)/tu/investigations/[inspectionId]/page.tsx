import { notFound, redirect } from 'next/navigation'
import TuInvestigationEditorClient from '@/components/tu/TuInvestigationEditorClient'
import {
  getTuInvestigationById,
  listTuReportSectionTypeOptions,
  requireTuContext,
  type TuInvestigationDetails,
  type TuReportSectionTypeOption,
} from '@/lib/tu/server'

export const dynamic = 'force-dynamic'

export default async function TuInvestigationPage({
  params,
}: {
  params: Promise<{ inspectionId: string }>
}) {
  const { inspectionId } = await params
  let investigation: TuInvestigationDetails | null = null
  let sectionTypeOptions: TuReportSectionTypeOption[] = []

  try {
    const context = await requireTuContext()
    ;[investigation, sectionTypeOptions] = await Promise.all([
      getTuInvestigationById({
        orgId: context.orgId,
        inspectionId,
        inspectorProfileId: context.userId,
      }),
      listTuReportSectionTypeOptions(),
    ])
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okänt fel.'
    if (message === 'UNAUTHORIZED') redirect('/login')
    if (message === 'TU_INVESTIGATION_NOT_FOUND') notFound()
    throw error
  }

  if (!investigation) notFound()
  return (
    <TuInvestigationEditorClient
      initialInvestigation={investigation}
      sectionTypeOptions={sectionTypeOptions}
    />
  )
}
