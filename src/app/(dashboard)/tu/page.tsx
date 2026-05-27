import { redirect } from 'next/navigation'
import TuDashboardClient from '@/components/tu/TuDashboardClient'
import {
  listTuAssignments,
  listTuInvestigations,
  requireTuContext,
  type TuAssignmentListItem,
  type TuInspectionSummary,
} from '@/lib/tu/server'

export const dynamic = 'force-dynamic'

export default async function TechnicalInvestigationsPage() {
  let assignments: TuAssignmentListItem[] = []
  let investigations: TuInspectionSummary[] = []
  let initialError: string | null = null

  try {
    const context = await requireTuContext()
    ;[assignments, investigations] = await Promise.all([
      listTuAssignments(context.orgId),
      listTuInvestigations(context.orgId),
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
      initialError={initialError}
    />
  )
}
