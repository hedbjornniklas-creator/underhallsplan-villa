export const TU_COMMON_MEASUREMENT_INSTRUMENTS = [
  'Elma Moisture Max',
  'Elma DT-128M',
  'Protimeter Aquant2',
  'Protimeter SurveyMaster',
  'Protimeter MMS2',
  'Protimeter MMS3',
  'Tramex Moisture Encounter ME5',
  'Tramex Moisture Encounter MEX5',
  'Tramex Concrete Moisture Encounter CMEX5',
  'GANN Hydromette BL Compact B 2',
  'GANN Hydromette UNI 11',
  'Testo 616',
  'Trotec T660',
  'Vaisala HM40-serien',
] as const

const LAST_INSTRUMENT_STORAGE_KEY = 'hushub:tu:last-measurement-instrument:v1'
const METHOD_STORAGE_KEY = 'hushub:tu:measurement-methods:v1'
const MAX_INSTRUMENT_LENGTH = 160
const MAX_METHOD_LENGTH = 160

export function isCommonTuMeasurementInstrument(value: string) {
  return TU_COMMON_MEASUREMENT_INSTRUMENTS.some((instrument) => instrument === value)
}

export function readRememberedTuMeasurementInstrument() {
  if (typeof window === 'undefined') return ''
  try {
    const value = window.localStorage.getItem(LAST_INSTRUMENT_STORAGE_KEY)?.trim() ?? ''
    return value.length <= MAX_INSTRUMENT_LENGTH ? value : ''
  } catch {
    return ''
  }
}

export function rememberTuMeasurementInstrument(value: string) {
  if (typeof window === 'undefined') return
  const normalized = value.trim().slice(0, MAX_INSTRUMENT_LENGTH)
  if (!normalized) return
  try {
    window.localStorage.setItem(LAST_INSTRUMENT_STORAGE_KEY, normalized)
  } catch {
    // The measurement can still be saved when browser preferences are unavailable.
  }
}

function readRememberedMethods() {
  if (typeof window === 'undefined') return {} as Record<string, string>
  try {
    const parsed = JSON.parse(window.localStorage.getItem(METHOD_STORAGE_KEY) ?? '{}') as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return Object.fromEntries(
      Object.entries(parsed)
        .filter(([key, value]) => key.trim() && typeof value === 'string')
        .map(([key, value]) => [key, value.trim().slice(0, MAX_METHOD_LENGTH)])
        .filter(([, value]) => Boolean(value))
    )
  } catch {
    return {}
  }
}

export function readRememberedTuMeasurementMethod(measurementType: string) {
  return readRememberedMethods()[measurementType.trim()] ?? ''
}

export function rememberTuMeasurementMethod(measurementType: string, method: string) {
  if (typeof window === 'undefined') return
  const normalizedType = measurementType.trim()
  const normalizedMethod = method.trim().slice(0, MAX_METHOD_LENGTH)
  if (!normalizedType || !normalizedMethod) return
  try {
    window.localStorage.setItem(METHOD_STORAGE_KEY, JSON.stringify({
      ...readRememberedMethods(),
      [normalizedType]: normalizedMethod,
    }))
  } catch {
    // The measurement can still be saved when browser preferences are unavailable.
  }
}
