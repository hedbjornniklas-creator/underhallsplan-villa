import { isOrganizationUuid } from '@/lib/organizations/administrationHttp'

export type OrganizationSenderProfileValues = {
  name: string
  address: string | null
  postalCode: string | null
  city: string | null
  email: string | null
  phone: string | null
  website: string | null
  logoPath: string | null
  reportFooterText: string | null
  isActive: boolean
}

export type OrganizationSenderProfile = OrganizationSenderProfileValues & { id: string; orgId: string; version: number }
export type OrganizationSenderWorkspace = {
  organization: { id: string; name: string; organizationNumber: string | null; legalName: string | null; legalNameVersion: number }
  canEdit: boolean
  migrationRequired: boolean
  profiles: OrganizationSenderProfile[]
}
export type OrganizationSenderMutation =
  | { action: 'legalName'; expectedVersion: number; legalName: string }
  | { action: 'saveProfile'; id: string; expectedVersion: number; values: OrganizationSenderProfileValues }

function exact(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('ORG_INPUT_INVALID')
  const input = value as Record<string, unknown>
  if (Object.keys(input).length !== keys.length || keys.some(key => !Object.hasOwn(input, key))) throw new Error('ORG_INPUT_INVALID')
  return input
}

function text(value: unknown, limit: number, multiline = false): string | null {
  if (value === null) return null
  if (typeof value !== 'string' || value.length > limit ||
    (multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u : /[\u0000-\u001f\u007f]/u).test(value)) throw new Error('ORG_INPUT_INVALID')
  return value.trim() || null
}

export function parseOrganizationSenderMutation(value: unknown): OrganizationSenderMutation {
  const action = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>).action : null
  const input = exact(value, action === 'legalName' ? ['action', 'expectedVersion', 'legalName'] : ['action', 'id', 'expectedVersion', 'values'])
  if (!Number.isSafeInteger(input.expectedVersion) || (input.expectedVersion as number) < 0) throw new Error('ORG_INPUT_INVALID')
  const expectedVersion = input.expectedVersion as number
  if (action === 'legalName') {
    const legalName = text(input.legalName, 240)
    if (!legalName) throw new Error('ORG_INPUT_INVALID')
    return { action, expectedVersion, legalName }
  }
  if (action !== 'saveProfile' || !isOrganizationUuid(input.id)) throw new Error('ORG_INPUT_INVALID')
  const fields = exact(input.values, ['name', 'address', 'postalCode', 'city', 'email', 'phone', 'website', 'logoPath', 'reportFooterText', 'isActive'])
  const name = text(fields.name, 240)
  if (!name || typeof fields.isActive !== 'boolean' || (expectedVersion === 0 && !fields.isActive)) throw new Error('ORG_INPUT_INVALID')
  const email = text(fields.email, 320)?.toLowerCase() ?? null
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) throw new Error('ORG_INPUT_INVALID')
  let website = text(fields.website, 500)
  if (website) {
    if (!/^https?:\/\//iu.test(website)) website = `https://${website}`
    let parsed: URL
    try { parsed = new URL(website) } catch { throw new Error('ORG_INPUT_INVALID') }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || !parsed.hostname.includes('.')) throw new Error('ORG_INPUT_INVALID')
    website = parsed.toString()
    if (website.length > 500) throw new Error('ORG_INPUT_INVALID')
  }
  return { action, id: input.id.toLowerCase(), expectedVersion, values: {
    name, address: text(fields.address, 300), postalCode: text(fields.postalCode, 40), city: text(fields.city, 160),
    email, phone: text(fields.phone, 80), website, logoPath: text(fields.logoPath, 2048),
    reportFooterText: text(fields.reportFooterText, 2000, true), isActive: fields.isActive,
  } }
}
