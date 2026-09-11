import {
  normalizeOrganizationCustomerIdentity,
  type OrganizationCustomerType,
} from '@/lib/customers/domain'

export type ExistingAssignmentCustomerBinding = {
  mode: 'existing'
  customerId: string
  customerVersion: number
}

export type CreateAssignmentCustomerBinding = {
  mode: 'create'
  customerType: OrganizationCustomerType
  identityNumber: string | null
}

export type AssignmentCustomerBinding =
  | ExistingAssignmentCustomerBinding
  | CreateAssignmentCustomerBinding

export type AssignmentCustomerReference = {
  id: string
  customerNumber: string
  version: number
  created: boolean
}

export type AssignmentCustomerResult = {
  assignmentId: string
  assignmentUpdatedAt: string
  customer: AssignmentCustomerReference
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/u

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(value)
  return actual.length === keys.length && actual.every((key) => keys.includes(key))
}

export function parseAssignmentCustomerOrganizationId(value: unknown) {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new Error('ASSIGNMENT_CUSTOMER_ORGANIZATION_INVALID')
  }
  return value
}

export function parseAssignmentCustomerAssignmentId(value: unknown) {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new Error('ASSIGNMENT_CUSTOMER_ASSIGNMENT_INVALID')
  }
  return value
}

export function parseAssignmentCustomerExpectedUpdatedAt(value: unknown) {
  if (
    typeof value !== 'string' ||
    value.length > 40 ||
    !TIMESTAMP_PATTERN.test(value) ||
    !Number.isFinite(Date.parse(value))
  ) {
    throw new Error('ASSIGNMENT_CUSTOMER_VERSION_INVALID')
  }
  return value
}

/**
 * The choice is always explicit. In particular, no email/name lookup is accepted
 * as a customer selector because private customers may share contact details.
 */
export function parseAssignmentCustomerBinding(value: unknown): AssignmentCustomerBinding {
  if (!isRecord(value) || typeof value.mode !== 'string') {
    throw new Error('ASSIGNMENT_CUSTOMER_BINDING_INVALID')
  }

  if (value.mode === 'create') {
    if (!hasExactKeys(value, ['mode', 'customerType', 'identityNumber'])) {
      throw new Error('ASSIGNMENT_CUSTOMER_BINDING_INVALID')
    }
    if (value.customerType !== 'business' && value.customerType !== 'private') {
      throw new Error('CUSTOMER_TYPE_INVALID')
    }
    if (value.identityNumber !== null && typeof value.identityNumber !== 'string') {
      throw new Error('CUSTOMER_IDENTITY_INVALID')
    }
    const identityNumber =
      value.identityNumber === null || value.identityNumber.trim() === ''
        ? null
        : normalizeOrganizationCustomerIdentity(value.identityNumber, value.customerType)
    if (value.identityNumber && !identityNumber) {
      throw new Error('CUSTOMER_IDENTITY_INVALID')
    }
    if (value.customerType === 'business' && !identityNumber) {
      throw new Error('CUSTOMER_IDENTITY_REQUIRED')
    }
    return {
      mode: 'create',
      customerType: value.customerType,
      identityNumber,
    }
  }

  if (value.mode !== 'existing' || !hasExactKeys(value, [
    'mode',
    'customerId',
    'customerVersion',
  ])) {
    throw new Error('ASSIGNMENT_CUSTOMER_BINDING_INVALID')
  }

  if (typeof value.customerId !== 'string' || !UUID_PATTERN.test(value.customerId)) {
    throw new Error('ASSIGNMENT_CUSTOMER_ID_INVALID')
  }
  if (!Number.isSafeInteger(value.customerVersion) || Number(value.customerVersion) <= 0) {
    throw new Error('ASSIGNMENT_CUSTOMER_VERSION_INVALID')
  }

  return {
    mode: 'existing',
    customerId: value.customerId,
    customerVersion: Number(value.customerVersion),
  }
}
