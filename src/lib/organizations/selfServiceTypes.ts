import { normalizeFortnoxOrganizationNumber } from '@/lib/fortnox/domain'
import { isOrganizationUuid } from '@/lib/organizations/administrationHttp'

export type SelfServiceOrganizationCreate = {
  requestId: string
  name: string
  organizationNumber: string
}

export function parseSelfServiceOrganizationCreate(value: unknown): SelfServiceOrganizationCreate {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('ORG_INPUT_INVALID')
  const input = value as Record<string, unknown>
  const keys = ['requestId', 'name', 'organizationNumber']
  if (Object.keys(input).length !== keys.length || keys.some(key => !Object.hasOwn(input, key)) ||
      !isOrganizationUuid(input.requestId) || typeof input.name !== 'string' || !input.name.trim() ||
      Array.from(input.name).length > 240 || /[\u0000-\u001f\u007f]/u.test(input.name) ||
      typeof input.organizationNumber !== 'string') throw new Error('ORG_INPUT_INVALID')
  const organizationNumber = normalizeFortnoxOrganizationNumber(input.organizationNumber)
  if (!organizationNumber) throw new Error('ORG_INPUT_INVALID')
  return { requestId: input.requestId.toLowerCase(), name: input.name.trim(), organizationNumber }
}
