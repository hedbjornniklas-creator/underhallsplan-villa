import { redirect } from 'next/navigation'
import AdminLandingClient from './AdminLandingClient'

type AdminPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>> | Record<string, string | string[] | undefined>
}

export default async function AdminPage({ searchParams }: AdminPageProps) {
  const resolvedSearchParams = await Promise.resolve(searchParams ?? {})
  const rawTab = resolvedSearchParams.tab
  const tab = Array.isArray(rawTab) ? rawTab[0] : rawTab

  if (tab) {
    redirect(`/admin/besiktapp?tab=${encodeURIComponent(tab)}`)
  }

  return <AdminLandingClient />
}
