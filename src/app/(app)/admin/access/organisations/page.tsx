import { redirect } from 'next/navigation'
import { requireModuleAccess } from '@/lib/access/server'
import OrganizationAdministrationClient from './OrganizationAdministrationClient'

export default async function OrganizationAdministrationPage() {
  try {
    await requireModuleAccess({ productKey: 'hushub_admin', moduleKey: 'access_management', scopeType: 'global' })
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') redirect('/login')
    return (
      <main className="mx-auto max-w-5xl px-6 py-12">
        <section className="rounded-3xl border border-rose-200 bg-rose-50 p-8 text-rose-900">
          <h1 className="text-2xl font-semibold">Åtkomst nekad</h1>
          <p className="mt-3">Organisationshanteringen kräver global behörighet till HusHub Admins accesshantering.</p>
        </section>
      </main>
    )
  }
  return <OrganizationAdministrationClient />
}
