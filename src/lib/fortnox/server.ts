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
  buildFortnoxAuthorizationUrl,
  hasAllowedFortnoxConnectionScopes,
  hasExactFortnoxScopes,
  normalizeFortnoxOrganizationNumber,
  normalizeFortnoxScopes,
} from './domain'
import {
  exchangeFortnoxAuthorizationCode,
  fetchFortnoxCompanyInformation,
  getFortnoxConfiguration,
  isFortnoxConfigured,
  requestFortnoxClientCredentialsToken,
} from './provider'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const OAUTH_STATE_PATTERN = /^[A-Za-z0-9_-]{32,200}$/
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000

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
