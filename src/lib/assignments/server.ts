import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { generateAssignmentToken, hashAssignmentToken } from '@/lib/assignments/tokens'
import { sendAssignmentEmail } from '@/lib/assignments/mailer'
import {
  buildAssignmentConfirmationEmail,
  buildAssignmentAcceptedNoticeEmail,
  buildAssignmentCancelledNoticeEmail,
  buildAssignmentOrderReceiptEmail,
} from '@/lib/assignments/emailTemplates'
import {
  getAssignmentTermsDocument,
  parseAssignmentTermsRole,
} from '@/lib/assignments/terms'

export type AssignmentStatus =
  | 'draft'
  | 'sent'
  | 'ordered'
  | 'booked'
  | 'completed'
  | 'expired'
  | 'cancelled'

export type AssignmentType = 'OB' | 'STATUS' | 'UHP'

type AuthUserLite = {
  id: string
  email?: string | null
  user_metadata?: Record<string, unknown> | null
}

type OrgMemberRow = {
  org_id: string
  role: 'admin' | 'inspector'
  is_active: boolean
  is_default: boolean
  organizations:
    | {
        name: string | null
        email_from: string | null
      }
    | Array<{
        name: string | null
        email_from: string | null
      }>
    | null
}

export type OrgContext = {
  userId: string
  orgId: string
  role: 'admin' | 'inspector'
  orgName: string | null
  orgEmailFrom: string | null
}

export type AssignmentListItem = {
  id: string
  org_id: string
  status: AssignmentStatus
  assignment_type: AssignmentType
  customer_name: string | null
  customer_email: string
  customer_phone: string | null
  customer_postal_code: string | null
  customer_city: string | null
  preferred_date: string | null
  preferred_time: string | null
  preliminary_address: string | null
  property_address: string | null
  property_postal_code: string | null
  property_city: string | null
  accepted_at: string | null
  booked_at: string | null
  converted_at: string | null
  inspection_id: string | null
  responsible_profile_id: string
  created_at: string
  updated_at: string
  last_sent_at: string | null
  archived_at: string | null
  archived_by: string | null
}

export type AssignmentDetails = AssignmentListItem & {
  customer_address: string | null
  property_municipality: string | null
  property_owner_name: string | null
  brf_name: string | null
  apartment_number: string | null
  apartment_holder_name: string | null
  terms_version: string | null
  terms_document_hash: string | null
  invoice_name: string | null
  invoice_address: string | null
  orderer_role: string | null
  personal_identity_number: string | null
  notes_internal: string | null
  cadastral_id: string | null
  price_amount: number | null
  currency: string
  property_id: string | null
}

export type AssignmentAddonOffer = {
  addon_service_id: string
  key: string
  name: string
  description: string | null
  price_amount: number
  currency: string
}

export type AssignmentAddonOrder = {
  id: string
  assignment_id: string
  org_id: string
  addon_service_id: string | null
  addon_key: string
  addon_name_snapshot: string
  price_amount_snapshot: number
  currency_snapshot: string
  created_at: string
}

type AssignmentLinkResult = {
  acceptUrl: string
  expiresAt: string
}

type ConvertAssignmentResult = {
  propertyId: string
  inspectionId: string
}

type InspectionCompletedEmailResult = {
  detailsUrl: string
}

type PropertySeedRow = {
  id: string
  owner: string | null
  created_at: string | null
  name: string
  address: string | null
  postal_code: string | null
  city: string | null
  municipality: string | null
  cadastral_id: string | null
  owner_name: string | null
  client_name: string | null
  contact_person: string | null
  tenure_type: string | null
  dwelling_type: string | null
  property_type: string | null
  plot_area_m2: number | null
  area_m2: number | null
  area_sqm: number | null
  tax_value: number | null
  planning_status: string | null
  type_code: string | null
  heating: string | null
  ventilation: string | null
  roof_type: string | null
  year_built: number | null
  cover_path: string | null
  status: string | null
  last_inspected: string | null
  last_inspection_at: string | null
}

type SupabaseError = {
  message?: string
  details?: string | null
  hint?: string | null
  code?: string | null
} | null

type SupabaseResponse<T> = Promise<{ data: T | null; error: SupabaseError }>

type SupabaseListResponse<T> = { data: T[] | null; error: SupabaseError }

type QueryBuilder<T = Record<string, unknown>> = {
  then: <TResult1 = SupabaseListResponse<T>, TResult2 = never>(
    onfulfilled?:
      | ((value: SupabaseListResponse<T>) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ) => PromiseLike<TResult1 | TResult2>
  select: (columns: string) => QueryBuilder<T>
  insert: (values: unknown) => QueryBuilder<T>
  update: (values: unknown) => QueryBuilder<T>
  delete: () => QueryBuilder<T>
  upsert: (values: unknown, options?: { onConflict?: string }) => QueryBuilder<T>
  eq: (column: string, value: unknown) => QueryBuilder<T>
  is: (column: string, value: unknown) => QueryBuilder<T>
  order: (
    column: string,
    options?: {
      ascending?: boolean
      nullsFirst?: boolean
    }
  ) => QueryBuilder<T>
  limit: (count: number) => QueryBuilder<T>
  single: () => SupabaseResponse<T>
  maybeSingle: () => SupabaseResponse<T>
}

type SupabaseAdminClient = {
  from: (table: string) => QueryBuilder
  rpc: (fn: string, args: Record<string, unknown>) => SupabaseResponse<unknown>
}

type OrgMemberAnyStatusRow = {
  id: string
  org_id: string
  role: 'admin' | 'inspector'
  is_default: boolean
}

type ProfileOrgSeedRow = {
  id: string
  is_admin: boolean
  full_name: string | null
  email: string | null
  org_name: string | null
  company_name: string | null
}

type OrganizationIdRow = {
  id: string
}

const ASSIGNMENT_SELECT_LIST = `
  id,
  org_id,
  status,
  assignment_type,
  responsible_profile_id,
  customer_name,
  customer_email,
  customer_phone,
  customer_postal_code,
  customer_city,
  preliminary_address,
  preferred_date,
  preferred_time,
  property_address,
  property_postal_code,
  property_city,
  accepted_at,
  booked_at,
  converted_at,
  inspection_id,
  created_at,
  updated_at,
  last_sent_at,
  archived_at,
  archived_by
`

const ASSIGNMENT_DETAIL_SELECT = `
  ${ASSIGNMENT_SELECT_LIST},
  customer_address,
  property_municipality,
  property_owner_name,
  brf_name,
  apartment_number,
  apartment_holder_name,
  terms_version,
  terms_document_hash,
  invoice_name,
  invoice_address,
  orderer_role,
  personal_identity_number,
  notes_internal,
  cadastral_id,
  price_amount,
  currency,
  property_id
`

const PROPERTY_SNAPSHOT_COLUMNS =
  'id,owner,created_at,name,address,postal_code,city,municipality,cadastral_id,owner_name,client_name,contact_person,tenure_type,dwelling_type,property_type,plot_area_m2,area_m2,area_sqm,tax_value,planning_status,type_code,heating,ventilation,roof_type,year_built,cover_path,status,last_inspected,last_inspection_at'

function parseOrganizationValue(member: OrgMemberRow) {
  const value = member.organizations
  if (!value) return { name: null, emailFrom: null }
  if (Array.isArray(value)) {
    const first = value[0]
    return {
      name: first?.name ?? null,
      emailFrom: first?.email_from ?? null,
    }
  }
  return {
    name: value.name ?? null,
    emailFrom: value.email_from ?? null,
  }
}

function normalizeText(value: string | null | undefined) {
  if (!value) return null
  const normalized = value.trim()
  return normalized === '' ? null : normalized
}

function buildDefaultOrgName(profile: ProfileOrgSeedRow, userEmail: string | null) {
  const explicitOrg = normalizeText(profile.org_name)
  if (explicitOrg) return explicitOrg

  const company = normalizeText(profile.company_name)
  if (company) return company

  const fullName = normalizeText(profile.full_name)
  if (fullName) return `${fullName}s Organisation`

  const emailPrefix = normalizeText(userEmail)?.split('@')[0]
  if (emailPrefix) return `${emailPrefix} Organization`

  return 'Organization'
}

async function fetchActiveOrgMember(admin: SupabaseAdminClient, profileId: string) {
  const { data, error } = await admin
    .from('org_members')
    .select('org_id,role,is_active,is_default,organizations(name,email_from)')
    .eq('profile_id', profileId)
    .eq('is_active', true)
    .order('is_default', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    throw new Error(error.message ?? 'Kunde inte hämta organisationskoppling.')
  }

  return (data ?? null) as OrgMemberRow | null
}

async function ensureProfileOrgMembership(
  admin: SupabaseAdminClient,
  user: AuthUserLite
) {
  const existingActiveMember = await fetchActiveOrgMember(admin, user.id)
  if (existingActiveMember) return existingActiveMember

  const profileSelect =
    'id,is_admin,full_name,email,org_name,company_name'
  const { data: profileData, error: profileError } = await admin
    .from('profiles')
    .select(profileSelect)
    .eq('id', user.id)
    .maybeSingle()

  if (profileError) {
    throw new Error(profileError.message ?? 'Kunde inte hämta profil.')
  }

  let profile = (profileData ?? null) as ProfileOrgSeedRow | null

  if (!profile) {
    const fullNameFromMetadata = normalizeText(
      typeof user.user_metadata?.full_name === 'string' ? user.user_metadata.full_name : null
    )

    const { error: createProfileError } = await admin.from('profiles').upsert(
      {
        id: user.id,
        email: normalizeText(user.email ?? null),
        full_name: fullNameFromMetadata,
        is_admin: false,
      },
      { onConflict: 'id' }
    )

    if (createProfileError) {
      throw new Error(createProfileError.message ?? 'Kunde inte skapa profil.')
    }

    const { data: reloadedProfile, error: reloadProfileError } = await admin
      .from('profiles')
      .select(profileSelect)
      .eq('id', user.id)
      .maybeSingle()

    if (reloadProfileError) {
      throw new Error(reloadProfileError.message ?? 'Kunde inte läsa profil efter skapande.')
    }

    profile = (reloadedProfile ?? null) as ProfileOrgSeedRow | null
  }

  if (!profile) {
    throw new Error('Kunde inte läsa profil för organisationskoppling.')
  }

  const { data: existingMemberAnyStatus, error: existingMemberError } = await admin
    .from('org_members')
    .select('id,org_id,role,is_default')
    .eq('profile_id', user.id)
    .order('is_default', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (existingMemberError) {
    throw new Error(existingMemberError.message ?? 'Kunde inte läsa organisationsmedlemskap.')
  }

  const existingMember = (existingMemberAnyStatus ?? null) as OrgMemberAnyStatusRow | null

  if (existingMember) {
    const membershipPatch: { is_active: boolean; is_default?: boolean } = {
      is_active: true,
    }

    if (!existingMember.is_default) {
      membershipPatch.is_default = true
    }

    const { error: activateMemberError } = await admin
      .from('org_members')
      .update(membershipPatch)
      .eq('id', existingMember.id)

    if (activateMemberError) {
      const errorMessage = activateMemberError.message ?? ''
      const isUniqueRace =
        errorMessage.toLowerCase().includes('duplicate') ||
        errorMessage.toLowerCase().includes('unique') ||
        errorMessage.toLowerCase().includes('conflict')

      if (!isUniqueRace) {
        throw new Error(errorMessage || 'Kunde inte aktivera organisationsmedlemskap.')
      }
    }

    const activatedMember = await fetchActiveOrgMember(admin, user.id)
    if (activatedMember) return activatedMember
  }

  const { data: existingOrgData, error: existingOrgError } = await admin
    .from('organizations')
    .select('id')
    .eq('created_by', user.id)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()

  if (existingOrgError) {
    throw new Error(existingOrgError.message ?? 'Kunde inte läsa organisation.')
  }

  let orgId = ((existingOrgData ?? null) as OrganizationIdRow | null)?.id ?? null

  if (!orgId) {
    const orgName = buildDefaultOrgName(profile, normalizeText(user.email ?? null))
    const { data: createdOrg, error: createOrgError } = await admin
      .from('organizations')
      .insert({
        name: orgName,
        created_by: user.id,
      })
      .select('id')
      .single()

    if (createOrgError || !createdOrg) {
      throw new Error(createOrgError?.message ?? 'Kunde inte skapa organisation.')
    }

    orgId = (createdOrg as OrganizationIdRow).id
  }

  const role: 'admin' | 'inspector' = profile.is_admin ? 'admin' : 'inspector'
  const { error: createMemberError } = await admin.from('org_members').insert({
    org_id: orgId,
    profile_id: user.id,
    role,
    is_active: true,
    is_default: true,
  })

  if (createMemberError) {
    const errorMessage = createMemberError.message ?? ''
    const isUniqueRace =
      errorMessage.toLowerCase().includes('duplicate') ||
      errorMessage.toLowerCase().includes('unique') ||
      errorMessage.toLowerCase().includes('conflict')

    if (!isUniqueRace) {
      throw new Error(errorMessage || 'Kunde inte skapa organisationsmedlemskap.')
    }
  }

  return fetchActiveOrgMember(admin, user.id)
}

function getRequiredEnv(name: 'APP_BASE_URL' | 'ASSIGNMENTS_MAIL_FROM') {
  const value = process.env[name]
  if (!value || value.trim() === '') {
    throw new Error(`MISSING_ENV:${name}`)
  }
  return value.trim()
}

export function isMissingEnvError(value: unknown): value is Error {
  return value instanceof Error && value.message.startsWith('MISSING_ENV:')
}

export function buildBaseUrl() {
  return getRequiredEnv('APP_BASE_URL').replace(/\/+$/, '')
}

function getMailFromAddress() {
  return getRequiredEnv('ASSIGNMENTS_MAIL_FROM')
}

export async function requireOrgContext(): Promise<OrgContext> {
  const userClient = createSupabaseServerClient()
  const {
    data: { user },
    error: userError,
  } = await userClient.auth.getUser()

  if (userError || !user) {
    throw new Error('UNAUTHORIZED')
  }

  const admin = createSupabaseAdminClient() as unknown as SupabaseAdminClient

  const data = await ensureProfileOrgMembership(admin, user as AuthUserLite)
  if (!data) {
    throw new Error('ORG_MEMBERSHIP_REQUIRED')
  }

  const member = data as OrgMemberRow
  const orgData = parseOrganizationValue(member)

  return {
    userId: user.id,
    orgId: member.org_id,
    role: member.role,
    orgName: orgData.name,
    orgEmailFrom: orgData.emailFrom,
  }
}

export async function listAssignmentsByOrg(orgId: string) {
  const admin = createSupabaseAdminClient() as unknown as SupabaseAdminClient
  const { data, error } = await admin
    .from('assignments')
    .select(ASSIGNMENT_SELECT_LIST)
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })

  if (error) {
    throw new Error(error.message ?? 'Kunde inte hämta uppdrag.')
  }

  return (data ?? []) as AssignmentListItem[]
}

export async function getProfileContact(profileId: string) {
  const admin = createSupabaseAdminClient() as unknown as SupabaseAdminClient
  const { data, error } = await admin
    .from('profiles')
    .select('id,full_name,email')
    .eq('id', profileId)
    .maybeSingle()

  if (error) {
    throw new Error(error.message ?? 'Kunde inte hämta profil.')
  }

  return (data ?? null) as { id: string; full_name: string | null; email: string | null } | null
}

export async function listAddonOffersForProfile(input: {
  orgId: string
  profileId: string
}): Promise<AssignmentAddonOffer[]> {
  const admin = createSupabaseAdminClient() as unknown as SupabaseAdminClient

  const { data: profileAddonData, error: profileAddonError } = await (admin as any)
    .from('profile_addon_services')
    .select('addon_service_id,price_amount,currency')
    .eq('org_id', input.orgId)
    .eq('profile_id', input.profileId)
    .eq('is_enabled', true)

  if (profileAddonError) {
    throw new Error(profileAddonError.message ?? 'Kunde inte hämta tilläggsuppdrag för besiktningsman.')
  }

  const profileRows = (profileAddonData ?? []) as Array<{
    addon_service_id: string
    price_amount: number | null
    currency: string | null
  }>

  if (profileRows.length === 0) return []

  const addonIds = [...new Set(profileRows.map((row) => row.addon_service_id).filter(Boolean))]
  if (addonIds.length === 0) return []

  const { data: catalogData, error: catalogError } = await (admin as any)
    .from('settings_addon_services')
    .select('id,key,name,description,sort_order')
    .in('id', addonIds)
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })

  if (catalogError) {
    throw new Error(catalogError.message ?? 'Kunde inte hämta tilläggskatalog.')
  }

  const catalogRows = (catalogData ?? []) as Array<{
    id: string
    key: string
    name: string
    description: string | null
  }>
  const profileByAddonId = new Map(profileRows.map((row) => [row.addon_service_id, row]))

  return catalogRows.flatMap((service) => {
    const profileOffer = profileByAddonId.get(service.id)
    if (!profileOffer) return []

    const rawPrice =
      typeof profileOffer.price_amount === 'number'
        ? profileOffer.price_amount
        : Number(profileOffer.price_amount ?? 0)
    const normalizedPrice = Number.isFinite(rawPrice) && rawPrice >= 0 ? Number(rawPrice.toFixed(2)) : 0
    const normalizedCurrency = (profileOffer.currency ?? 'SEK').trim().toUpperCase() || 'SEK'

    return [
      {
        addon_service_id: service.id,
        key: service.key,
        name: service.name,
        description: service.description,
        price_amount: normalizedPrice,
        currency: normalizedCurrency,
      } satisfies AssignmentAddonOffer,
    ]
  })
}

export async function listAssignmentAddonOrders(input: {
  orgId: string
  assignmentId: string
}): Promise<AssignmentAddonOrder[]> {
  const admin = createSupabaseAdminClient() as unknown as SupabaseAdminClient

  const { data, error } = await (admin as any)
    .from('assignment_addon_orders')
    .select(
      'id,assignment_id,org_id,addon_service_id,addon_key,addon_name_snapshot,price_amount_snapshot,currency_snapshot,created_at'
    )
    .eq('org_id', input.orgId)
    .eq('assignment_id', input.assignmentId)
    .order('created_at', { ascending: true })

  if (error) {
    throw new Error(error.message ?? 'Kunde inte hämta beställda tilläggsuppdrag.')
  }

  const rows = (data ?? []) as Array<{
    id: string
    assignment_id: string
    org_id: string
    addon_service_id: string | null
    addon_key: string
    addon_name_snapshot: string
    price_amount_snapshot: number | string
    currency_snapshot: string | null
    created_at: string
  }>

  return rows.map((row) => {
    const rawPrice =
      typeof row.price_amount_snapshot === 'number'
        ? row.price_amount_snapshot
        : Number(String(row.price_amount_snapshot ?? '0'))
    const normalizedPrice = Number.isFinite(rawPrice) && rawPrice >= 0 ? Number(rawPrice.toFixed(2)) : 0

    return {
      id: row.id,
      assignment_id: row.assignment_id,
      org_id: row.org_id,
      addon_service_id: row.addon_service_id,
      addon_key: row.addon_key,
      addon_name_snapshot: row.addon_name_snapshot,
      price_amount_snapshot: normalizedPrice,
      currency_snapshot: (row.currency_snapshot ?? 'SEK').trim().toUpperCase() || 'SEK',
      created_at: row.created_at,
    } satisfies AssignmentAddonOrder
  })
}

export async function createAssignment(input: {
  orgId: string
  createdBy: string
  responsibleProfileId: string
  assignmentType: AssignmentType
  customerEmail: string
  customerName?: string | null
  customerPhone?: string | null
  customerPostalCode?: string | null
  customerCity?: string | null
  customerAddress?: string | null
  preliminaryAddress?: string | null
  propertyAddress?: string | null
  propertyPostalCode?: string | null
  propertyCity?: string | null
  propertyMunicipality?: string | null
  propertyOwnerName?: string | null
  cadastralId?: string | null
  brfName?: string | null
  apartmentNumber?: string | null
  apartmentHolderName?: string | null
  ordererRole?: string | null
  preferredDate?: string | null
  preferredTime?: string | null
  priceAmount?: number | null
  currency?: string | null
  notesInternal?: string | null
}) {
  const admin = createSupabaseAdminClient() as unknown as SupabaseAdminClient
  const { data, error } = await admin
    .from('assignments')
    .insert({
      org_id: input.orgId,
      status: 'draft',
      assignment_type: input.assignmentType,
      responsible_profile_id: input.responsibleProfileId,
      customer_email: input.customerEmail,
      customer_name: input.customerName ?? null,
      customer_phone: input.customerPhone ?? null,
      customer_postal_code: input.customerPostalCode ?? null,
      customer_city: input.customerCity ?? null,
      customer_address: input.customerAddress ?? null,
      preliminary_address: input.preliminaryAddress ?? null,
      property_address: input.propertyAddress ?? input.preliminaryAddress ?? null,
      property_postal_code: input.propertyPostalCode ?? null,
      property_city: input.propertyCity ?? null,
      property_municipality: input.propertyMunicipality ?? null,
      property_owner_name: input.propertyOwnerName ?? null,
      cadastral_id: input.cadastralId ?? null,
      brf_name: input.brfName ?? null,
      apartment_number: input.apartmentNumber ?? null,
      apartment_holder_name: input.apartmentHolderName ?? null,
      orderer_role: input.ordererRole ?? null,
      preferred_date: input.preferredDate ?? null,
      preferred_time: input.preferredTime ?? null,
      price_amount: input.priceAmount ?? null,
      currency: input.currency ?? 'SEK',
      notes_internal: input.notesInternal ?? null,
      created_by: input.createdBy,
      updated_by: input.createdBy,
    })
    .select(ASSIGNMENT_DETAIL_SELECT)
    .single()

  if (error || !data) {
    throw new Error(error?.message ?? 'Kunde inte skapa uppdrag.')
  }

  return data as AssignmentDetails
}

export async function getAssignmentById(orgId: string, assignmentId: string) {
  const admin = createSupabaseAdminClient() as unknown as SupabaseAdminClient
  const { data, error } = await admin
    .from('assignments')
    .select(ASSIGNMENT_DETAIL_SELECT)
    .eq('org_id', orgId)
    .eq('id', assignmentId)
    .maybeSingle()

  if (error) {
    throw new Error(error.message ?? 'Kunde inte hämta uppdrag.')
  }

  return (data ?? null) as AssignmentDetails | null
}

export async function updateAssignmentById(input: {
  orgId: string
  assignmentId: string
  updatedBy: string
  patch: Partial<{
    customer_name: string | null
    customer_email: string | null
    customer_phone: string | null
    customer_postal_code: string | null
    customer_city: string | null
    customer_address: string | null
    preliminary_address: string | null
    preferred_date: string | null
    preferred_time: string | null
    property_address: string | null
    property_postal_code: string | null
    property_city: string | null
    property_municipality: string | null
    property_owner_name: string | null
    cadastral_id: string | null
    brf_name: string | null
    apartment_number: string | null
    apartment_holder_name: string | null
    invoice_name: string | null
    invoice_address: string | null
    orderer_role: string | null
    personal_identity_number: string | null
    notes_internal: string | null
    price_amount: number | null
    currency: string | null
    assignment_type: AssignmentType
    responsible_profile_id: string
    status: AssignmentStatus
    archived_at: string | null
    archived_by: string | null
  }>
}) {
  const admin = createSupabaseAdminClient() as unknown as SupabaseAdminClient
  const patch: Record<string, unknown> = { ...input.patch }
  if (input.patch.status === 'booked') {
    patch.booked_at = new Date().toISOString()
  }
  const payload = {
    ...patch,
    updated_by: input.updatedBy,
  }

  const { data, error } = await admin
    .from('assignments')
    .update(payload)
    .eq('org_id', input.orgId)
    .eq('id', input.assignmentId)
    .select(ASSIGNMENT_DETAIL_SELECT)
    .single()

  if (error || !data) {
    throw new Error(error?.message ?? 'Kunde inte uppdatera uppdrag.')
  }

  // Soft-delete flow: revoke all still-active public accept links when an assignment is cancelled.
  if (input.patch.status === 'cancelled') {
    const { error: revokeError } = await admin
      .from('assignment_links')
      .update({
        revoked_at: new Date().toISOString(),
      })
      .eq('org_id', input.orgId)
      .eq('assignment_id', input.assignmentId)
      .is('used_at', null)
      .is('revoked_at', null)

    if (revokeError) {
      throw new Error(revokeError.message ?? 'Kunde inte inaktivera uppdragslankar.')
    }
  }

  return data as AssignmentDetails
}

export async function createReissuedAssignmentDraft(input: {
  orgId: string
  sourceAssignmentId: string
  createdBy: string
}): Promise<{ draft: AssignmentDetails; cancelledSource: AssignmentDetails }> {
  const admin = createSupabaseAdminClient() as unknown as SupabaseAdminClient
  const source = await getAssignmentById(input.orgId, input.sourceAssignmentId)

  if (!source) {
    throw new Error('ASSIGNMENT_NOT_FOUND')
  }

  if (source.status !== 'sent' && source.status !== 'ordered' && source.status !== 'booked') {
    throw new Error('ASSIGNMENT_REISSUE_NOT_ALLOWED')
  }

  const draft = await createAssignment({
    orgId: input.orgId,
    createdBy: input.createdBy,
    responsibleProfileId: source.responsible_profile_id,
    assignmentType: source.assignment_type,
    customerEmail: source.customer_email,
    customerName: source.customer_name,
    customerPhone: source.customer_phone,
    customerPostalCode: source.customer_postal_code,
    customerCity: source.customer_city,
    customerAddress: source.customer_address,
    preliminaryAddress: source.preliminary_address,
    propertyAddress: source.property_address,
    propertyPostalCode: source.property_postal_code,
    propertyCity: source.property_city,
    propertyMunicipality: source.property_municipality,
    propertyOwnerName: source.property_owner_name,
    cadastralId: source.cadastral_id,
    brfName: source.brf_name,
    apartmentNumber: source.apartment_number,
    apartmentHolderName: source.apartment_holder_name,
    ordererRole: source.orderer_role,
    preferredDate: source.preferred_date,
    preferredTime: source.preferred_time,
    priceAmount: source.price_amount,
    currency: source.currency,
    notesInternal: source.notes_internal,
  })

  try {
    const addonOrders = await listAssignmentAddonOrders({
      orgId: input.orgId,
      assignmentId: source.id,
    })

    if (addonOrders.length > 0) {
      const payload = addonOrders.map((row) => ({
        assignment_id: draft.id,
        org_id: input.orgId,
        addon_service_id: row.addon_service_id,
        addon_key: row.addon_key,
        addon_name_snapshot: row.addon_name_snapshot,
        price_amount_snapshot: row.price_amount_snapshot,
        currency_snapshot: row.currency_snapshot,
      }))

      const { error: addonInsertError } = await (admin as any)
        .from('assignment_addon_orders')
        .insert(payload)

      if (addonInsertError) {
        throw new Error(addonInsertError.message ?? 'Kunde inte kopiera tilläggsuppdrag.')
      }
    }
    const cancelledSource = await updateAssignmentById({
      orgId: input.orgId,
      assignmentId: source.id,
      updatedBy: input.createdBy,
      patch: { status: 'cancelled' },
    })

    return { draft, cancelledSource }
  } catch (error) {
    await admin.from('assignments').delete().eq('org_id', input.orgId).eq('id', draft.id)
    throw error instanceof Error
      ? error
      : new Error('Kunde inte skapa ny version av uppdragsbekräftelsen.')
  }
}

export class AssignmentEmailSendError extends Error {
  acceptUrl: string

  constructor(message: string, acceptUrl: string) {
    super(message)
    this.acceptUrl = acceptUrl
  }
}

function toSwedishDateString(value: string | null) {
  if (!value) return 'Ej satt'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleDateString('sv-SE')
}

export async function sendAssignmentConfirmation(input: {
  assignment: AssignmentDetails
  orgName: string | null
  requestedByUserId: string
  responsibleEmail: string | null
  baseUrl: string
}): Promise<AssignmentLinkResult> {
  const admin = createSupabaseAdminClient() as unknown as SupabaseAdminClient
  const token = generateAssignmentToken()
  const tokenHash = hashAssignmentToken(token)
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
  const acceptUrl = `${input.baseUrl}/accept/${token}`
  const termsRole = parseAssignmentTermsRole(input.assignment.orderer_role)
  if (!termsRole) {
    throw new Error('ORDERER_ROLE_REQUIRED')
  }
  const assignmentPrice =
    typeof input.assignment.price_amount === 'number' ? input.assignment.price_amount : null
  if (assignmentPrice === null || !Number.isFinite(assignmentPrice) || assignmentPrice < 0) {
    throw new Error('PRICE_REQUIRED')
  }
  const terms = getAssignmentTermsDocument(termsRole)

  await admin
    .from('assignment_links')
    .update({
      revoked_at: new Date().toISOString(),
    })
    .eq('org_id', input.assignment.org_id)
    .eq('assignment_id', input.assignment.id)
    .is('used_at', null)
    .is('revoked_at', null)

  const { data: linkData, error: linkError } = await admin
    .from('assignment_links')
    .insert({
      assignment_id: input.assignment.id,
      org_id: input.assignment.org_id,
      token_hash: tokenHash,
      expires_at: expiresAt,
      terms_version: terms.version,
      created_by: input.requestedByUserId,
    })
    .select('id')
    .single()

  if (linkError || !linkData) {
    throw new Error(linkError?.message ?? 'Kunde inte skapa uppdragslänk.')
  }

  const fromAddress = getMailFromAddress()
  const { subject, html, text } = buildAssignmentConfirmationEmail({
    assignment: input.assignment,
    orgName: input.orgName,
    acceptUrl,
    expiresAt,
    termsVersion: terms.version,
    termsRole,
  })

  const { data: messageData, error: messageError } = await admin
    .from('outbound_messages')
    .insert({
      org_id: input.assignment.org_id,
      assignment_id: input.assignment.id,
      channel: 'email',
      recipient_email: input.assignment.customer_email,
      subject,
      template_key: 'assignment_confirmation',
      status: 'pending',
      created_by: input.requestedByUserId,
      reply_to_email: input.responsibleEmail ?? null,
    })
    .select('id')
    .single()

  if (messageError || !messageData) {
    throw new Error(messageError?.message ?? 'Kunde inte skapa mejllogg.')
  }

  try {
    const sendResult = await sendAssignmentEmail({
      to: input.assignment.customer_email,
      from: fromAddress,
      replyTo: input.responsibleEmail ?? null,
      subject,
      html,
      text,
    })

    await admin
      .from('outbound_messages')
      .update({
        status: 'sent',
        provider: sendResult.provider,
        provider_message_id: sendResult.providerMessageId,
        sent_at: new Date().toISOString(),
      })
      .eq('id', messageData.id)

    const nextAssignmentStatus: AssignmentStatus =
      input.assignment.status === 'ordered' || input.assignment.status === 'booked'
        ? input.assignment.status
        : 'sent'

    await admin
      .from('assignments')
      .update({
        status: nextAssignmentStatus,
        last_sent_at: new Date().toISOString(),
        updated_by: input.requestedByUserId,
      })
      .eq('id', input.assignment.id)
      .eq('org_id', input.assignment.org_id)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okänt fel vid mejlutskick.'
    await admin
      .from('outbound_messages')
      .update({
        status: 'failed',
        error_message: message,
      })
      .eq('id', messageData.id)

    throw new AssignmentEmailSendError(message, acceptUrl)
  }

  return {
    acceptUrl,
    expiresAt,
  }
}

export async function sendAssignmentOrderReceipt(input: {
  assignment: AssignmentDetails
  orgName: string | null
  requestedByUserId?: string | null
  responsibleEmail: string | null
}): Promise<void> {
  const admin = createSupabaseAdminClient() as unknown as SupabaseAdminClient
  const termsRole = parseAssignmentTermsRole(input.assignment.orderer_role)
  if (!termsRole) {
    throw new Error('ORDERER_ROLE_REQUIRED')
  }
  if (!input.assignment.accepted_at || !input.assignment.terms_version) {
    throw new Error('ASSIGNMENT_NOT_ACCEPTED')
  }

  const terms = getAssignmentTermsDocument(termsRole)
  const addonOrders = await listAssignmentAddonOrders({
    orgId: input.assignment.org_id,
    assignmentId: input.assignment.id,
  })

  const { subject, html, text } = buildAssignmentOrderReceiptEmail({
    assignment: input.assignment,
    orgName: input.orgName,
    termsVersion: input.assignment.terms_version,
    termsRole,
    termsText: terms.text,
    acceptedAt: input.assignment.accepted_at,
    addonOrders: addonOrders.map((row) => ({
      addon_name_snapshot: row.addon_name_snapshot,
      price_amount_snapshot: row.price_amount_snapshot,
      currency_snapshot: row.currency_snapshot,
    })),
  })

  const fromAddress = getMailFromAddress()
  const createdBy = input.requestedByUserId ?? input.assignment.responsible_profile_id ?? null

  const { data: messageData, error: messageError } = await admin
    .from('outbound_messages')
    .insert({
      org_id: input.assignment.org_id,
      assignment_id: input.assignment.id,
      channel: 'email',
      recipient_email: input.assignment.customer_email,
      subject,
      template_key: 'assignment_order_receipt',
      status: 'pending',
      created_by: createdBy,
      reply_to_email: input.responsibleEmail ?? null,
    })
    .select('id')
    .single()

  if (messageError || !messageData) {
    throw new Error(messageError?.message ?? 'Kunde inte skapa mejllogg.')
  }

  try {
    const sendResult = await sendAssignmentEmail({
      to: input.assignment.customer_email,
      from: fromAddress,
      replyTo: input.responsibleEmail ?? null,
      subject,
      html,
      text,
    })

    await admin
      .from('outbound_messages')
      .update({
        status: 'sent',
        provider: sendResult.provider,
        provider_message_id: sendResult.providerMessageId,
        sent_at: new Date().toISOString(),
      })
      .eq('id', messageData.id)

    await admin
      .from('assignments')
      .update({
        last_sent_at: new Date().toISOString(),
        updated_by: createdBy,
      })
      .eq('id', input.assignment.id)
      .eq('org_id', input.assignment.org_id)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'OkÃ¤nt fel vid mejlutskick.'
    await admin
      .from('outbound_messages')
      .update({
        status: 'failed',
        error_message: message,
      })
      .eq('id', messageData.id)

    throw new Error(message)
  }
}

export async function sendAssignmentAcceptedNotice(input: {
  assignment: AssignmentDetails
  orgName: string | null
  requestedByUserId?: string | null
  responsibleEmail: string | null
}): Promise<void> {
  const admin = createSupabaseAdminClient() as unknown as SupabaseAdminClient
  if (!input.assignment.accepted_at) {
    throw new Error('ASSIGNMENT_NOT_ACCEPTED')
  }

  const { subject, html, text } = buildAssignmentAcceptedNoticeEmail({
    assignment: input.assignment,
    orgName: input.orgName,
    acceptedAt: input.assignment.accepted_at,
  })

  const fromAddress = getMailFromAddress()
  const createdBy = input.requestedByUserId ?? input.assignment.responsible_profile_id ?? null

  const { data: messageData, error: messageError } = await admin
    .from('outbound_messages')
    .insert({
      org_id: input.assignment.org_id,
      assignment_id: input.assignment.id,
      channel: 'email',
      recipient_email: input.assignment.customer_email,
      subject,
      template_key: 'assignment_accept_notice',
      status: 'pending',
      created_by: createdBy,
      reply_to_email: input.responsibleEmail ?? null,
    })
    .select('id')
    .single()

  if (messageError || !messageData) {
    throw new Error(messageError?.message ?? 'Kunde inte skapa mejllogg.')
  }

  try {
    const sendResult = await sendAssignmentEmail({
      to: input.assignment.customer_email,
      from: fromAddress,
      replyTo: input.responsibleEmail ?? null,
      subject,
      html,
      text,
    })

    await admin
      .from('outbound_messages')
      .update({
        status: 'sent',
        provider: sendResult.provider,
        provider_message_id: sendResult.providerMessageId,
        sent_at: new Date().toISOString(),
      })
      .eq('id', messageData.id)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okänt fel vid mejlutskick.'
    await admin
      .from('outbound_messages')
      .update({
        status: 'failed',
        error_message: message,
      })
      .eq('id', messageData.id)

    throw new Error(message)
  }
}

export async function sendAssignmentCancelledNotice(input: {
  assignment: AssignmentDetails
  orgName: string | null
  requestedByUserId?: string | null
  responsibleEmail: string | null
}): Promise<void> {
  const admin = createSupabaseAdminClient() as unknown as SupabaseAdminClient

  const { subject, html, text } = buildAssignmentCancelledNoticeEmail({
    assignment: input.assignment,
    orgName: input.orgName,
  })

  const fromAddress = getMailFromAddress()
  const createdBy = input.requestedByUserId ?? input.assignment.responsible_profile_id ?? null

  const { data: messageData, error: messageError } = await admin
    .from('outbound_messages')
    .insert({
      org_id: input.assignment.org_id,
      assignment_id: input.assignment.id,
      channel: 'email',
      recipient_email: input.assignment.customer_email,
      subject,
      template_key: 'assignment_cancelled_notice',
      status: 'pending',
      created_by: createdBy,
      reply_to_email: input.responsibleEmail ?? null,
    })
    .select('id')
    .single()

  if (messageError || !messageData) {
    throw new Error(messageError?.message ?? 'Kunde inte skapa mejllogg.')
  }

  try {
    const sendResult = await sendAssignmentEmail({
      to: input.assignment.customer_email,
      from: fromAddress,
      replyTo: input.responsibleEmail ?? null,
      subject,
      html,
      text,
    })

    await admin
      .from('outbound_messages')
      .update({
        status: 'sent',
        provider: sendResult.provider,
        provider_message_id: sendResult.providerMessageId,
        sent_at: new Date().toISOString(),
      })
      .eq('id', messageData.id)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okant fel vid mejlutskick.'
    await admin
      .from('outbound_messages')
      .update({
        status: 'failed',
        error_message: message,
      })
      .eq('id', messageData.id)

    throw new Error(message)
  }
}

export class InspectionCompletedEmailSendError extends Error {
  detailsUrl: string

  constructor(message: string, detailsUrl: string) {
    super(message)
    this.detailsUrl = detailsUrl
  }
}

export async function sendInspectionCompletedEmail(input: {
  assignment: AssignmentDetails
  orgName: string | null
  requestedByUserId: string
  responsibleEmail: string | null
  baseUrl: string
}): Promise<InspectionCompletedEmailResult> {
  const admin = createSupabaseAdminClient() as unknown as SupabaseAdminClient

  if (!input.assignment.inspection_id || !input.assignment.property_id) {
    throw new Error('INSPECTION_REFERENCE_MISSING')
  }

  const fromAddress = getMailFromAddress()
  const detailsUrl = `${input.baseUrl}/utlatande/${input.assignment.property_id}/${input.assignment.inspection_id}`
  const subject = `Besiktningen ar klar - ${input.orgName ?? 'BesiktApp'}`
  const preferredDate = toSwedishDateString(input.assignment.preferred_date)
  const address =
    input.assignment.property_address ?? input.assignment.preliminary_address ?? 'Ej satt'

  const html = `
    <p>Hej,</p>
    <p>Besiktningen ar nu klar.</p>
    <p><strong>Adress:</strong> ${address}<br/>
    <strong>Datum:</strong> ${preferredDate}</p>
    <p><a href="${detailsUrl}" target="_blank" rel="noreferrer">Oppna underlag</a></p>
  `

  const text =
    `Hej,\n\n` +
    `Besiktningen ar nu klar.\n` +
    `Adress: ${address}\n` +
    `Datum: ${preferredDate}\n\n` +
    `Oppna underlag: ${detailsUrl}`

  const { data: messageData, error: messageError } = await admin
    .from('outbound_messages')
    .insert({
      org_id: input.assignment.org_id,
      assignment_id: input.assignment.id,
      channel: 'email',
      recipient_email: input.assignment.customer_email,
      subject,
      template_key: 'inspection_completed',
      status: 'pending',
      created_by: input.requestedByUserId,
      reply_to_email: input.responsibleEmail ?? null,
    })
    .select('id')
    .single()

  if (messageError || !messageData) {
    throw new Error(messageError?.message ?? 'Kunde inte skapa mejllogg.')
  }

  try {
    const sendResult = await sendAssignmentEmail({
      to: input.assignment.customer_email,
      from: fromAddress,
      replyTo: input.responsibleEmail ?? null,
      subject,
      html,
      text,
    })

    await admin
      .from('outbound_messages')
      .update({
        status: 'sent',
        provider: sendResult.provider,
        provider_message_id: sendResult.providerMessageId,
        sent_at: new Date().toISOString(),
      })
      .eq('id', messageData.id)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okant fel vid mejlutskick.'
    await admin
      .from('outbound_messages')
      .update({
        status: 'failed',
        error_message: message,
      })
      .eq('id', messageData.id)

    throw new InspectionCompletedEmailSendError(message, detailsUrl)
  }

  return { detailsUrl }
}

export async function resolvePublicAssignmentByToken(token: string) {
  const admin = createSupabaseAdminClient() as unknown as SupabaseAdminClient
  const tokenHash = hashAssignmentToken(token)

  const { data, error } = await admin
    .from('assignment_links')
    .select(
      'id,assignment_id,org_id,expires_at,used_at,revoked_at,terms_version,assignments(id,status,assignment_type,responsible_profile_id,customer_name,customer_email,customer_phone,customer_address,preliminary_address,preferred_date,preferred_time,price_amount,currency,property_address,property_postal_code,property_city,property_municipality,property_owner_name,cadastral_id,brf_name,apartment_number,apartment_holder_name,orderer_role,accepted_at)'
    )
    .eq('token_hash', tokenHash)
    .maybeSingle()

  if (error) {
    throw new Error(error.message ?? 'Kunde inte verifiera token.')
  }

  return data as
    | {
        id: string
        assignment_id: string
        org_id: string
        expires_at: string
        used_at: string | null
        revoked_at: string | null
        terms_version: string | null
        assignments: AssignmentDetails | AssignmentDetails[] | null
      }
    | null
}

export async function consumeAssignmentToken(input: {
  token: string
  termsVersion: string
  payload: Record<string, unknown>
  ip: string | null
  userAgent: string | null
}) {
  const admin = createSupabaseAdminClient() as unknown as SupabaseAdminClient
  const { data, error } = await admin.rpc('consume_assignment_token', {
    p_token: input.token,
    p_terms_version: input.termsVersion,
    p_payload: input.payload,
    p_ip: input.ip,
    p_user_agent: input.userAgent,
  })

  if (error) {
    const parts = [error.message ?? 'Kunde inte acceptera uppdrag.']
    if (error.code) parts.push(`code=${error.code}`)
    if (error.details) parts.push(`details=${error.details}`)
    if (error.hint) parts.push(`hint=${error.hint}`)
    throw new Error(parts.join(' | '))
  }

  return data
}

function toPropertyName(address: string | null, assignmentId: string) {
  if (address && address.trim().length > 0) return address.trim()
  return `Fastighet ${assignmentId.slice(0, 8)}`
}

function normalizeAssignmentRoleToInspectionSide(
  value: string | null | undefined
): 'buyer' | 'seller' | 'apartment' {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')

  if (normalized.includes('sell') || normalized.includes('salj')) return 'seller'
  if (
    normalized.includes('apt') ||
    normalized.includes('apartment') ||
    normalized.includes('lagenhet')
  ) {
    return 'apartment'
  }
  return 'buyer'
}

function toAddonPrice(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(String(value ?? '0'))
  if (!Number.isFinite(parsed) || parsed < 0) return 0
  return Number(parsed.toFixed(2))
}

function toAddonCurrency(value: unknown): string {
  const normalized = String(value ?? '')
    .trim()
    .toUpperCase()
  return normalized.length === 3 ? normalized : 'SEK'
}

function toDateOnly(value: string | null | undefined): string | null {
  if (!value) return null
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return null
  const parts = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Stockholm',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(parsed)
  const year = parts.find(part => part.type === 'year')?.value
  const month = parts.find(part => part.type === 'month')?.value
  const day = parts.find(part => part.type === 'day')?.value
  return year && month && day ? `${year}-${month}-${day}` : null
}

function buildSnapshotPayload(inspectionId: string, propertyData: PropertySeedRow) {
  return {
    inspection_id: inspectionId,
    source_property_id: propertyData.id,
    source_property_owner: propertyData.owner ?? null,
    source_property_created_at: propertyData.created_at ?? null,
    imported_at: new Date().toISOString(),
    snapshot_version: 1,
    name: propertyData.name ?? null,
    address: propertyData.address ?? null,
    postal_code: propertyData.postal_code ?? null,
    city: propertyData.city ?? null,
    municipality: propertyData.municipality ?? null,
    cadastral_id: propertyData.cadastral_id ?? null,
    owner_name: propertyData.owner_name ?? null,
    client_name: propertyData.client_name ?? null,
    contact_person: propertyData.contact_person ?? null,
    tenure_type: propertyData.tenure_type ?? null,
    dwelling_type: propertyData.dwelling_type ?? null,
    property_type: propertyData.property_type ?? null,
    plot_area_m2: propertyData.plot_area_m2 ?? null,
    area_m2: propertyData.area_m2 ?? null,
    area_sqm: propertyData.area_sqm ?? null,
    tax_value: propertyData.tax_value ?? null,
    planning_status: propertyData.planning_status ?? null,
    type_code: propertyData.type_code ?? null,
    heating: propertyData.heating ?? null,
    ventilation: propertyData.ventilation ?? null,
    roof_type: propertyData.roof_type ?? null,
    year_built: propertyData.year_built ?? null,
    cover_path: propertyData.cover_path ?? null,
    status: propertyData.status ?? null,
    last_inspected: propertyData.last_inspected ?? null,
    last_inspection_at: propertyData.last_inspection_at ?? null,
  }
}

export async function convertAssignmentToInspection(input: {
  orgId: string
  assignmentId: string
  requestedByUserId: string
}): Promise<ConvertAssignmentResult> {
  const admin = createSupabaseAdminClient() as unknown as SupabaseAdminClient
  const assignment = await getAssignmentById(input.orgId, input.assignmentId)

  if (!assignment) {
    throw new Error('Uppdraget hittades inte.')
  }

  if (assignment.inspection_id) {
    const propertyId = assignment.property_id
    if (!propertyId) {
      throw new Error('Uppdraget är redan konverterat men saknar property_id.')
    }
    return { propertyId, inspectionId: assignment.inspection_id }
  }

  if (assignment.status !== 'booked') {
    throw new Error('Uppdraget måste vara bokat innan besiktning kan startas.')
  }

  const resolvedAddress = assignment.property_address ?? assignment.preliminary_address ?? null
  const ownerId = assignment.responsible_profile_id ?? input.requestedByUserId
  const propertyName = toPropertyName(resolvedAddress, assignment.id)

  const { data: propertyData, error: propertyError } = await admin
    .from('properties')
    .insert({
      owner: ownerId,
      name: propertyName,
      status: 'Utkast',
      address: resolvedAddress,
      postal_code: assignment.property_postal_code,
      city: assignment.property_city ?? assignment.property_municipality,
      municipality: assignment.property_municipality ?? assignment.property_city,
      cadastral_id: assignment.cadastral_id,
      client_name: assignment.customer_name,
      owner_name: assignment.property_owner_name ?? assignment.customer_name,
    })
    .select(PROPERTY_SNAPSHOT_COLUMNS)
    .single()

  if (propertyError || !propertyData) {
    throw new Error(propertyError?.message ?? 'Kunde inte skapa fastighet från uppdrag.')
  }

  const property = propertyData as PropertySeedRow

  const assignmentNo = assignment.id.replace(/-/g, '').slice(0, 8).toUpperCase()
  const contactParts = [assignment.customer_phone, assignment.customer_email].filter(Boolean)
  const clientContact = contactParts.length > 0 ? contactParts.join(' | ') : null

  const { data: inspectionData, error: inspectionError } = await admin
    .from('inspections')
    .insert({
      property_id: propertyData.id,
      type: assignment.assignment_type,
      status: 'draft',
      inspection_side: normalizeAssignmentRoleToInspectionSide(assignment.orderer_role),
      date: assignment.preferred_date,
      inspection_time: assignment.preferred_time,
      client_name: assignment.customer_name,
      client_contact: clientContact,
      assignment_number: assignmentNo,
      assignment_confirmation_delivered_date: toDateOnly(assignment.accepted_at),
    })
    .select('id')
    .single()

  if (inspectionError || !inspectionData) {
    await admin.from('properties').delete().eq('id', property.id)
    throw new Error(inspectionError?.message ?? 'Kunde inte skapa besiktning från uppdrag.')
  }

  const inspection = inspectionData as { id: string }

  const { error: conditionsError } = await admin
    .from('inspection_conditions')
    .insert({
      inspection_id: inspection.id,
      furnishing_level: 'fullt_moblerad',
    })

  if (conditionsError) {
    await admin.from('inspections').delete().eq('id', inspection.id)
    await admin.from('properties').delete().eq('id', property.id)
    throw new Error(conditionsError.message ?? 'Kunde inte skapa förutsättningar för besiktning.')
  }

  const { data: profileAddonDataRaw, error: profileAddonError } = await (admin as any)
    .from('profile_addon_services')
    .select('addon_service_id, price_amount, currency')
    .eq('org_id', input.orgId)
    .eq('profile_id', ownerId)
    .eq('is_enabled', true)

  if (profileAddonError) {
    await admin.from('inspections').delete().eq('id', inspection.id)
    await admin.from('properties').delete().eq('id', property.id)
    throw new Error(profileAddonError.message ?? 'Kunde inte hämta tilläggsuppdrag för besiktningsmannen.')
  }

  const profileAddonRows = Array.isArray(profileAddonDataRaw)
    ? (profileAddonDataRaw as Array<{
        addon_service_id: string
        price_amount: number | string | null
        currency: string | null
      }>)
    : []

  if (profileAddonRows.length > 0) {
    const addonServiceIds = Array.from(
      new Set(
        profileAddonRows
          .map(row => row.addon_service_id)
          .filter((value): value is string => typeof value === 'string' && value.length > 0)
      )
    )
    const addonServiceFilter =
      addonServiceIds.length > 0
        ? addonServiceIds
        : ['00000000-0000-0000-0000-000000000000']

    const { data: catalogDataRaw, error: catalogError } = await (admin as any)
      .from('settings_addon_services')
      .select('id, key, name, sort_order')
      .eq('is_active', true)
      .in('id', addonServiceFilter)

    if (catalogError) {
      await admin.from('inspections').delete().eq('id', inspection.id)
      await admin.from('properties').delete().eq('id', property.id)
      throw new Error(catalogError.message ?? 'Kunde inte hämta tilläggskatalogen.')
    }

    const catalogRows = Array.isArray(catalogDataRaw)
      ? (catalogDataRaw as Array<{
          id: string
          key: string
          name: string
          sort_order: number | null
        }>)
      : []

    const { data: assignmentAddonDataRaw, error: assignmentAddonError } = await (admin as any)
      .from('assignment_addon_orders')
      .select(
        'id, addon_service_id, addon_key, addon_name_snapshot, price_amount_snapshot, currency_snapshot'
      )
      .eq('org_id', input.orgId)
      .eq('assignment_id', assignment.id)

    if (assignmentAddonError) {
      await admin.from('inspections').delete().eq('id', inspection.id)
      await admin.from('properties').delete().eq('id', property.id)
      throw new Error(
        assignmentAddonError.message ?? 'Kunde inte hämta valda tilläggsuppdrag från uppdraget.'
      )
    }

    const assignmentAddonRows = Array.isArray(assignmentAddonDataRaw)
      ? (assignmentAddonDataRaw as Array<{
          id: string
          addon_service_id: string | null
          addon_key: string
          addon_name_snapshot: string
          price_amount_snapshot: number | string
          currency_snapshot: string | null
        }>)
      : []

    const catalogById = new Map(catalogRows.map(row => [row.id, row]))
    const selectedByServiceId = new Map(
      assignmentAddonRows
        .filter((row): row is typeof row & { addon_service_id: string } => !!row.addon_service_id)
        .map(row => [row.addon_service_id, row])
    )
    const selectedByKey = new Map(assignmentAddonRows.map(row => [row.addon_key, row]))

    const inspectionAddonRows = profileAddonRows
      .map(row => {
        const catalog = catalogById.get(row.addon_service_id)
        if (!catalog) return null

        const selected = selectedByServiceId.get(catalog.id) ?? selectedByKey.get(catalog.key)
        return {
          inspection_id: inspection.id,
          org_id: input.orgId,
          assignment_addon_order_id: selected?.id ?? null,
          addon_service_id: catalog.id,
          addon_key: catalog.key,
          addon_name_snapshot:
            selected?.addon_name_snapshot?.trim() && selected.addon_name_snapshot.trim().length > 0
              ? selected.addon_name_snapshot.trim()
              : catalog.name,
          sort_order: typeof catalog.sort_order === 'number' ? catalog.sort_order : 100,
          price_amount_snapshot: selected
            ? toAddonPrice(selected.price_amount_snapshot)
            : toAddonPrice(row.price_amount),
          currency_snapshot: selected
            ? toAddonCurrency(selected.currency_snapshot)
            : toAddonCurrency(row.currency),
          is_selected: !!selected,
          selected_source: selected ? 'assignment' : 'inspection',
        }
      })
      .filter((row): row is NonNullable<typeof row> => row !== null)

    if (inspectionAddonRows.length > 0) {
      const { error: inspectionAddonError } = await (admin as any)
        .from('inspection_addon_orders')
        .insert(inspectionAddonRows)

      if (inspectionAddonError) {
        await admin.from('inspections').delete().eq('id', inspection.id)
        await admin.from('properties').delete().eq('id', property.id)
        throw new Error(
          inspectionAddonError.message ?? 'Kunde inte skapa tilläggsuppdragssnapshot för besiktningen.'
        )
      }

      const selectedScope = inspectionAddonRows
        .filter(row => row.is_selected)
        .map(row => row.addon_name_snapshot)
        .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
        .join('; ')

      if (selectedScope !== '') {
        const { error: scopeUpdateError } = await admin
          .from('inspections')
          .update({ scope: selectedScope })
          .eq('id', inspection.id)

        if (scopeUpdateError) {
          await admin.from('inspections').delete().eq('id', inspection.id)
          await admin.from('properties').delete().eq('id', property.id)
          throw new Error(
            scopeUpdateError.message ?? 'Kunde inte sätta omfattning från valda tilläggsuppdrag.'
          )
        }
      }
    }
  }

  if (assignment.assignment_type === 'OB') {
    const snapshotPayload = {
      ...buildSnapshotPayload(inspection.id, property),
      brf_name: assignment.brf_name ?? null,
      apartment_number: assignment.apartment_number ?? null,
      apartment_holder_name: assignment.apartment_holder_name ?? null,
    }

    const { error: snapshotError } = await admin
      .from('ob_property_snapshot')
      .upsert(snapshotPayload, {
        onConflict: 'inspection_id',
      })

    if (snapshotError) {
      await admin.from('inspections').delete().eq('id', inspection.id)
      await admin.from('properties').delete().eq('id', property.id)
      throw new Error('Kunde inte skapa OB-snapshot från uppdrag.')
    }
  }

  const { error: assignmentUpdateError } = await admin
    .from('assignments')
    .update({
      property_id: property.id,
      inspection_id: inspection.id,
      converted_at: new Date().toISOString(),
      status: 'completed',
      updated_by: input.requestedByUserId,
    })
    .eq('id', assignment.id)
    .eq('org_id', input.orgId)

  if (assignmentUpdateError) {
    throw new Error(assignmentUpdateError.message ?? 'Kunde inte uppdatera uppdrag efter konvertering.')
  }

  return {
    propertyId: property.id,
    inspectionId: inspection.id,
  }
}
