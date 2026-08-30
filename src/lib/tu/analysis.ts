import type { TuEvidenceAiSuggestion } from '@/lib/tu/evidence'

export type TuAnalysisWorkflowStatus =
  | 'in_progress'
  | 'analysis_processing'
  | 'analysis_ready'
  | 'analysis_approved'

export type TuAnalysisRunStatus = 'queued' | 'processing' | 'completed' | 'failed' | 'cancelled'

export type TuAnalysisProgressStage =
  | 'queued'
  | 'preparing'
  | 'analyzing_images'
  | 'synthesizing'
  | 'saving'
  | 'completed'
  | 'failed'
  | 'cancelled'

export const TU_ANALYSIS_UPDATED_EVENT = 'tu-analysis-updated'

export type TuAnalysisItemType =
  | 'verified_observation'
  | 'party_statement'
  | 'measurement'
  | 'image_observation'
  | 'technical_hypothesis'
  | 'information_gap'
  | 'recommended_follow_up'
  | 'report_image'

export type TuAnalysisReviewStatus = 'pending' | 'accepted' | 'rejected'
export type TuAnalysisCertainty = 'confirmed' | 'probable' | 'uncertain'

export type TuAnalysisValidation = {
  observationCount: number
  unreviewedObservationCount: number
  imageCount: number
  measurementCount: number
  unlinkedImageCount: number
  emptyObservationCount: number
  warnings: string[]
  canComplete: boolean
}

export type TuAnalysisItem = {
  id: string
  runId: string
  itemType: TuAnalysisItemType
  title: string
  summary: string
  certainty: TuAnalysisCertainty
  reviewStatus: TuAnalysisReviewStatus
  targetSectionId: string | null
  includeInReport: boolean
  sourceObservationIds: string[]
  sourceImageIds: string[]
  sourceMeasurementIds: string[]
  supportingReasons: string[]
  contradictingReasons: string[]
  warnings: string[]
  sortOrder: number
  createdAt: string
  updatedAt: string
}

export type TuAnalysisRun = {
  id: string
  status: TuAnalysisRunStatus
  model: string
  rulesetKey: string
  rulesetVersion: number
  attemptCount: number
  errorMessage: string | null
  progressStage: TuAnalysisProgressStage
  progressCurrent: number
  progressTotal: number
  progressMessage: string | null
  heartbeatAt: string | null
  overview: string | null
  warnings: string[]
  createdAt: string
  startedAt: string | null
  completedAt: string | null
}

export function isTuAnalysisProgressStage(value: unknown): value is TuAnalysisProgressStage {
  return (
    value === 'queued'
    || value === 'preparing'
    || value === 'analyzing_images'
    || value === 'synthesizing'
    || value === 'saving'
    || value === 'completed'
    || value === 'failed'
    || value === 'cancelled'
  )
}

export function getTuAnalysisProgressStep(run: TuAnalysisRun | null | undefined) {
  switch (run?.progressStage) {
    case 'analyzing_images':
      return { current: 2, total: 4, label: 'Bildanalys' }
    case 'synthesizing':
      return { current: 3, total: 4, label: 'Samlad bedömning' }
    case 'saving':
    case 'completed':
      return { current: 4, total: 4, label: run.progressStage === 'saving' ? 'Sparar resultat' : 'Klar' }
    case 'failed':
      return { current: 4, total: 4, label: 'Avbruten' }
    case 'cancelled':
      return { current: 4, total: 4, label: 'Avbruten' }
    case 'queued':
    case 'preparing':
    default:
      return { current: 1, total: 4, label: run?.progressStage === 'preparing' ? 'Förbereder underlag' : 'Väntar på start' }
  }
}

export function getTuAnalysisProgressMessage(run: TuAnalysisRun | null | undefined) {
  if (run?.progressMessage) return run.progressMessage
  switch (run?.progressStage) {
    case 'preparing':
      return 'Förbereder observationer, mätvärden och bilder.'
    case 'analyzing_images':
      return run.progressTotal > 0
        ? `Analyserar bilder ${run.progressCurrent} av ${run.progressTotal}.`
        : 'Analyserar bilder.'
    case 'synthesizing':
      return 'Sammanställer hela besiktningsunderlaget.'
    case 'saving':
      return 'Sparar analysresultatet för granskning.'
    case 'completed':
      return 'Analysen är klar för granskning.'
    case 'failed':
      return 'Analysen kunde inte slutföras.'
    case 'cancelled':
      return 'Analysen avbröts eftersom underlaget ändrades.'
    case 'queued':
    default:
      return 'Analysen väntar på att starta.'
  }
}

export type TuAnalysisWorkflow = {
  status: TuAnalysisWorkflowStatus
  fieldworkCompletedAt: string | null
  analysisApprovedAt: string | null
  analysisStaleAt: string | null
  run: TuAnalysisRun | null
  items: TuAnalysisItem[]
}

export type TuAnalysisResponse = {
  workflow?: TuAnalysisWorkflow
  validation?: TuAnalysisValidation
  item?: TuAnalysisItem
  suggestion?: TuEvidenceAiSuggestion
  error?: string
}

export function isTuAnalysisWorkflowStatus(value: unknown): value is TuAnalysisWorkflowStatus {
  return (
    value === 'in_progress'
    || value === 'analysis_processing'
    || value === 'analysis_ready'
    || value === 'analysis_approved'
  )
}

export function isTuAnalysisRunStatus(value: unknown): value is TuAnalysisRunStatus {
  return (
    value === 'queued'
    || value === 'processing'
    || value === 'completed'
    || value === 'failed'
    || value === 'cancelled'
  )
}

export function isTuAnalysisItemType(value: unknown): value is TuAnalysisItemType {
  return (
    value === 'verified_observation'
    || value === 'party_statement'
    || value === 'measurement'
    || value === 'image_observation'
    || value === 'technical_hypothesis'
    || value === 'information_gap'
    || value === 'recommended_follow_up'
    || value === 'report_image'
  )
}

export function isTuAnalysisReviewStatus(value: unknown): value is TuAnalysisReviewStatus {
  return value === 'pending' || value === 'accepted' || value === 'rejected'
}

export function isTuAnalysisCertainty(value: unknown): value is TuAnalysisCertainty {
  return value === 'confirmed' || value === 'probable' || value === 'uncertain'
}
