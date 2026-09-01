export type TuChronologicalEvidence = {
  id: string
  observedAt: string
}

export type TuGeneratedParagraph = {
  text: string
  sourceAnalysisItemIds: string[]
  sourceObservationIds: string[]
  sourceFieldKeys: string[]
  warnings: string[]
}

export type TuGeneratedGroundedSection = {
  sectionId: string
  paragraphs: TuGeneratedParagraph[]
  warnings: string[]
}

export type TuGroundingStatus = 'grounded' | 'needs_source' | 'blocked' | 'manually_edited'

export type TuValidatedGroundedSection = {
  sectionId: string
  text: string
  sourceAnalysisItemIds: string[]
  sourceObservationIds: string[]
  sourceFieldKeys: string[]
  warnings: string[]
  groundingStatus: TuGroundingStatus
}

function cleanText(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

export function sortTuEvidenceChronologically<T extends TuChronologicalEvidence>(items: T[]) {
  return [...items].sort((left, right) => {
    const leftTime = Date.parse(left.observedAt)
    const rightTime = Date.parse(right.observedAt)
    if (Number.isNaN(leftTime) && Number.isNaN(rightTime)) return left.id.localeCompare(right.id)
    if (Number.isNaN(leftTime)) return 1
    if (Number.isNaN(rightTime)) return -1
    return leftTime - rightTime || left.id.localeCompare(right.id)
  })
}

export function findTuMoistureGroundingRisks(input: {
  text: string
  sourceTexts: string[]
  currentAssessmentTexts: string[]
}) {
  const text = cleanText(input.text)
  const sources = input.sourceTexts.join('\n').toLocaleLowerCase('sv-SE')
  const assessments = input.currentAssessmentTexts.join('\n').toLocaleLowerCase('sv-SE')
  const risks: string[] = []
  const unsupportedPatterns: Array<{ generated: RegExp; source: RegExp; message: string }> = [
    {
      generated: /standardmetod(?:er)?/i,
      source: /standardmetod(?:er)?/i,
      message: 'Texten anger standardmetod utan källstöd.',
    },
    {
      generated: /åtkomlighet.{0,35}tillfredsställ/i,
      source: /åtkomlighet.{0,35}tillfredsställ/i,
      message: 'Texten bedömer åtkomligheten utan källstöd.',
    },
    {
      generated: /(?:luft|ång)spärr(?:en)? fungerar som förväntat/i,
      source: /(?:luft|ång)spärr(?:en)? fungerar som förväntat/i,
      message: 'Texten påstår att en spärr fungerar utan dokumenterad funktionskontroll.',
    },
    {
      generated: /inga riskfaktorer/i,
      source: /inga riskfaktorer/i,
      message: 'Texten utesluter riskfaktorer utan uttryckligt källstöd.',
    },
    {
      generated: /(?:saknar|utan|ingen|inga) fukt/i,
      source: /(?:saknar|utan|ingen|inga) fukt/i,
      message: 'Texten gör ett absolut påstående om frånvaro av fukt utan motsvarande källformulering.',
    },
  ]

  for (const rule of unsupportedPatterns) {
    if (rule.generated.test(text) && !rule.source.test(sources)) risks.push(rule.message)
  }

  const comparativeMeasurementClaim = /(?:inga\s+förhöjda|förhöjda|normala?|acceptabla?)\s+fukt(?:värden?|nivåer?)/i
  if (comparativeMeasurementClaim.test(text)) {
    const hasStructuredMeasurement = [
      /mätvärde:/i,
      /enhet:/i,
      /metod:/i,
      /instrument:/i,
    ].every((pattern) => pattern.test(sources))
    const hasComparisonBasis = /(?:referens|gränsvärde|jämförelse|normalvärde|förhöjd|normal|acceptabel)/i.test(sources)
    if (!hasStructuredMeasurement || !hasComparisonBasis) {
      risks.push('Texten klassificerar ett fuktresultat utan komplett mätunderlag och dokumenterad jämförelsegrund.')
    }
  }

  if (/(?:hela|samtliga|konstruktionen|byggnaden).{0,45}(?:saknar fukt|ingen fukt|inga fuktindikationer)/i.test(text)) {
    risks.push('Texten generaliserar ett begränsat kontrollresultat till en större konstruktion eller byggnad.')
  }

  const assessmentNegatesMoisture = /(?:inte|ej).{0,55}fukt|smutsfläck|missfärgning/.test(assessments)
  if (/fuktfläck/i.test(text) && assessmentNegatesMoisture) {
    risks.push('Texten använder fuktfläck trots att den godkända aktuella bedömningen inte bekräftar fukt.')
  }

  const sourceCorrectsToSolarCollector = /(?:rättare sagt|korriger\w*).{0,50}solfångare/.test(sources)
    || /solpanel.{0,60}solfångare/.test(sources)
  if (/solpanel/i.test(text) && sourceCorrectsToSolarCollector) {
    risks.push('Texten använder solpanel trots att källan korrigerar uppgiften till solfångare.')
  }

  return uniqueStrings(risks)
}

export function validateTuGroundedSections(input: {
  expectedSectionIds: string[]
  generatedSections: TuGeneratedGroundedSection[]
  validAnalysisItemIds: Set<string>
  validObservationIds: Set<string>
  validFieldKeys: Set<string>
  analysisSourceTextById: Map<string, string>
  observationSourceTextById: Map<string, string>
  fieldSourceTextByKey: Map<string, string>
  currentAssessmentTexts: string[]
  conflictResolutionAnalysisIdsByObservation?: Map<string, Set<string>>
}) {
  const generatedById = new Map(input.generatedSections.map((section) => [section.sectionId, section]))

  return input.expectedSectionIds.map((sectionId): TuValidatedGroundedSection => {
    const generated = generatedById.get(sectionId)
    const warnings = [...(generated?.warnings ?? [])]
    const acceptedParagraphs: Array<TuGeneratedParagraph & {
      sourceAnalysisItemIds: string[]
      sourceObservationIds: string[]
      sourceFieldKeys: string[]
    }> = []
    let blockedParagraphCount = 0

    for (const paragraph of generated?.paragraphs ?? []) {
      const text = cleanText(paragraph.text)
      if (!text) continue
      const sourceAnalysisItemIds = uniqueStrings(paragraph.sourceAnalysisItemIds)
        .filter((id) => input.validAnalysisItemIds.has(id))
      const sourceObservationIds = uniqueStrings(paragraph.sourceObservationIds)
        .filter((id) => input.validObservationIds.has(id))
      const sourceFieldKeys = uniqueStrings(paragraph.sourceFieldKeys)
        .filter((key) => input.validFieldKeys.has(key))
      const hasSource = sourceAnalysisItemIds.length > 0
        || sourceObservationIds.length > 0
        || sourceFieldKeys.length > 0

      if (!hasSource) {
        blockedParagraphCount += 1
        warnings.push('Ett AI-stycke togs bort eftersom det saknade verifierbar källa.')
        continue
      }

      const unresolvedConflictSources = sourceObservationIds.filter((observationId) => {
        const resolutionIds = input.conflictResolutionAnalysisIdsByObservation?.get(observationId)
        return resolutionIds && !sourceAnalysisItemIds.some((id) => resolutionIds.has(id))
      })
      if (unresolvedConflictSources.length > 0) {
        blockedParagraphCount += 1
        warnings.push(
          'Ett AI-stycke togs bort eftersom det använde en motsagd fältuppgift utan att hänvisa till den godkända aktuella bedömningen.'
        )
        continue
      }

      const sourceTexts = [
        ...sourceAnalysisItemIds.map((id) => input.analysisSourceTextById.get(id) ?? ''),
        ...sourceObservationIds.map((id) => input.observationSourceTextById.get(id) ?? ''),
        ...sourceFieldKeys.map((key) => input.fieldSourceTextByKey.get(key) ?? ''),
      ].filter(Boolean)
      const risks = findTuMoistureGroundingRisks({
        text,
        sourceTexts,
        currentAssessmentTexts: input.currentAssessmentTexts,
      })
      if (risks.length > 0) {
        blockedParagraphCount += 1
        warnings.push(...risks)
        continue
      }

      acceptedParagraphs.push({
        ...paragraph,
        text,
        sourceAnalysisItemIds,
        sourceObservationIds,
        sourceFieldKeys,
      })
    }

    const text = acceptedParagraphs.map((paragraph) => paragraph.text).join('\n\n')
    if (!text) warnings.push('Rapportdelen lämnades tom eftersom verifierbart underlag saknas.')
    return {
      sectionId,
      text,
      sourceAnalysisItemIds: uniqueStrings(
        acceptedParagraphs.flatMap((paragraph) => paragraph.sourceAnalysisItemIds)
      ),
      sourceObservationIds: uniqueStrings(
        acceptedParagraphs.flatMap((paragraph) => paragraph.sourceObservationIds)
      ),
      sourceFieldKeys: uniqueStrings(
        acceptedParagraphs.flatMap((paragraph) => paragraph.sourceFieldKeys)
      ),
      warnings: uniqueStrings(warnings),
      groundingStatus: text
        ? blockedParagraphCount > 0 ? 'blocked' : 'grounded'
        : 'needs_source',
    }
  })
}
