export type TuReportEditorialSectionPlan = {
  sectionId: string
  include: boolean
  purpose: string
  selectedAnalysisItemIds: string[]
  selectedObservationIds: string[]
  selectedFieldKeys: string[]
  internalWarnings: string[]
}

export type TuReportEditorialPlan = {
  focus: string
  scopeBoundary: string
  internalWarnings: string[]
  sections: TuReportEditorialSectionPlan[]
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

function assertKnownValues(values: string[], known: Set<string>) {
  if (values.some((value) => !known.has(value))) {
    throw new Error('OPENAI_INVALID_REPORT_EDITORIAL_PLAN')
  }
}

export function parseTuReportEditorialPlan(input: {
  value: unknown
  snapshot: JsonRecord
}): TuReportEditorialPlan {
  const parsed = record(input.value)
  const expectedSectionIds = records(input.snapshot.sections)
    .map((section) => cleanText(section.id))
    .filter(Boolean)
  const approvedAnalysis = record(input.snapshot.approvedAnalysis)
  const analysisItemIds = new Set([
    ...records(approvedAnalysis.items),
    ...records(approvedAnalysis.resolvedConflicts),
  ].map((item) => cleanText(item.id)).filter(Boolean))
  const evidence = record(input.snapshot.evidence)
  const observationIds = new Set(
    records(evidence.observations).map((item) => cleanText(item.id)).filter(Boolean)
  )
  const fieldKeys = new Set(
    records(input.snapshot.sourceFields).map((item) => cleanText(item.key)).filter(Boolean)
  )

  const sections = records(parsed.sections).map((section) => {
    const sectionId = cleanText(section.sectionId)
    const selectedAnalysisItemIds = stringArray(section.selectedAnalysisItemIds)
    const selectedObservationIds = stringArray(section.selectedObservationIds)
    const selectedFieldKeys = stringArray(section.selectedFieldKeys)
    assertKnownValues(selectedAnalysisItemIds, analysisItemIds)
    assertKnownValues(selectedObservationIds, observationIds)
    assertKnownValues(selectedFieldKeys, fieldKeys)
    return {
      sectionId,
      include: section.include === true,
      purpose: cleanText(section.purpose),
      selectedAnalysisItemIds,
      selectedObservationIds,
      selectedFieldKeys,
      internalWarnings: stringArray(section.internalWarnings),
    }
  })
  const sectionIds = sections.map((section) => section.sectionId)
  if (
    !cleanText(parsed.focus)
    || sections.length !== expectedSectionIds.length
    || new Set(sectionIds).size !== sectionIds.length
    || expectedSectionIds.some((sectionId) => !sectionIds.includes(sectionId))
    || sectionIds.some((sectionId) => !expectedSectionIds.includes(sectionId))
    || sections.some((section) => section.include && (
      !section.purpose
      || (
        section.selectedAnalysisItemIds.length === 0
        && section.selectedObservationIds.length === 0
        && section.selectedFieldKeys.length === 0
      )
    ))
  ) {
    throw new Error('OPENAI_INVALID_REPORT_EDITORIAL_PLAN')
  }

  return {
    focus: cleanText(parsed.focus),
    scopeBoundary: cleanText(parsed.scopeBoundary),
    internalWarnings: stringArray(parsed.internalWarnings),
    sections: expectedSectionIds.map((sectionId) => (
      sections.find((section) => section.sectionId === sectionId)!
    )),
  }
}

export function buildTuReportWriterSnapshot(input: {
  snapshot: JsonRecord
  plan: TuReportEditorialPlan
}) {
  const approvedAnalysis = record(input.snapshot.approvedAnalysis)
  const analysisItems = [
    ...records(approvedAnalysis.items),
    ...records(approvedAnalysis.resolvedConflicts),
  ]
  const evidence = record(input.snapshot.evidence)
  const observations = records(evidence.observations)
  const images = records(evidence.images)
  const fields = records(input.snapshot.sourceFields)
  const sectionsById = new Map(
    records(input.snapshot.sections).map((section) => [cleanText(section.id), section])
  )

  return {
    ruleset: input.snapshot.ruleset,
    reportTemplate: input.snapshot.reportTemplate,
    editorialFocus: input.plan.focus,
    scopeBoundary: input.plan.scopeBoundary,
    sections: input.plan.sections.map((sectionPlan) => {
      const section = sectionsById.get(sectionPlan.sectionId) ?? {}
      const selectedAnalysisItems = analysisItems.filter((item) => (
        sectionPlan.selectedAnalysisItemIds.includes(cleanText(item.id))
      ))
      const selectedObservations = observations.filter((observation) => (
        sectionPlan.selectedObservationIds.includes(cleanText(observation.id))
      ))
      const selectedFields = fields.filter((field) => (
        sectionPlan.selectedFieldKeys.includes(cleanText(field.key))
      ))
      const selectedImageIds = new Set([
        ...selectedAnalysisItems.flatMap((item) => stringArray(item.source_image_ids)),
        ...selectedObservations.flatMap((observation) => stringArray(observation.imageIds)),
      ])

      return {
        section,
        editorialPurpose: sectionPlan.purpose,
        include: sectionPlan.include,
        selectedSources: {
          analysisItems: selectedAnalysisItems,
          observations: selectedObservations,
          fields: selectedFields,
          images: images.filter((image) => selectedImageIds.has(cleanText(image.id))),
        },
      }
    }),
  }
}
