import type {
  TuAnalysisProgressStage,
  TuAnalysisRunStatus,
} from '@/lib/tu/analysis'
import type { TuGroundingStatus } from '@/lib/tu/grounding'

export const TU_REPORT_DRAFT_UPDATED_EVENT = 'tu-report-draft-updated'

export type TuWholeReportDraftRun = {
  id: string
  status: TuAnalysisRunStatus
  model: string
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

export type TuWholeReportDraftSection = {
  id: string
  runId: string
  targetSectionId: string
  targetSectionKey: string
  targetSectionTitle: string
  proposedText: string
  status: 'pending' | 'accepted' | 'rejected'
  sourceObservationIds: string[]
  sourceAnalysisItemIds: string[]
  sourceFieldKeys: string[]
  warnings: string[]
  groundingStatus: TuGroundingStatus
  applicationMode: 'replace' | 'append' | null
  createdAt: string
  updatedAt: string
}

export type TuWholeReportDraftAction = {
  id: string
  kind: 'measurement_metadata'
  observationId: string
  measurementId: string
  title: string
  detail: string
  missingFields: string[]
}

export type TuWholeReportDraftState = {
  run: TuWholeReportDraftRun | null
  sections: TuWholeReportDraftSection[]
  actions: TuWholeReportDraftAction[]
}

export type TuWholeReportDraftResponse = {
  draft?: TuWholeReportDraftState
  section?: TuWholeReportDraftSection
  error?: string
}
