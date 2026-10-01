import { notFound, redirect } from 'next/navigation'
import ActionCaseProject from '@/components/tasks/ActionCaseProject'
import UppdragScope from '@/components/tasks/UppdragScope'
import { requireOrgContext } from '@/lib/assignments/server'
import { requireModuleAccess } from '@/lib/access/server'
import { getActionCaseWorkspace } from '@/lib/action-cases/server'
import { getCustomerOfferWorkspace } from '@/lib/action-cases/customerOffersServer'
import { getTaskWorkspace } from '@/lib/tasks/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { parseProjectView } from '@/lib/action-cases/projectNavigation'
import type { CustomerOfferWorkspace } from '@/lib/action-cases/customerOffers'
import type { TaskPerson } from '@/lib/tasks/contracts'

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
  let initialOffer: CustomerOfferWorkspace | null = null
  let initialOfferError: string | null = null
  try { initialOffer = await getCustomerOfferWorkspace(ctx, caseId) }
  catch { initialOfferError = 'Offertuppgifterna kunde inte hämtas. Försök igen. Projektarbete och filer är fortfarande tillgängliga.' }
  let people: TaskPerson[] = []
  let peopleUnavailable = false
  try { people = (await getTaskWorkspace({ ...ctx, isOrgAdmin: org.role === 'admin' })).people }
  catch { peopleUnavailable = true }
  const db = createSupabaseAdminClient()
  const organization = await db.from('organizations').select('name').eq('id', org.orgId).maybeSingle()
  const profile = await db.from('profiles').select('email').eq('id', org.userId).maybeSingle()
  return <UppdragScope><div className="gizmo-workspace">
    {peopleUnavailable && <p className="mx-auto max-w-7xl px-6 py-3 text-sm" role="alert">Kontaktlistan kunde inte hämtas. Mottagare kan fortfarande anges manuellt.</p>}
    <ActionCaseProject caseId={caseId} initialWorkspace={workspace} initialOffer={initialOffer} initialOfferError={initialOfferError}
      initialView={parseProjectView((await searchParams).view)} people={people} issuerName={organization.data?.name ?? ''} replyEmail={profile.data?.email ?? ''} />
  </div></UppdragScope>
}
