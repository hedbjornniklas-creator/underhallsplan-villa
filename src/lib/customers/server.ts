import 'server-only'

import {
  requireProductAccess,
  type PlatformAccessContext,
} from '@/lib/access/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import {
  parseOrganizationCustomerInput,
  type OrganizationCustomer,
  type OrganizationCustomerInput,
  type OrganizationCustomerOrganization,
  type OrganizationCustomerType,
  type OrganizationCustomerWorkspace,
} from './domain'

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const CUSTOMER_COLUMNS = [
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
  'fortnox_customer_number',
  'is_active',
  'version',
  'created_at',
  'updated_at',
].join(',')

type DatabaseError = {
  code?: string | null
  message?: string | null
  details?: string | null
  hint?: string | null
} | null

type CustomerRow = {
  id: string
  org_id: string
  customer_number: number | string
  customer_type: OrganizationCustomerType
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
  fortnox_customer_number: string | null
  is_active: boolean
  version: number | string
  created_at: string
  updated_at: string
}

type OrganizationMembershipRow = {
  org_id: string
  role: 'admin' | 'inspector'
  is_default: boolean
  created_at: string
  organizations: { name?: unknown } | Array<{ name?: unknown }> | null
}

function databaseFailure(error: DatabaseError): never {
  if (
    error?.code === '42P01' ||
    error?.code === '42703' ||
    error?.code === '42883' ||
    error?.code === 'PGRST202' ||
    error?.code === 'PGRST204' ||
    error?.code === 'PGRST205'
  ) {
    throw new Error('CUSTOMERS_SCHEMA_REQUIRED')
  }

  if (error?.code === '23505') {
    const safeConstraintText = `${error.message ?? ''} ${error.details ?? ''}`
    if (
      safeConstraintText.includes('organization_customers_organization_number_uidx') ||
      safeConstraintText.includes('organization_customers_personal_identity_number_uidx')
    ) {
      throw new Error('CUSTOMER_IDENTITY_EXISTS')
    }
  }

  throw new Error('CUSTOMER_DATABASE_FAILED')
}

function customerId(value: unknown) {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new Error('CUSTOMER_ID_INVALID')
  }
  return value
}

function organizationId(value: unknown, required: boolean) {
  if (value === undefined || value === null || value === '') {
    if (required) throw new Error('CUSTOMER_ORGANIZATION_INVALID')
    return null
  }
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new Error('CUSTOMER_ORGANIZATION_INVALID')
  }
  return value
}

function expectedVersion(value: unknown) {
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error('CUSTOMER_REQUEST_INVALID')
  }
  return parsed
}

function mapCustomer(
  row: CustomerRow,
  options: { includePersonalIdentity?: boolean } = {}
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
        : options.includePersonalIdentity
          ? row.personal_identity_number
          : null,
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

function toDatabaseValues(input: OrganizationCustomerInput, profileId: string) {
  return {
    customer_type: input.customerType,
    name: input.name,
    organization_number: input.customerType === 'business' ? input.identityNumber : null,
    personal_identity_number: input.customerType === 'private' ? input.identityNumber : null,
    email: input.email,
    phone: input.phone,
    address: input.address,
    address_line_2: input.addressLine2,
    postal_code: input.postalCode,
    city: input.city,
    country_code: input.countryCode,
    invoice_same_as_customer: input.invoiceSameAsCustomer,
    invoice_name: input.invoiceName,
    invoice_email: input.invoiceEmail,
    invoice_address: input.invoiceAddress,
    invoice_address_line_2: input.invoiceAddressLine2,
    invoice_postal_code: input.invoicePostalCode,
    invoice_city: input.invoiceCity,
    invoice_country_code: input.invoiceCountryCode,
    invoice_reference: input.invoiceReference,
    updated_by_profile_id: profileId,
  }
}

function relationName(value: OrganizationMembershipRow['organizations']) {
  const organization = Array.isArray(value) ? value[0] : value
  return typeof organization?.name === 'string' && organization.name.trim()
    ? organization.name.trim()
    : null
}

function dashboardAssignments(context: PlatformAccessContext) {
  return context.assignments.filter((assignment) => assignment.productKey === 'dashboard')
}

function canReadOrganization(context: PlatformAccessContext, orgId: string) {
  const assignments = dashboardAssignments(context)
  if (assignments.length === 0) return true
  return assignments.some(
    (assignment) =>
      assignment.scopeType === 'global' ||
      (assignment.scopeType === 'organization' && assignment.scopeId === orgId)
  )
}

function canManageOrganization(context: PlatformAccessContext, orgId: string) {
  const assignments = dashboardAssignments(context)
  if (assignments.length === 0) return true
  return assignments.some((assignment) => {
    const isAdminModule =
      assignment.moduleKey === 'admin' ||
      (!assignment.moduleKey && assignment.roleKey === 'dashboard_admin')
    return (
      isAdminModule &&
      (assignment.scopeType === 'global' ||
        (assignment.scopeType === 'organization' && assignment.scopeId === orgId))
    )
  })
}

async function customerContext(orgIdValue: unknown, requireAdmin: boolean) {
  const requestedOrgId = organizationId(orgIdValue, requireAdmin)
  const access = await requireProductAccess('dashboard')
  const admin = createSupabaseAdminClient()
  const { data, error } = await admin
    .from('org_members')
    .select('org_id,role,is_default,created_at,organizations(name)')
    .eq('profile_id', access.identity.profileId)
    .eq('is_active', true)
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: true })
    .order('org_id', { ascending: true })

  if (error) databaseFailure(error)
  const memberships = (data ?? []) as unknown as OrganizationMembershipRow[]
  const organizations = memberships.flatMap<OrganizationCustomerOrganization>((membership) => {
    if (!canReadOrganization(access, membership.org_id)) return []
    return [
      {
        id: membership.org_id,
        name: relationName(membership.organizations),
        isDefault: membership.is_default,
        canManage:
          membership.role === 'admin' &&
          canManageOrganization(access, membership.org_id),
      },
    ]
  })

  if (organizations.length === 0) throw new Error('ORG_MEMBERSHIP_REQUIRED')
  const selected = requestedOrgId
    ? organizations.find((organization) => organization.id === requestedOrgId)
    : organizations.find((organization) => organization.isDefault) ??
      organizations[0]

  if (!selected) throw new Error('CUSTOMER_ORGANIZATION_MEMBER_REQUIRED')
  if (requireAdmin && !selected.canManage) {
    throw new Error('CUSTOMER_ORGANIZATION_ADMIN_REQUIRED')
  }
  return {
    profileId: access.identity.profileId,
    orgId: selected.id,
    organization: selected,
    organizations,
  }
}

async function customerStillExists(orgId: string, id: string) {
  const admin = createSupabaseAdminClient()
  const { data, error } = await admin
    .from('organization_customers')
    .select('id')
    .eq('org_id', orgId)
    .eq('id', id)
    .maybeSingle()
  if (error) databaseFailure(error)
  return Boolean(data)
}

export async function getOrganizationCustomerWorkspace(
  orgIdValue?: unknown
): Promise<OrganizationCustomerWorkspace> {
  const context = await customerContext(orgIdValue, false)
  const admin = createSupabaseAdminClient()
  const { data, error } = await admin
    .from('organization_customers')
    .select(CUSTOMER_COLUMNS)
    .eq('org_id', context.orgId)
    .order('is_active', { ascending: false })
    .order('customer_number', { ascending: true })

  if (error) databaseFailure(error)
  return {
    organization: context.organization,
    organizations: context.organizations,
    customers: ((data ?? []) as unknown as CustomerRow[]).map((row) =>
      mapCustomer(row, { includePersonalIdentity: context.organization.canManage })
    ),
  }
}

export async function getOrganizationCustomerNavigationContext(orgIdValue?: unknown) {
  const context = await customerContext(orgIdValue, false)
  return {
    organization: context.organization,
    organizations: context.organizations,
  }
}

export async function createOrganizationCustomer(orgIdValue: unknown, value: unknown) {
  const context = await customerContext(orgIdValue, true)
  const input = parseOrganizationCustomerInput(value)
  const admin = createSupabaseAdminClient()
  const { data, error } = await admin
    .from('organization_customers')
    .insert({
      org_id: context.orgId,
      ...toDatabaseValues(input, context.profileId),
      created_by_profile_id: context.profileId,
    })
    .select(CUSTOMER_COLUMNS)
    .single()

  if (error || !data) databaseFailure(error)
  return mapCustomer(data as unknown as CustomerRow, { includePersonalIdentity: true })
}

export async function updateOrganizationCustomer(
  orgIdValue: unknown,
  idValue: unknown,
  versionValue: unknown,
  value: unknown
) {
  const context = await customerContext(orgIdValue, true)
  const id = customerId(idValue)
  const version = expectedVersion(versionValue)
  const input = parseOrganizationCustomerInput(value)
  const admin = createSupabaseAdminClient()
  const { data, error } = await admin
    .from('organization_customers')
    .update(toDatabaseValues(input, context.profileId))
    .eq('org_id', context.orgId)
    .eq('id', id)
    .eq('version', version)
    .select(CUSTOMER_COLUMNS)
    .maybeSingle()

  if (error) databaseFailure(error)
  if (!data) {
    if (await customerStillExists(context.orgId, id)) {
      throw new Error('CUSTOMER_VERSION_CONFLICT')
    }
    throw new Error('CUSTOMER_NOT_FOUND')
  }
  return mapCustomer(data as unknown as CustomerRow, { includePersonalIdentity: true })
}

export async function setOrganizationCustomerActive(
  orgIdValue: unknown,
  idValue: unknown,
  versionValue: unknown,
  activeValue: unknown
) {
  const context = await customerContext(orgIdValue, true)
  const id = customerId(idValue)
  const version = expectedVersion(versionValue)
  if (typeof activeValue !== 'boolean') throw new Error('CUSTOMER_REQUEST_INVALID')

  const admin = createSupabaseAdminClient()
  const { data, error } = await admin
    .from('organization_customers')
    .update({
      is_active: activeValue,
      updated_by_profile_id: context.profileId,
    })
    .eq('org_id', context.orgId)
    .eq('id', id)
    .eq('version', version)
    .select(CUSTOMER_COLUMNS)
    .maybeSingle()

  if (error) databaseFailure(error)
  if (!data) {
    if (await customerStillExists(context.orgId, id)) {
      throw new Error('CUSTOMER_VERSION_CONFLICT')
    }
    throw new Error('CUSTOMER_NOT_FOUND')
  }
  return mapCustomer(data as unknown as CustomerRow, { includePersonalIdentity: true })
}
