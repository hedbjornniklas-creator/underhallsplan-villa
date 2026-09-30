export type TuReportCoverageSourceType = 'analysis_item' | 'observation' | 'field'

export type TuReportCoverageDisposition =
  | 'already_covered'
  | 'added_to_report'
  | 'intentionally_omitted'
  | 'needs_user_review'

export type TuReportCoverageFinding = {
  sourceType: TuReportCoverageSourceType
  sourceId: string
  disposition: TuReportCoverageDisposition
  targetSectionId: string | null
  reason: string
}

export type TuReportCoverageReview = {
  summary: string
  reviewedAnalysisItemIds: string[]
  reviewedObservationIds: string[]
  reviewedFieldKeys: string[]
  findings: TuReportCoverageFinding[]
}

type JsonRecord = Record<string, unknown>

function cleanText(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function record(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function records(value: unknown) {
  return Array.isArray(value) ? value.map(record) : []
}

function stringArray(value: unknown) {
  if (!Array.isArray(value)) return []
  return [...new Set(value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean))]
}

function sameValues(actual: string[], expected: string[]) {
  if (actual.length !== expected.length) return false
  const actualSet = new Set(actual)
  return expected.every((value) => actualSet.has(value))
}

function isSourceType(value: string): value is TuReportCoverageSourceType {
  return value === 'analysis_item' || value === 'observation' || value === 'field'
}

function isDisposition(value: string): value is TuReportCoverageDisposition {
  return value === 'already_covered'
    || value === 'added_to_report'
    || value === 'intentionally_omitted'
    || value === 'needs_user_review'
}

export function parseTuReportCoverageReview(input: {
  value: unknown
  writerSnapshot: JsonRecord
}): TuReportCoverageReview {
  const parsed = record(input.value)
  const registry = record(input.writerSnapshot.sourceRegistry)
  const expectedAnalysisItemIds = records(registry.analysisItems)
    .map((item) => cleanText(item.id))
    .filter(Boolean)
  const expectedObservationIds = records(registry.observations)
    .map((item) => cleanText(item.id))
    .filter(Boolean)
  const expectedFieldKeys = records(registry.fields)
    .map((item) => cleanText(item.key))
    .filter(Boolean)
  const expectedSectionIds = records(input.writerSnapshot.sections)
    .map((item) => cleanText(record(item.section).id))
    .filter(Boolean)

  const reviewedAnalysisItemIds = stringArray(parsed.reviewedAnalysisItemIds)
  const reviewedObservationIds = stringArray(parsed.reviewedObservationIds)
  const reviewedFieldKeys = stringArray(parsed.reviewedFieldKeys)
  if (
    !cleanText(parsed.summary)
    || !sameValues(reviewedAnalysisItemIds, expectedAnalysisItemIds)
    || !sameValues(reviewedObservationIds, expectedObservationIds)
    || !sameValues(reviewedFieldKeys, expectedFieldKeys)
  ) {
    throw new Error('OPENAI_INCOMPLETE_REPORT_COVERAGE')
  }

  const knownSources = {
    analysis_item: new Set(expectedAnalysisItemIds),
    observation: new Set(expectedObservationIds),
    field: new Set(expectedFieldKeys),
  }
  const knownSections = new Set(expectedSectionIds)
  const findingKeys = new Set<string>()
  const findings = records(parsed.findings).map((finding) => {
    const sourceType = cleanText(finding.sourceType)
    const sourceId = cleanText(finding.sourceId)
    const disposition = cleanText(finding.disposition)
    const targetSectionId = cleanText(finding.targetSectionId) || null
    const reason = cleanText(finding.reason)
    if (
      !isSourceType(sourceType)
      || !isDisposition(disposition)
      || !sourceId
      || !knownSources[sourceType].has(sourceId)
      || (targetSectionId !== null && !knownSections.has(targetSectionId))
      || !reason
    ) {
      throw new Error('OPENAI_INVALID_REPORT_COVERAGE')
    }
    const findingKey = `${sourceType}:${sourceId}`
    if (findingKeys.has(findingKey)) throw new Error('OPENAI_INVALID_REPORT_COVERAGE')
    findingKeys.add(findingKey)
    return { sourceType, sourceId, disposition, targetSectionId, reason }
  })
  const expectedFindingKeys = [
    ...expectedAnalysisItemIds.map((id) => `analysis_item:${id}`),
    ...expectedObservationIds.map((id) => `observation:${id}`),
    ...expectedFieldKeys.map((key) => `field:${key}`),
  ]
  if (!sameValues([...findingKeys], expectedFindingKeys)) {
    throw new Error('OPENAI_INCOMPLETE_REPORT_COVERAGE')
  }

  return {
    summary: cleanText(parsed.summary),
    reviewedAnalysisItemIds: expectedAnalysisItemIds,
    reviewedObservationIds: expectedObservationIds,
    reviewedFieldKeys: expectedFieldKeys,
    findings,
  }
}
