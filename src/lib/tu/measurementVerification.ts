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

function numericValue(value: string) {
  const match = value.replace(/\s/g, '').match(/[-+]?\d+(?:[.,]\d+)?/u)
  if (!match) return null
  const parsed = Number.parseFloat(match[0].replace(',', '.'))
  return Number.isFinite(parsed) ? parsed : null
}

function readingsMatch(recordedValue: string, displayReading: string) {
  const recordedNumber = numericValue(recordedValue)
  const displayNumber = numericValue(displayReading)
  if (recordedNumber !== null && displayNumber !== null) {
    return Math.abs(recordedNumber - displayNumber) < 0.001
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
