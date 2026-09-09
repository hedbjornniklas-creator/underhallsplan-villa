export type TuDocumentAnalysisSourceRole =
  | 'prior_report'
  | 'agreed_scope'
  | 'completion_record'
  | 'measurement_record'
  | 'other'

export type TuInvestigationDocument = {
  id: string
  inspectionId: string
  orgId: string
  storageBucket: string
  filePath: string
  fileName: string | null
  title: string | null
  contentType: string | null
  fileSizeBytes: number | null
  includeInDelivery: boolean
  useInAnalysis: boolean
  analysisSourceRole: TuDocumentAnalysisSourceRole
  sourceParty: string | null
  documentDate: string | null
  uploadedBy: string | null
  createdAt: string | null
  updatedAt: string | null
  signedUrl: string | null
}

export const TU_DOCUMENT_SOURCE_ROLE_OPTIONS: Array<{
  value: TuDocumentAnalysisSourceRole
  label: string
}> = [
  { value: 'prior_report', label: 'Tidigare utlåtande' },
  { value: 'agreed_scope', label: 'Beställning eller avtalad omfattning' },
  { value: 'completion_record', label: 'Redovisning av utförd åtgärd' },
  { value: 'measurement_record', label: 'Mätprotokoll' },
  { value: 'other', label: 'Annat underlag' },
]

export function isTuDocumentAnalysisSourceRole(
  value: unknown
): value is TuDocumentAnalysisSourceRole {
  return TU_DOCUMENT_SOURCE_ROLE_OPTIONS.some((option) => option.value === value)
}

export function tuDocumentAnalysisSourceRoleLabel(value: TuDocumentAnalysisSourceRole) {
  return TU_DOCUMENT_SOURCE_ROLE_OPTIONS.find((option) => option.value === value)?.label
    ?? 'Annat underlag'
}

export function isTuDocumentAiReadable(document: Pick<TuInvestigationDocument, 'contentType' | 'fileName'>) {
  const type = document.contentType?.trim().toLowerCase() ?? ''
  const name = document.fileName?.trim().toLowerCase() ?? ''
  return type === 'application/pdf' || type === 'text/plain' || name.endsWith('.pdf') || name.endsWith('.txt')
}
