export const ASSIGNMENT_ISSUER_SNAPSHOT_SCHEMA_VERSION =
  'assignment_issuer_v1' as const
export const ASSIGNMENT_ISSUER_IDENTITY_SCHEMA =
  ASSIGNMENT_ISSUER_SNAPSHOT_SCHEMA_VERSION

export type AssignmentIssuerIdentitySource = 'organization_card' | 'legacy_profile'

export type AssignmentIssuerCertificationSnapshot = Readonly<{
  key: string
  name: string
  category: 'certification' | 'membership'
  sortOrder: number | null
  numberValue: string | null
  validTo: string | null
}>

export type AssignmentIssuerIdentitySnapshotV1 = Readonly<{
  schema: typeof ASSIGNMENT_ISSUER_IDENTITY_SCHEMA
  orgId: string
  profileId: string
  capturedAt: string
  card: Readonly<{
    id: string | null
    version: number | null
    source: AssignmentIssuerIdentitySource
    updatedAt: string | null
  }>
  inspector: Readonly<{
    displayName: string
    title: string | null
    phone: string | null
    email: string | null
    avatarPath: string | null
    signaturePath: string | null
  }>
  company: Readonly<{
    name: string
    organizationNumber: string | null
    address: string | null
    postalCode: string | null
    city: string | null
    logoPath: string | null
    reportFooterText: string | null
  }>
  certifications: Readonly<{
    sbrGroup: string | null
    sbrStatus: string | null
    membershipNumber: string | null
    certificationNumber: string | null
    isSbrDiplomeradAreamatning: boolean
    items: readonly AssignmentIssuerCertificationSnapshot[]
  }>
  replyToEmail: string | null
}>

export type AssignmentIssuerIdentityExpectation = Readonly<{
  orgId: string
  profileId: string
}>

export type AssignmentIssuerIdentityOptionalExpectation = Readonly<{
  orgId?: string
  profileId?: string
}>

export type CreateAssignmentIssuerIdentitySnapshotV1Input = Omit<
  AssignmentIssuerIdentitySnapshotV1,
  'schema'
>

type UnknownRecord = Record<string, unknown>

const ROOT_KEYS = [
  'schema',
  'orgId',
  'profileId',
  'capturedAt',
  'card',
  'inspector',
  'company',
  'certifications',
  'replyToEmail',
] as const

const CARD_KEYS = ['id', 'version', 'source', 'updatedAt'] as const
const INSPECTOR_KEYS = [
  'displayName',
  'title',
  'phone',
  'email',
  'avatarPath',
  'signaturePath',
] as const
const COMPANY_KEYS = [
  'name',
  'organizationNumber',
  'address',
  'postalCode',
  'city',
  'logoPath',
  'reportFooterText',
] as const
const CERTIFICATIONS_KEYS = [
  'sbrGroup',
  'sbrStatus',
  'membershipNumber',
  'certificationNumber',
  'isSbrDiplomeradAreamatning',
  'items',
] as const
const CERTIFICATION_ITEM_KEYS = [
  'key',
  'name',
  'category',
  'sortOrder',
  'numberValue',
  'validTo',
] as const

const ISO_TIMESTAMP =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/u
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/u
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u
const URI_SCHEME = /^[a-z][a-z\d+.-]*:/iu
const UNSAFE_MEDIA_SCHEME = /^(?:data|javascript|vbscript):/iu
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/u

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function exactRecord(
  value: unknown,
  keys: readonly string[]
): UnknownRecord | null {
  if (!isRecord(value)) return null
  const actualKeys = Object.keys(value)
  if (actualKeys.length !== keys.length) return null
  return keys.every((key) => Object.prototype.hasOwnProperty.call(value, key))
    ? value
    : null
}

function requiredText(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string' || value.length > maxLength) return undefined
  if (!value || value !== value.trim() || CONTROL_CHARACTER.test(value)) return undefined
  return value
}

function optionalText(
  value: unknown,
  maxLength: number
): string | null | undefined {
  if (value === null) return null
  return requiredText(value, maxLength)
}

function optionalEmail(value: unknown): string | null | undefined {
  const email = optionalText(value, 320)
  if (email === undefined || email === null) return email
  return EMAIL.test(email) ? email : undefined
}

function isoTimestamp(value: unknown): string | undefined {
  const timestamp = requiredText(value, 64)
  if (!timestamp || !ISO_TIMESTAMP.test(timestamp)) return undefined
  const datePart = timestamp.slice(0, 10)
  const calendarDate = new Date(`${datePart}T00:00:00.000Z`)
  if (
    !Number.isFinite(calendarDate.getTime()) ||
    calendarDate.toISOString().slice(0, 10) !== datePart
  ) {
    return undefined
  }
  return Number.isFinite(Date.parse(timestamp)) ? timestamp : undefined
}

function optionalIsoTimestamp(value: unknown): string | null | undefined {
  if (value === null) return null
  return isoTimestamp(value)
}

function optionalIsoDate(value: unknown): string | null | undefined {
  if (value === null) return null
  const date = requiredText(value, 10)
  if (!date || !ISO_DATE.test(date)) return undefined
  const parsed = new Date(`${date}T00:00:00.000Z`)
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    return undefined
  }
  return date
}

function optionalMediaPath(value: unknown): string | null | undefined {
  const path = optionalText(value, 2_048)
  if (path === undefined || path === null) return path
  if (
    UNSAFE_MEDIA_SCHEME.test(path) ||
    path.startsWith('//') ||
    path.includes('\\') ||
    path.split('/').includes('..')
  ) {
    return undefined
  }
  if (URI_SCHEME.test(path) && !/^https?:/iu.test(path)) return undefined
  return path
}

function optionalSafeInteger(value: unknown): number | null | undefined {
  if (value === null) return null
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : undefined
}

function parseCertificationItems(
  value: unknown
): readonly AssignmentIssuerCertificationSnapshot[] | null {
  if (!Array.isArray(value) || value.length > 100) return null

  const parsed: AssignmentIssuerCertificationSnapshot[] = []
  const seenKeys = new Set<string>()
  for (const candidate of value) {
    const row = exactRecord(candidate, CERTIFICATION_ITEM_KEYS)
    if (!row) return null

    const key = requiredText(row.key, 160)
    const name = requiredText(row.name, 240)
    const category = row.category
    const sortOrder = optionalSafeInteger(row.sortOrder)
    const numberValue = optionalText(row.numberValue, 160)
    const validTo = optionalIsoDate(row.validTo)
    if (
      !key ||
      !name ||
      (category !== 'certification' && category !== 'membership') ||
      sortOrder === undefined ||
      numberValue === undefined ||
      validTo === undefined ||
      seenKeys.has(key)
    ) {
      return null
    }

    seenKeys.add(key)
    parsed.push({ key, name, category, sortOrder, numberValue, validTo })
  }

  return parsed
}

export function parseAssignmentIssuerIdentitySnapshotV1(
  value: unknown,
  expected: AssignmentIssuerIdentityExpectation
): AssignmentIssuerIdentitySnapshotV1 | null {
  const expectedOrgId = requiredText(expected.orgId, 200)
  const expectedProfileId = requiredText(expected.profileId, 200)
  const root = exactRecord(value, ROOT_KEYS)
  if (!expectedOrgId || !expectedProfileId || !root) return null
  if (root.schema !== ASSIGNMENT_ISSUER_IDENTITY_SCHEMA) return null

  const orgId = requiredText(root.orgId, 200)
  const profileId = requiredText(root.profileId, 200)
  const capturedAt = isoTimestamp(root.capturedAt)
  if (orgId !== expectedOrgId || profileId !== expectedProfileId || !capturedAt) {
    return null
  }

  const cardRow = exactRecord(root.card, CARD_KEYS)
  const inspectorRow = exactRecord(root.inspector, INSPECTOR_KEYS)
  const companyRow = exactRecord(root.company, COMPANY_KEYS)
  const certificationsRow = exactRecord(root.certifications, CERTIFICATIONS_KEYS)
  if (!cardRow || !inspectorRow || !companyRow || !certificationsRow) return null

  const cardId = optionalText(cardRow.id, 200)
  const cardVersion = optionalSafeInteger(cardRow.version)
  const cardUpdatedAt = optionalIsoTimestamp(cardRow.updatedAt)
  const cardSource = cardRow.source
  if (
    cardId === undefined ||
    cardVersion === undefined ||
    cardUpdatedAt === undefined ||
    (cardSource !== 'organization_card' && cardSource !== 'legacy_profile')
  ) {
    return null
  }
  if (
    (cardSource === 'organization_card' &&
      (!cardId || cardVersion === null || cardVersion <= 0 || !cardUpdatedAt)) ||
    (cardSource === 'legacy_profile' &&
      (cardId !== null || cardVersion !== null || cardUpdatedAt !== null))
  ) {
    return null
  }

  const displayName = requiredText(inspectorRow.displayName, 200)
  const title = optionalText(inspectorRow.title, 160)
  const phone = optionalText(inspectorRow.phone, 80)
  const inspectorEmail = optionalEmail(inspectorRow.email)
  const avatarPath = optionalMediaPath(inspectorRow.avatarPath)
  const signaturePath = optionalMediaPath(inspectorRow.signaturePath)
  if (
    !displayName ||
    title === undefined ||
    phone === undefined ||
    inspectorEmail === undefined ||
    avatarPath === undefined ||
    signaturePath === undefined
  ) {
    return null
  }

  const companyName = requiredText(companyRow.name, 240)
  const organizationNumber = optionalText(companyRow.organizationNumber, 40)
  const address = optionalText(companyRow.address, 300)
  const postalCode = optionalText(companyRow.postalCode, 40)
  const city = optionalText(companyRow.city, 160)
  const logoPath = optionalMediaPath(companyRow.logoPath)
  const reportFooterText = optionalText(companyRow.reportFooterText, 2_000)
  if (
    !companyName ||
    organizationNumber === undefined ||
    address === undefined ||
    postalCode === undefined ||
    city === undefined ||
    logoPath === undefined ||
    reportFooterText === undefined
  ) {
    return null
  }

  const sbrGroup = optionalText(certificationsRow.sbrGroup, 240)
  const sbrStatus = optionalText(certificationsRow.sbrStatus, 240)
  const membershipNumber = optionalText(certificationsRow.membershipNumber, 160)
  const certificationNumber = optionalText(certificationsRow.certificationNumber, 160)
  const isSbrDiplomeradAreamatning = certificationsRow.isSbrDiplomeradAreamatning
  const certificationItems = parseCertificationItems(certificationsRow.items)
  if (
    sbrGroup === undefined ||
    sbrStatus === undefined ||
    membershipNumber === undefined ||
    certificationNumber === undefined ||
    typeof isSbrDiplomeradAreamatning !== 'boolean' ||
    certificationItems === null
  ) {
    return null
  }

  const replyToEmail = optionalEmail(root.replyToEmail)
  if (replyToEmail === undefined) return null

  return {
    schema: ASSIGNMENT_ISSUER_IDENTITY_SCHEMA,
    orgId,
    profileId,
    capturedAt,
    card: {
      id: cardId,
      version: cardVersion,
      source: cardSource,
      updatedAt: cardUpdatedAt,
    },
    inspector: {
      displayName,
      title,
      phone,
      email: inspectorEmail,
      avatarPath,
      signaturePath,
    },
    company: {
      name: companyName,
      organizationNumber,
      address,
      postalCode,
      city,
      logoPath,
      reportFooterText,
    },
    certifications: {
      sbrGroup,
      sbrStatus,
      membershipNumber,
      certificationNumber,
      isSbrDiplomeradAreamatning,
      items: certificationItems,
    },
    replyToEmail,
  }
}

export function createAssignmentIssuerIdentitySnapshotV1(
  input: CreateAssignmentIssuerIdentitySnapshotV1Input
): AssignmentIssuerIdentitySnapshotV1 {
  const snapshot = parseAssignmentIssuerIdentitySnapshotV1(
    { ...input, schema: ASSIGNMENT_ISSUER_IDENTITY_SCHEMA },
    { orgId: input.orgId, profileId: input.profileId }
  )
  if (!snapshot) throw new Error('ASSIGNMENT_ISSUER_IDENTITY_INVALID')
  return snapshot
}

/**
 * Parses the current issuer snapshot schema. When an expected organization or
 * profile is supplied, that identifier must match the frozen snapshot. Issued
 * token consumers intentionally validate the stable organization only: the
 * frozen profile remains authoritative even if responsibility changes later.
 */
export function parseAssignmentIssuerIdentitySnapshot(
  value: unknown,
  expected: AssignmentIssuerIdentityOptionalExpectation = {}
): AssignmentIssuerIdentitySnapshotV1 | null {
  const root = exactRecord(value, ROOT_KEYS)
  if (!root) return null

  const snapshotOrgId = requiredText(root.orgId, 200)
  const snapshotProfileId = requiredText(root.profileId, 200)
  if (!snapshotOrgId || !snapshotProfileId) return null

  const expectedOrgId =
    expected.orgId === undefined
      ? snapshotOrgId
      : requiredText(expected.orgId, 200)
  const expectedProfileId =
    expected.profileId === undefined
      ? snapshotProfileId
      : requiredText(expected.profileId, 200)
  if (!expectedOrgId || !expectedProfileId) return null

  return parseAssignmentIssuerIdentitySnapshotV1(value, {
    orgId: expectedOrgId,
    profileId: expectedProfileId,
  })
}

export function isAssignmentIssuerIdentitySnapshotV1(
  value: unknown,
  expected: AssignmentIssuerIdentityExpectation
): value is AssignmentIssuerIdentitySnapshotV1 {
  return parseAssignmentIssuerIdentitySnapshotV1(value, expected) !== null
}
