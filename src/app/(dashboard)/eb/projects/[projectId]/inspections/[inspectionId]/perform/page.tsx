import { notFound, redirect } from 'next/navigation'
import EbInspectionRoundClient from '@/components/eb/EbInspectionRoundClient'
import { requireModuleAccess } from '@/lib/access/server'
import { requireOrgContext } from '@/lib/assignments/server'
import { getEbInspectionRound, type EbInspectionRound } from '@/lib/eb/server'

export const dynamic = 'force-dynamic'

export default async function EbInspectionPerformPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string; inspectionId: string }>
  searchParams?: Promise<{ disciplineId?: string }>
}) {
  const { projectId, inspectionId } = await params
  const resolvedSearchParams = searchParams ? await searchParams : {}
  let round: EbInspectionRound | null = null

  try {
    await requireModuleAccess({
      productKey: 'dashboard',
      moduleKey: 'construction_inspections',
    })
    const context = await requireOrgContext()
    round = await getEbInspectionRound({
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

  if (!round) {
    notFound()
  }

  return (
    <EbInspectionRoundClient
      initialRound={round}
      initialDisciplineId={resolvedSearchParams.disciplineId ?? null}
    />
  )
}
