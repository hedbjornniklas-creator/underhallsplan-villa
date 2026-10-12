export type ProfileExtraKind = 'certification' | 'addon'

export type CertificationValues = {
  enabled: boolean
  number: string
  date: string
}

export type AddonValues = {
  enabled: boolean
  price: string
}

type CatalogEntry = {
  id: string
  key: string
  name: string
  description: string | null
  exists: boolean
}

export type CertificationEntry = CatalogEntry & {
  category: 'certification' | 'membership'
  requiresNumber: boolean
  requiresValidTo: boolean
  numberLabel: string | null
  validToLabel: string | null
  value: CertificationValues
}

export type AddonEntry = CatalogEntry & {
  currency: string
  value: AddonValues
}

export type ProfileExtrasWorkspace = {
  orgId: string
  profileId: string
  certifications: CertificationEntry[]
  addons: AddonEntry[]
}

export type ProfileExtraMutation = { orgId: string; id: string } & (
  | { kind: 'certification'; expected: CertificationValues | null; values: CertificationValues }
  | { kind: 'addon'; expected: AddonValues | null; values: AddonValues }
)

export type ProfileExtraSaved = { orgId: string; profileId: string } & (
  | { kind: 'certification'; entry: CertificationEntry }
  | { kind: 'addon'; entry: AddonEntry }
)

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

export function profileExtrasOrgId(value: unknown): string {
  if (typeof value !== 'string' || !UUID.test(value)) throw new Error('ORG_SELECTION_INVALID')
  return value
}

function exactRecord(value: unknown, fields: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).length !== fields.length || fields.some(field => !Object.hasOwn(value, field))) {
    throw new Error('ORG_INPUT_INVALID')
  }
  return value as Record<string, unknown>
}

export function isProfileCertificationDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false
  const [year, month, day] = value.split('-').map(Number)
  if (year < 1 || month < 1 || month > 12 || day < 1) return false
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
  return day <= [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]
}

// Decimal arithmetic avoids binary rounding surprises such as 1.005 -> 1.00.
// The result fits numeric(12,2), whose integer cents are also safe JS integers.
export function profileAddonPrice(value: string): number | null {
  const normalized = value.trim().replace(',', '.')
  if (!normalized) return null
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/u.test(normalized)) throw new Error('ORG_INPUT_INVALID')
  const [rawWhole, fraction = ''] = normalized.split('.')
  const whole = rawWhole.replace(/^0+/u, '') || '0'
  if (whole.length > 10) throw new Error('ORG_INPUT_INVALID')
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0').slice(0, 2))
    + (fraction.length > 2 && fraction[2] >= '5' ? 1 : 0)
  if (!Number.isSafeInteger(cents) || cents > 999_999_999_999) throw new Error('ORG_INPUT_INVALID')
  return cents / 100
}

function certificationValues(value: unknown, normalize: boolean): CertificationValues {
  const record = exactRecord(value, ['enabled', 'number', 'date'])
  if (typeof record.enabled !== 'boolean' || typeof record.number !== 'string' || typeof record.date !== 'string') {
    throw new Error('ORG_INPUT_INVALID')
  }
  const date = normalize ? record.date.trim() : record.date
  if (date && !isProfileCertificationDate(date)) throw new Error('ORG_INPUT_INVALID')
  return { enabled: record.enabled, number: normalize ? record.number.trim() : record.number, date }
}

function addonValues(value: unknown, normalize: boolean): AddonValues {
  const record = exactRecord(value, ['enabled', 'price'])
  if (typeof record.enabled !== 'boolean' || typeof record.price !== 'string') throw new Error('ORG_INPUT_INVALID')
  const price = profileAddonPrice(record.price)
  return { enabled: record.enabled, price: normalize ? (price === null ? '' : String(price)) : record.price }
}

export function parseProfileExtraMutation(value: unknown): ProfileExtraMutation {
  const record = exactRecord(value, ['orgId', 'kind', 'id', 'expected', 'values'])
  const orgId = profileExtrasOrgId(record.orgId)
  if (typeof record.id !== 'string' || !UUID.test(record.id)) throw new Error('ORG_INPUT_INVALID')
  if (record.kind === 'certification') {
    return {
      orgId, id: record.id, kind: record.kind,
      // The baseline must retain exact stored text, including whitespace.
      expected: record.expected === null ? null : certificationValues(record.expected, false),
      values: certificationValues(record.values, true),
    }
  }
  if (record.kind === 'addon') {
    return {
      orgId, id: record.id, kind: record.kind,
      expected: record.expected === null ? null : addonValues(record.expected, false),
      values: addonValues(record.values, true),
    }
  }
  throw new Error('ORG_INPUT_INVALID')
}
