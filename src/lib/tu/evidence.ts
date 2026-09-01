export const TU_MOISTURE_DAMAGE_TEMPLATE_KEY = 'moisture_damage_investigation'

export function isTuAnalysisSourceImage(image: { sectionKey: string }) {
  return image.sectionKey !== 'cover'
}

export type TuObservationSourceType = 'typed' | 'voice' | 'mixed'
export type TuObservationCertainty = 'confirmed' | 'probable' | 'uncertain'
export type TuObservationReviewStatus = 'draft' | 'reviewed'
export type TuAiSuggestionStatus = 'pending' | 'accepted' | 'rejected'

export type TuMeasurement = {
  id: string
  observationId: string | null
  location: string | null
  measurementType: string
  valueText: string
  unit: string | null
  method: string | null
  instrument: string | null
  note: string | null
  measuredAt: string
  createdAt: string
  updatedAt: string
}

export type TuObservation = {
  id: string
  sourceType: TuObservationSourceType
  location: string | null
  buildingComponent: string | null
  noteText: string
  transcriptText: string | null
  riskNote: string | null
  suggestedFollowUp: string | null
  certainty: TuObservationCertainty
  reviewStatus: TuObservationReviewStatus
  targetSectionId: string | null
  includeInReport: boolean
  imageIds: string[]
  measurements: TuMeasurement[]
  audioStorageBucket: string | null
  audioStoragePath: string | null
  audioContentType: string | null
  audioDurationSeconds: number | null
  observedAt: string
  createdAt: string
  updatedAt: string
}

export type TuEvidenceAiSuggestion = {
  id: string
  runId: string
  targetSectionId: string
  targetSectionKey: string
  targetSectionTitle: string
  proposedText: string
  status: TuAiSuggestionStatus
  sourceObservationIds: string[]
  warnings: string[]
  applicationMode: 'append' | 'replace' | null
  createdAt: string
  updatedAt: string
}

export type TuEvidenceResponse = {
  observations?: TuObservation[]
  observation?: TuObservation
  suggestion?: TuEvidenceAiSuggestion
  error?: string
}

export function isTuObservationSourceType(value: unknown): value is TuObservationSourceType {
  return value === 'typed' || value === 'voice' || value === 'mixed'
}

export function isTuObservationCertainty(value: unknown): value is TuObservationCertainty {
  return value === 'confirmed' || value === 'probable' || value === 'uncertain'
}

export function isTuObservationReviewStatus(value: unknown): value is TuObservationReviewStatus {
  return value === 'draft' || value === 'reviewed'
}

export function isTuAiSuggestionStatus(value: unknown): value is TuAiSuggestionStatus {
  return value === 'pending' || value === 'accepted' || value === 'rejected'
}
