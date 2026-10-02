export type TuMeasurementVerificationStatus = 'match' | 'conflict' | 'not_readable'
export type TuMeasurementVerificationResolution = 'recorded_confirmed' | null

export type TuMeasurementImageVerification = {
  measurementId: string
  observationId: string
  location: string | null
  measurementType: string
  recordedValue: string
  unit: string | null
  method: string | null
  instrument: string | null
  sourceImageIds: string[]
  imageReadings: string[]
  status: TuMeasurementVerificationStatus
  resolution: TuMeasurementVerificationResolution
}

type JsonRecord = Record<string, unknown>

type ImageReadingSource = {
  imageId: string
  displayReadings: string[]
}

function record(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : {}
}

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function textArray(value: unknown) {
  return Array.isArray(value)
    ? value.map(text).filter(Boolean)
    : []
}

function numericReading(value: string) {
  const match = value.replace(/\s/g, '').match(/[-+]?\d+(?:[.,]\d+)?/u)
  if (!match) return null
  const parsed = Number.parseFloat(match[0].replace(',', '.'))
  if (!Number.isFinite(parsed)) return null
  const decimalPart = match[0].split(/[.,]/u)[1] ?? ''
  return {
    value: parsed,
    decimalPlaces: decimalPart.length,
  }
}

function readingsMatch(recordedValue: string, displayReading: string) {
  const recorded = numericReading(recordedValue)
  const displayed = numericReading(displayReading)
  if (recorded && displayed) {
    const leastPreciseDecimals = Math.min(recorded.decimalPlaces, displayed.decimalPlaces)
    const roundingTolerance = 0.5 * (10 ** -leastPreciseDecimals)
    return Math.abs(recorded.value - displayed.value) < roundingTolerance
  }
  return recordedValue.trim().toLocaleLowerCase('sv-SE')
    === displayReading.trim().toLocaleLowerCase('sv-SE')
}

export function getTuMeasurementImageIds(snapshot: unknown) {
  const root = record(snapshot)
  const observations = Array.isArray(root.observations) ? root.observations.map(record) : []
  return new Set(
    observations
      .filter((observation) => Array.isArray(observation.measurements) && observation.measurements.length > 0)
      .flatMap((observation) => textArray(observation.imageIds))
  )
}

export function deriveTuMeasurementImageVerifications(
  snapshot: unknown,
  imageAnalyses: ImageReadingSource[]
): TuMeasurementImageVerification[] {
  const root = record(snapshot)
  const observations = Array.isArray(root.observations) ? root.observations.map(record) : []
  const analysisByImageId = new Map(imageAnalyses.map((analysis) => [analysis.imageId, analysis]))

  return observations.flatMap((observation) => {
    const observationId = text(observation.id)
    const sourceImageIds = textArray(observation.imageIds)
    const imageReadings = [...new Set(sourceImageIds.flatMap(
      (imageId) => analysisByImageId.get(imageId)?.displayReadings ?? []
    ).map((reading) => reading.trim()).filter(Boolean))]
    const measurements = Array.isArray(observation.measurements)
      ? observation.measurements.map(record)
      : []

    return measurements.map((measurement): TuMeasurementImageVerification | null => {
      const measurementId = text(measurement.id)
      const recordedValue = text(measurement.value)
      if (!observationId || !measurementId || !recordedValue || sourceImageIds.length === 0) return null

      const status: TuMeasurementVerificationStatus = imageReadings.length === 0
        ? 'not_readable'
        : imageReadings.some((reading) => readingsMatch(recordedValue, reading))
          ? 'match'
          : 'conflict'

      return {
        measurementId,
        observationId,
        location: text(measurement.location) || text(observation.location) || null,
        measurementType: text(measurement.type) || 'Mätning',
        recordedValue,
        unit: text(measurement.unit) || null,
        method: text(measurement.method) || null,
        instrument: text(measurement.instrument) || null,
        sourceImageIds,
        imageReadings,
        status,
        resolution: null,
      }
    }).filter((verification): verification is TuMeasurementImageVerification => Boolean(verification))
  })
}

export function parseTuMeasurementImageVerifications(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.map(record).map((item): TuMeasurementImageVerification | null => {
    const measurementId = text(item.measurementId)
    const observationId = text(item.observationId)
    const recordedValue = text(item.recordedValue)
    if (!measurementId || !observationId || !recordedValue) return null
    const status: TuMeasurementVerificationStatus = item.status === 'match' || item.status === 'conflict'
      ? item.status
      : 'not_readable'
    return {
      measurementId,
      observationId,
      location: text(item.location) || null,
      measurementType: text(item.measurementType) || 'Mätning',
      recordedValue,
      unit: text(item.unit) || null,
      method: text(item.method) || null,
      instrument: text(item.instrument) || null,
      sourceImageIds: textArray(item.sourceImageIds),
      imageReadings: textArray(item.imageReadings),
      status,
      resolution: item.resolution === 'recorded_confirmed' ? 'recorded_confirmed' : null,
    }
  }).filter((item): item is TuMeasurementImageVerification => Boolean(item))
}

export const TU_MEASUREMENT_REVIEW_INSTRUCTION =
  'measurementReview.confirmedReadings innehåller besiktningsmannens uttryckliga kontroll av registrerat värde mot instrumentbilden. För just dessa mätningar gäller recordedValue framför AI:ns imageReadings och äldre AI-varningar eller konfliktbedömningar om samma avläsning. Behandla inte den avgjorda bildavläsningen som en kvarstående motsägelse och begär inte ommätning enbart på den grunden. Använd sourceFieldKey som källstöd för beslutet. Bekräftelsen säger inget om normalnivå, skadeorsak, metodens lämplighet eller andra mätningar; behåll sådana sakligt grundade osäkerheter. Beskriv mätresultatet i rapporten, inte den interna AI-granskningen.'

export function buildTuMeasurementReview(input: {
  verifications: unknown
  evidence: unknown
}) {
  const observations = record(input.evidence).observations
  const byObservationId = new Map((Array.isArray(observations) ? observations : [])
    .map(record).map((observation) => [text(observation.id), observation]))
  const conflicts = parseTuMeasurementImageVerifications(input.verifications)
    .filter((item) => item.status === 'conflict')
  const confirmedReadings = conflicts.filter((item) => {
    if (item.resolution !== 'recorded_confirmed') return false
    const observation = byObservationId.get(item.observationId)
    if (!observation) return false
    const measurement = (Array.isArray(observation.measurements) ? observation.measurements : [])
      .map(record).find((candidate) => text(candidate.id) === item.measurementId)
    if (!measurement) return false
    // A decision applies to the reviewed reading and photos, never to a later edit.
    const imageIds = [...new Set(textArray(observation.imageIds))].sort()
    const reviewedImageIds = [...new Set(item.sourceImageIds)].sort()
    return text(measurement.value) === item.recordedValue
      && (text(measurement.type) || 'Mätning') === item.measurementType
      && text(measurement.unit) === (item.unit ?? '')
      && text(measurement.method) === (item.method ?? '')
      && text(measurement.instrument) === (item.instrument ?? '')
      && (text(measurement.location) || text(observation.location)) === (item.location ?? '')
      && imageIds.length > 0
      && JSON.stringify(imageIds) === JSON.stringify(reviewedImageIds)
  }).map((item) => ({
    ...item,
    status: 'resolved' as const,
    sourceFieldKey: `measurement.${item.measurementId}.recordedConfirmed`,
  }))
  const confirmedIds = new Set(confirmedReadings.map((item) => item.measurementId))
  return {
    confirmedReadings,
    unresolvedMeasurementIds: conflicts.filter((item) => !confirmedIds.has(item.measurementId))
      .map((item) => item.measurementId),
  }
}
