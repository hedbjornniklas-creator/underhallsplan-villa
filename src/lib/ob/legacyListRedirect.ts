export function legacyObOverviewHref(params: { orgId?: string | string[] }) {
  const query = new URLSearchParams()
  const values = Array.isArray(params.orgId) ? params.orgId : params.orgId === undefined ? [] : [params.orgId]
  for (const value of values) query.append('orgId', value)
  // Keep duplicate/invalid selections visible to the destination's existing access checks.
  return `/ob${query.size ? `?${query}` : ''}`
}
