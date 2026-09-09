import type { TuAnalysisRunStatus } from '@/lib/tu/analysis'

export const TU_CONTROL_PLAN_UPDATED_EVENT = 'tu:control-plan-updated'

export type TuPostDamageCaseStatus = 'draft' | 'plan_processing' | 'plan_ready' | 'plan_approved'
export type TuDamageType =
  | 'fire_smoke'
  | 'moisture_water'
  | 'microbial'
  | 'ventilation'
  | 'structure'
  | 'installation'
  | 'other'
export type TuRemediationStage =
  | 'after_demolition'
  | 'after_remediation'
  | 'before_restoration'
  | 'after_completion'
  | 'other'
export type TuVerificationItemType =
  | 'prior_observation'
  | 'recommendation'
  | 'agreed_measure'
  | 'completion_claim'
  | 'measurement_requirement'
  | 'other'
export type TuVerificationReviewStatus = 'pending' | 'accepted' | 'rejected'
export type TuVerificationStatus =
  | 'not_checked'
  | 'verified'
  | 'consistent'
  | 'reported_not_verifiable'
  | 'partially_verified'
  | 'remaining_condition'
  | 'inaccessible'
  | 'not_applicable'
export type TuVerificationPriority = 'high' | 'normal' | 'low'

export type TuControlPlanSourceReference = {
  documentId: string
  page: number | null
  excerpt: string
}

export type TuControlPlanRun = {
  id: string
  status: TuAnalysisRunStatus
  model: string
  errorMessage: string | null
  progressStage: string | null
  progressMessage: string | null
  createdAt: string | null
  startedAt: string | null
  completedAt: string | null
}

export type TuVerificationItem = {
  id: string
  runId: string
  itemType: TuVerificationItemType
  category: string
  title: string
  description: string
  verificationMethod: string | null
  sourceReferences: TuControlPlanSourceReference[]
  priority: TuVerificationPriority
  reviewStatus: TuVerificationReviewStatus
  verificationStatus: TuVerificationStatus
  needsFollowUp: boolean
  inspectorNote: string | null
  observationIds: string[]
  sortOrder: number
  reviewedAt: string | null
  createdAt: string | null
  updatedAt: string | null
}

export type TuPostDamageCase = {
  damageTypes: TuDamageType[]
  remediationStage: TuRemediationStage | null
  mainQuestion: string | null
  status: TuPostDamageCaseStatus
  currentPlanRunId: string | null
  overview: string | null
  sourceSummary: string | null
  conflicts: string[]
  essentialQuestions: string[]
  planStaleAt: string | null
  planApprovedAt: string | null
}

export type TuControlPlanState = {
  case: TuPostDamageCase
  run: TuControlPlanRun | null
  items: TuVerificationItem[]
  sourceDocumentCount: number
  readableSourceDocumentCount: number
}

export type TuControlPlanResponse = {
  preparation?: TuControlPlanState
  item?: TuVerificationItem
  error?: string
}

export type TuControlPlanReviewSummary = {
  accepted: number
  rejected: number
  pending: number
  canApprove: boolean
}

export function summarizeTuControlPlanReview(
  items: Array<Pick<TuVerificationItem, 'reviewStatus'>>
): TuControlPlanReviewSummary {
  const summary = items.reduce(
    (current, item) => {
      current[item.reviewStatus] += 1
      return current
    },
    { accepted: 0, rejected: 0, pending: 0 }
  )

  return {
    ...summary,
    canApprove: summary.pending === 0 && summary.accepted > 0,
  }
}

export const TU_DAMAGE_TYPE_OPTIONS: Array<{ value: TuDamageType; label: string }> = [
  { value: 'fire_smoke', label: 'Brand och rök' },
  { value: 'moisture_water', label: 'Fukt och vatten' },
  { value: 'microbial', label: 'Mikrobiell skada' },
  { value: 'ventilation', label: 'Ventilation' },
  { value: 'structure', label: 'Konstruktion' },
  { value: 'installation', label: 'Installation' },
  { value: 'other', label: 'Annat' },
]

export const TU_REMEDIATION_STAGE_OPTIONS: Array<{ value: TuRemediationStage; label: string }> = [
  { value: 'after_demolition', label: 'Efter rivning' },
  { value: 'after_remediation', label: 'Efter sanering eller uttorkning' },
  { value: 'before_restoration', label: 'Före återställning' },
  { value: 'after_completion', label: 'Efter färdigställande' },
  { value: 'other', label: 'Annat skede' },
]

export const TU_VERIFICATION_STATUS_OPTIONS: Array<{ value: TuVerificationStatus; label: string }> = [
  { value: 'not_checked', label: 'Inte kontrollerad' },
  { value: 'verified', label: 'Verifierad' },
  { value: 'consistent', label: 'Förenlig med synligt utförande' },
  { value: 'reported_not_verifiable', label: 'Uppges utförd, kan inte verifieras' },
  { value: 'partially_verified', label: 'Delvis verifierad' },
  { value: 'remaining_condition', label: 'Kvarstående förhållande' },
  { value: 'inaccessible', label: 'Inte åtkomlig' },
  { value: 'not_applicable', label: 'Inte aktuell' },
]

export function isTuDamageType(value: unknown): value is TuDamageType {
  return TU_DAMAGE_TYPE_OPTIONS.some((option) => option.value === value)
}

export function isTuRemediationStage(value: unknown): value is TuRemediationStage {
  return TU_REMEDIATION_STAGE_OPTIONS.some((option) => option.value === value)
}

export function isTuVerificationItemType(value: unknown): value is TuVerificationItemType {
  return [
    'prior_observation',
    'recommendation',
    'agreed_measure',
    'completion_claim',
    'measurement_requirement',
    'other',
  ].includes(String(value))
}

export function isTuVerificationReviewStatus(value: unknown): value is TuVerificationReviewStatus {
  return value === 'pending' || value === 'accepted' || value === 'rejected'
}

export function isTuVerificationStatus(value: unknown): value is TuVerificationStatus {
  return TU_VERIFICATION_STATUS_OPTIONS.some((option) => option.value === value)
}

export function isTuVerificationPriority(value: unknown): value is TuVerificationPriority {
  return value === 'high' || value === 'normal' || value === 'low'
}
