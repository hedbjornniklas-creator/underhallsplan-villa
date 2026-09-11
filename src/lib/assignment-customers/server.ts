import 'server-only'

import {
  requireProductAccess,
  type PlatformAccessContext,
} from '@/lib/access/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import {
  parseAssignmentCustomerAssignmentId,
  parseAssignmentCustomerBinding,
  parseAssignmentCustomerExpectedUpdatedAt,
  parseAssignmentCustomerOrganizationId,
  type AssignmentCustomerBinding,
  type AssignmentCustomerResult,
} from './domain'

export { parseAssignmentCustomerBinding } from './domain'
export type { AssignmentCustomerBinding, AssignmentCustomerResult } from './domain'

type DatabaseError = {
  code?: string | null
  message?: string | null
  details?: string | null
} | null

type RpcResultRow = {
  result_code?: unknown
  assignment_id?: unknown
  organization_customer_id?: unknown
  assignment_updated_at?: unknown
  customer_number?: unknown
  customer_version?: unknown
  customer_created?: unknown
}

const RESULT_FAILURES: Readonly<Record<string, string>> = Object.freeze({
  INVALID_REQUEST: 'ASSIGNMENT_CUSTOMER_REQUEST_INVALID',
  MEMBER_REQUIRED: 'ASSIGNMENT_CUSTOMER_MEMBER_REQUIRED',
  ASSIGNMENT_NOT_FOUND: 'ASSIGNMENT_CUSTOMER_ASSIGNMENT_NOT_FOUND',
  ASSIGNMENT_VERSION_CONFLICT: 'ASSIGNMENT_CUSTOMER_ASSIGNMENT_VERSION_CONFLICT',
  LINK_CONFLICT: 'ASSIGNMENT_CUSTOMER_LINK_CONFLICT',
  CUSTOMER_NOT_FOUND: 'ASSIGNMENT_CUSTOMER_NOT_FOUND',
  CUSTOMER_INACTIVE: 'ASSIGNMENT_CUSTOMER_INACTIVE',
  CUSTOMER_VERSION_CONFLICT: 'ASSIGNMENT_CUSTOMER_VERSION_CONFLICT',
  CUSTOMER_IDENTITY_CONFLICT: 'ASSIGNMENT_CUSTOMER_IDENTITY_CONFLICT',
  CUSTOMER_EMAIL_REQUIRED: 'ASSIGNMENT_CUSTOMER_EMAIL_REQUIRED',
  CUSTOMER_SNAPSHOT_INCOMPLETE: 'ASSIGNMENT_CUSTOMER_SNAPSHOT_INCOMPLETE',
})

const SUCCESS_CODES = new Set(['LINKED', 'CREATED_AND_LINKED', 'ALREADY_LINKED'])

function databaseFailure(error: DatabaseError): never {
  if (
    error?.code === '42P01' ||
    error?.code === '42703' ||
    error?.code === '42883' ||
    error?.code === 'PGRST202' ||
    error?.code === 'PGRST204' ||
    error?.code === 'PGRST205'
  ) {
    throw new Error('ASSIGNMENT_CUSTOMERS_SCHEMA_REQUIRED')
  }
  if (error?.code === '23505') {
    const safeConstraintText = `${error.message ?? ''} ${error.details ?? ''}`
    if (
      safeConstraintText.includes('organization_customers_organization_number_uidx') ||
      safeConstraintText.includes('organization_customers_personal_identity_number_uidx')
    ) {
      throw new Error('ASSIGNMENT_CUSTOMER_IDENTITY_CONFLICT')
    }
  }
  throw new Error('ASSIGNMENT_CUSTOMER_DATABASE_FAILED')
}

function canAccessOrganization(context: PlatformAccessContext, orgId: string) {
  const dashboardAssignments = context.assignments.filter(
    (assignment) => assignment.productKey === 'dashboard'
  )
  if (dashboardAssignments.length === 0) return true
  return dashboardAssignments.some(
    (assignment) =>
      assignment.scopeType === 'organization' && assignment.scopeId === orgId
  )
}

async function requireActiveOrganizationMember(orgId: string) {
  const context = await requireProductAccess('dashboard')
  if (!canAccessOrganization(context, orgId)) {
    throw new Error('ASSIGNMENT_CUSTOMER_MEMBER_REQUIRED')
  }

  const admin = createSupabaseAdminClient()
  const { data, error } = await admin
    .from('org_members')
    .select('org_id')
    .eq('org_id', orgId)
    .eq('profile_id', context.identity.profileId)
    .eq('is_active', true)
    .maybeSingle()

  if (error) databaseFailure(error)
  if (!data) throw new Error('ASSIGNMENT_CUSTOMER_MEMBER_REQUIRED')
  return { admin, profileId: context.identity.profileId }
}

function rpcArgs(
  orgId: string,
  assignmentId: string,
  expectedAssignmentUpdatedAt: string,
  binding: AssignmentCustomerBinding,
  profileId: string
) {
  return {
    p_org_id: orgId,
    p_assignment_id: assignmentId,
    p_expected_assignment_updated_at: expectedAssignmentUpdatedAt,
    p_mode: binding.mode,
    p_customer_id: binding.mode === 'existing' ? binding.customerId : null,
    p_expected_customer_version:
      binding.mode === 'existing' ? binding.customerVersion : null,
    p_customer_type: binding.mode === 'create' ? binding.customerType : null,
    p_identity_number: binding.mode === 'create' ? binding.identityNumber : null,
    p_actor_profile_id: profileId,
  }
}

function asResultRow(value: unknown): RpcResultRow {
  const candidate = Array.isArray(value)
    ? value.length === 1
      ? value[0]
      : null
    : value
  if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) {
    throw new Error('ASSIGNMENT_CUSTOMER_DATABASE_FAILED')
  }
  return candidate as RpcResultRow
}

function positiveSafeInteger(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error('ASSIGNMENT_CUSTOMER_DATABASE_FAILED')
  }
  return parsed
}

function customerNumber(value: unknown) {
  const normalized =
    typeof value === 'number' && Number.isSafeInteger(value)
      ? String(value)
      : typeof value === 'string'
        ? value
        : ''
  if (
    !/^[1-9][0-9]{0,18}$/u.test(normalized) ||
    normalized.length < 4 ||
    (normalized.length === 4 && normalized < '1001')
  ) {
    throw new Error('ASSIGNMENT_CUSTOMER_DATABASE_FAILED')
  }
  return normalized
}

function parseRpcResult(value: unknown, expectedAssignmentId: string): AssignmentCustomerResult {
  const row = asResultRow(value)
  if (typeof row.result_code !== 'string') {
    throw new Error('ASSIGNMENT_CUSTOMER_DATABASE_FAILED')
  }
  const failure = RESULT_FAILURES[row.result_code]
  if (failure) throw new Error(failure)
  if (!SUCCESS_CODES.has(row.result_code)) {
    throw new Error('ASSIGNMENT_CUSTOMER_DATABASE_FAILED')
  }

  let assignmentId: string
  let id: string
  let assignmentUpdatedAt: string
  try {
    assignmentId = parseAssignmentCustomerAssignmentId(row.assignment_id)
    id = parseAssignmentCustomerAssignmentId(row.organization_customer_id)
    assignmentUpdatedAt = parseAssignmentCustomerExpectedUpdatedAt(
      row.assignment_updated_at
    )
  } catch {
    throw new Error('ASSIGNMENT_CUSTOMER_DATABASE_FAILED')
  }
  if (assignmentId !== expectedAssignmentId) {
    throw new Error('ASSIGNMENT_CUSTOMER_DATABASE_FAILED')
  }
  const version = positiveSafeInteger(row.customer_version)
  if (
    typeof row.customer_created !== 'boolean' ||
    row.customer_created !== (row.result_code === 'CREATED_AND_LINKED')
  ) {
    throw new Error('ASSIGNMENT_CUSTOMER_DATABASE_FAILED')
  }

  return {
    assignmentId,
    assignmentUpdatedAt,
    customer: {
      id,
      customerNumber: customerNumber(row.customer_number),
      version,
      created: row.customer_created,
    },
  }
}

/**
 * Atomically links an assignment to an explicitly selected customer, or creates
 * one from the assignment's locked customer snapshot. No name/email matching is
 * performed. Active inspectors may use this from an already authorized module;
 * the exact active organization membership is verified again here and in SQL.
 */
export async function assignOrganizationCustomer(
  orgIdValue: unknown,
  assignmentIdValue: unknown,
  expectedAssignmentUpdatedAtValue: unknown,
  bindingValue: unknown
): Promise<AssignmentCustomerResult> {
  const orgId = parseAssignmentCustomerOrganizationId(orgIdValue)
  const assignmentId = parseAssignmentCustomerAssignmentId(assignmentIdValue)
  const expectedAssignmentUpdatedAt = parseAssignmentCustomerExpectedUpdatedAt(
    expectedAssignmentUpdatedAtValue
  )
  const binding = parseAssignmentCustomerBinding(bindingValue)
  const { admin, profileId } = await requireActiveOrganizationMember(orgId)

  const { data, error } = await admin.rpc(
    'assign_organization_customer',
    rpcArgs(orgId, assignmentId, expectedAssignmentUpdatedAt, binding, profileId)
  )
  if (error) databaseFailure(error)
  return parseRpcResult(data, assignmentId)
}

/**
 * Best-effort compensation for a module flow that created a draft but could
 * not complete its customer link. The strict filters ensure that a draft is
 * never removed after it has been linked, sent, changed or taken over.
 */
export async function discardUnlinkedAssignmentDraft(
  orgIdValue: unknown,
  assignmentIdValue: unknown,
  expectedAssignmentUpdatedAtValue: unknown
) {
  const orgId = parseAssignmentCustomerOrganizationId(orgIdValue)
  const assignmentId = parseAssignmentCustomerAssignmentId(assignmentIdValue)
  const expectedAssignmentUpdatedAt = parseAssignmentCustomerExpectedUpdatedAt(
    expectedAssignmentUpdatedAtValue
  )
  const { admin, profileId } = await requireActiveOrganizationMember(orgId)
  const { data, error } = await admin
    .from('assignments')
    .delete()
    .eq('org_id', orgId)
    .eq('id', assignmentId)
    .eq('created_by', profileId)
    .eq('status', 'draft')
    .eq('updated_at', expectedAssignmentUpdatedAt)
    .is('organization_customer_id', null)
    .select('id')
    .maybeSingle()

  if (error) databaseFailure(error)
  return Boolean(data)
}
