import { notFound } from 'next/navigation'
import CustomerOfferEditor from '@/components/tasks/CustomerOfferEditor'
import UppdragScope from '@/components/tasks/UppdragScope'
import { getActionCaseWorkspace } from '@/lib/action-cases/server'
import { getCustomerOfferWorkspace } from '@/lib/action-cases/customerOffersServer'
import { customerOfferContext } from '@/lib/action-cases/customerOffersHttp'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
export const dynamic = 'force-dynamic'
export default async function CustomerOfferPage({
  params
}: {
  params: Promise<{ caseId: string }>
}) {
  const { caseId } = await params,
    ctx = await customerOfferContext()
  const workspace = await getActionCaseWorkspace(ctx, caseId),
    actionCase = workspace.cases.find((c) => c.id === caseId)
  if (!actionCase) notFound()
  let initial
  try {
    initial = await getCustomerOfferWorkspace(ctx, caseId)
  } catch (error) {
    return (
      <main className="mx-auto max-w-4xl px-6 py-10">
        <a href="/uppdrag" className="text-violet-700">
          Till uppdrag
        </a>
        <h1 className="mt-6">Kundvy och offert</h1>
        <p className="mt-4">
          {error instanceof Error && error.message === 'CUSTOMER_OFFER_SCHEMA'
            ? 'Kundofferter är inte aktiverade ännu. Kör databasmigrationen 2026-09-29_01_action_case_customer_offers.sql.'
            : 'Kundofferten kunde inte hämtas. Försök igen senare.'}
        </p>
      </main>
    )
  }
  const db = createSupabaseAdminClient(),
    org = await db
      .from('organizations')
      .select('name')
      .eq('id', ctx.orgId)
      .maybeSingle(),
    profile = await db
      .from('profiles')
      .select('email')
      .eq('id', ctx.userId)
      .maybeSingle()
  return (
    <UppdragScope>
      <CustomerOfferEditor
        actionCase={actionCase}
        initial={initial}
        issuerName={org.data?.name ?? ''}
        replyEmail={profile.data?.email ?? ''}
      />
    </UppdragScope>
  )
}
