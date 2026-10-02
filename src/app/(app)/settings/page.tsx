import { redirect } from 'next/navigation'

export default async function SharedBesiktAppSettingsPage({ searchParams }: { searchParams?: Promise<{ orgId?: string | string[]; fortnox?: string | string[] }> }) {
  const params = searchParams ? await searchParams : {}
  // Keep the supplied selection, including an invalid one for the destination
  // to reject; never silently replace it with another organization.
  const query = new URLSearchParams()
  if (Array.isArray(params.orgId)) params.orgId.forEach(value => query.append('orgId', value))
  else if (params.orgId !== undefined) query.set('orgId', params.orgId)
  // OAuth returns to this stable URL. Preserve its result and open the
  // integration panel; do not drop the callback notice during navigation.
  if (params.fortnox !== undefined) {
    for (const value of Array.isArray(params.fortnox) ? params.fortnox : [params.fortnox]) query.append('fortnox', value)
    query.set('tab', 'integrations')
  }
  redirect(`/settings/organisation${query.size ? `?${query}` : ''}`)
}
