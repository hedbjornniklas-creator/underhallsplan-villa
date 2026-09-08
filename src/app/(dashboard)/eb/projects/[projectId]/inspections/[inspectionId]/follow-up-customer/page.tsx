import { notFound, redirect } from 'next/navigation'
import EbFollowUpCustomerSettings from '@/components/eb/EbFollowUpCustomerSettings'
import { requireModuleAccess } from '@/lib/access/server'
import { requireOrgContext } from '@/lib/assignments/server'
import { getEbFollowUpCustomerSettings, type EbFollowUpCustomerSettings as CustomerSettings } from '@/lib/eb/followUpCustomer'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export default async function EbFollowUpCustomerPage({ params }: {
  params: Promise<{ projectId: string; inspectionId: string }>
}) {
  const { projectId, inspectionId } = await params
  let settings: CustomerSettings | null = null
  try {
    await requireModuleAccess({ productKey: 'dashboard', moduleKey: 'construction_inspections' })
    const org = await requireOrgContext()
    settings = await getEbFollowUpCustomerSettings({
      admin: createSupabaseAdminClient(), orgId: org.orgId, projectId, inspectionId,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (message === 'UNAUTHORIZED') redirect('/login')
    if (message === 'ORG_MEMBERSHIP_REQUIRED' || message === 'MODULE_ACCESS_REQUIRED') redirect('/dashboard')
    if (message === 'EB_INSPECTION_NOT_FOUND') notFound()
    if (message !== 'EB_FOLLOW_UP_CONFIGURATION') throw error
  }
  const base = `/eb/projects/${encodeURIComponent(projectId)}/inspections/${encodeURIComponent(inspectionId)}`
  return <main className="mx-auto max-w-3xl space-y-5 px-5 py-8">
    <a href={`${base}/digital`} className="text-sm text-indigo-700 underline">Till digitalt utlåtande</a>
    <h1 className="text-2xl font-semibold text-slate-900">Besiktningens beställare</h1>
    {settings
      ? <EbFollowUpCustomerSettings initialSettings={settings} endpoint={`/api${base}/follow-up-customer`} />
      : <p>Beställaradressen kan inte visas eller ändras förrän systemets databas är uppdaterad. Kontakta administratören. Utlåtandet påverkas inte.</p>}
  </main>
}
