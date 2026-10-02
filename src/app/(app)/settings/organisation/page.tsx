import Link from 'next/link'
import { redirect } from 'next/navigation'
import OrganizationSettingsClient from '@/components/organizations/OrganizationSettingsClient'
import SettingsNav from '@/components/settings/SettingsNav'
import { getOrganizationWorkspace } from '@/lib/organizations/administration'

export const dynamic = 'force-dynamic'

export default async function OrganizationSettingsPage({ searchParams }: { searchParams?: Promise<{ orgId?: string | string[]; tab?: string }> }) {
  const query = searchParams ? await searchParams : {}
  let workspace: Awaited<ReturnType<typeof getOrganizationWorkspace>> | null = null
  let errorMessage = ''
  try {
    workspace = await getOrganizationWorkspace(query.orgId)
  } catch (failure) {
    const code = failure instanceof Error ? failure.message : ''
    if (code === 'UNAUTHORIZED') {
      const next = typeof query.orgId === 'string' ? `/settings/organisation?orgId=${encodeURIComponent(query.orgId)}` : '/settings/organisation'
      redirect(`/login?next=${encodeURIComponent(next)}`)
    }
    errorMessage = ['ORG_MEMBERSHIP_REQUIRED', 'ORG_ADMIN_REQUIRED', 'MODULE_ACCESS_REQUIRED'].includes(code)
      ? 'Du saknar ett aktivt medlemskap eller behörighet i den valda organisationen.'
      : code === 'ORG_SELECTION_INVALID' ? 'Organisationsvalet i adressen är ogiltigt.'
        : 'Organisationsinställningarna kunde inte hämtas. Försök igen om en stund.'
  }
  return <div className="min-h-full bg-slate-50 px-4 py-6 md:px-6 md:py-8"><div className="mx-auto max-w-6xl space-y-5"><SettingsNav />{workspace ? <OrganizationSettingsClient key={`${workspace.organization.id}:${workspace.role}`} initialWorkspace={workspace} initialTab={query.tab === 'members' || query.tab === 'integrations' ? query.tab : 'organization'} /> : <section className="rounded-2xl border border-rose-200 bg-white p-6 shadow-sm"><h1 className="text-xl font-semibold text-slate-950">Organisationen kunde inte öppnas</h1><p role="alert" className="mt-3 text-sm text-rose-800">{errorMessage}</p><Link href="/settings/organisation" className="mt-4 inline-flex text-sm font-semibold text-indigo-700 underline">Välj min standardorganisation</Link></section>}</div></div>
}
