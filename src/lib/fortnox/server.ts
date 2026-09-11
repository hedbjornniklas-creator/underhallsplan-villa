import 'server-only'

import { createHash, randomBytes } from 'node:crypto'
import {
  requireModuleAccess,
  requireProductAccess,
  type PlatformAccessContext,
} from '@/lib/access/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import {
  FORTNOX_CONNECTION_SCOPES,
  buildFortnoxCustomerDraft,
  buildFortnoxCustomerIdentity,
  buildFortnoxAuthorizationUrl,
  hasAllowedFortnoxConnectionScopes,
  hasExactFortnoxScopes,
  normalizeFortnoxOrganizationNumber,
  normalizeFortnoxScopes,
} from './domain'
import {
  createFortnoxCustomer,
  exchangeFortnoxAuthorizationCode,
  fetchFortnoxCustomer,
  fetchFortnoxCompanyInformation,
  findFortnoxCustomersByOrganizationNumber,
  getFortnoxConfiguration,
  isFortnoxConfigured,
  requestFortnoxClientCredentialsToken,
} from './provider'
import type { OrganizationCustomer } from '@/lib/customers/domain'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const OAUTH_STATE_PATTERN = /^[A-Za-z0-9_-]{32,200}$/
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000
const FORTNOX_CUSTOMER_OPERATION_SCOPES = Object.freeze([
  'companyinformation',
  'customer',
] as const)
const FORTNOX_CUSTOMER_DATABASE_COLUMNS = [
  'id',
  'org_id',
  'customer_number',
  'customer_type',
  'name',
  'organization_number',
  'personal_identity_number',
  'email',
  'phone',
  'address',
  'address_line_2',
  'postal_code',
  'city',
  'country_code',
  'invoice_same_as_customer',
  'invoice_name',
  'invoice_email',
  'invoice_address',
  'invoice_address_line_2',
  'invoice_postal_code',
  'invoice_city',
  'invoice_country_code',
  'invoice_reference',
  'fortnox_tenant_id',
  'fortnox_customer_number',
  'fortnox_synced_at',
  'is_active',
  'version',
  'created_at',
  'updated_at',
].join(',')

type DatabaseError = {
  code?: string | null
  message?: string | null
} | null

type OrgMembershipRow = {
  org_id: string
  role: 'admin' | 'inspector'
  is_default: boolean
  created_at: string
}

type OrganizationRow = {
  id: string
  name: string
  organization_number: string | null
}

class FortnoxCallbackFailure extends Error {
  readonly orgId: string

  constructor(error: unknown, orgId: string) {
    super(error instanceof Error ? error.message : 'FORTNOX_REQUEST_FAILED')
    this.name = 'FortnoxCallbackFailure'
    this.orgId = orgId
  }
}

export function fortnoxCallbackFailureOrganizationId(error: unknown) {
  return error instanceof FortnoxCallbackFailure ? error.orgId : undefined
}

type FortnoxConnectionRow = {
  org_id: string
  company_name: string
  company_organization_number: string
  granted_scopes: string[]
  status: 'connected' | 'needs_reauthorization'
  connected_at: string
  last_verified_at: string
}

type FortnoxVerifiableConnectionRow = FortnoxConnectionRow & {
  tenant_id: string
  connection_version: number | string
}

type AppliedVerificationRow = FortnoxConnectionRow & {
  connection_version: number | string
}

type ConsumedStateRow = {
  org_id: string
  requested_scopes: string[]
}

type FortnoxCustomerDatabaseRow = {
  id: string
  org_id: string
  customer_number: number | string
  customer_type: 'business' | 'private'
  name: string
  organization_number: string | null
  personal_identity_number: string | null
  email: string | null
  phone: string | null
  address: string | null
  address_line_2: string | null
  postal_code: string | null
  city: string | null
  country_code: string
  invoice_same_as_customer: boolean
  invoice_name: string | null
  invoice_email: string | null
  invoice_address: string | null
  invoice_address_line_2: string | null
  invoice_postal_code: string | null
  invoice_city: string | null
  invoice_country_code: string | null
  invoice_reference: string | null
  fortnox_tenant_id: string | null
  fortnox_customer_number: string | null
  fortnox_synced_at: string | null
  is_active: boolean
  version: number | string
  created_at: string
  updated_at: string
}

type FortnoxCustomerBindingRow = {
  result_code: string
  customer_id: string | null
  bound_org_id: string | null
  bound_tenant_id: string | null
  bound_fortnox_customer_number: string | null
  bound_at: string | null
  customer_version: number | string | null
  customer_updated_at: string | null
}

export type FortnoxConnectionStatus = {
  companyName: string
  organizationNumber: string
  grantedScopes: string[]
  status: 'connected' | 'needs_reauthorization'
  connectedAt: string
  lastVerifiedAt: string
}

export type FortnoxOrganizationSettings = {
  id: string
  name: string
  organizationNumber: string | null
  isDefault: boolean
  canManage: boolean
  connection: FortnoxConnectionStatus | null
}

function assertOrganizationId(orgId: string) {
  if (!UUID_PATTERN.test(orgId)) throw new Error('FORTNOX_ORGANIZATION_INVALID')
}

function throwDatabaseError(error: DatabaseError): never {
  if (
    error?.code === '42P01' ||
    error?.code === '42703' ||
    error?.code === '42883' ||
    error?.code === 'PGRST202' ||
    error?.code === 'PGRST204' ||
    error?.code === 'PGRST205'
  ) {
    throw new Error('FORTNOX_DATABASE_NOT_READY')
  }
  throw new Error('FORTNOX_DATABASE_FAILED')
}

function hasNormalizedOrganizationAdminAccess(context: PlatformAccessContext, orgId: string) {
  const dashboardAssignments = context.assignments.filter(
    (assignment) => assignment.productKey === 'dashboard'
  )

  // This mirrors the access layer's legacy fallback when no normalized
  // Dashboard assignment exists for the profile.
  if (dashboardAssignments.length === 0) return true

  return dashboardAssignments.some((assignment) => {
    const isAdminModule =
      assignment.moduleKey === 'admin' ||
      (!assignment.moduleKey && assignment.roleKey === 'dashboard_admin')

    return (
      isAdminModule &&
      assignment.scopeType === 'organization' &&
      assignment.scopeId === orgId
    )
  })
}

async function loadExactOrganization(
  context: PlatformAccessContext,
  orgId: string,
  requireAdmin: boolean
) {
  const admin = createSupabaseAdminClient()
  let membershipQuery = admin
    .from('org_members')
    .select('org_id,role,is_default,created_at')
    .eq('org_id', orgId)
    .eq('profile_id', context.identity.profileId)
    .eq('is_active', true)

  if (requireAdmin) membershipQuery = membershipQuery.eq('role', 'admin')

  const { data: membershipData, error: membershipError } = await membershipQuery.maybeSingle()
  if (membershipError) throwDatabaseError(membershipError)
  if (!membershipData) {
    throw new Error(requireAdmin ? 'FORTNOX_ORGANIZATION_ADMIN_REQUIRED' : 'FORTNOX_ORGANIZATION_MEMBER_REQUIRED')
  }

  const { data: organizationData, error: organizationError } = await admin
    .from('organizations')
    .select('id,name,organization_number')
    .eq('id', orgId)
    .maybeSingle()

  if (organizationError) throwDatabaseError(organizationError)
  if (!organizationData) throw new Error('FORTNOX_ORGANIZATION_NOT_FOUND')

  return {
    context,
    membership: membershipData as OrgMembershipRow,
    organization: organizationData as OrganizationRow,
  }
}

async function requireFortnoxOrganizationAdmin(orgId: string) {
  assertOrganizationId(orgId)
  const context = await requireModuleAccess({
    productKey: 'dashboard',
    moduleKey: 'admin',
    scopeType: 'organization',
    scopeId: orgId,
  })
  return loadExactOrganization(context, orgId, true)
}

function mapConnection(row: FortnoxConnectionRow): FortnoxConnectionStatus {
  const grantedScopes = normalizeFortnoxScopes(row.granted_scopes)
  return {
    companyName: row.company_name,
    organizationNumber: row.company_organization_number,
    grantedScopes,
    status:
      row.status === 'connected' &&
      hasExactFortnoxScopes(grantedScopes, FORTNOX_CONNECTION_SCOPES)
        ? 'connected'
        : 'needs_reauthorization',
    connectedAt: row.connected_at,
    lastVerifiedAt: row.last_verified_at,
  }
}

export async function getFortnoxSettings(): Promise<{
  configured: boolean
  organizations: FortnoxOrganizationSettings[]
}> {
  const context = await requireProductAccess('dashboard')
  const admin = createSupabaseAdminClient()
  const { data: membershipData, error: membershipError } = await admin
    .from('org_members')
    .select('org_id,role,is_default,created_at')
    .eq('profile_id', context.identity.profileId)
    .eq('is_active', true)
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: true })

  if (membershipError) throwDatabaseError(membershipError)
  const memberships = (membershipData ?? []) as OrgMembershipRow[]
  if (memberships.length === 0) {
    return { configured: isFortnoxConfigured(), organizations: [] }
  }

  const orgIds = memberships.map((membership) => membership.org_id)
  const [organizationsResult, connectionsResult] = await Promise.all([
    admin
      .from('organizations')
      .select('id,name,organization_number')
      .in('id', orgIds),
    admin
      .from('fortnox_connections')
      .select(
        'org_id,company_name,company_organization_number,granted_scopes,status,connected_at,last_verified_at'
      )
      .in('org_id', orgIds),
  ])

  if (organizationsResult.error) throwDatabaseError(organizationsResult.error)
  if (connectionsResult.error) throwDatabaseError(connectionsResult.error)

  const organizationsById = new Map(
    ((organizationsResult.data ?? []) as OrganizationRow[]).map((organization) => [
      organization.id,
      organization,
    ])
  )
  const connectionsByOrgId = new Map(
    ((connectionsResult.data ?? []) as FortnoxConnectionRow[]).map((connection) => [
      connection.org_id,
      connection,
    ])
  )

  return {
    configured: isFortnoxConfigured(),
    organizations: memberships.flatMap((membership) => {
      const organization = organizationsById.get(membership.org_id)
      if (!organization) return []
      const connection = connectionsByOrgId.get(membership.org_id)

      return [
        {
          id: organization.id,
          name: organization.name,
          organizationNumber: organization.organization_number,
          isDefault: membership.is_default,
          canManage:
            membership.role === 'admin' &&
            hasNormalizedOrganizationAdminAccess(context, organization.id),
          connection: connection ? mapConnection(connection) : null,
        },
      ]
    }),
  }
}

export async function updateFortnoxOrganizationNumber(orgId: string, value: string) {
  const { organization } = await requireFortnoxOrganizationAdmin(orgId)
  const organizationNumber = normalizeFortnoxOrganizationNumber(value)
  if (!organizationNumber) throw new Error('FORTNOX_ORGANIZATION_NUMBER_INVALID')

  const admin = createSupabaseAdminClient()
  const { data: connectionData, error: connectionError } = await admin
    .from('fortnox_connections')
    .select('company_organization_number')
    .eq('org_id', orgId)
    .maybeSingle()

  if (connectionError) throwDatabaseError(connectionError)
  if (
    connectionData &&
    String(connectionData.company_organization_number) !== organizationNumber
  ) {
    throw new Error('FORTNOX_ORGANIZATION_NUMBER_LOCKED')
  }

  if (organization.organization_number !== organizationNumber) {
    const { error } = await admin
      .from('organizations')
      .update({ organization_number: organizationNumber })
      .eq('id', orgId)

    if (error?.code === '23503') throw new Error('FORTNOX_ORGANIZATION_NUMBER_LOCKED')
    if (error) throwDatabaseError(error)
  }

  return organizationNumber
}

function newOAuthState() {
  const state = randomBytes(32).toString('base64url')
  return {
    state,
    hash: createHash('sha256').update(state).digest('hex'),
  }
}

export async function createFortnoxAuthorization(orgId: string) {
  const { context, organization } = await requireFortnoxOrganizationAdmin(orgId)
  if (!organization.organization_number) {
    throw new Error('FORTNOX_ORGANIZATION_NUMBER_REQUIRED')
  }

  const configuration = getFortnoxConfiguration()
  const oauthState = newOAuthState()
  const expiresAt = new Date(Date.now() + OAUTH_STATE_TTL_MS).toISOString()
  const authorizationUrl = buildFortnoxAuthorizationUrl({
    clientId: configuration.clientId,
    redirectUri: configuration.redirectUri,
    state: oauthState.state,
  })
  const admin = createSupabaseAdminClient()
  const { error } = await admin.rpc('create_fortnox_oauth_state', {
    p_state_hash: oauthState.hash,
    p_org_id: orgId,
    p_profile_id: context.identity.profileId,
    p_requested_scopes: [...FORTNOX_CONNECTION_SCOPES],
    p_expires_at: expiresAt,
  })

  if (error) throwDatabaseError(error)
  return authorizationUrl
}

function validateCallbackState(value: string) {
  if (!OAUTH_STATE_PATTERN.test(value)) throw new Error('FORTNOX_STATE_INVALID')
  return createHash('sha256').update(value).digest('hex')
}

function validateAuthorizationCode(value: string | null | undefined) {
  if (!value || value.length > 4096 || /[\s\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error('FORTNOX_CALLBACK_INVALID')
  }
  return value
}

function providerAuthorizationFailure(value: string | null | undefined) {
  if (!value || value.length > 128 || !/^[a-z][a-z0-9_]*$/u.test(value)) {
    return new Error('FORTNOX_CALLBACK_INVALID')
  }
  if (value === 'access_denied') {
    return new Error('FORTNOX_AUTHORIZATION_CANCELLED')
  }
  if (value === 'error_missing_license' || value === 'error_missing_app_license') {
    return new Error('FORTNOX_PERMISSION_OR_LICENSE_MISSING')
  }
  return new Error('FORTNOX_AUTHORIZATION_REJECTED')
}

function assertCurrentConnectionScopes(scopes: unknown) {
  if (!hasExactFortnoxScopes(scopes, FORTNOX_CONNECTION_SCOPES)) {
    throw new Error('FORTNOX_REQUIRED_SCOPE_MISSING')
  }
}

const FORTNOX_REAUTHORIZATION_ERRORS = new Set([
  'FORTNOX_ACCESS_TOKEN_REJECTED',
  'FORTNOX_CLIENT_CREDENTIALS_REJECTED',
  'FORTNOX_COMPANY_VERIFICATION_FAILED',
  'FORTNOX_INVALID_TENANT',
  'FORTNOX_ORGANIZATION_MISMATCH',
  'FORTNOX_PERMISSION_OR_LICENSE_MISSING',
  'FORTNOX_REQUIRED_SCOPE_MISSING',
])

function normalizeConnectionVersion(value: unknown) {
  const normalized =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && /^[1-9][0-9]*$/u.test(value)
        ? Number(value)
        : Number.NaN
  return Number.isSafeInteger(normalized) && normalized > 0 ? normalized : null
}

function normalizeCustomerVersion(value: unknown) {
  const normalized =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && /^[1-9][0-9]*$/u.test(value)
        ? Number(value)
        : Number.NaN
  return Number.isSafeInteger(normalized) && normalized > 0 ? normalized : null
}

function assertFortnoxCustomerId(value: unknown) {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new Error('FORTNOX_CUSTOMER_ID_INVALID')
  }
  return value
}

function assertFortnoxCustomerVersion(value: unknown) {
  const version = normalizeCustomerVersion(value)
  if (version === null) throw new Error('FORTNOX_CUSTOMER_VERSION_INVALID')
  return version
}

function mapFortnoxCustomerDatabaseRow(
  row: FortnoxCustomerDatabaseRow
): OrganizationCustomer {
  const customerType = row.customer_type === 'private' ? 'private' : 'business'
  return {
    id: row.id,
    customerNumber: String(row.customer_number),
    customerType,
    name: row.name,
    identityNumber:
      customerType === 'business'
        ? row.organization_number
        : row.personal_identity_number,
    email: row.email,
    phone: row.phone,
    address: row.address,
    addressLine2: row.address_line_2,
    postalCode: row.postal_code,
    city: row.city,
    countryCode: row.country_code,
    invoiceSameAsCustomer: row.invoice_same_as_customer,
    invoiceName: row.invoice_name,
    invoiceEmail: row.invoice_email,
    invoiceAddress: row.invoice_address,
    invoiceAddressLine2: row.invoice_address_line_2,
    invoicePostalCode: row.invoice_postal_code,
    invoiceCity: row.invoice_city,
    invoiceCountryCode: row.invoice_country_code,
    invoiceReference: row.invoice_reference,
    fortnoxCustomerNumber: row.fortnox_customer_number,
    isActive: row.is_active,
    version: Number(row.version),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

async function loadFortnoxCustomerConnection(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  orgId: string
) {
  const { data, error } = await admin
    .from('fortnox_connections')
    .select(
      'org_id,tenant_id,company_name,company_organization_number,granted_scopes,status,connected_at,last_verified_at,connection_version'
    )
    .eq('org_id', orgId)
    .maybeSingle()

  if (error) throwDatabaseError(error)
  if (!data) throw new Error('FORTNOX_CONNECTION_NOT_FOUND')
  const connection = data as FortnoxVerifiableConnectionRow
  if (
    connection.status !== 'connected' ||
    !hasExactFortnoxScopes(connection.granted_scopes, FORTNOX_CONNECTION_SCOPES)
  ) {
    throw new Error('FORTNOX_CONNECTION_NEEDS_REAUTHORIZATION')
  }
  return connection
}

async function requireFortnoxCustomerOperationAccess(
  authorization: Awaited<ReturnType<typeof requireFortnoxOrganizationAdmin>>,
  admin: ReturnType<typeof createSupabaseAdminClient>
) {
  const orgId = authorization.organization.id
  const connection = await loadFortnoxCustomerConnection(admin, orgId)
  if (
    !authorization.organization.organization_number ||
    connection.company_organization_number !==
      authorization.organization.organization_number
  ) {
    throw new Error('FORTNOX_ORGANIZATION_MISMATCH')
  }

  const token = await requestFortnoxClientCredentialsToken({
    tenantId: connection.tenant_id,
    requestedScopes: [...FORTNOX_CUSTOMER_OPERATION_SCOPES],
    configuration: getFortnoxConfiguration(),
  })
  if (!hasExactFortnoxScopes(token.scopes, FORTNOX_CUSTOMER_OPERATION_SCOPES)) {
    throw new Error('FORTNOX_REQUIRED_SCOPE_MISSING')
  }

  const company = await fetchFortnoxCompanyInformation(token.accessToken)
  if (
    company.tenantId !== connection.tenant_id ||
    company.organizationNumber !== connection.company_organization_number ||
    company.organizationNumber !== authorization.organization.organization_number
  ) {
    throw new Error('FORTNOX_COMPANY_VERIFICATION_FAILED')
  }

  const currentAuthorization = await requireFortnoxOrganizationAdmin(orgId)
  const currentConnection = await loadFortnoxCustomerConnection(admin, orgId)
  if (
    currentAuthorization.context.identity.profileId !==
      authorization.context.identity.profileId ||
    currentAuthorization.organization.organization_number !==
      company.organizationNumber ||
    currentConnection.tenant_id !== connection.tenant_id ||
    currentConnection.company_organization_number !== company.organizationNumber
  ) {
    throw new Error('FORTNOX_CUSTOMER_BINDING_SUPERSEDED')
  }

  return {
    accessToken: token.accessToken,
    profileId: authorization.context.identity.profileId,
    tenantId: connection.tenant_id,
  }
}

function customerDraft(
  row: FortnoxCustomerDatabaseRow,
  customerNumber: string,
  externalReference: string
) {
  try {
    return buildFortnoxCustomerDraft({
      customerType: row.customer_type,
      name: row.name,
      customerNumber,
      externalReference,
      organizationNumber: row.organization_number,
      email: row.email,
      invoiceEmail: row.invoice_same_as_customer ? row.email : row.invoice_email,
      phone: row.phone,
      address: row.address,
      addressLine2: row.address_line_2,
      postalCode: row.postal_code,
      city: row.city,
      countryCode: row.country_code,
    })
  } catch (error) {
    if (error instanceof Error && error.message === 'FORTNOX_CUSTOMER_PAYLOAD_INVALID') {
      throw new Error('FORTNOX_CUSTOMER_REJECTED')
    }
    throw error
  }
}

function ownsFortnoxCustomer(
  customer: { customerNumber: string; externalReference: string | null },
  customerNumber: string,
  externalReference: string
) {
  return (
    customer.customerNumber === customerNumber &&
    customer.externalReference === externalReference
  )
}

type FortnoxCustomerCandidateResult =
  | { status: 'owned'; customerNumber: string }
  | { status: 'collision' | 'reserved' }

async function ensureFortnoxCustomerCandidate(input: {
  accessToken: string
  row: FortnoxCustomerDatabaseRow
  customerNumber: string
  externalReference: string
}): Promise<FortnoxCustomerCandidateResult> {
  const existing = await fetchFortnoxCustomer(
    input.accessToken,
    input.customerNumber
  )
  if (existing) {
    return ownsFortnoxCustomer(
      existing,
      input.customerNumber,
      input.externalReference
    )
      ? { status: 'owned', customerNumber: existing.customerNumber }
      : { status: 'collision' }
  }

  const draft = customerDraft(
    input.row,
    input.customerNumber,
    input.externalReference
  )
  try {
    const created = await createFortnoxCustomer(input.accessToken, draft)
    if (
      ownsFortnoxCustomer(
        created,
        input.customerNumber,
        input.externalReference
      )
    ) {
      return { status: 'owned', customerNumber: created.customerNumber }
    }
  } catch (error) {
    const code = error instanceof Error ? error.message : ''
    if (
      code !== 'FORTNOX_CUSTOMER_NUMBER_CONFLICT' &&
      code !== 'FORTNOX_CUSTOMER_OUTCOME_UNKNOWN'
    ) {
      throw error
    }

    let reconciled
    try {
      reconciled = await fetchFortnoxCustomer(
        input.accessToken,
        input.customerNumber
      )
    } catch {
      throw new Error(
        code === 'FORTNOX_CUSTOMER_OUTCOME_UNKNOWN'
          ? 'FORTNOX_CUSTOMER_OUTCOME_UNKNOWN'
          : 'FORTNOX_TEMPORARILY_UNAVAILABLE'
      )
    }
    if (reconciled) {
      return ownsFortnoxCustomer(
        reconciled,
        input.customerNumber,
        input.externalReference
      )
        ? { status: 'owned', customerNumber: reconciled.customerNumber }
        : { status: 'collision' }
    }
    if (code === 'FORTNOX_CUSTOMER_NUMBER_CONFLICT') {
      return { status: 'reserved' }
    }
    throw new Error('FORTNOX_CUSTOMER_OUTCOME_UNKNOWN')
  }

  const reconciled = await fetchFortnoxCustomer(
    input.accessToken,
    input.customerNumber
  )
  if (!reconciled) throw new Error('FORTNOX_CUSTOMER_OUTCOME_UNKNOWN')
  return ownsFortnoxCustomer(
    reconciled,
    input.customerNumber,
    input.externalReference
  )
    ? { status: 'owned', customerNumber: reconciled.customerNumber }
    : { status: 'collision' }
}

async function createOrRecoverFortnoxCustomer(
  accessToken: string,
  row: FortnoxCustomerDatabaseRow
) {
  const identity = buildFortnoxCustomerIdentity(row.id, row.customer_number)
  for (const customerNumber of [
    identity.customerNumber,
    identity.fallbackCustomerNumber,
  ]) {
    const result = await ensureFortnoxCustomerCandidate({
      accessToken,
      row,
      customerNumber,
      externalReference: identity.externalReference,
    })
    if (result.status === 'owned') return result.customerNumber
  }
  throw new Error('FORTNOX_CUSTOMER_NUMBER_COLLISION')
}

async function bindFortnoxCustomer(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>
  row: FortnoxCustomerDatabaseRow
  expectedVersion: number
  profileId: string
  tenantId: string
  fortnoxCustomerNumber: string
}) {
  const { data, error } = await input.admin.rpc(
    'bind_organization_customer_to_fortnox',
    {
      p_org_id: input.row.org_id,
      p_customer_id: input.row.id,
      p_expected_version: input.expectedVersion,
      p_profile_id: input.profileId,
      p_tenant_id: input.tenantId,
      p_fortnox_customer_number: input.fortnoxCustomerNumber,
    }
  )
  if (error) {
    if (
      error.code === '42883' ||
      error.code === 'PGRST202' ||
      error.code === 'PGRST204'
    ) {
      throw new Error('FORTNOX_CUSTOMER_BINDING_SCHEMA_REQUIRED')
    }
    throwDatabaseError(error)
  }

  const result = Array.isArray(data)
    ? (data[0] as FortnoxCustomerBindingRow | undefined)
    : undefined
  if (!result) throw new Error('FORTNOX_DATABASE_FAILED')

  if (result.result_code === 'ADMIN_REQUIRED') {
    throw new Error('FORTNOX_ORGANIZATION_ADMIN_REQUIRED')
  }
  if (result.result_code === 'CONNECTION_NOT_CURRENT') {
    throw new Error('FORTNOX_CUSTOMER_BINDING_SUPERSEDED')
  }
  if (result.result_code === 'CUSTOMER_NOT_FOUND') {
    throw new Error('FORTNOX_CUSTOMER_NOT_FOUND')
  }
  if (result.result_code === 'CUSTOMER_INACTIVE') {
    throw new Error('FORTNOX_CUSTOMER_INACTIVE')
  }
  if (result.result_code === 'VERSION_CONFLICT') {
    throw new Error('FORTNOX_CUSTOMER_VERSION_CONFLICT')
  }
  if (result.result_code === 'LINK_CONFLICT') {
    throw new Error('FORTNOX_CUSTOMER_TENANT_CONFLICT')
  }
  if (result.result_code !== 'BOUND' && result.result_code !== 'ALREADY_BOUND') {
    throw new Error('FORTNOX_DATABASE_FAILED')
  }

  const version = normalizeCustomerVersion(result.customer_version)
  if (
    version === null ||
    result.customer_id !== input.row.id ||
    result.bound_org_id !== input.row.org_id ||
    result.bound_tenant_id !== input.tenantId ||
    result.bound_fortnox_customer_number !== input.fortnoxCustomerNumber ||
    typeof result.bound_at !== 'string' ||
    typeof result.customer_updated_at !== 'string'
  ) {
    throw new Error('FORTNOX_DATABASE_FAILED')
  }

  return mapFortnoxCustomerDatabaseRow({
    ...input.row,
    fortnox_tenant_id: result.bound_tenant_id,
    fortnox_customer_number: result.bound_fortnox_customer_number,
    fortnox_synced_at: result.bound_at,
    version,
    updated_at: result.customer_updated_at,
  })
}

/**
 * Explicitly exports one active, organization-scoped HusHub customer to the
 * currently connected Fortnox tenant and stores the resulting customer link.
 *
 * Private customers are never matched on name or e-mail. Business customers
 * may reuse one unambiguous, exact organization-number match in Fortnox.
 */
export async function exportOrganizationCustomerToFortnox(
  orgIdValue: unknown,
  customerIdValue: unknown,
  versionValue: unknown
): Promise<OrganizationCustomer> {
  if (typeof orgIdValue !== 'string') {
    throw new Error('FORTNOX_ORGANIZATION_INVALID')
  }
  assertOrganizationId(orgIdValue)
  const customerId = assertFortnoxCustomerId(customerIdValue)
  const expectedVersion = assertFortnoxCustomerVersion(versionValue)

  const authorization = await requireFortnoxOrganizationAdmin(orgIdValue)
  const admin = createSupabaseAdminClient()
  const { data, error } = await admin
    .from('organization_customers')
    .select(FORTNOX_CUSTOMER_DATABASE_COLUMNS)
    .eq('org_id', orgIdValue)
    .eq('id', customerId)
    .maybeSingle()

  if (error) throwDatabaseError(error)
  if (!data) throw new Error('FORTNOX_CUSTOMER_NOT_FOUND')

  const row = data as unknown as FortnoxCustomerDatabaseRow
  const currentVersion = normalizeCustomerVersion(row.version)
  if (
    row.id !== customerId ||
    row.org_id !== orgIdValue ||
    currentVersion === null
  ) {
    throw new Error('FORTNOX_DATABASE_FAILED')
  }
  if (!row.is_active) throw new Error('FORTNOX_CUSTOMER_INACTIVE')

  const hasTenantId = row.fortnox_tenant_id !== null
  const hasCustomerNumber = row.fortnox_customer_number !== null
  const hasSyncedAt = row.fortnox_synced_at !== null
  const isLinked = hasTenantId && hasCustomerNumber && hasSyncedAt
  const isUnlinked = !hasTenantId && !hasCustomerNumber && !hasSyncedAt
  if (!isLinked && !isUnlinked) throw new Error('FORTNOX_DATABASE_FAILED')

  // A retry after a successful bind is read-only and returns the current row.
  // It still validates that the organization points at the same live tenant.
  if (isLinked) {
    const connection = await loadFortnoxCustomerConnection(admin, orgIdValue)
    if (
      !authorization.organization.organization_number ||
      connection.company_organization_number !==
        authorization.organization.organization_number ||
      row.fortnox_tenant_id !== connection.tenant_id
    ) {
      throw new Error('FORTNOX_CUSTOMER_TENANT_CONFLICT')
    }
    return mapFortnoxCustomerDatabaseRow({ ...row, version: currentVersion })
  }

  if (currentVersion !== expectedVersion) {
    throw new Error('FORTNOX_CUSTOMER_VERSION_CONFLICT')
  }

  const access = await requireFortnoxCustomerOperationAccess(
    authorization,
    admin
  )

  let fortnoxCustomerNumber: string | null = null
  if (row.customer_type === 'business') {
    const organizationNumber = normalizeFortnoxOrganizationNumber(
      row.organization_number
    )
    if (!organizationNumber) throw new Error('FORTNOX_CUSTOMER_REJECTED')

    const matches = await findFortnoxCustomersByOrganizationNumber(
      access.accessToken,
      organizationNumber
    )
    if (matches.length > 1) {
      throw new Error('FORTNOX_CUSTOMER_MATCH_AMBIGUOUS')
    }
    fortnoxCustomerNumber = matches[0]?.customerNumber ?? null
  }

  if (!fortnoxCustomerNumber) {
    fortnoxCustomerNumber = await createOrRecoverFortnoxCustomer(
      access.accessToken,
      row
    )
  }

  return bindFortnoxCustomer({
    admin,
    row,
    expectedVersion,
    profileId: access.profileId,
    tenantId: access.tenantId,
    fortnoxCustomerNumber,
  })
}

async function applyFortnoxConnectionVerification(input: {
  admin: ReturnType<typeof createSupabaseAdminClient>
  orgId: string
  tenantId: string
  expectedVersion: number
  companyName: string | null
  grantedScopes: string[] | null
  errorCode: string | null
}) {
  const { data, error } = await input.admin.rpc(
    'apply_fortnox_connection_verification',
    {
      p_org_id: input.orgId,
      p_tenant_id: input.tenantId,
      p_expected_version: input.expectedVersion,
      p_company_name: input.companyName,
      p_granted_scopes: input.grantedScopes,
      p_error_code: input.errorCode,
    }
  )

  if (error) throwDatabaseError(error)
  const row = Array.isArray(data)
    ? (data[0] as AppliedVerificationRow | undefined)
    : undefined
  if (!row) throw new Error('FORTNOX_VERIFICATION_SUPERSEDED')
  const hasValidStatusScopes =
    row.status === 'connected'
      ? hasExactFortnoxScopes(row.granted_scopes, FORTNOX_CONNECTION_SCOPES)
      : row.status === 'needs_reauthorization' &&
        hasAllowedFortnoxConnectionScopes(row.granted_scopes)
  if (
    normalizeConnectionVersion(row.connection_version) === null ||
    !hasValidStatusScopes
  ) {
    throw new Error('FORTNOX_DATABASE_FAILED')
  }
  return mapConnection(row)
}

export async function verifyFortnoxConnection(
  orgId: string
): Promise<FortnoxConnectionStatus> {
  const authorization = await requireFortnoxOrganizationAdmin(orgId)
  const { organization } = authorization
  const admin = createSupabaseAdminClient()
  const { data: connectionData, error: connectionError } = await admin
    .from('fortnox_connections')
    .select(
      'org_id,tenant_id,company_name,company_organization_number,granted_scopes,status,connected_at,last_verified_at,connection_version'
    )
    .eq('org_id', orgId)
    .maybeSingle()

  if (connectionError) throwDatabaseError(connectionError)
  if (!connectionData) throw new Error('FORTNOX_CONNECTION_NOT_FOUND')

  const connection = connectionData as FortnoxVerifiableConnectionRow
  const connectionVersion = normalizeConnectionVersion(connection.connection_version)
  if (connectionVersion === null) throw new Error('FORTNOX_DATABASE_FAILED')

  try {
    assertCurrentConnectionScopes(connection.granted_scopes)
    if (
      !organization.organization_number ||
      connection.company_organization_number !== organization.organization_number
    ) {
      throw new Error('FORTNOX_ORGANIZATION_MISMATCH')
    }

    const configuration = getFortnoxConfiguration()
    const token = await requestFortnoxClientCredentialsToken({
      tenantId: connection.tenant_id,
      requestedScopes: [...FORTNOX_CONNECTION_SCOPES],
      configuration,
    })
    assertCurrentConnectionScopes(token.scopes)

    const company = await fetchFortnoxCompanyInformation(token.accessToken)
    if (
      company.tenantId !== connection.tenant_id ||
      company.organizationNumber !== connection.company_organization_number ||
      company.organizationNumber !== organization.organization_number
    ) {
      throw new Error('FORTNOX_COMPANY_VERIFICATION_FAILED')
    }

    const grantedScopes = normalizeFortnoxScopes(token.scopes)
    const currentAuthorization = await requireFortnoxOrganizationAdmin(orgId)
    if (
      currentAuthorization.context.identity.profileId !==
        authorization.context.identity.profileId ||
      currentAuthorization.organization.organization_number !== company.organizationNumber
    ) {
      throw new Error('FORTNOX_ORGANIZATION_ADMIN_REQUIRED')
    }

    return await applyFortnoxConnectionVerification({
      admin,
      orgId,
      tenantId: connection.tenant_id,
      expectedVersion: connectionVersion,
      companyName: company.companyName,
      grantedScopes,
      errorCode: null,
    })
  } catch (error) {
    const code = error instanceof Error ? error.message : ''
    if (FORTNOX_REAUTHORIZATION_ERRORS.has(code)) {
      const currentAuthorization = await requireFortnoxOrganizationAdmin(orgId)
      if (
        currentAuthorization.context.identity.profileId !==
        authorization.context.identity.profileId
      ) {
        throw new Error('FORTNOX_ORGANIZATION_ADMIN_REQUIRED')
      }
      await applyFortnoxConnectionVerification({
        admin,
        orgId,
        tenantId: connection.tenant_id,
        expectedVersion: connectionVersion,
        companyName: null,
        grantedScopes: null,
        errorCode: code,
      })
    }
    throw error
  }
}

export async function completeFortnoxAuthorization(input: {
  state: string
  code?: string | null
  providerError?: string | null
}) {
  const stateHash = validateCallbackState(input.state)
  const initialContext = await requireProductAccess('dashboard')
  const admin = createSupabaseAdminClient()
  const { data: consumedData, error: consumeError } = await admin.rpc(
    'consume_fortnox_oauth_state',
    {
      p_state_hash: stateHash,
      p_profile_id: initialContext.identity.profileId,
    }
  )

  if (consumeError) throwDatabaseError(consumeError)
  const consumed = Array.isArray(consumedData)
    ? (consumedData[0] as ConsumedStateRow | undefined)
    : undefined
  if (!consumed || !UUID_PATTERN.test(consumed.org_id)) {
    throw new Error('FORTNOX_STATE_INVALID')
  }

  try {
    const requestedScopes = normalizeFortnoxScopes(consumed.requested_scopes)
    if (!hasExactFortnoxScopes(requestedScopes, FORTNOX_CONNECTION_SCOPES)) {
      throw new Error('FORTNOX_STATE_INVALID')
    }

    const authorization = await requireFortnoxOrganizationAdmin(consumed.org_id)
    if (authorization.context.identity.profileId !== initialContext.identity.profileId) {
      throw new Error('FORTNOX_STATE_INVALID')
    }

    if (input.providerError !== null && input.providerError !== undefined) {
      throw providerAuthorizationFailure(input.providerError)
    }

    const code = validateAuthorizationCode(input.code)
    const configuration = getFortnoxConfiguration()
    const authorizationGrant = await exchangeFortnoxAuthorizationCode({
      code,
      requestedScopes,
      configuration,
    })
    assertCurrentConnectionScopes(authorizationGrant.scopes)

    const initialCompany = await fetchFortnoxCompanyInformation(authorizationGrant.accessToken)
    if (
      !authorization.organization.organization_number ||
      initialCompany.organizationNumber !== authorization.organization.organization_number
    ) {
      throw new Error('FORTNOX_ORGANIZATION_MISMATCH')
    }

    const clientCredentialsGrant = await requestFortnoxClientCredentialsToken({
      tenantId: initialCompany.tenantId,
      requestedScopes,
      configuration,
    })
    assertCurrentConnectionScopes(clientCredentialsGrant.scopes)

    const verifiedCompany = await fetchFortnoxCompanyInformation(
      clientCredentialsGrant.accessToken
    )
    if (
      verifiedCompany.tenantId !== initialCompany.tenantId ||
      verifiedCompany.organizationNumber !== initialCompany.organizationNumber ||
      verifiedCompany.organizationNumber !== authorization.organization.organization_number
    ) {
      throw new Error('FORTNOX_COMPANY_VERIFICATION_FAILED')
    }

    const verifiedAt = new Date().toISOString()
    const grantedScopes = normalizeFortnoxScopes(clientCredentialsGrant.scopes)
    const currentAuthorization = await requireFortnoxOrganizationAdmin(consumed.org_id)
    if (
      currentAuthorization.context.identity.profileId !==
        authorization.context.identity.profileId ||
      currentAuthorization.organization.organization_number !==
        verifiedCompany.organizationNumber
    ) {
      throw new Error('FORTNOX_ORGANIZATION_ADMIN_REQUIRED')
    }
    const { data: saved, error: upsertError } = await admin.rpc(
      'save_fortnox_connection_from_oauth_state',
      {
        p_state_hash: stateHash,
        p_profile_id: authorization.context.identity.profileId,
        p_tenant_id: verifiedCompany.tenantId,
        p_company_name: verifiedCompany.companyName,
        p_company_organization_number: verifiedCompany.organizationNumber,
        p_granted_scopes: grantedScopes,
        p_verified_at: verifiedAt,
      }
    )

    if (upsertError?.code === '23505') {
      throw new Error('FORTNOX_TENANT_ALREADY_CONNECTED')
    }
    if (upsertError?.code === '23503') {
      throw new Error('FORTNOX_ORGANIZATION_MISMATCH')
    }
    if (upsertError) throwDatabaseError(upsertError)
    if (saved !== true) throw new Error('FORTNOX_AUTHORIZATION_SUPERSEDED')

    return {
      orgId: consumed.org_id,
      companyName: verifiedCompany.companyName,
      organizationNumber: verifiedCompany.organizationNumber,
      grantedScopes,
      status: 'connected' as const,
      connectedAt: verifiedAt,
      lastVerifiedAt: verifiedAt,
    }
  } catch (error) {
    throw new FortnoxCallbackFailure(error, consumed.org_id)
  }
}
