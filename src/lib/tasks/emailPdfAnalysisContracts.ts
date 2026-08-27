export const TASK_EMAIL_PDF_MAX_MEGABYTES = 4
export const TASK_EMAIL_PDF_MAX_BYTES = TASK_EMAIL_PDF_MAX_MEGABYTES * 1024 * 1024
export const TASK_EMAIL_PDF_MAX_SUBTASKS = 5
export const TASK_EMAIL_PDF_INSTRUCTION_MAX_LENGTH = 1200

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

export type TaskEmailPdfMainTask = {
  title: string
  description: string
  contextLabel: string
  taskKind: TaskEmailPdfTaskKind
  evidenceRequirements: TaskEmailPdfEvidenceRequirement[]
  sourcePages: number[]
}

export type TaskEmailPdfSubtask = {
  title: string
  description: string
  rationale: string
  sourcePages: number[]
}

export type TaskEmailPdfAnalysis = {
  summary: string
  mainTask: TaskEmailPdfMainTask
  subtasks: TaskEmailPdfSubtask[]
  missingInformation: string[]
  warnings: string[]
}
