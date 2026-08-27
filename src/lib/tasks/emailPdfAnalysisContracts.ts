export const TASK_EMAIL_PDF_MAX_MEGABYTES = 4
export const TASK_EMAIL_PDF_MAX_BYTES = TASK_EMAIL_PDF_MAX_MEGABYTES * 1024 * 1024
export const TASK_EMAIL_PDF_MAX_SUBTASKS = 10
export const TASK_EMAIL_PDF_INSTRUCTION_MAX_LENGTH = 1200

export const TASK_EMAIL_PDF_DOCUMENT_TYPES = [
  'email',
  'meeting_minutes',
  'inspection_report',
  'other',
] as const

export const TASK_EMAIL_PDF_DOCUMENT_TYPE_HINTS = [
  'auto',
  ...TASK_EMAIL_PDF_DOCUMENT_TYPES,
] as const

export const TASK_EMAIL_PDF_ANALYSIS_MODES = [
  'explicit',
  'recommended',
  'exploratory',
] as const

export const TASK_EMAIL_PDF_TASK_BASES = [
  'explicit',
  'recommendation',
  'ai_suggestion',
] as const

export const TASK_EMAIL_PDF_DOCUMENT_TYPE_CONFIDENCES = [
  'high',
  'medium',
  'low',
] as const

export const TASK_EMAIL_PDF_TASK_KINDS = [
  'simple',
  'paid_external',
  'warranty',
  'general',
] as const

export const TASK_EMAIL_PDF_EVIDENCE_REQUIREMENTS = [
  'photo',
  'document',
  'text',
] as const

export type TaskEmailPdfTaskKind = (typeof TASK_EMAIL_PDF_TASK_KINDS)[number]
export type TaskEmailPdfEvidenceRequirement =
  (typeof TASK_EMAIL_PDF_EVIDENCE_REQUIREMENTS)[number]
export type TaskEmailPdfDocumentType = (typeof TASK_EMAIL_PDF_DOCUMENT_TYPES)[number]
export type TaskEmailPdfDocumentTypeHint = (typeof TASK_EMAIL_PDF_DOCUMENT_TYPE_HINTS)[number]
export type TaskEmailPdfAnalysisMode = (typeof TASK_EMAIL_PDF_ANALYSIS_MODES)[number]
export type TaskEmailPdfTaskBasis = (typeof TASK_EMAIL_PDF_TASK_BASES)[number]
export type TaskEmailPdfDocumentTypeConfidence =
  (typeof TASK_EMAIL_PDF_DOCUMENT_TYPE_CONFIDENCES)[number]

export type TaskEmailPdfSourceItem = {
  text: string
  sourceExcerpt: string
  sourcePages: number[]
}

export type TaskEmailPdfMainTask = {
  title: string
  description: string
  contextLabel: string
  taskKind: TaskEmailPdfTaskKind
  evidenceRequirements: TaskEmailPdfEvidenceRequirement[]
  sourceExcerpt: string
  sourcePages: number[]
}

export type TaskEmailPdfSubtask = {
  title: string
  description: string
  checklist: string[]
  basis: TaskEmailPdfTaskBasis
  responsibleParty: string
  dueText: string
  sourceExcerpt: string
  sourcePages: number[]
}

export type TaskEmailPdfAnalysis = {
  analysisMode: TaskEmailPdfAnalysisMode
  documentType: TaskEmailPdfDocumentType
  documentTypeConfidence: TaskEmailPdfDocumentTypeConfidence
  hasMoreActions: boolean
  summary: string
  mainTask: TaskEmailPdfMainTask
  subtasks: TaskEmailPdfSubtask[]
  decisions: TaskEmailPdfSourceItem[]
  observations: TaskEmailPdfSourceItem[]
  missingInformation: string[]
  warnings: string[]
}
