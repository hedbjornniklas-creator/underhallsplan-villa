import { notFound, redirect } from 'next/navigation'
import ActionCaseProject from '@/components/tasks/ActionCaseProject'
import UppdragScope from '@/components/tasks/UppdragScope'
import { requireOrgContext } from '@/lib/assignments/server'
import { requireModuleAccess } from '@/lib/access/server'
import { getActionCaseWorkspace } from '@/lib/action-cases/server'
import { getCustomerOfferWorkspace } from '@/lib/action-cases/customerOffersServer'
import { getTaskPeople } from '@/lib/tasks/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { parseProjectView } from '@/lib/action-cases/projectNavigation'
import { readOrganizationBranding } from '@/lib/organizations/companyProfile'

export const dynamic = 'force-dynamic'

export default async function ProjectPage({ params, searchParams }: {
  params: Promise<{ caseId: string }>
  searchParams: Promise<{ view?: string }>
}) {
  const { caseId } = await params
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(caseId)) notFound()
  const org = await requireOrgContext().catch((error: unknown) => {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') redirect('/login')
    throw error
  })
  await requireModuleAccess({ productKey: 'dashboard', moduleKey: 'tasks', scopeType: 'organization', scopeId: org.orgId })
  const ctx = { orgId: org.orgId, userId: org.userId }
  const workspace = await getActionCaseWorkspace(ctx, caseId)
  if (!workspace.cases.some((item) => item.id === caseId)) notFound()
  const db = createSupabaseAdminClient()
  const [offerResult, peopleResult, organization, profile, company] = await Promise.all([
    getCustomerOfferWorkspace(ctx, caseId).then((data) => ({ data, error: null })).catch(() => ({
      data: null, error: 'Offertuppgifterna kunde inte hämtas. Försök igen. Projektarbete och filer är fortfarande tillgängliga.',
    })),
    getTaskPeople({ ...ctx, isOrgAdmin: org.role === 'admin' }).then((people) => ({ people, unavailable: false }))
      .catch(() => ({ people: [], unavailable: true })),
    db.from('organizations').select('name').eq('id', org.orgId).maybeSingle(),
    db.from('profiles').select('full_name,email,phone').eq('id', org.userId).maybeSingle(),
    readOrganizationBranding(org.orgId).then((data) => ({ data, unavailable: false })).catch(() => ({ data: null, unavailable: true })),
  ])
  return <UppdragScope><div className="gizmo-workspace">
    {peopleResult.unavailable && <p className="mx-auto max-w-7xl px-6 py-3 text-sm" role="alert">Kontaktlistan kunde inte hämtas. Mottagare kan fortfarande anges manuellt.</p>}
    {company.unavailable && <p className="mx-auto max-w-7xl px-6 py-3 text-sm" role="alert">Entreprenörens företagsuppgifter kunde inte hämtas. De kan fyllas i under Avtal.</p>}
    <ActionCaseProject caseId={caseId} initialWorkspace={workspace} initialOffer={offerResult.data} initialOfferError={offerResult.error}
      initialView={parseProjectView((await searchParams).view)} people={peopleResult.people} issuerName={company.data?.name ?? organization.data?.name ?? ''} replyEmail={profile.data?.email ?? ''}
      contractorSource={{ companyName: company.data?.name ?? organization.data?.name ?? '',
        organizationNumber: company.data?.organizationNumber ?? '', street: company.data?.address ?? '',
        postalCode: company.data?.postalCode ?? '', city: company.data?.city ?? '',
        contactName: profile.data?.full_name ?? '', mobile: profile.data?.phone ?? '', email: profile.data?.email ?? '' }} />
  </div></UppdragScope>
}
