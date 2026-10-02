import { normalizeFortnoxOrganizationNumber } from '@/lib/fortnox/domain'

export type OrganizationProfileValues = {
  name: string
  organizationNumber: string | null
  address: string | null
  postalCode: string | null
  city: string | null
  website: string | null
  logoPath: string | null
  reportFooterText: string | null
}

export type OrganizationBranding = OrganizationProfileValues & {
  id: string
  configured: boolean
  version: number
}

export type OrganizationAdministrationWorkspace = {
  profileId: string
  role: 'admin' | 'inspector'
  organization: OrganizationBranding
  modules: string[]
  migrationRequired: boolean
}

export function parseOrganizationProfile(value: unknown): OrganizationProfileValues {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('ORG_INPUT_INVALID')
  const input = value as Record<string, unknown>
  const keys = ['name', 'organizationNumber', 'address', 'postalCode', 'city', 'website', 'logoPath', 'reportFooterText']
  if (Object.keys(input).length !== keys.length || keys.some(key => !Object.hasOwn(input, key))) {
    throw new Error('ORG_INPUT_INVALID')
  }
  const field = (key: string, max: number) => {
    const raw = input[key]
    if (raw === null || raw === '') return null
    if (typeof raw !== 'string' || raw.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(raw)) {
      throw new Error('ORG_INPUT_INVALID')
    }
    return raw.trim() || null
  }
  const name = field('name', 240)
  if (!name) throw new Error('ORG_INPUT_INVALID')
  const rawNumber = field('organizationNumber', 40)
  const organizationNumber = rawNumber ? normalizeFortnoxOrganizationNumber(rawNumber) : null
  if (rawNumber && !organizationNumber) throw new Error('ORG_INPUT_INVALID')
  let website = field('website', 500)
  if (website) {
    if (!/^https?:\/\//iu.test(website)) website = `https://${website}`
    let parsed: URL
    try { parsed = new URL(website) } catch { throw new Error('ORG_INPUT_INVALID') }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || !parsed.hostname.includes('.')) {
      throw new Error('ORG_INPUT_INVALID')
    }
    website = parsed.toString()
    if (website.length > 500) throw new Error('ORG_INPUT_INVALID')
  }
  return {
    name, organizationNumber, website,
    address: field('address', 300), postalCode: field('postalCode', 40), city: field('city', 160),
    logoPath: field('logoPath', 2048), reportFooterText: field('reportFooterText', 2000),
  }
}
