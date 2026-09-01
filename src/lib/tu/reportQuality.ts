import type { TuObservation } from '@/lib/tu/evidence'

export type TuReportQualityIssue = {
  id: string
  severity: 'blocker' | 'warning'
  message: string
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
