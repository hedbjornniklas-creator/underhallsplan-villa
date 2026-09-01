import type { TuGroundingStatus } from '@/lib/tu/grounding'

export const TU_REPORT_REVIEW_UPDATED_EVENT = 'tu-report-review-updated'

export type TuReportReviewStatus =
  | 'queued'
  | 'processing'
  | 'completed'
  | 'applied'
  | 'rejected'
  | 'failed'
  | 'reverted'

export type TuReportReviewSection = {
  sectionId: string
  sectionKey: string
  sectionTitle: string
  beforeText: string
  proposedText: string
  changeReason: string
  sourceObservationIds: string[]
  sourceAnalysisItemIds: string[]
  sourceFieldKeys: string[]
  warnings: string[]
  groundingStatus: TuGroundingStatus
}

export type TuReportReviewInstruction = {
  id: string
  scope: 'section' | 'report'
  targetSectionId: string | null
  targetSectionTitle: string | null
  instruction: string
  status: TuReportReviewStatus
  impactSummary: string | null
  warnings: string[]
  errorMessage: string | null
  progressMessage: string | null
  sections: TuReportReviewSection[]
  createdAt: string
  appliedAt: string | null
  revertedAt: string | null
}

export type TuReportReviewState = {
  current: TuReportReviewInstruction | null
  latestApplied: TuReportReviewInstruction | null
}

export type TuReportReviewResponse = {
  review?: TuReportReviewState
  error?: string
}
