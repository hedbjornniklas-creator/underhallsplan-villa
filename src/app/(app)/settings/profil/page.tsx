import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getOrganizationWorkspace } from '@/lib/organizations/administration'
import { getOrganizationProfileWorkspace } from '@/lib/organizations/profileCard'
import TuOrganizationProfileEditor from '@/components/tu/TuOrganizationProfileEditor'
import SettingsNav from '@/components/settings/SettingsNav'

export const dynamic = 'force-dynamic'

export default async function MemberProfilePage({ searchParams }: { searchParams?: Promise<{ orgId?: string | string[] }> }) {
  const params = searchParams ? await searchParams : {}
  let context: Awaited<ReturnType<typeof getOrganizationWorkspace>> | null = null
  let workspace: Awaited<ReturnType<typeof getOrganizationProfileWorkspace>> | null = null
  try {
    context = await getOrganizationWorkspace(params.orgId)
    workspace = await getOrganizationProfileWorkspace({ orgId: context.organization.id, orgName: context.organization.name, profileId: context.profileId, role: context.role })
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') redirect('/login')
  }
  if (!context || !workspace) {
    return <section className="mx-auto max-w-3xl p-8"><h1 className="text-xl font-semibold">Profilen kunde inte öppnas</h1><p className="my-3">Kontrollera att du har ett aktivt medlemskap i den valda organisationen.</p><Link className="underline" href="/settings/organisation">Till organisationsinställningar</Link></section>
  }
  return <div className="mx-auto max-w-6xl space-y-5 px-4 py-6">
      <SettingsNav />
      <header className="rounded-2xl bg-white p-5"><h1 className="text-2xl font-semibold text-slate-950">Min profil i {context.organization.name}</h1><p className="mt-2 text-slate-600">Dina personliga uppgifter på visitkortet. Företagets uppgifter hanteras gemensamt för organisationen. Dessa uppgifter används i TU; ÖB/EB använder tills vidare den tidigare profilvyn.</p><Link className="mt-3 inline-block text-sm text-indigo-700 underline" href="/ob/settings">Tidigare profilvy för ÖB/EB</Link></header>
      <TuOrganizationProfileEditor key={context.organization.id} initialWorkspace={workspace} />
    </div>
}
