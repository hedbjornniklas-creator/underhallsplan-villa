const REPORT_LABEL = 'Utl\u00e5tande'

function sanitizeFilenamePart(value: string | null | undefined) {
  const raw = String(value ?? '').trim()
  if (!raw || raw === '--') return ''
  return raw.replace(/[\\/:*?"<>|]/g, '-').replace(/\s+/g, ' ').trim()
}

function reportModuleLabel(family: string | null | undefined) {
  const normalized = String(family ?? '').trim().toUpperCase()
  if (normalized === 'TU') return 'TU'
  if (normalized === 'EB') return 'EB'
  if (normalized === 'UHP') return 'UHP'
  return '\u00d6B'
}

export function buildReportPdfFileName(input: {
  assignmentNumber?: string | null
  inspectionDate?: string | null
  inspectionFamily?: string | null
}) {
  const moduleLabel = reportModuleLabel(input.inspectionFamily)
  const safeAssignmentNumber = sanitizeFilenamePart(input.assignmentNumber)
  if (safeAssignmentNumber) return `${REPORT_LABEL} ${moduleLabel} ${safeAssignmentNumber}.pdf`

  const safeDate = sanitizeFilenamePart(input.inspectionDate)
  return safeDate ? `${REPORT_LABEL} ${moduleLabel} ${safeDate}.pdf` : `${REPORT_LABEL} ${moduleLabel}.pdf`
}
