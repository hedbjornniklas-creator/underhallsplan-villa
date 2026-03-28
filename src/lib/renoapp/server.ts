import crypto from 'node:crypto'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { sendAssignmentEmail } from '@/lib/assignments/mailer'

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const INVITE_TTL_HOURS = 24 * 7

type BrfAssociationRow = {
  id: string
  name: string
  slug: string
  email: string | null
  is_public_apply_enabled: boolean
  apply_intro_text: string | null
}

type ActionTypeRow = {
  id: string
  key: string
  label: string
  sort_order: number
  is_active: boolean
}

type DocumentTypeRow = {
  id: string
  key: string
  label: string
  description: string | null
  sort_order: number
  is_active: boolean
}

type RequirementRow = {
  id: string
  brf_id: string | null
  action_type_id: string
  document_type_id: string
  is_required: boolean
  note: string | null
  sort_order: number
}

type ContactRow = {
  id: string
  name: string
  email: string | null
  phone: string | null
}

type UnitRow = {
  id: string
  brf_id: string
  unit_number_internal: string | null
  unit_number_skatteverket: string | null
  status: string
  updated_at: string
}

type CaseRow = {
  id: string
  brf_id: string
  unit_id: string | null
  applicant_contact_id: string | null
  action_type_id: string | null
  case_number: string
  title: string
  description: string | null
  status: string
  risk_level: string | null
  blocked_at: string | null
  blocked_reason: string | null
  submitted_at: string
  updated_at: string
}

type CaseAccessLinkRow = {
  id: string
  case_id: string
  email: string
  scope: 'read' | 'upload_documents' | 'answer_questions'
  expires_at: string
  revoked_at: string | null
  last_used_at: string | null
}

type BrfMemberRow = {
  brf_id: string
  role: 'board' | 'admin'
  is_active: boolean
  brf_associations:
    | {
        name: string | null
        slug: string | null
      }
    | Array<{
        name: string | null
        slug: string | null
      }>
    | null
}

type ProfileLite = {
  id: string
  full_name: string | null
  email: string | null
  is_admin: boolean
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
  eq: (column: string, value: unknown) => QueryBuilder<T>
  is: (column: string, value: unknown) => QueryBuilder<T>
  in: (column: string, values: unknown[]) => QueryBuilder<T>
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
}

type PublicRequirement = {
  id: string
  documentTypeId: string
  documentKey: string
  documentLabel: string
  documentDescription: string | null
  isRequired: boolean
  note: string | null
  sortOrder: number
}

type PublicActionType = {
  id: string
  key: string
  label: string
  sortOrder: number
  requirements: PublicRequirement[]
}

export type RenoAppPublicBrfConfig = {
  brf: {
    id: string
    name: string
    slug: string
    applyIntroText: string | null
  }
  actionTypes: PublicActionType[]
}

export type CreatePublicApplicationInput = {
  brfSlug: string
  applicantName: string
  applicantEmail: string
  applicantPhone?: string | null
  unitNumberInternal?: string | null
  unitNumberSkatteverket?: string | null
  description: string
  actionTypeKey: string
  checks: {
    affectsStructure: boolean
    affectsPlumbing: boolean
    affectsVentilation: boolean
    affectsElectrical: boolean
    affectsWetRoom: boolean
    affectsSurfaceOnly: boolean
  }
}

export type CreatePublicApplicationResult = {
  caseId: string
  caseNumber: string
  accessUrl: string
  emailSent: boolean
  emailError: string | null
}

export type RenoAppCaseAccessResult = {
  state: 'open' | 'expired' | 'revoked'
  access: {
    scope: CaseAccessLinkRow['scope']
    allowedActions: string[]
    expiresAt: string
    revokedAt: string | null
    lastUsedAt: string | null
  }
  brf: {
    id: string
    name: string
    slug: string
  }
  case: {
    id: string
    caseNumber: string
    title: string
    description: string | null
    status: string
    riskLevel: string | null
    submittedAt: string
    blockedAt: string | null
    blockedReason: string | null
    actionType: {
      key: string
      label: string
    } | null
  }
  contact: {
    id: string | null
    name: string | null
    email: string | null
    phone: string | null
  }
  unit: {
    id: string | null
    unitNumberInternal: string | null
    unitNumberSkatteverket: string | null
    status: string | null
  }
  documents: Array<{
    id: string
    fileName: string | null
    status: string
    uploadedAt: string
    note: string | null
  }>
  documentOptions: Array<{
    id: string
    label: string
    description: string | null
    isRequired: boolean
  }>
}

export type RenoAppViewerContext = {
  userId: string
  profile: ProfileLite
  isInternalAdmin: boolean
  brfs: Array<{
    id: string
    name: string | null
    slug: string | null
    role: 'board' | 'admin'
  }>
  accessibleBrfIds: string[] | null
}

export type RenoAppDashboardSummary = {
  accessibleBrfs: RenoAppViewerContext['brfs']
  stats: {
    openCases: number
    needInfoCases: number
    preliminaryUnits: number
  }
}

export type RenoAppUserListItem = {
  brf: {
    id: string
    name: string | null
    slug: string | null
  }
  members: Array<{
    profileId: string
    fullName: string | null
    email: string | null
    role: 'board' | 'admin'
    acceptedAt: string | null
  }>
  pendingInvites: Array<{
    id: string
    fullName: string | null
    email: string
    expiresAt: string
    createdAt: string
  }>
}

export type CreateRenoAppUserInviteResult = {
  invite: {
    id: string
    email: string
    fullName: string | null
    expiresAt: string
    inviteUrl: string
    emailSent: boolean
    emailError: string | null
  }
}

export type RenoAppCaseListItem = {
  id: string
  caseNumber: string
  title: string
  status: string
  riskLevel: string | null
  updatedAt: string
  submittedAt: string
  brf: {
    id: string
    name: string | null
    slug: string | null
  }
  actionType: {
    key: string
    label: string
  } | null
  applicant: {
    name: string | null
    email: string | null
  }
}

export type RenoAppUnitListItem = {
  id: string
  unitNumberInternal: string | null
  unitNumberSkatteverket: string | null
  status: string
  updatedAt: string
  brf: {
    id: string
    name: string | null
    slug: string | null
  }
  currentContacts: Array<{
    id: string
    name: string | null
    email: string | null
    verificationStatus: string
    relationshipType: string
  }>
}

export type RenoAppCaseDetail = {
  id: string
  caseNumber: string
  title: string
  description: string | null
  status: string
  riskLevel: string | null
  submittedAt: string
  updatedAt: string
  blockedAt: string | null
  blockedReason: string | null
  brf: {
    id: string
    name: string | null
    slug: string | null
  }
  actionType: {
    id: string | null
    key: string | null
    label: string | null
  }
  applicant: {
    id: string | null
    name: string | null
    email: string | null
    phone: string | null
  }
  unit: {
    id: string | null
    unitNumberInternal: string | null
    unitNumberSkatteverket: string | null
    status: string | null
  }
  checks: {
    affectsStructure: boolean
    affectsPlumbing: boolean
    affectsVentilation: boolean
    affectsElectrical: boolean
    affectsWetRoom: boolean
    affectsSurfaceOnly: boolean
  } | null
  currentContacts: Array<{
    id: string
    name: string | null
    email: string | null
    verificationStatus: string
    relationshipType: string
  }>
  documents: Array<{
    id: string
    documentTypeId: string | null
    documentTypeLabel: string | null
    fileName: string | null
    status: string
    uploadedAt: string
    note: string | null
  }>
  requirements: PublicRequirement[]
  decisions: Array<{
    id: string
    decision: string
    conditions: string | null
    reason: string | null
    decidedAt: string
  }>
  accessLinks: Array<{
    id: string
    email: string
    scope: string
    expiresAt: string
    revokedAt: string | null
    lastUsedAt: string | null
  }>
}

export type UpdateRenoAppCaseStatusInput = {
  status: 'review' | 'need_info' | 'approved' | 'conditional' | 'rejected'
  reason?: string | null
  conditions?: string | null
}

function parseBrfAssociationValue(value: BrfMemberRow['brf_associations']) {
  if (Array.isArray(value)) return value[0] ?? null
  return value ?? null
}

function computeRiskLevel(checks: CreatePublicApplicationInput['checks']) {
  if (checks.affectsStructure || checks.affectsPlumbing || checks.affectsVentilation) return 'high'
  if (checks.affectsElectrical || checks.affectsWetRoom) return 'medium'
  if (checks.affectsSurfaceOnly) return 'low'
  return null
}

function allowedActionsFromScope(scope: CaseAccessLinkRow['scope']) {
  if (scope === 'answer_questions') return ['read', 'upload_documents', 'answer_questions']
  if (scope === 'upload_documents') return ['read', 'upload_documents']
  return ['read']
}

async function createUniqueCaseNumber(admin: SupabaseAdminClient) {
  const year = new Date().getFullYear()

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const suffix = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0')
    const caseNumber = `RA-${year}-${suffix}`

    const { data, error } = await admin
      .from('renovation_cases')
      .select('id')
      .eq('case_number', caseNumber)
      .maybeSingle()

    if (error) {
      throw new Error(error.message ?? 'Kunde inte generera ärendenummer.')
    }

    if (!data) {
      return caseNumber
    }
  }

  throw new Error('Kunde inte generera unikt ärendenummer.')
}

async function getPublicBrfBySlug(admin: SupabaseAdminClient, slug: string) {
  const { data, error } = await admin
    .from('brf_associations')
    .select('id,name,slug,email,is_public_apply_enabled,apply_intro_text')
    .eq('slug', slug)
    .maybeSingle()

  if (error) {
    throw new Error(error.message ?? 'Kunde inte hämta BRF.')
  }

  return (data ?? null) as BrfAssociationRow | null
}

async function listActiveActionTypes(admin: SupabaseAdminClient) {
  const { data, error } = await admin
    .from('renovation_action_types')
    .select('id,key,label,sort_order,is_active')
    .eq('is_active', true)
    .order('sort_order', { ascending: true })

  if (error) {
    throw new Error(error.message ?? 'Kunde inte hämta åtgärdstyper.')
  }

  return (data ?? []) as ActionTypeRow[]
}

async function listActiveDocumentTypes(admin: SupabaseAdminClient) {
  const { data, error } = await admin
    .from('renovation_document_types')
    .select('id,key,label,description,sort_order,is_active')
    .eq('is_active', true)
    .order('sort_order', { ascending: true })

  if (error) {
    throw new Error(error.message ?? 'Kunde inte hämta dokumenttyper.')
  }

  return (data ?? []) as DocumentTypeRow[]
}

async function listRequirements(admin: SupabaseAdminClient, brfId: string) {
  const globalQuery = await admin
    .from('renovation_action_document_requirements')
    .select('id,brf_id,action_type_id,document_type_id,is_required,note,sort_order')
    .is('brf_id', null)
    .order('sort_order', { ascending: true })

  if (globalQuery.error) {
    throw new Error(globalQuery.error.message ?? 'Kunde inte hämta globala dokumentkrav.')
  }

  const localQuery = await admin
    .from('renovation_action_document_requirements')
    .select('id,brf_id,action_type_id,document_type_id,is_required,note,sort_order')
    .eq('brf_id', brfId)
    .order('sort_order', { ascending: true })

  if (localQuery.error) {
    throw new Error(localQuery.error.message ?? 'Kunde inte hämta BRF-specifika dokumentkrav.')
  }

  return [...((globalQuery.data ?? []) as RequirementRow[]), ...((localQuery.data ?? []) as RequirementRow[])]
}

export async function getRenoAppPublicConfig(slug: string): Promise<RenoAppPublicBrfConfig | null> {
  const admin = createSupabaseAdminClient() as unknown as SupabaseAdminClient
  const brf = await getPublicBrfBySlug(admin, slug)

  if (!brf || !brf.is_public_apply_enabled) {
    return null
  }

  const [actionTypes, documentTypes, requirements] = await Promise.all([
    listActiveActionTypes(admin),
    listActiveDocumentTypes(admin),
    listRequirements(admin, brf.id),
  ])

  const documentById = new Map(documentTypes.map((item) => [item.id, item]))
  const requirementMap = new Map<string, RequirementRow>()

  for (const requirement of requirements) {
    const key = `${requirement.action_type_id}:${requirement.document_type_id}`
    requirementMap.set(key, requirement)
  }

  return {
    brf: {
      id: brf.id,
      name: brf.name,
      slug: brf.slug,
      applyIntroText: brf.apply_intro_text,
    },
    actionTypes: actionTypes.map((actionType) => ({
      id: actionType.id,
      key: actionType.key,
      label: actionType.label,
      sortOrder: actionType.sort_order,
      requirements: Array.from(requirementMap.values())
        .filter((requirement) => requirement.action_type_id === actionType.id)
        .map((requirement) => {
          const documentType = documentById.get(requirement.document_type_id)

          return {
            id: requirement.id,
            documentTypeId: requirement.document_type_id,
            documentKey: documentType?.key ?? 'unknown',
            documentLabel: documentType?.label ?? 'Okänd dokumenttyp',
            documentDescription: documentType?.description ?? null,
            isRequired: requirement.is_required,
            note: requirement.note,
            sortOrder: requirement.sort_order,
          }
        })
        .sort((left, right) => left.sortOrder - right.sortOrder),
    })),
  }
}

export async function createPublicApplication(
  input: CreatePublicApplicationInput,
  requestOrigin: string
): Promise<CreatePublicApplicationResult> {
  const admin = createSupabaseAdminClient() as unknown as SupabaseAdminClient
  const brf = await getPublicBrfBySlug(admin, input.brfSlug)

  if (!brf || !brf.is_public_apply_enabled) {
    throw new Error('BRF_NOT_FOUND')
  }

  const applicantName = normalizeText(input.applicantName)
  const applicantEmail = normalizeEmail(input.applicantEmail)
  const applicantPhone = normalizeText(input.applicantPhone)
  const unitNumberInternal = normalizeText(input.unitNumberInternal)
  const unitNumberSkatteverket = normalizeText(input.unitNumberSkatteverket)
  const description = normalizeText(input.description)
  const actionTypeKey = normalizeText(input.actionTypeKey)

  if (!applicantName) throw new Error('APPLICANT_NAME_REQUIRED')
  assertValidEmail(applicantEmail, 'APPLICANT_EMAIL_INVALID')
  if (!unitNumberInternal && !unitNumberSkatteverket) throw new Error('UNIT_NUMBER_REQUIRED')
  if (!description) throw new Error('DESCRIPTION_REQUIRED')
  if (!actionTypeKey) throw new Error('ACTION_TYPE_REQUIRED')
  const applicantEmailValue = applicantEmail as string

  const { data: actionType, error: actionTypeError } = await admin
    .from('renovation_action_types')
    .select('id,key,label,sort_order,is_active')
    .eq('key', actionTypeKey)
    .eq('is_active', true)
    .maybeSingle()

  if (actionTypeError) {
    throw new Error(actionTypeError.message ?? 'Kunde inte hämta åtgärdstyp.')
  }

  if (!actionType) {
    throw new Error('ACTION_TYPE_REQUIRED')
  }

  let contact: ContactRow | null = null
  if (applicantEmail) {
    const { data } = await admin
      .from('contacts')
      .select('id,name,email,phone')
      .eq('email', applicantEmailValue)
      .limit(1)
      .maybeSingle()
    contact = (data ?? null) as ContactRow | null
  }

  if (!contact && applicantPhone) {
    const { data } = await admin
      .from('contacts')
      .select('id,name,email,phone')
      .eq('phone', applicantPhone)
      .limit(1)
      .maybeSingle()
    contact = (data ?? null) as ContactRow | null
  }

  if (!contact) {
    const { data, error } = await admin
      .from('contacts')
      .insert({
        name: applicantName,
        email: applicantEmailValue,
        phone: applicantPhone,
      })
      .select('id,name,email,phone')
      .single()

    if (error) {
      throw new Error(error.message ?? 'Kunde inte skapa kontakt.')
    }

    contact = data as ContactRow
  }

  let unit: UnitRow | null = null
  if (unitNumberInternal) {
    const { data } = await admin
      .from('brf_units')
      .select('id,brf_id,unit_number_internal,unit_number_skatteverket,status,updated_at')
      .eq('brf_id', brf.id)
      .eq('unit_number_internal', unitNumberInternal)
      .limit(1)
      .maybeSingle()
    unit = (data ?? null) as UnitRow | null
  }

  if (!unit && unitNumberSkatteverket) {
    const { data } = await admin
      .from('brf_units')
      .select('id,brf_id,unit_number_internal,unit_number_skatteverket,status,updated_at')
      .eq('brf_id', brf.id)
      .eq('unit_number_skatteverket', unitNumberSkatteverket)
      .limit(1)
      .maybeSingle()
    unit = (data ?? null) as UnitRow | null
  }

  if (!unit) {
    const { data, error } = await admin
      .from('brf_units')
      .insert({
        brf_id: brf.id,
        unit_number_internal: unitNumberInternal,
        unit_number_skatteverket: unitNumberSkatteverket,
        status: 'preliminary',
      })
      .select('id,brf_id,unit_number_internal,unit_number_skatteverket,status,updated_at')
      .single()

    if (error) {
      throw new Error(error.message ?? 'Kunde inte skapa lägenhet.')
    }

    unit = data as UnitRow
  }

  const { data: existingUnitContact } = await admin
    .from('unit_contacts')
    .select('id')
    .eq('unit_id', unit.id)
    .eq('contact_id', contact.id)
    .eq('is_current', true)
    .limit(1)
    .maybeSingle()

  if (!existingUnitContact) {
    const { error } = await admin.from('unit_contacts').insert({
      unit_id: unit.id,
      contact_id: contact.id,
      relationship_type: 'unknown',
      verification_status: 'unverified',
      is_current: true,
    })

    if (error) {
      throw new Error(error.message ?? 'Kunde inte koppla kontakt till lägenhet.')
    }
  }

  const caseNumber = await createUniqueCaseNumber(admin)
  const riskLevel = computeRiskLevel(input.checks)
  const title = `Renovering: ${(actionType as ActionTypeRow).label}`

  const { data: insertedCase, error: caseError } = await admin
    .from('renovation_cases')
    .insert({
      brf_id: brf.id,
      unit_id: unit.id,
      applicant_contact_id: contact.id,
      action_type_id: (actionType as ActionTypeRow).id,
      case_number: caseNumber,
      title,
      description,
      status: 'submitted',
      risk_level: riskLevel,
      submitted_at: new Date().toISOString(),
    })
    .select('id')
    .single()

  if (caseError || !insertedCase) {
    throw new Error(caseError?.message ?? 'Kunde inte skapa ärende.')
  }

  const { error: checksError } = await admin.from('renovation_case_checks').insert({
    case_id: insertedCase.id,
    affects_structure: !!input.checks.affectsStructure,
    affects_plumbing: !!input.checks.affectsPlumbing,
    affects_ventilation: !!input.checks.affectsVentilation,
    affects_electrical: !!input.checks.affectsElectrical,
    affects_wet_room: !!input.checks.affectsWetRoom,
    affects_surface_only: !!input.checks.affectsSurfaceOnly,
  })

  if (checksError) {
    throw new Error(checksError.message ?? 'Kunde inte spara teknisk påverkan.')
  }

  const plainToken = makeToken()
  const tokenHash = hashToken(plainToken)
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 14).toISOString()

  const { error: accessError } = await admin.from('case_access_links').insert({
    case_id: insertedCase.id,
    token_hash: tokenHash,
    email: applicantEmailValue,
    scope: 'answer_questions',
    expires_at: expiresAt,
  })

  if (accessError) {
    throw new Error(accessError.message ?? 'Kunde inte skapa åtkomstlänk.')
  }

  const accessUrl = buildAbsoluteUrl(requestOrigin, `/renoapp/case/${plainToken}`)
  let emailSent = false
  let emailError: string | null = null

  const mailFrom = getMailFromAddress()
  if (mailFrom) {
    try {
      await sendAssignmentEmail({
        to: applicantEmailValue,
        from: mailFrom,
        replyTo: brf.email ?? null,
        subject: `RenoApp: ditt ärende ${caseNumber}`,
        html: [
          `<p>Hej ${applicantName},</p>`,
          `<p>Vi har tagit emot din renoveringsansökan för <strong>${brf.name}</strong>.</p>`,
          `<p>Ärendenummer: <strong>${caseNumber}</strong></p>`,
          `<p>Öppna och komplettera ditt ärende via länken nedan:</p>`,
          `<p><a href="${accessUrl}">${accessUrl}</a></p>`,
          `<p>Länken gäller till ${new Date(expiresAt).toLocaleString('sv-SE')}.</p>`,
        ].join(''),
        text: [
          `Hej ${applicantName},`,
          ``,
          `Vi har tagit emot din renoveringsansökan för ${brf.name}.`,
          `Ärendenummer: ${caseNumber}`,
          `Öppna och komplettera ditt ärende här: ${accessUrl}`,
          `Länken gäller till ${new Date(expiresAt).toLocaleString('sv-SE')}.`,
        ].join('\n'),
      })
      emailSent = true
    } catch (error) {
      emailError = error instanceof Error ? error.message : 'Mejlutskick misslyckades.'
    }
  } else {
    emailError = 'ASSIGNMENTS_MAIL_FROM saknas. Åtkomstlänken skapades men inget mejl skickades.'
  }

  return {
    caseId: insertedCase.id as string,
    caseNumber,
    accessUrl,
    emailSent,
    emailError,
  }
}

export async function getCaseAccessByToken(token: string): Promise<RenoAppCaseAccessResult | null> {
  const admin = createSupabaseAdminClient() as unknown as SupabaseAdminClient
  const tokenHash = hashToken(token)

  const { data: accessData, error: accessError } = await admin
    .from('case_access_links')
    .select('id,case_id,email,scope,expires_at,revoked_at,last_used_at,created_at')
    .eq('token_hash', tokenHash)
    .maybeSingle()

  if (accessError) {
    throw new Error(accessError.message ?? 'Kunde inte läsa åtkomstlänk.')
  }

  if (!accessData) {
    return null
  }

  const access = accessData as CaseAccessLinkRow
  const now = Date.now()
  const isRevoked = !!access.revoked_at
  const isExpired = new Date(access.expires_at).getTime() < now

  if (!isRevoked && !isExpired) {
    await admin.from('case_access_links').update({ last_used_at: new Date().toISOString() }).eq('id', access.id)
  }

  const { data: caseData, error: caseError } = await admin
    .from('renovation_cases')
    .select('id,brf_id,unit_id,applicant_contact_id,action_type_id,case_number,title,description,status,risk_level,blocked_at,blocked_reason,submitted_at,updated_at')
    .eq('id', access.case_id)
    .maybeSingle()

  if (caseError || !caseData) {
    throw new Error(caseError?.message ?? 'Kunde inte hämta ärende.')
  }

  const caseRow = caseData as CaseRow

  const [brfResult, contactResult, unitResult, actionResult, documentsResult] = await Promise.all([
    admin.from('brf_associations').select('id,name,slug').eq('id', caseRow.brf_id).maybeSingle(),
    caseRow.applicant_contact_id
      ? admin.from('contacts').select('id,name,email,phone').eq('id', caseRow.applicant_contact_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    caseRow.unit_id
      ? admin
          .from('brf_units')
          .select('id,unit_number_internal,unit_number_skatteverket,status')
          .eq('id', caseRow.unit_id)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    caseRow.action_type_id
      ? admin.from('renovation_action_types').select('key,label').eq('id', caseRow.action_type_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    admin
      .from('renovation_case_documents')
      .select('id,file_name,status,uploaded_at,note')
      .eq('case_id', caseRow.id)
      .order('uploaded_at', { ascending: false }),
  ])

  if (brfResult.error) throw new Error(brfResult.error.message ?? 'Kunde inte hämta BRF.')
  if (contactResult.error) throw new Error(contactResult.error.message ?? 'Kunde inte hämta kontakt.')
  if (unitResult.error) throw new Error(unitResult.error.message ?? 'Kunde inte hämta lägenhet.')
  if (actionResult.error) throw new Error(actionResult.error.message ?? 'Kunde inte hämta åtgärdstyp.')
  if (documentsResult.error) throw new Error(documentsResult.error.message ?? 'Kunde inte hämta dokument.')

  const [activeDocumentTypes, caseRequirements] = caseRow.action_type_id
    ? await Promise.all([listActiveDocumentTypes(admin), listRequirements(admin, caseRow.brf_id)])
    : [[], [] as RequirementRow[]]
  const requirementByDocumentId = new Map(
    caseRequirements
      .filter((item) => item.action_type_id === caseRow.action_type_id)
      .map((item) => [item.document_type_id, item] as const)
  )

  return {
    state: isRevoked ? 'revoked' : isExpired ? 'expired' : 'open',
    access: {
      scope: access.scope,
      allowedActions: allowedActionsFromScope(access.scope),
      expiresAt: access.expires_at,
      revokedAt: access.revoked_at,
      lastUsedAt: access.last_used_at,
    },
    brf: {
      id: String(brfResult.data?.id ?? ''),
      name: String(brfResult.data?.name ?? ''),
      slug: String(brfResult.data?.slug ?? ''),
    },
    case: {
      id: caseRow.id,
      caseNumber: caseRow.case_number,
      title: caseRow.title,
      description: caseRow.description,
      status: caseRow.status,
      riskLevel: caseRow.risk_level,
      submittedAt: caseRow.submitted_at,
      blockedAt: caseRow.blocked_at,
      blockedReason: caseRow.blocked_reason,
      actionType: actionResult.data
        ? {
            key: String(actionResult.data.key ?? ''),
            label: String(actionResult.data.label ?? ''),
          }
        : null,
    },
    contact: {
      id: (contactResult.data?.id as string | null | undefined) ?? null,
      name: (contactResult.data?.name as string | null | undefined) ?? null,
      email: (contactResult.data?.email as string | null | undefined) ?? null,
      phone: (contactResult.data?.phone as string | null | undefined) ?? null,
    },
    unit: {
      id: (unitResult.data?.id as string | null | undefined) ?? null,
      unitNumberInternal: (unitResult.data?.unit_number_internal as string | null | undefined) ?? null,
      unitNumberSkatteverket: (unitResult.data?.unit_number_skatteverket as string | null | undefined) ?? null,
      status: (unitResult.data?.status as string | null | undefined) ?? null,
    },
    documents: ((documentsResult.data ?? []) as Array<Record<string, unknown>>).map((document) => ({
      id: String(document.id ?? ''),
      fileName: (document.file_name as string | null | undefined) ?? null,
      status: String(document.status ?? ''),
      uploadedAt: String(document.uploaded_at ?? ''),
      note: (document.note as string | null | undefined) ?? null,
    })),
    documentOptions: activeDocumentTypes
      .filter((item) => requirementByDocumentId.size === 0 || requirementByDocumentId.has(item.id))
      .sort((left, right) => left.sort_order - right.sort_order)
      .map((item) => ({
        id: item.id,
        label: item.label,
        description: item.description,
        isRequired: requirementByDocumentId.get(item.id)?.is_required ?? false,
      })),
  }
}

export async function requireRenoAppViewerContext(): Promise<RenoAppViewerContext> {
  const userClient = createSupabaseServerClient()
  const {
    data: { user },
    error: userError,
  } = await userClient.auth.getUser()

  if (userError || !user) {
    throw new Error('UNAUTHORIZED')
  }

  const admin = createSupabaseAdminClient() as unknown as SupabaseAdminClient
  const { data: profileData, error: profileError } = await admin
    .from('profiles')
    .select('id,full_name,email,is_admin')
    .eq('id', user.id)
    .maybeSingle()

  if (profileError || !profileData) {
    throw new Error(profileError?.message ?? 'PROFILE_NOT_FOUND')
  }

  const profile = profileData as ProfileLite
  const { data: memberRows, error: memberError } = await admin
    .from('brf_members')
    .select('brf_id,role,is_active,brf_associations(name,slug)')
    .eq('profile_id', user.id)
    .eq('is_active', true)

  if (memberError) {
    throw new Error(memberError.message ?? 'Kunde inte läsa RenoApp-medlemskap.')
  }

  const brfs = ((memberRows ?? []) as BrfMemberRow[]).map((row) => {
    const brf = parseBrfAssociationValue(row.brf_associations)
    return {
      id: row.brf_id,
      name: brf?.name ?? null,
      slug: brf?.slug ?? null,
      role: row.role,
    }
  })

  if (brfs.length === 0 && !profile.is_admin) {
    throw new Error('RENOAPP_MEMBERSHIP_REQUIRED')
  }

  return {
    userId: user.id,
    profile,
    isInternalAdmin: profile.is_admin,
    brfs,
    accessibleBrfIds: brfs.length > 0 ? brfs.map((item) => item.id) : null,
  }
}

function applyBrfScope(query: QueryBuilder, accessibleBrfIds: string[] | null) {
  if (accessibleBrfIds && accessibleBrfIds.length > 0) {
    return query.in('brf_id', accessibleBrfIds)
  }

  return query
}

function normalizeText(value: unknown) {
  const text = String(value ?? '').trim()
  return text === '' ? null : text
}

function normalizeEmail(value: unknown) {
  const text = normalizeText(value)
  return text ? text.toLowerCase() : null
}

function assertValidEmail(value: string | null, fieldName: string) {
  if (!value || !EMAIL_REGEX.test(value)) {
    throw new Error(fieldName)
  }
}

function makeToken() {
  return crypto.randomBytes(24).toString('base64url')
}

function hashToken(token: string) {
  return crypto.createHash('sha256').update(token).digest('hex')
}

function buildAbsoluteUrl(origin: string, path: string) {
  return `${origin.replace(/\/+$/, '')}${path.startsWith('/') ? path : `/${path}`}`
}

function getMailFromAddress() {
  const mailFrom = process.env.ASSIGNMENTS_MAIL_FROM?.trim()
  if (!mailFrom) return null
  return mailFrom
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function buildRenoAppEmailHtml(input: {
  origin: string
  preheader?: string | null
  bodyHtml: string
}) {
  const logoUrl = buildAbsoluteUrl(input.origin, '/landing/Renoapp.png')
  const preheader = input.preheader ? escapeHtml(input.preheader) : null

  return `
    <div style="margin:0;padding:0;background:#f6f1ea;color:#1c1917;font-family:Arial,sans-serif;">
      ${
        preheader
          ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${preheader}</div>`
          : ''
      }
      <div style="max-width:640px;margin:0 auto;padding:32px 20px;">
        <div style="background:#ffffff;border:1px solid #e7e5e4;border-radius:24px;padding:32px;">
          <div style="margin-bottom:24px;">
            <img
              src="${logoUrl}"
              alt="RenoApp"
              width="132"
              style="display:block;width:132px;max-width:132px;height:auto;border:0;outline:none;text-decoration:none;"
            />
          </div>
          <div style="font-size:16px;line-height:1.75;color:#292524;">
            ${input.bodyHtml}
            <p style="margin:24px 0 0;">Med vänlig hälsning,<br />RenoApp-teamet på HusHub</p>
          </div>
        </div>
      </div>
    </div>
  `
}

export async function getRenoAppDashboardSummary(): Promise<RenoAppDashboardSummary> {
  const context = await requireRenoAppViewerContext()
  const admin = createSupabaseAdminClient() as unknown as SupabaseAdminClient

  const casesQuery = applyBrfScope(
    admin.from('renovation_cases').select('id,status'),
    context.accessibleBrfIds
  )
  const unitsQuery = applyBrfScope(
    admin.from('brf_units').select('id,status'),
    context.accessibleBrfIds
  )

  const [casesResult, unitsResult] = await Promise.all([casesQuery, unitsQuery])

  if (casesResult.error) {
    throw new Error(casesResult.error.message ?? 'Kunde inte hämta RenoApp-ärenden.')
  }

  if (unitsResult.error) {
    throw new Error(unitsResult.error.message ?? 'Kunde inte hämta RenoApp-lägenheter.')
  }

  const cases = (casesResult.data ?? []) as Array<{ status: string }>
  const units = (unitsResult.data ?? []) as Array<{ status: string }>

  return {
    accessibleBrfs: context.brfs,
    stats: {
      openCases: cases.filter((item) => ['submitted', 'review', 'conditional'].includes(item.status)).length,
      needInfoCases: cases.filter((item) => item.status === 'need_info').length,
      preliminaryUnits: units.filter((item) => item.status === 'preliminary').length,
    },
  }
}

export async function listRenoAppCases(): Promise<RenoAppCaseListItem[]> {
  const context = await requireRenoAppViewerContext()
  const admin = createSupabaseAdminClient() as unknown as SupabaseAdminClient

  const casesQuery = applyBrfScope(
    admin
      .from('renovation_cases')
      .select('id,brf_id,applicant_contact_id,action_type_id,case_number,title,status,risk_level,submitted_at,updated_at')
      .order('updated_at', { ascending: false })
      .limit(100),
    context.accessibleBrfIds
  )

  const { data, error } = await casesQuery

  if (error) {
    throw new Error(error.message ?? 'Kunde inte hämta RenoApp-ärenden.')
  }

  const rows = (data ?? []) as Array<Record<string, unknown>>
  const brfIds = Array.from(new Set(rows.map((row) => String(row.brf_id ?? '')).filter(Boolean)))
  const actionTypeIds = Array.from(new Set(rows.map((row) => String(row.action_type_id ?? '')).filter(Boolean)))
  const contactIds = Array.from(new Set(rows.map((row) => String(row.applicant_contact_id ?? '')).filter(Boolean)))

  const [brfsResult, actionTypesResult, contactsResult] = await Promise.all([
    brfIds.length > 0
      ? admin.from('brf_associations').select('id,name,slug').in('id', brfIds)
      : Promise.resolve({ data: [], error: null }),
    actionTypeIds.length > 0
      ? admin.from('renovation_action_types').select('id,key,label').in('id', actionTypeIds)
      : Promise.resolve({ data: [], error: null }),
    contactIds.length > 0
      ? admin.from('contacts').select('id,name,email').in('id', contactIds)
      : Promise.resolve({ data: [], error: null }),
  ])

  if (brfsResult.error) throw new Error(brfsResult.error.message ?? 'Kunde inte hämta BRF-data.')
  if (actionTypesResult.error) throw new Error(actionTypesResult.error.message ?? 'Kunde inte hämta åtgärdstyper.')
  if (contactsResult.error) throw new Error(contactsResult.error.message ?? 'Kunde inte hämta kontakter.')

  const brfMap = new Map(
    ((brfsResult.data ?? []) as Array<Record<string, unknown>>).map((row) => [
      String(row.id ?? ''),
      {
        id: String(row.id ?? ''),
        name: (row.name as string | null | undefined) ?? null,
        slug: (row.slug as string | null | undefined) ?? null,
      },
    ])
  )
  const actionMap = new Map(
    ((actionTypesResult.data ?? []) as Array<Record<string, unknown>>).map((row) => [
      String(row.id ?? ''),
      {
        key: String(row.key ?? ''),
        label: String(row.label ?? ''),
      },
    ])
  )
  const contactMap = new Map(
    ((contactsResult.data ?? []) as Array<Record<string, unknown>>).map((row) => [
      String(row.id ?? ''),
      {
        name: (row.name as string | null | undefined) ?? null,
        email: (row.email as string | null | undefined) ?? null,
      },
    ])
  )

  return rows.map((row) => {
    const brfId = String(row.brf_id ?? '')
    const actionTypeId = String(row.action_type_id ?? '')
    const contactId = String(row.applicant_contact_id ?? '')

    return {
      id: String(row.id ?? ''),
      caseNumber: String(row.case_number ?? ''),
      title: String(row.title ?? ''),
      status: String(row.status ?? ''),
      riskLevel: (row.risk_level as string | null | undefined) ?? null,
      updatedAt: String(row.updated_at ?? ''),
      submittedAt: String(row.submitted_at ?? ''),
      brf: brfMap.get(brfId) ?? { id: brfId, name: null, slug: null },
      actionType: actionTypeId ? actionMap.get(actionTypeId) ?? null : null,
      applicant: contactId ? contactMap.get(contactId) ?? { name: null, email: null } : { name: null, email: null },
    }
  })
}

export async function listRenoAppUnits(): Promise<RenoAppUnitListItem[]> {
  const context = await requireRenoAppViewerContext()
  const admin = createSupabaseAdminClient() as unknown as SupabaseAdminClient

  const unitsQuery = applyBrfScope(
    admin
      .from('brf_units')
      .select('id,brf_id,unit_number_internal,unit_number_skatteverket,status,updated_at')
      .order('updated_at', { ascending: false })
      .limit(100),
    context.accessibleBrfIds
  )

  const { data, error } = await unitsQuery

  if (error) {
    throw new Error(error.message ?? 'Kunde inte hämta RenoApp-lägenheter.')
  }

  const rows = (data ?? []) as Array<Record<string, unknown>>
  const brfIds = Array.from(new Set(rows.map((row) => String(row.brf_id ?? '')).filter(Boolean)))
  const unitIds = rows.map((row) => String(row.id ?? '')).filter(Boolean)

  const [brfsResult, unitContactsResult] = await Promise.all([
    brfIds.length > 0
      ? admin.from('brf_associations').select('id,name,slug').in('id', brfIds)
      : Promise.resolve({ data: [], error: null }),
    unitIds.length > 0
      ? admin
          .from('unit_contacts')
          .select('id,unit_id,contact_id,verification_status,relationship_type,is_current')
          .in('unit_id', unitIds)
          .eq('is_current', true)
      : Promise.resolve({ data: [], error: null }),
  ])

  if (brfsResult.error) throw new Error(brfsResult.error.message ?? 'Kunde inte hämta BRF-data.')
  if (unitContactsResult.error) throw new Error(unitContactsResult.error.message ?? 'Kunde inte hämta kontaktkopplingar.')

  const unitContactRows = (unitContactsResult.data ?? []) as Array<Record<string, unknown>>
  const contactIds = Array.from(new Set(unitContactRows.map((row) => String(row.contact_id ?? '')).filter(Boolean)))

  const contactsResult =
    contactIds.length > 0
      ? await admin.from('contacts').select('id,name,email').in('id', contactIds)
      : { data: [], error: null }

  if (contactsResult.error) throw new Error(contactsResult.error.message ?? 'Kunde inte hämta kontakter.')

  const brfMap = new Map(
    ((brfsResult.data ?? []) as Array<Record<string, unknown>>).map((row) => [
      String(row.id ?? ''),
      {
        id: String(row.id ?? ''),
        name: (row.name as string | null | undefined) ?? null,
        slug: (row.slug as string | null | undefined) ?? null,
      },
    ])
  )
  const contactMap = new Map(
    ((contactsResult.data ?? []) as Array<Record<string, unknown>>).map((row) => [
      String(row.id ?? ''),
      {
        id: String(row.id ?? ''),
        name: (row.name as string | null | undefined) ?? null,
        email: (row.email as string | null | undefined) ?? null,
      },
    ])
  )
  const contactsByUnitId = new Map<string, RenoAppUnitListItem['currentContacts']>()

  for (const row of unitContactRows) {
    const unitId = String(row.unit_id ?? '')
    const contactId = String(row.contact_id ?? '')
    const contact = contactMap.get(contactId) ?? { id: contactId, name: null, email: null }
    const current = contactsByUnitId.get(unitId) ?? []
    current.push({
      id: contact.id,
      name: contact.name,
      email: contact.email,
      verificationStatus: String(row.verification_status ?? ''),
      relationshipType: String(row.relationship_type ?? ''),
    })
    contactsByUnitId.set(unitId, current)
  }

  return rows.map((row) => {
    const unitId = String(row.id ?? '')
    const brfId = String(row.brf_id ?? '')

    return {
      id: unitId,
      unitNumberInternal: (row.unit_number_internal as string | null | undefined) ?? null,
      unitNumberSkatteverket: (row.unit_number_skatteverket as string | null | undefined) ?? null,
      status: String(row.status ?? ''),
      updatedAt: String(row.updated_at ?? ''),
      brf: brfMap.get(brfId) ?? { id: brfId, name: null, slug: null },
      currentContacts: contactsByUnitId.get(unitId) ?? [],
    }
  })
}

export async function listRenoAppUsers(): Promise<RenoAppUserListItem[]> {
  const context = await requireRenoAppViewerContext()
  const admin = createSupabaseAdminClient() as unknown as SupabaseAdminClient

  const brfIds = context.accessibleBrfIds ?? context.brfs.map((item) => item.id)

  if (brfIds.length === 0) {
    return []
  }

  const [brfsResult, membersResult, invitesResult] = await Promise.all([
    admin.from('brf_associations').select('id,name,slug').in('id', brfIds),
    admin
      .from('brf_members')
      .select('brf_id,profile_id,role,accepted_at,is_active')
      .in('brf_id', brfIds)
      .eq('is_active', true),
    admin
      .from('brf_member_invites')
      .select('id,brf_id,email,full_name,expires_at,accepted_at,revoked_at,created_at')
      .in('brf_id', brfIds)
      .is('accepted_at', null)
      .is('revoked_at', null)
      .order('created_at', { ascending: false }),
  ])

  if (brfsResult.error) throw new Error(brfsResult.error.message ?? 'Kunde inte hämta BRF-data.')
  if (membersResult.error) throw new Error(membersResult.error.message ?? 'Kunde inte hämta RenoApp-användare.')
  if (invitesResult.error) throw new Error(invitesResult.error.message ?? 'Kunde inte hämta väntande invites.')

  const memberRows = (membersResult.data ?? []) as Array<Record<string, unknown>>
  const profileIds = Array.from(new Set(memberRows.map((row) => String(row.profile_id ?? '')).filter(Boolean)))
  const profilesResult =
    profileIds.length > 0
      ? await admin.from('profiles').select('id,full_name,email').in('id', profileIds)
      : { data: [], error: null }

  if (profilesResult.error) {
    throw new Error(profilesResult.error.message ?? 'Kunde inte hämta användarprofiler.')
  }

  const brfMap = new Map(
    ((brfsResult.data ?? []) as Array<Record<string, unknown>>).map((row) => [
      String(row.id ?? ''),
      {
        id: String(row.id ?? ''),
        name: (row.name as string | null | undefined) ?? null,
        slug: (row.slug as string | null | undefined) ?? null,
      },
    ])
  )

  const profileMap = new Map(
    ((profilesResult.data ?? []) as Array<Record<string, unknown>>).map((row) => [
      String(row.id ?? ''),
      {
        fullName: (row.full_name as string | null | undefined) ?? null,
        email: (row.email as string | null | undefined) ?? null,
      },
    ])
  )

  const membersByBrfId = new Map<string, RenoAppUserListItem['members']>()
  for (const row of memberRows) {
    const brfId = String(row.brf_id ?? '')
    const profileId = String(row.profile_id ?? '')
    const profile = profileMap.get(profileId) ?? { fullName: null, email: null }
    const bucket = membersByBrfId.get(brfId) ?? []
    bucket.push({
      profileId,
      fullName: profile.fullName,
      email: profile.email,
      role: String(row.role ?? 'board') as 'board' | 'admin',
      acceptedAt: (row.accepted_at as string | null | undefined) ?? null,
    })
    membersByBrfId.set(brfId, bucket)
  }

  const invitesByBrfId = new Map<string, RenoAppUserListItem['pendingInvites']>()
  for (const row of (invitesResult.data ?? []) as Array<Record<string, unknown>>) {
    const brfId = String(row.brf_id ?? '')
    const bucket = invitesByBrfId.get(brfId) ?? []
    bucket.push({
      id: String(row.id ?? ''),
      fullName: (row.full_name as string | null | undefined) ?? null,
      email: String(row.email ?? ''),
      expiresAt: String(row.expires_at ?? ''),
      createdAt: String(row.created_at ?? ''),
    })
    invitesByBrfId.set(brfId, bucket)
  }

  return brfIds.map((brfId) => ({
    brf: brfMap.get(brfId) ?? { id: brfId, name: null, slug: null },
    members: membersByBrfId.get(brfId) ?? [],
    pendingInvites: invitesByBrfId.get(brfId) ?? [],
  }))
}

export async function createRenoAppUserInvite(input: {
  brfId: string
  fullName: string
  email: string
  origin: string
}): Promise<CreateRenoAppUserInviteResult> {
  const context = await requireRenoAppViewerContext()
  const admin = createSupabaseAdminClient() as unknown as SupabaseAdminClient

  if (context.accessibleBrfIds && !context.accessibleBrfIds.includes(input.brfId)) {
    throw new Error('BRF_NOT_FOUND')
  }

  const fullName = normalizeText(input.fullName)
  const email = normalizeEmail(input.email)
  const origin = normalizeText(input.origin) ?? process.env.NEXT_PUBLIC_SITE_URL ?? 'https://hushub.se'

  if (!fullName) throw new Error('FULL_NAME_REQUIRED')
  assertValidEmail(email, 'EMAIL_INVALID')

  const { data: brfData, error: brfError } = await admin
    .from('brf_associations')
    .select('id,name,slug')
    .eq('id', input.brfId)
    .maybeSingle()

  if (brfError) {
    throw new Error(brfError.message ?? 'Kunde inte läsa BRF.')
  }
  if (!brfData) {
    throw new Error('BRF_NOT_FOUND')
  }

  const { data: existingMemberRows, error: existingMemberError } = await admin
    .from('brf_members')
    .select('profile_id')
    .eq('brf_id', input.brfId)
    .eq('is_active', true)

  if (existingMemberError) {
    throw new Error(existingMemberError.message ?? 'Kunde inte läsa användare.')
  }

  const profileIds = Array.from(
    new Set(((existingMemberRows ?? []) as Array<Record<string, unknown>>).map((row) => String(row.profile_id ?? '')).filter(Boolean))
  )
  const profilesResult =
    profileIds.length > 0
      ? await admin.from('profiles').select('id,email').in('id', profileIds)
      : { data: [], error: null }

  if (profilesResult.error) {
    throw new Error(profilesResult.error.message ?? 'Kunde inte läsa användarprofiler.')
  }

  const activeEmails = new Set(
    ((profilesResult.data ?? []) as Array<Record<string, unknown>>)
      .map((row) => normalizeEmail(row.email))
      .filter((value): value is string => Boolean(value))
  )
  if (email && activeEmails.has(email)) {
    throw new Error('EMAIL_ALREADY_MEMBER')
  }

  const { data: existingInvite, error: existingInviteError } = await admin
    .from('brf_member_invites')
    .select('id')
    .eq('brf_id', input.brfId)
    .eq('email', email)
    .is('accepted_at', null)
    .is('revoked_at', null)
    .maybeSingle()

  if (existingInviteError) {
    throw new Error(existingInviteError.message ?? 'Kunde inte läsa befintliga invites.')
  }
  if (existingInvite) {
    throw new Error('EMAIL_ALREADY_INVITED')
  }

  const token = makeToken()
  const tokenHash = hashToken(token)
  const expiresAt = new Date(Date.now() + INVITE_TTL_HOURS * 60 * 60 * 1000).toISOString()

  const { data: inviteData, error: insertError } = await admin
    .from('brf_member_invites')
    .insert({
      brf_id: input.brfId,
      email,
      full_name: fullName,
      role: 'board',
      token_hash: tokenHash,
      expires_at: expiresAt,
      created_by: context.userId,
    })
    .select('id')
    .single()

  if (insertError || !inviteData) {
    throw new Error(insertError?.message ?? 'Kunde inte skapa invite.')
  }

  const inviteUrl = buildAbsoluteUrl(origin, `/renoapp/invite/${token}`)
  const mailFrom = getMailFromAddress()
  let emailSent = false
  let emailError: string | null = null

  if (mailFrom) {
    try {
      const subject = `Inbjudan till RenoApp för ${String(brfData.name ?? 'er BRF')}`
      await sendAssignmentEmail({
        to: email as string,
        from: mailFrom,
        subject,
        html: buildRenoAppEmailHtml({
          origin,
          preheader: subject,
          bodyHtml: `
            <p>Hej ${escapeHtml(fullName as string)},</p>
            <p>Du har blivit inbjuden till RenoApp för <strong>${escapeHtml(String(brfData.name ?? 'er BRF'))}</strong>.</p>
            <p>Öppna länken nedan för att aktivera ditt konto:</p>
            <p><a href="${inviteUrl}">${inviteUrl}</a></p>
            <p>Länken gäller till ${new Date(expiresAt).toLocaleString('sv-SE')}.</p>
          `,
        }),
        text: [
          `Hej ${fullName},`,
          `Du har blivit inbjuden till RenoApp för ${String(brfData.name ?? 'er BRF')}.`,
          `Öppna länken för att aktivera ditt konto: ${inviteUrl}`,
          `Länken gäller till ${new Date(expiresAt).toLocaleString('sv-SE')}.`,
          '',
          'Med vänlig hälsning,',
          'RenoApp-teamet på HusHub',
        ].join('\n'),
      })
      emailSent = true
    } catch (error) {
      emailError = error instanceof Error ? error.message : 'Mejlutskick misslyckades.'
    }
  } else {
    emailError = 'ASSIGNMENTS_MAIL_FROM saknas. Invite skapades men inget mejl skickades.'
  }

  return {
    invite: {
      id: String(inviteData.id ?? ''),
      email: email as string,
      fullName,
      expiresAt,
      inviteUrl,
      emailSent,
      emailError,
    },
  }
}

export async function revokeRenoAppUserInvite(inviteId: string) {
  const context = await requireRenoAppViewerContext()
  const admin = createSupabaseAdminClient() as unknown as SupabaseAdminClient

  const { data: inviteData, error: inviteError } = await admin
    .from('brf_member_invites')
    .select('id,brf_id,accepted_at,revoked_at')
    .eq('id', inviteId)
    .maybeSingle()

  if (inviteError) {
    throw new Error(inviteError.message ?? 'Kunde inte läsa invite.')
  }
  if (!inviteData) {
    throw new Error('INVITE_NOT_FOUND')
  }

  const brfId = String((inviteData as Record<string, unknown>).brf_id ?? '')
  if (context.accessibleBrfIds && !context.accessibleBrfIds.includes(brfId)) {
    throw new Error('INVITE_NOT_FOUND')
  }
  if ((inviteData as Record<string, unknown>).accepted_at) {
    throw new Error('INVITE_ALREADY_ACCEPTED')
  }
  if ((inviteData as Record<string, unknown>).revoked_at) {
    throw new Error('INVITE_ALREADY_REVOKED')
  }

  const { error: updateError } = await admin
    .from('brf_member_invites')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', inviteId)

  if (updateError) {
    throw new Error(updateError.message ?? 'Kunde inte återkalla invite.')
  }

  return { revoked: true as const }
}

export async function getRenoAppCaseDetail(caseId: string): Promise<RenoAppCaseDetail | null> {
  const context = await requireRenoAppViewerContext()
  const admin = createSupabaseAdminClient() as unknown as SupabaseAdminClient

  const { data: caseData, error: caseError } = await admin
    .from('renovation_cases')
    .select(
      'id,brf_id,unit_id,applicant_contact_id,action_type_id,case_number,title,description,status,risk_level,blocked_at,blocked_reason,submitted_at,updated_at'
    )
    .eq('id', caseId)
    .maybeSingle()

  if (caseError) {
    throw new Error(caseError.message ?? 'Kunde inte läsa RenoApp-ärende.')
  }

  if (!caseData) {
    return null
  }

  const caseRow = caseData as CaseRow
  if (context.accessibleBrfIds && !context.accessibleBrfIds.includes(caseRow.brf_id)) {
    throw new Error('CASE_NOT_FOUND')
  }

  const [brfResult, contactResult, unitResult, checksResult, docsResult, decisionsResult, linksResult, actionResult] =
    await Promise.all([
      admin.from('brf_associations').select('id,name,slug').eq('id', caseRow.brf_id).maybeSingle(),
      caseRow.applicant_contact_id
        ? admin.from('contacts').select('id,name,email,phone').eq('id', caseRow.applicant_contact_id).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      caseRow.unit_id
        ? admin
            .from('brf_units')
            .select('id,unit_number_internal,unit_number_skatteverket,status')
            .eq('id', caseRow.unit_id)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      admin
        .from('renovation_case_checks')
        .select(
          'affects_structure,affects_plumbing,affects_ventilation,affects_electrical,affects_wet_room,affects_surface_only'
        )
        .eq('case_id', caseId)
        .maybeSingle(),
      admin
        .from('renovation_case_documents')
        .select('id,document_type_id,file_name,status,uploaded_at,note')
        .eq('case_id', caseId)
        .order('uploaded_at', { ascending: false }),
      admin
        .from('renovation_case_decisions')
        .select('id,decision,conditions,reason,decided_at')
        .eq('case_id', caseId)
        .order('decided_at', { ascending: false }),
      admin
        .from('case_access_links')
        .select('id,email,scope,expires_at,revoked_at,last_used_at')
        .eq('case_id', caseId)
        .order('created_at', { ascending: false }),
      caseRow.action_type_id
        ? admin.from('renovation_action_types').select('id,key,label').eq('id', caseRow.action_type_id).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ])

  if (brfResult.error) throw new Error(brfResult.error.message ?? 'Kunde inte läsa BRF.')
  if (contactResult.error) throw new Error(contactResult.error.message ?? 'Kunde inte läsa kontakt.')
  if (unitResult.error) throw new Error(unitResult.error.message ?? 'Kunde inte läsa lägenhet.')
  if (checksResult.error) throw new Error(checksResult.error.message ?? 'Kunde inte läsa ärendechecks.')
  if (docsResult.error) throw new Error(docsResult.error.message ?? 'Kunde inte läsa dokument.')
  if (decisionsResult.error) throw new Error(decisionsResult.error.message ?? 'Kunde inte läsa beslut.')
  if (linksResult.error) throw new Error(linksResult.error.message ?? 'Kunde inte läsa access links.')
  if (actionResult.error) throw new Error(actionResult.error.message ?? 'Kunde inte läsa åtgärdstyp.')

  const currentContactsResult =
    caseRow.unit_id
      ? await admin
          .from('unit_contacts')
          .select('contact_id,verification_status,relationship_type')
          .eq('unit_id', caseRow.unit_id)
          .eq('is_current', true)
      : { data: [], error: null }

  if (currentContactsResult.error) {
    throw new Error(currentContactsResult.error.message ?? 'Kunde inte läsa kontaktkopplingar.')
  }

  const currentContactRows = (currentContactsResult.data ?? []) as Array<Record<string, unknown>>
  const currentContactIds = Array.from(
    new Set(currentContactRows.map((row) => String(row.contact_id ?? '')).filter(Boolean))
  )
  const documentTypeIds = Array.from(
    new Set(
      ((docsResult.data ?? []) as Array<Record<string, unknown>>)
        .map((row) => String(row.document_type_id ?? ''))
        .filter(Boolean)
    )
  )

  const [currentContactsLookup, documentTypesLookup, requirements] = await Promise.all([
    currentContactIds.length > 0
      ? admin.from('contacts').select('id,name,email').in('id', currentContactIds)
      : Promise.resolve({ data: [], error: null }),
    documentTypeIds.length > 0
      ? admin.from('renovation_document_types').select('id,label').in('id', documentTypeIds)
      : Promise.resolve({ data: [], error: null }),
    caseRow.action_type_id ? listRequirements(admin, caseRow.brf_id) : Promise.resolve([] as RequirementRow[]),
  ])

  if (currentContactsLookup.error) {
    throw new Error(currentContactsLookup.error.message ?? 'Kunde inte läsa kontaktdata.')
  }
  if (documentTypesLookup.error) {
    throw new Error(documentTypesLookup.error.message ?? 'Kunde inte läsa dokumenttyper.')
  }

  const contactMap = new Map(
    ((currentContactsLookup.data ?? []) as Array<Record<string, unknown>>).map((row) => [
      String(row.id ?? ''),
      {
        id: String(row.id ?? ''),
        name: (row.name as string | null | undefined) ?? null,
        email: (row.email as string | null | undefined) ?? null,
      },
    ])
  )
  const documentTypeMap = new Map(
    ((documentTypesLookup.data ?? []) as Array<Record<string, unknown>>).map((row) => [
      String(row.id ?? ''),
      (row.label as string | null | undefined) ?? null,
    ])
  )

  const requiredDocumentTypes = caseRow.action_type_id
    ? await listActiveDocumentTypes(admin)
    : []
  const requiredDocumentTypeMap = new Map(requiredDocumentTypes.map((item) => [item.id, item]))
  const requirementMap = new Map<string, RequirementRow>()
  for (const requirement of requirements) {
    const key = `${requirement.action_type_id}:${requirement.document_type_id}`
    requirementMap.set(key, requirement)
  }

  const requirementItems: PublicRequirement[] = caseRow.action_type_id
    ? Array.from(requirementMap.values())
        .filter((item) => item.action_type_id === caseRow.action_type_id)
        .map((item) => {
          const documentType = requiredDocumentTypeMap.get(item.document_type_id)
          return {
            id: item.id,
            documentTypeId: item.document_type_id,
            documentKey: documentType?.key ?? 'unknown',
            documentLabel: documentType?.label ?? 'Okänd dokumenttyp',
            documentDescription: documentType?.description ?? null,
            isRequired: item.is_required,
            note: item.note,
            sortOrder: item.sort_order,
          }
        })
        .sort((left, right) => left.sortOrder - right.sortOrder)
    : []

  return {
    id: caseRow.id,
    caseNumber: caseRow.case_number,
    title: caseRow.title,
    description: caseRow.description,
    status: caseRow.status,
    riskLevel: caseRow.risk_level,
    submittedAt: caseRow.submitted_at,
    updatedAt: caseRow.updated_at,
    blockedAt: caseRow.blocked_at,
    blockedReason: caseRow.blocked_reason,
    brf: {
      id: String(brfResult.data?.id ?? caseRow.brf_id),
      name: (brfResult.data?.name as string | null | undefined) ?? null,
      slug: (brfResult.data?.slug as string | null | undefined) ?? null,
    },
    actionType: {
      id: (actionResult.data?.id as string | null | undefined) ?? null,
      key: (actionResult.data?.key as string | null | undefined) ?? null,
      label: (actionResult.data?.label as string | null | undefined) ?? null,
    },
    applicant: {
      id: (contactResult.data?.id as string | null | undefined) ?? null,
      name: (contactResult.data?.name as string | null | undefined) ?? null,
      email: (contactResult.data?.email as string | null | undefined) ?? null,
      phone: (contactResult.data?.phone as string | null | undefined) ?? null,
    },
    unit: {
      id: (unitResult.data?.id as string | null | undefined) ?? null,
      unitNumberInternal: (unitResult.data?.unit_number_internal as string | null | undefined) ?? null,
      unitNumberSkatteverket: (unitResult.data?.unit_number_skatteverket as string | null | undefined) ?? null,
      status: (unitResult.data?.status as string | null | undefined) ?? null,
    },
    checks: checksResult.data
      ? {
          affectsStructure: Boolean(checksResult.data.affects_structure),
          affectsPlumbing: Boolean(checksResult.data.affects_plumbing),
          affectsVentilation: Boolean(checksResult.data.affects_ventilation),
          affectsElectrical: Boolean(checksResult.data.affects_electrical),
          affectsWetRoom: Boolean(checksResult.data.affects_wet_room),
          affectsSurfaceOnly: Boolean(checksResult.data.affects_surface_only),
        }
      : null,
    currentContacts: currentContactRows.map((row) => {
      const contact = contactMap.get(String(row.contact_id ?? '')) ?? { id: String(row.contact_id ?? ''), name: null, email: null }
      return {
        id: contact.id,
        name: contact.name,
        email: contact.email,
        verificationStatus: String(row.verification_status ?? ''),
        relationshipType: String(row.relationship_type ?? ''),
      }
    }),
    documents: ((docsResult.data ?? []) as Array<Record<string, unknown>>).map((row) => ({
      id: String(row.id ?? ''),
      documentTypeId: (row.document_type_id as string | null | undefined) ?? null,
      documentTypeLabel: documentTypeMap.get(String(row.document_type_id ?? '')) ?? null,
      fileName: (row.file_name as string | null | undefined) ?? null,
      status: String(row.status ?? ''),
      uploadedAt: String(row.uploaded_at ?? ''),
      note: (row.note as string | null | undefined) ?? null,
    })),
    requirements: requirementItems,
    decisions: ((decisionsResult.data ?? []) as Array<Record<string, unknown>>).map((row) => ({
      id: String(row.id ?? ''),
      decision: String(row.decision ?? ''),
      conditions: (row.conditions as string | null | undefined) ?? null,
      reason: (row.reason as string | null | undefined) ?? null,
      decidedAt: String(row.decided_at ?? ''),
    })),
    accessLinks: ((linksResult.data ?? []) as Array<Record<string, unknown>>).map((row) => ({
      id: String(row.id ?? ''),
      email: String(row.email ?? ''),
      scope: String(row.scope ?? ''),
      expiresAt: String(row.expires_at ?? ''),
      revokedAt: (row.revoked_at as string | null | undefined) ?? null,
      lastUsedAt: (row.last_used_at as string | null | undefined) ?? null,
    })),
  }
}

export async function updateRenoAppCaseStatus(
  caseId: string,
  input: UpdateRenoAppCaseStatusInput
): Promise<RenoAppCaseDetail> {
  const context = await requireRenoAppViewerContext()
  const admin = createSupabaseAdminClient() as unknown as SupabaseAdminClient

  const allowedStatuses = new Set(['review', 'need_info', 'approved', 'conditional', 'rejected'])
  const decisionStatuses = new Set(['approved', 'conditional', 'rejected'])

  if (!allowedStatuses.has(input.status)) {
    throw new Error('INVALID_CASE_STATUS')
  }

  const reason = normalizeText(input.reason)
  const conditions = normalizeText(input.conditions)

  if (input.status === 'rejected' && !reason) {
    throw new Error('DECISION_REASON_REQUIRED')
  }

  if (input.status === 'conditional' && !conditions) {
    throw new Error('DECISION_CONDITIONS_REQUIRED')
  }

  const { data: caseData, error: caseError } = await admin
    .from('renovation_cases')
    .select('id,brf_id')
    .eq('id', caseId)
    .maybeSingle()

  if (caseError) {
    throw new Error(caseError.message ?? 'Kunde inte läsa RenoApp-ärende.')
  }

  if (!caseData) {
    throw new Error('CASE_NOT_FOUND')
  }

  const brfId = String(caseData.brf_id ?? '')
  if (context.accessibleBrfIds && !context.accessibleBrfIds.includes(brfId)) {
    throw new Error('CASE_NOT_FOUND')
  }

  const { error: updateError } = await admin.from('renovation_cases').update({ status: input.status }).eq('id', caseId)

  if (updateError) {
    throw new Error(updateError.message ?? 'Kunde inte uppdatera RenoApp-ärende.')
  }

  if (decisionStatuses.has(input.status)) {
    const { error: insertError } = await admin.from('renovation_case_decisions').insert({
      case_id: caseId,
      decision: input.status,
      conditions,
      reason,
      decided_by: context.profile.id,
    })

    if (insertError) {
      throw new Error(insertError.message ?? 'Kunde inte spara beslut.')
    }
  }

  const updatedCase = await getRenoAppCaseDetail(caseId)
  if (!updatedCase) {
    throw new Error('CASE_NOT_FOUND')
  }

  return updatedCase
}
