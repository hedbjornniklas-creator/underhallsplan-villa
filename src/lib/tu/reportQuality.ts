import type { TuObservation } from '@/lib/tu/evidence'

export type TuReportQualityIssue = {
  id: string
  severity: 'blocker' | 'warning'
  message: string
}

export type TuReportImprovementSuggestion = {
  id: string
  message: string
  destination: 'evidence' | 'report'
  requiredBeforeFinalization: boolean
}

export type TuReportImprovementCategory = {
  id: 'field_evidence' | 'measurements' | 'images' | 'report_text' | 'scope'
  label: string
  score: 1 | 2 | 3 | 4 | 5
  summary: string
  suggestions: TuReportImprovementSuggestion[]
}

export type TuReportImprovementReview = {
  disclaimer: string
  categories: TuReportImprovementCategory[]
}

type ReportImage = {
  id: string
  caption: string | null
}

function clean(value: string | null | undefined) {
  return value?.trim() ?? ''
}

function isGenericCaption(value: string | null | undefined) {
  const caption = clean(value).toLocaleLowerCase('sv-SE')
  return !caption || /^(?:bild|foto|besiktningsbild)(?:\s+\d+)?$/.test(caption)
}

function boundedScore(value: number): 1 | 2 | 3 | 4 | 5 {
  return Math.max(1, Math.min(5, Math.round(value))) as 1 | 2 | 3 | 4 | 5
}

export function evaluateTuReportImprovements(input: {
  reportText: string
  observations: TuObservation[]
  appendixImages: ReportImage[]
  qualityIssues: TuReportQualityIssue[]
}): TuReportImprovementReview {
  const observations = input.observations
  const measurements = observations.flatMap((observation) => observation.measurements)
  const reviewedCount = observations.filter((observation) => observation.reviewStatus === 'reviewed').length
  const missingLocationCount = observations.filter((observation) => !clean(observation.location)).length
  const missingObservationTextCount = observations.filter((observation) => (
    !clean(observation.noteText) && !clean(observation.transcriptText)
  )).length
  const incompleteMeasurements = measurements.filter((measurement) => (
    !clean(measurement.location)
    || !clean(measurement.method)
    || !clean(measurement.instrument)
  ))
  const genericCaptionCount = input.appendixImages.filter((image) => isGenericCaption(image.caption)).length
  const blockerCount = input.qualityIssues.filter((issue) => issue.severity === 'blocker').length
  const warningCount = input.qualityIssues.filter((issue) => issue.severity === 'warning').length
  const scopeIsExplicit = /(?:uppdrag|frågeställning)/i.test(input.reportText)
    && /(?:avgräns|begräns|endast|omfattar)/i.test(input.reportText)

  const fieldSuggestions: TuReportImprovementSuggestion[] = []
  if (observations.length === 0) {
    fieldSuggestions.push({
      id: 'observations-missing',
      message: 'Lägg till de observationer som rapportens bedömning bygger på.',
      destination: 'evidence',
      requiredBeforeFinalization: false,
    })
  } else if (reviewedCount < observations.length) {
    fieldSuggestions.push({
      id: 'observations-unreviewed',
      message: `Kontrollera ${observations.length - reviewedCount} fältpost${observations.length - reviewedCount === 1 ? '' : 'er'} som inte är granskade.`,
      destination: 'evidence',
      requiredBeforeFinalization: false,
    })
  }
  if (missingLocationCount > 0) {
    fieldSuggestions.push({
      id: 'observation-location-missing',
      message: `Ange plats för ${missingLocationCount} observation${missingLocationCount === 1 ? '' : 'er'} om uppgiften är känd.`,
      destination: 'evidence',
      requiredBeforeFinalization: false,
    })
  }
  if (missingObservationTextCount > 0) {
    fieldSuggestions.push({
      id: 'observation-text-missing',
      message: `Komplettera ${missingObservationTextCount} observation${missingObservationTextCount === 1 ? '' : 'er'} som saknar anteckning eller röstutskrift.`,
      destination: 'evidence',
      requiredBeforeFinalization: false,
    })
  }

  const measurementSuggestions: TuReportImprovementSuggestion[] = []
  if (measurements.length === 0) {
    measurementSuggestions.push({
      id: 'measurements-not-recorded',
      message: 'Bedöm om instrumentmätning behövs. Lägg endast till uppgifter som faktiskt dokumenterades vid undersökningen.',
      destination: 'evidence',
      requiredBeforeFinalization: false,
    })
  } else if (incompleteMeasurements.length > 0) {
    measurementSuggestions.push({
      id: 'measurements-incomplete',
      message: `Komplettera plats, metod eller instrument för ${incompleteMeasurements.length} mätning${incompleteMeasurements.length === 1 ? '' : 'ar'} om uppgifterna finns.`,
      destination: 'evidence',
      requiredBeforeFinalization: false,
    })
  }

  const imageSuggestions: TuReportImprovementSuggestion[] = []
  if (input.appendixImages.length === 0) {
    imageSuggestions.push({
      id: 'appendix-images-missing',
      message: 'Bedöm om relevanta fotografier bör väljas till bildbilagan.',
      destination: 'report',
      requiredBeforeFinalization: false,
    })
  }
  if (genericCaptionCount > 0) {
    imageSuggestions.push({
      id: 'appendix-captions-missing',
      message: `Skriv en beskrivande bildtext för ${genericCaptionCount} bilagebild${genericCaptionCount === 1 ? '' : 'er'}, gärna med plats och vad bilden visar.`,
      destination: 'report',
      requiredBeforeFinalization: false,
    })
  }

  const reportSuggestions = input.qualityIssues.map((issue) => ({
    id: issue.id,
    message: issue.message,
    destination: 'report' as const,
    requiredBeforeFinalization: issue.severity === 'blocker',
  }))
  const scopeSuggestions: TuReportImprovementSuggestion[] = scopeIsExplicit ? [] : [{
    id: 'scope-not-explicit',
    message: 'Kontrollera att uppdragets fråga och undersökningens avgränsning framgår tydligt.',
    destination: 'report',
    requiredBeforeFinalization: false,
  }]

  const fieldScore = observations.length === 0
    ? 1
    : boundedScore(5 - (reviewedCount < observations.length ? 1 : 0) - (missingLocationCount > 0 ? 1 : 0) - (missingObservationTextCount > 0 ? 1 : 0))
  const measurementScore = measurements.length === 0 ? 3 : boundedScore(5 - (incompleteMeasurements.length > 0 ? 2 : 0))
  const imageScore = input.appendixImages.length === 0 ? 2 : boundedScore(5 - (genericCaptionCount > 0 ? 2 : 0))
  const reportScore = boundedScore(5 - blockerCount * 2 - warningCount)

  return {
    disclaimer: 'Kontrollen visar möjliga förbättringar i underlag och presentation. Den bedömer inte juridisk hållbarhet, ansvar eller sannolik utgång i en tvist.',
    categories: [
      {
        id: 'field_evidence',
        label: 'Fältunderlag',
        score: fieldScore,
        summary: observations.length > 0
          ? `${reviewedCount} av ${observations.length} observationer är granskade.`
          : 'Inga observationer hittades i fältunderlaget.',
        suggestions: fieldSuggestions,
      },
      {
        id: 'measurements',
        label: 'Mätuppgifter',
        score: measurementScore,
        summary: measurements.length > 0
          ? `${measurements.length} mätning${measurements.length === 1 ? '' : 'ar'} finns registrerad${measurements.length === 1 ? '' : 'e'}.`
          : 'Ingen instrumentmätning finns registrerad. Det kan vara korrekt för uppdraget.',
        suggestions: measurementSuggestions,
      },
      {
        id: 'images',
        label: 'Bilddokumentation',
        score: imageScore,
        summary: `${input.appendixImages.length} bild${input.appendixImages.length === 1 ? '' : 'er'} är vald${input.appendixImages.length === 1 ? '' : 'a'} till bilagan.`,
        suggestions: imageSuggestions,
      },
      {
        id: 'report_text',
        label: 'Rapporttext',
        score: reportScore,
        summary: input.qualityIssues.length === 0
          ? 'Inga kända text- eller underlagsvarningar hittades.'
          : `${input.qualityIssues.length} punkt${input.qualityIssues.length === 1 ? '' : 'er'} kan behöva kontrolleras.`,
        suggestions: reportSuggestions,
      },
      {
        id: 'scope',
        label: 'Uppdrag och avgränsning',
        score: scopeIsExplicit ? 5 : 3,
        summary: scopeIsExplicit
          ? 'Uppdrag och avgränsning framgår i rapporttexten.'
          : 'Kontrollen hittade inte både en tydlig uppdragsfråga och en avgränsning.',
        suggestions: scopeSuggestions,
      },
    ],
  }
}

export function evaluateTuReportQuality(input: {
  reportText: string
  observations: TuObservation[]
  appendixImages: ReportImage[]
}): TuReportQualityIssue[] {
  const issues: TuReportQualityIssue[] = []
  const measurements = input.observations.flatMap((observation) => observation.measurements)

  const incompleteMeasurements = measurements.filter((measurement) => (
    !clean(measurement.location)
    || !clean(measurement.method)
    || !clean(measurement.instrument)
  ))
  if (incompleteMeasurements.length > 0) {
    issues.push({
      id: 'measurement-context-incomplete',
      severity: 'warning',
      message: `${incompleteMeasurements.length} mätning${incompleteMeasurements.length === 1 ? '' : 'ar'} saknar plats, metod eller instrument. Komplettera dem om resultatet ska användas i bedömningen.`,
    })
  }

  const missingExpectedUnit = measurements.filter((measurement) => {
    const type = measurement.measurementType.toLocaleLowerCase('sv-SE')
    return (type.includes('(rf)') || type.includes('(fk)') || type.includes('temperatur'))
      && !clean(measurement.unit)
  })
  if (missingExpectedUnit.length > 0) {
    issues.push({
      id: 'measurement-unit-missing',
      severity: 'warning',
      message: `${missingExpectedUnit.length} mätning${missingExpectedUnit.length === 1 ? '' : 'ar'} saknar enhet.`,
    })
  }

  const comparativeClaim = /(?:inga\s+förhöjda|förhöjda|normala?|acceptabla?)\s+fukt(?:värden?|nivåer?)/i
  if (comparativeClaim.test(input.reportText)) {
    const hasQualifiedMeasurement = measurements.some((measurement) => (
      clean(measurement.location)
      && clean(measurement.unit)
      && clean(measurement.method)
      && clean(measurement.instrument)
      && /(?:referens|gränsvärde|jämförelse|normalvärde|förhöjd|normal|acceptabel)/i.test(clean(measurement.note))
    ))
    if (!hasQualifiedMeasurement) {
      issues.push({
        id: 'comparative-moisture-claim-unsupported',
        severity: 'blocker',
        message: 'Utlåtandet klassificerar fuktvärden utan komplett mätunderlag och dokumenterad jämförelsegrund.',
      })
    }
  }

  if (/(?:hela|samtliga|konstruktionen|byggnaden).{0,45}(?:saknar fukt|ingen fukt|inga fuktindikationer)/i.test(input.reportText)) {
    issues.push({
      id: 'measurement-result-overgeneralized',
      severity: 'blocker',
      message: 'Utlåtandet generaliserar ett begränsat fuktresultat till en hel konstruktion eller byggnad.',
    })
  }

  if (/(?:felaktigt|inte fackmässigt|otillåtet) utför/i.test(input.reportText)) {
    issues.push({
      id: 'categorical-execution-claim',
      severity: 'warning',
      message: 'Utlåtandet innehåller en kategorisk bedömning av utförandet. Kontrollera att iakttagelse och bedömningsgrund framgår.',
    })
  }

  const internalProcessVoice = /(?:den|det|de)\s+registrerad(?:e|a)?\s+(?:uppdragsbeskrivningen|omfattningen|bakgrunden|underlaget)|fältanteckning(?:en|arna)?|transkribering(?:en|arna)?|AI[- ]analys(?:en)?/i
  if (internalProcessVoice.test(input.reportText)) {
    issues.push({
      id: 'internal-source-language-in-report',
      severity: 'blocker',
      message: 'Utlåtandet hänvisar till interna fält, anteckningar eller AI-processen. Formulera texten i besiktningsmannens egen röst.',
    })
  }

  const missingMeasurementAudit = /(?:saknas|redovisas inte|har inte redovisats)[^.]{0,140}(?:instrument|mätmetod|enhet|numeriskt mätvärde|jämförelsegrund)|(?:instrument|mätmetod|enhet|numeriskt mätvärde|jämförelsegrund)[^.]{0,140}(?:saknas|redovisas inte|har inte redovisats)/i
  if (missingMeasurementAudit.test(input.reportText)) {
    issues.push({
      id: 'measurement-audit-language-in-report',
      severity: 'blocker',
      message: 'Utlåtandet räknar upp saknade mätuppgifter. Utelämna det osäkra mätpåståendet eller beskriv endast en relevant undersökningsbegränsning.',
    })
  }

  const genericCaptionCount = input.appendixImages.filter((image) => isGenericCaption(image.caption)).length
  if (genericCaptionCount > 0) {
    issues.push({
      id: 'appendix-caption-missing',
      severity: 'warning',
      message: `${genericCaptionCount} bild${genericCaptionCount === 1 ? '' : 'er'} i bilagan saknar en beskrivande bildtext.`,
    })
  }

  return issues
}
