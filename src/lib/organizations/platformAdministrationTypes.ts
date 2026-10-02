import { normalizeFortnoxOrganizationNumber } from '@/lib/fortnox/domain'
import { isOrganizationUuid } from '@/lib/organizations/administrationHttp'

export const PLATFORM_ORGANIZATION_MODULE = 'technical_investigations'
export type PlatformOrganizationRole = 'admin' | 'inspector'
export type PlatformOrganizationMemberState = {
  role: PlatformOrganizationRole
  isActive: boolean
  modules: string[]
}
export type PlatformOrganizationSummary = {
  id: string
  name: string
  organizationNumber: string | null
  modules: string[]
  tuManaged: boolean
}
export type PlatformOrganizationMember = PlatformOrganizationMemberState & {
  profileId: string
  displayName: string | null
  email: string | null
}
export type PlatformOrganizationDirectory = {
  organizations: (PlatformOrganizationSummary & { activeMemberCount: number; activeAdminCount: number })[]
  users: { id: string; fullName: string | null; email: string | null }[]
}
export type PlatformOrganizationDetail = {
  organization: PlatformOrganizationSummary
  members: PlatformOrganizationMember[]
}

function exactObject(value: unknown, keys: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('ORG_INPUT_INVALID')
  const input = value as Record<string, unknown>
  if (Object.keys(input).length !== keys.length || keys.some(key => !Object.hasOwn(input, key))) {
    throw new Error('ORG_INPUT_INVALID')
  }
  return input
}

export function parsePlatformOrganizationId(value: unknown) {
  if (!isOrganizationUuid(value)) throw new Error('ORG_INPUT_INVALID')
  return value.toLowerCase()
}

function modules(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 1 || value.some(key => key !== PLATFORM_ORGANIZATION_MODULE)) {
    throw new Error('ORG_INPUT_INVALID')
  }
  return [...value]
}

function memberState(value: unknown): PlatformOrganizationMemberState {
  const input = exactObject(value, ['role', 'isActive', 'modules'])
  if ((input.role !== 'admin' && input.role !== 'inspector') || typeof input.isActive !== 'boolean') {
    throw new Error('ORG_INPUT_INVALID')
  }
  const selected = modules(input.modules)
  if (!input.isActive && selected.length) throw new Error('ORG_INPUT_INVALID')
  return { role: input.role, isActive: input.isActive, modules: selected }
}

export function parsePlatformOrganizationCreate(value: unknown) {
  const input = exactObject(value, ['requestId', 'name', 'organizationNumber', 'adminProfileId', 'modules'])
  if (typeof input.name !== 'string' || !input.name.trim() || input.name.length > 240 ||
    /[\u0000-\u001f\u007f]/u.test(input.name)) throw new Error('ORG_INPUT_INVALID')
  if (input.organizationNumber !== null && typeof input.organizationNumber !== 'string') throw new Error('ORG_INPUT_INVALID')
  const rawNumber = input.organizationNumber?.trim() || null
  const organizationNumber = rawNumber ? normalizeFortnoxOrganizationNumber(rawNumber) : null
  if (rawNumber && !organizationNumber) throw new Error('ORG_INPUT_INVALID')
  return {
    requestId: parsePlatformOrganizationId(input.requestId), name: input.name.trim(), organizationNumber,
    adminProfileId: parsePlatformOrganizationId(input.adminProfileId), modules: modules(input.modules),
  }
}

export function parsePlatformOrganizationModules(value: unknown) {
  const input = exactObject(value, ['expectedModules', 'modules'])
  return { expectedModules: modules(input.expectedModules), modules: modules(input.modules) }
}

export function parsePlatformOrganizationMember(value: unknown) {
  const input = exactObject(value, ['profileId', 'expected', 'role', 'isActive', 'modules'])
  return {
    profileId: parsePlatformOrganizationId(input.profileId),
    expected: input.expected === null ? null : memberState(input.expected),
    ...memberState({ role: input.role, isActive: input.isActive, modules: input.modules }),
  }
}
