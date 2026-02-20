import { createSupabaseServerClient } from '@/lib/supabase/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { generateAssignmentToken, hashAssignmentToken } from '@/lib/assignments/tokens'
import { sendAssignmentEmail } from '@/lib/assignments/mailer'

export type AssignmentStatus =
  | 'draft'
  | 'sent'
  | 'booked'
  | 'completed'
  | 'expired'
  | 'cancelled'

export type AssignmentType = 'OB' | 'STATUS' | 'UHP'

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
  preferred_date: string | null
  preferred_time: string | null
  preliminary_address: string | null
  property_address: string | null
  property_postal_code: string | null
  property_city: string | null
  accepted_at: string | null
  converted_at: string | null
  inspection_id: string | null
  responsible_profile_id: string
  created_at: string
  updated_at: string
  last_sent_at: string | null
}

export type AssignmentDetails = AssignmentListItem & {
  terms_version: string | null
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

type AssignmentLinkResult = {
  acceptUrl: string
  expiresAt: string
}

type ConvertAssignmentResult = {
  propertyId: string
  inspectionId: string
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

type SupabaseError = { message?: string } | null

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

const ASSIGNMENT_SELECT_LIST = `
  id,
  org_id,
  status,
  assignment_type,
  responsible_profile_id,
  customer_name,
  customer_email,
  customer_phone,
  preliminary_address,
  preferred_date,
  preferred_time,
  property_address,
  property_postal_code,
  property_city,
  accepted_at,
  converted_at,
  inspection_id,
  created_at,
  updated_at,
  last_sent_at
`

const ASSIGNMENT_DETAIL_SELECT = `
  ${ASSIGNMENT_SELECT_LIST},
  terms_version,
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

export function buildBaseUrl(request?: Request) {
  const configured =
    process.env.APP_BASE_URL ??
    process.env.NEXT_PUBLIC_APP_BASE_URL ??
    process.env.NEXT_PUBLIC_SITE_URL
  if (configured) return configured.replace(/\/+$/, '')

  if (request) {
    const url = new URL(request.url)
    const proto = request.headers.get('x-forwarded-proto') ?? url.protocol.replace(':', '')
    const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? url.host
    return `${proto}://${host}`.replace(/\/+$/, '')
  }

  return 'http://localhost:3000'
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
  const { data, error } = await admin
    .from('org_members')
    .select('org_id,role,is_active,is_default,organizations(name,email_from)')
    .eq('profile_id', user.id)
    .eq('is_active', true)
    .order('is_default', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error || !data) {
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

export async function createAssignment(input: {
  orgId: string
  createdBy: string
  responsibleProfileId: string
  assignmentType: AssignmentType
  customerEmail: string
  customerName?: string | null
  customerPhone?: string | null
  preliminaryAddress?: string | null
  preferredDate?: string | null
  preferredTime?: string | null
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
      preliminary_address: input.preliminaryAddress ?? null,
      preferred_date: input.preferredDate ?? null,
      preferred_time: input.preferredTime ?? null,
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
    preliminary_address: string | null
    preferred_date: string | null
    preferred_time: string | null
    property_address: string | null
    property_postal_code: string | null
    property_city: string | null
    cadastral_id: string | null
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
  }>
}) {
  const admin = createSupabaseAdminClient() as unknown as SupabaseAdminClient
  const payload = {
    ...input.patch,
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

  return data as AssignmentDetails
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
  orgEmailFrom: string | null
  requestedByUserId: string
  responsibleEmail: string | null
  baseUrl: string
}): Promise<AssignmentLinkResult> {
  const admin = createSupabaseAdminClient() as unknown as SupabaseAdminClient
  const token = generateAssignmentToken()
  const tokenHash = hashAssignmentToken(token)
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
  const acceptUrl = `${input.baseUrl}/accept/${token}`

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
      created_by: input.requestedByUserId,
    })
    .select('id')
    .single()

  if (linkError || !linkData) {
    throw new Error(linkError?.message ?? 'Kunde inte skapa uppdragslänk.')
  }

  const fromAddress =
    input.orgEmailFrom ??
    process.env.ASSIGNMENTS_MAIL_FROM ??
    process.env.RESEND_FROM ??
    'noreply@besiktapp.local'

  const subject = `Uppdragsbekräftelse - ${input.orgName ?? 'BesiktApp'}`
  const preferredDate = toSwedishDateString(input.assignment.preferred_date)
  const preferredTime = input.assignment.preferred_time ?? 'Ej satt'
  const address = input.assignment.preliminary_address ?? 'Ej satt'

  const html = `
    <p>Hej,</p>
    <p>Du har fått en uppdragsbekräftelse för besiktning.</p>
    <p><strong>Typ:</strong> ${input.assignment.assignment_type}<br/>
    <strong>Preliminär adress:</strong> ${address}<br/>
    <strong>Preliminärt datum:</strong> ${preferredDate}<br/>
    <strong>Preliminär tid:</strong> ${preferredTime}</p>
    <p><a href="${acceptUrl}" target="_blank" rel="noreferrer">Öppna uppdragsbekräftelse</a></p>
    <p>Länken är giltig i 7 dagar.</p>
  `

  const text =
    `Hej,\n\n` +
    `Du har fått en uppdragsbekräftelse för besiktning.\n` +
    `Typ: ${input.assignment.assignment_type}\n` +
    `Preliminär adress: ${address}\n` +
    `Preliminärt datum: ${preferredDate}\n` +
    `Preliminär tid: ${preferredTime}\n\n` +
    `Öppna uppdragsbekräftelse: ${acceptUrl}\n\n` +
    `Länken är giltig i 7 dagar.`

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

    await admin
      .from('assignments')
      .update({
        status: 'sent',
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

export async function resolvePublicAssignmentByToken(token: string) {
  const admin = createSupabaseAdminClient() as unknown as SupabaseAdminClient
  const tokenHash = hashAssignmentToken(token)

  const { data, error } = await admin
    .from('assignment_links')
    .select(
      'id,assignment_id,org_id,expires_at,used_at,revoked_at,assignments(id,status,assignment_type,customer_name,customer_email,customer_phone,preliminary_address,preferred_date,preferred_time,property_address,property_postal_code,property_city,accepted_at)'
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
    throw new Error(error.message ?? 'Kunde inte acceptera uppdrag.')
  }

  return data
}

function toPropertyName(address: string | null, assignmentId: string) {
  if (address && address.trim().length > 0) return address.trim()
  return `Fastighet ${assignmentId.slice(0, 8)}`
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
      city: assignment.property_city,
      cadastral_id: assignment.cadastral_id,
      client_name: assignment.customer_name,
      owner_name: assignment.customer_name,
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
      date: assignment.preferred_date,
      inspection_time: assignment.preferred_time,
      client_name: assignment.customer_name,
      client_contact: clientContact,
      assignment_number: assignmentNo,
    })
    .select('id')
    .single()

  if (inspectionError || !inspectionData) {
    await admin.from('properties').delete().eq('id', property.id)
    throw new Error(inspectionError?.message ?? 'Kunde inte skapa besiktning från uppdrag.')
  }

  const inspection = inspectionData as { id: string }

  if (assignment.assignment_type === 'OB') {
    const { error: snapshotError } = await admin
      .from('ob_property_snapshot')
      .upsert(buildSnapshotPayload(inspection.id, property), {
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
