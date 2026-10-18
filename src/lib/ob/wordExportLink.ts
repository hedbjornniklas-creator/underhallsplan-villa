export function obWordExportHref(inspectionId: string, reportId?: string | null, orgId?: string) {
  const query = new URLSearchParams(reportId ? { report: reportId } : { draft: '1' })
  if (orgId) query.set('orgId', orgId)
  return `/api/ob/inspections/${encodeURIComponent(inspectionId)}/word?${query}`
}
