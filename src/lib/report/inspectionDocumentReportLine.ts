export type InspectionDocumentReportLineInput = {
  title?: string | null
  status?: string | null
  note?: string | null
}

const DOCUMENT_STATUS_GAP = '\u00A0\u00A0\u00A0\u00A0'

const trimText = (value: string | null | undefined) => (value ?? '').trim()

export function formatInspectionDocumentReportLine(
  document: InspectionDocumentReportLineInput
) {
  const status = trimText(document.status).toLowerCase()
  if (status === 'na') return null

  const title = trimText(document.title) || 'Handling'
  const note = trimText(document.note)
  const statusText = status === 'missing' ? 'Inte tillhandah\u00e5llen' : 'Tillhandah\u00e5llen'
  const line = `${title}${DOCUMENT_STATUS_GAP}${statusText}`

  return note ? `${line}. ${note}` : line
}
