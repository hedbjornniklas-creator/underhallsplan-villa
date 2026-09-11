import { redirect } from 'next/navigation'
import TuDashboardClient from '@/components/tu/TuDashboardClient'
import {
  getTuInspectorProfileCard,
  listTuReportTemplateOptions,
  listTuAssignments,
  listTuInvestigations,
  requireTuContext,
  type TuAssignmentListItem,
  type TuInspectorProfileCard,
  type TuInspectionSummary,
  type TuReportTemplateOption,
} from '@/lib/tu/server'

export const dynamic = 'force-dynamic'

export default async function TechnicalInvestigationsPage({
  searchParams,
}: {
  searchParams?: Promise<{ orgId?: string | string[] }>
}) {
  const resolvedSearchParams = searchParams ? await searchParams : {}
  let assignments: TuAssignmentListItem[] = []
  let investigations: TuInspectionSummary[] = []
  let inspectorProfile: TuInspectorProfileCard | null = null
  let reportTemplates: TuReportTemplateOption[] = []
  let initialError: string | null = null
  let organizationId: string | null = null
  let organizationName: string | null = null

  try {
    const context = await requireTuContext(resolvedSearchParams.orgId)
    organizationId = context.orgId
    organizationName = context.orgName
    ;[assignments, investigations, inspectorProfile, reportTemplates] = await Promise.all([
      listTuAssignments(context.orgId),
      listTuInvestigations(context.orgId),
      getTuInspectorProfileCard({ orgId: context.orgId, profileId: context.userId }),
      listTuReportTemplateOptions(),
    ])
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okänt fel.'
    if (message === 'UNAUTHORIZED') redirect('/login')
    initialError =
      message === 'ORG_SELECTION_INVALID'
        ? 'Den valda organisationen är ogiltig. Återställ organisationsvalet i topbaren.'
        : message === 'ORG_MEMBERSHIP_REQUIRED' || message === 'MODULE_ACCESS_REQUIRED'
          ? 'Du saknar TU-behörighet i den valda organisationen.'
          : 'Kunde inte hämta TU-data. Kontrollera att TU-migrationen är körd.'
  }

  if (!organizationId) {
    return (
      <main className="min-h-full bg-slate-50 p-4 md:p-6">
        <section className="mx-auto max-w-3xl rounded-2xl border border-rose-200 bg-rose-50 p-6 text-rose-950 shadow-sm">
          <h1 className="text-lg font-semibold">TU kunde inte öppnas</h1>
          <p className="mt-2 text-sm">{initialError}</p>
        </section>
      </main>
    )
  }

  return (
    <TuDashboardClient
      key={organizationId}
      organizationId={organizationId}
      organizationName={organizationName}
      initialAssignments={assignments}
      initialInvestigations={investigations}
      initialReportTemplates={reportTemplates}
      inspectorProfile={inspectorProfile}
      initialError={initialError}
    />
  )
}
