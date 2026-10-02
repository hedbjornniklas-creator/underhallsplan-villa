import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

export default async function TuOrganizationProfilePage({ searchParams }: {
  searchParams?: Promise<{ orgId?: string | string[] }>
}) {
  const params = searchParams ? await searchParams : {}
  const query = new URLSearchParams()
  // Preserve invalid/duplicate selections for the destination's strict validator.
  for (const id of Array.isArray(params.orgId) ? params.orgId : params.orgId === undefined ? [] : [params.orgId]) query.append('orgId', id)
  redirect(`/settings/profil${query.size ? `?${query}` : ''}`)
}
