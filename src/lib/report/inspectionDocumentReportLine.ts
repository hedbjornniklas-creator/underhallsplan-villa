export type InspectionDocumentReportLineInput = {
  title?: string | null
  status?: string | null
  note?: string | null
}

export type InspectionDocumentReportLineParts = {
  title: string
  statusText: string
  note: string
  text: string
}

const DOCUMENT_STATUS_GAP = '\u00A0\u00A0\u00A0\u00A0'
const DOCUMENT_STATUS_PATTERN = /(Inte tillhandahållen|Tillhandahållen)(?:\.\s*(.*))?$/u

const trimText = (value: string | null | undefined) => (value ?? '').trim()
const repairDocumentLineText = (value: string) => value.replace(/\u00c3\u00a5/g, '\u00e5')

export function formatInspectionDocumentReportLineParts(
  document: InspectionDocumentReportLineInput
): InspectionDocumentReportLineParts | null {
  const status = trimText(document.status).toLowerCase()
  if (status === 'na') return null

  const title = trimText(document.title) || 'Handling'
  const note = trimText(document.note)
  const statusText = status === 'missing' ? 'Inte tillhandah\u00e5llen' : 'Tillhandah\u00e5llen'
  const line = `${title}${DOCUMENT_STATUS_GAP}${statusText}`

  return {
    title,
    statusText,
    note,
    text: note ? `${line}. ${note}` : line,
  }
}

export function formatInspectionDocumentReportLine(
  document: InspectionDocumentReportLineInput
) {
  return formatInspectionDocumentReportLineParts(document)?.text ?? null
}

export function parseInspectionDocumentReportLine(
  line: string
): InspectionDocumentReportLineParts {
  const text = repairDocumentLineText(trimText(line))
  const match = text.match(DOCUMENT_STATUS_PATTERN)
  if (!match?.index) {
    return { title: text, statusText: '', note: '', text }
  }

  const title = text.slice(0, match.index).trim() || 'Handling'
  return {
    title,
    statusText: match[1] ?? '',
    note: trimText(match[2]),
    text,
  }
}
