import { normalizeFortnoxOrganizationNumber } from '@/lib/fortnox/domain'

export type OrganizationProfileCardSource =
  | 'organization_card'
  | 'legacy_profile'
  | 'unconfigured'

export type OrganizationProfileCardValues = {
  displayName: string
  title: string | null
  phone: string | null
  email: string | null
  companyName: string
  companyOrgNo: string | null
  companyAddress: string | null
  companyPostalCode: string | null
  companyCity: string | null
  avatarPath: string | null
  logoPath: string | null
  signaturePath: string | null
  reportFooterText: string | null
}

export type ResolvedOrganizationProfileCard = OrganizationProfileCardValues & {
  id: string | null
  orgId: string
  profileId: string
  source: OrganizationProfileCardSource
  configured: boolean
  migrationRequired: boolean
  isDefaultOrganization: boolean
  version: number | null
  createdAt: string | null
  updatedAt: string | null
}

export type OrganizationProfileWorkspace = {
  profileId: string
  organization: {
    id: string
    name: string | null
    isDefault: boolean
  }
  role: 'admin' | 'inspector'
  configured: boolean
  migrationRequired: boolean
  version: number | null
  source: OrganizationProfileCardSource
  card: OrganizationProfileCardValues
}

const FIELD_NAMES = [
  'displayName',
  'title',
  'phone',
  'email',
  'companyName',
  'companyOrgNo',
  'companyAddress',
  'companyPostalCode',
  'companyCity',
  'avatarPath',
  'logoPath',
  'signaturePath',
  'reportFooterText',
] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function optionalText(value: unknown, maxLength: number) {
  if (value === null || value === undefined || value === '') return null
  if (typeof value !== 'string') throw new Error('ORG_PROFILE_CARD_INPUT_INVALID')
  const normalized = value.trim()
  if (!normalized) return null
  if (normalized.length > maxLength) throw new Error('ORG_PROFILE_CARD_INPUT_INVALID')
  return normalized
}

function requiredText(value: unknown, maxLength: number) {
  const normalized = optionalText(value, maxLength)
  if (!normalized) throw new Error('ORG_PROFILE_CARD_REQUIRED_FIELDS')
  return normalized
}

function mediaPath(value: unknown) {
  const normalized = optionalText(value, 2_048)
  if (!normalized) return null
  const lower = normalized.toLowerCase()
  if (
    lower.startsWith('data:') ||
    lower.startsWith('javascript:') ||
    lower.startsWith('vbscript:')
  ) {
    throw new Error('ORG_PROFILE_CARD_INPUT_INVALID')
  }
  return normalized
}

export function parseOrganizationProfileCardValues(
  value: unknown
): OrganizationProfileCardValues {
  if (!isRecord(value)) throw new Error('ORG_PROFILE_CARD_INPUT_INVALID')
  if (
    Object.keys(value).some(
      (key) => !(FIELD_NAMES as readonly string[]).includes(key)
    )
  ) {
    throw new Error('ORG_PROFILE_CARD_INPUT_INVALID')
  }

  const email = optionalText(value.email, 320)?.toLowerCase() ?? null
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) {
    throw new Error('ORG_PROFILE_CARD_EMAIL_INVALID')
  }
  const rawCompanyOrgNo = optionalText(value.companyOrgNo, 40)
  const companyOrgNo = rawCompanyOrgNo
    ? normalizeFortnoxOrganizationNumber(rawCompanyOrgNo)
    : null
  if (rawCompanyOrgNo && !companyOrgNo) {
    throw new Error('ORG_PROFILE_CARD_ORGNO_INVALID')
  }

  return {
    displayName: requiredText(value.displayName, 200),
    title: optionalText(value.title, 160),
    phone: optionalText(value.phone, 80),
    email,
    companyName: requiredText(value.companyName, 240),
    companyOrgNo,
    companyAddress: optionalText(value.companyAddress, 300),
    companyPostalCode: optionalText(value.companyPostalCode, 40),
    companyCity: optionalText(value.companyCity, 160),
    avatarPath: mediaPath(value.avatarPath),
    logoPath: mediaPath(value.logoPath),
    signaturePath: mediaPath(value.signaturePath),
    reportFooterText: optionalText(value.reportFooterText, 2_000),
  }
}
