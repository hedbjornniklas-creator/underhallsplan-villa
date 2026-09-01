import 'server-only'

import {
  validateTuGroundedSections,
  type TuGeneratedGroundedSection,
} from '@/lib/tu/grounding'

type JsonRecord = Record<string, unknown>

function cleanText(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function stringArray(value: unknown) {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
}

function record(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

export function validateTuReportSections(input: {
  snapshot: JsonRecord
  expectedSectionIds: string[]
  generatedSections: TuGeneratedGroundedSection[]
}) {
  const approvedAnalysis = record(input.snapshot.approvedAnalysis)
  const analysisItems = Array.isArray(approvedAnalysis.items)
    ? approvedAnalysis.items.map(record)
    : []
  const resolvedConflicts = Array.isArray(approvedAnalysis.resolvedConflicts)
    ? approvedAnalysis.resolvedConflicts.map(record)
    : []
  const allAnalysisItems = [...analysisItems, ...resolvedConflicts]
  const validAnalysisItemIds = new Set(
    allAnalysisItems.map((item) => cleanText(item.id)).filter(Boolean)
  )

  const evidence = record(input.snapshot.evidence)
  const observations = Array.isArray(evidence.observations)
    ? evidence.observations.map(record)
    : []
  const validObservationIds = new Set(
    observations.map((observation) => cleanText(observation.id)).filter(Boolean)
  )

  const sourceFields = Array.isArray(input.snapshot.sourceFields)
    ? input.snapshot.sourceFields.map(record)
    : []
  const validFieldKeys = new Set(
    sourceFields.map((field) => cleanText(field.key)).filter(Boolean)
  )

  const analysisSourceTextById = new Map<string, string>()
  for (const item of allAnalysisItems) {
    const id = cleanText(item.id)
    if (!id) continue
    analysisSourceTextById.set(id, [
      cleanText(item.title),
      cleanText(item.summary),
      ...stringArray(item.supporting_reasons),
      ...stringArray(item.contradicting_reasons),
    ].filter(Boolean).join('\n'))
  }

  const observationSourceTextById = new Map<string, string>()
  for (const observation of observations) {
    const id = cleanText(observation.id)
    if (!id) continue
    observationSourceTextById.set(id, [
      cleanText(observation.noteText),
      cleanText(observation.transcriptText),
      cleanText(observation.riskNote),
      cleanText(observation.suggestedFollowUp),
      ...(Array.isArray(observation.measurements)
        ? observation.measurements.map(record).flatMap((measurement) => [
            cleanText(measurement.location) ? `Mätplats: ${cleanText(measurement.location)}` : '',
            cleanText(measurement.type) ? `Mättyp: ${cleanText(measurement.type)}` : '',
            cleanText(measurement.value) ? `Mätvärde: ${cleanText(measurement.value)}` : '',
            cleanText(measurement.unit) ? `Enhet: ${cleanText(measurement.unit)}` : '',
            cleanText(measurement.method) ? `Metod: ${cleanText(measurement.method)}` : '',
            cleanText(measurement.instrument) ? `Instrument: ${cleanText(measurement.instrument)}` : '',
            cleanText(measurement.note) ? `Mätkommentar: ${cleanText(measurement.note)}` : '',
          ])
        : []),
    ].filter(Boolean).join('\n'))
  }

  const fieldSourceTextByKey = new Map<string, string>()
  for (const field of sourceFields) {
    const key = cleanText(field.key)
    if (key) fieldSourceTextByKey.set(key, cleanText(field.value))
  }

  const currentAssessmentTexts = analysisItems
    .filter((item) => cleanText(item.item_type) === 'current_assessment')
    .flatMap((item) => [cleanText(item.title), cleanText(item.summary)])
    .filter(Boolean)
  const currentAssessmentIds = analysisItems
    .filter((item) => cleanText(item.item_type) === 'current_assessment')
    .map((item) => cleanText(item.id))
    .filter(Boolean)
  const conflictResolutionAnalysisIdsByObservation = new Map<string, Set<string>>()
  for (const conflict of resolvedConflicts) {
    const conflictId = cleanText(conflict.id)
    if (!conflictId) continue
    for (const observationId of stringArray(conflict.earlier_source_observation_ids)) {
      const resolutions = conflictResolutionAnalysisIdsByObservation.get(observationId)
        ?? new Set<string>()
      resolutions.add(conflictId)
      currentAssessmentIds.forEach((id) => resolutions.add(id))
      conflictResolutionAnalysisIdsByObservation.set(observationId, resolutions)
    }
  }

  return validateTuGroundedSections({
    expectedSectionIds: input.expectedSectionIds,
    generatedSections: input.generatedSections,
    validAnalysisItemIds,
    validObservationIds,
    validFieldKeys,
    analysisSourceTextById,
    observationSourceTextById,
    fieldSourceTextByKey,
    currentAssessmentTexts,
    conflictResolutionAnalysisIdsByObservation,
  })
}
