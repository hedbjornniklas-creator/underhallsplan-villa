import type { TuMeasurementAssessment } from '@/lib/tu/evidence'

export type TuMeasurementTypeDefinition = {
  value: string
  label: string
  resultLabel: string
  resultPlaceholder: string
  unit: string
  fixedUnit: boolean
  defaultMethod: string
}

export const TU_MEASUREMENT_TYPE_DEFINITIONS: TuMeasurementTypeDefinition[] = [
  {
    value: 'Fuktindikering',
    label: 'Fuktindikering',
    resultLabel: 'Indikationsvärde',
    resultPlaceholder: 'Exempel: 62',
    unit: '',
    fixedUnit: true,
    defaultMethod: 'Indikativ ytmätning',
  },
  {
    value: 'Relativ fuktighet (RF)',
    label: 'Relativ fuktighet (RF)',
    resultLabel: 'Resultat',
    resultPlaceholder: 'Exempel: 75,2',
    unit: '% RF',
    fixedUnit: true,
    defaultMethod: 'Mätning av relativ fuktighet',
  },
  {
    value: 'Fuktkvot (FK)',
    label: 'Fuktkvot (FK)',
    resultLabel: 'Resultat',
    resultPlaceholder: 'Exempel: 16,5',
    unit: '% FK',
    fixedUnit: true,
    defaultMethod: 'Fuktkvotsmätning med stift',
  },
  {
    value: 'Temperatur',
    label: 'Lufttemperatur',
    resultLabel: 'Temperatur',
    resultPlaceholder: 'Exempel: 21,4',
    unit: '°C',
    fixedUnit: true,
    defaultMethod: 'Lufttemperaturmätning',
  },
  {
    value: 'Yttemperatur',
    label: 'Yttemperatur',
    resultLabel: 'Temperatur',
    resultPlaceholder: 'Exempel: 18,7',
    unit: '°C',
    fixedUnit: true,
    defaultMethod: 'Yttemperaturmätning',
  },
  {
    value: 'Annan instrumentmätning',
    label: 'Annan instrumentmätning',
    resultLabel: 'Resultat',
    resultPlaceholder: 'Ange avläst resultat',
    unit: '',
    fixedUnit: false,
    defaultMethod: '',
  },
]

export function getTuMeasurementTypeDefinition(value: string) {
  return TU_MEASUREMENT_TYPE_DEFINITIONS.find((definition) => definition.value === value)
    ?? TU_MEASUREMENT_TYPE_DEFINITIONS[TU_MEASUREMENT_TYPE_DEFINITIONS.length - 1]
}

export function resolveTuMeasurementUnit(measurementType: string, enteredUnit: string) {
  const definition = getTuMeasurementTypeDefinition(measurementType)
  return definition.fixedUnit ? definition.unit : enteredUnit.trim()
}

export function formatTuMeasurementResult(input: {
  measurementType: string
  valueText: string
  unit?: string | null
}) {
  const value = input.valueText.trim()
  const unit = resolveTuMeasurementUnit(input.measurementType, input.unit ?? '')
  if (!value) return ''
  if (input.measurementType === 'Fuktindikering') return `${value} (indikationsvärde)`
  return unit ? `${value} ${unit}` : value
}

export function getTuMeasurementAssessmentOptions(measurementType: string): Array<{
  value: TuMeasurementAssessment
  label: string
}> {
  if (measurementType === 'Fuktindikering') {
    return [
      { value: 'no_deviation', label: 'Ingen avvikande indikation' },
      { value: 'deviation', label: 'Avvikande/förhöjd indikation' },
      { value: 'not_assessable', label: 'Kan inte bedömas' },
    ]
  }

  return [
    { value: 'no_deviation', label: 'Ingen avvikelse noterad' },
    { value: 'deviation', label: 'Avvikande resultat' },
    { value: 'not_assessable', label: 'Kan inte bedömas' },
  ]
}

export function formatTuMeasurementAssessment(input: {
  measurementType: string
  assessment?: TuMeasurementAssessment | null
}) {
  if (!input.assessment) return ''
  return getTuMeasurementAssessmentOptions(input.measurementType)
    .find((option) => option.value === input.assessment)?.label ?? ''
}
