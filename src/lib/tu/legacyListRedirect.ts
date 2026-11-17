export function legacyTuOverviewHref(params: { orgId?: string | string[] }) {
  const query = new URLSearchParams()
  const values = Array.isArray(params.orgId) ? params.orgId : params.orgId === undefined ? [] : [params.orgId]
  for (const value of values) query.append('orgId', value)
  // Preserve invalid/duplicate selections for the overview's existing access checks.
  return `/tu${query.size ? `?${query}` : ''}`
}
