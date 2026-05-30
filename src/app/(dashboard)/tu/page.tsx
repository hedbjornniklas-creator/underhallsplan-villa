import { redirect } from 'next/navigation'
import TuDashboardClient from '@/components/tu/TuDashboardClient'
import {
  getTuInspectorProfileCard,
  listTuAssignments,
  listTuInvestigations,
  requireTuContext,
  type TuAssignmentListItem,
  type TuInspectorProfileCard,
  type TuInspectionSummary,
} from '@/lib/tu/server'

export const dynamic = 'force-dynamic'

export default async function TechnicalInvestigationsPage() {
  let assignments: TuAssignmentListItem[] = []
  let investigations: TuInspectionSummary[] = []
  let inspectorProfile: TuInspectorProfileCard | null = null
  let initialError: string | null = null

  try {
    const context = await requireTuContext()
    ;[assignments, investigations, inspectorProfile] = await Promise.all([
      listTuAssignments(context.orgId),
      listTuInvestigations(context.orgId),
      getTuInspectorProfileCard({ orgId: context.orgId, profileId: context.userId }),
    ])
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okänt fel.'
    if (message === 'UNAUTHORIZED') redirect('/login')
    initialError = 'Kunde inte hämta TU-data. Kontrollera att TU-migrationen är körd.'
  }

  return (
    <TuDashboardClient
      initialAssignments={assignments}
      initialInvestigations={investigations}
      inspectorProfile={inspectorProfile}
      initialError={initialError}
    />
  )
}
