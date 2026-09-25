export function obPublishedReportHref(inspectionId: string, linkId: string | null) {
  return linkId ? `/ob/inspections/${encodeURIComponent(inspectionId)}/digital?report=${encodeURIComponent(linkId)}` : null
}
