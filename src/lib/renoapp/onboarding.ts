import crypto from 'node:crypto'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { sendAssignmentEmail } from '@/lib/assignments/mailer'
import { RENOAPP_BRF_TERMS_VERSION } from '@/lib/renoapp/brfTerms'

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const ORG_NUMBER_REGEX = /^\d{6}-\d{4}$/
const POSTAL_CODE_REGEX = /^\d{3}\s\d{2}$/
const INVITE_TTL_HOURS = 24 * 7
const MIN_PASSWORD_LENGTH = 8

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
  upsert: (values: unknown, options?: unknown) => QueryBuilder<T>
  update: (values: unknown) => QueryBuilder<T>
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
  auth: {
    admin: {
      createUser: (input: {
        email: string
        password: string
        email_confirm?: boolean
        user_metadata?: Record<string, unknown>
      }) => Promise<{
        data: {
          user:
            | {
                id: string
                email?: string | null
                user_metadata?: Record<string, unknown>
              }
            | null
        }
        error: SupabaseError
      }>
    }
  }
}

type InternalAdminContext = {
  userId: string
  profile: {
    id: string
    email: string | null
    full_name: string | null
    is_admin: boolean
  }
}

type BrfRequestRow = {
  id: string
  name: string
  org_number: string | null
  address: string | null
  contact_name: string
  contact_email: string
  contact_phone: string | null
  message: string | null
  status: 'pending' | 'approved' | 'rejected'
  review_note: string | null
  reviewed_at: string | null
  approved_brf_id: string | null
  created_at: string
}

type BrfRow = {
  id: string
  name: string
  slug: string
  org_number: string | null
  address: string | null
  address_line_2: string | null
  postal_code: string | null
  city: string | null
  email: string | null
  phone: string | null
  property_designation: string | null
  invoice_address: string | null
  invoice_email: string | null
  invoice_reference: string | null
  primary_contact_name: string | null
  primary_contact_email: string | null
  primary_contact_phone: string | null
  unit_count: number | null
  technical_contact: string | null
  onboarding_comment: string | null
  onboarding_completed_at: string | null
  is_public_apply_enabled: boolean
  is_public_apply_listed: boolean
}

type InviteRow = {
  id: string
  brf_id: string
  email: string
  full_name: string | null
  role: 'board' | 'admin'
  expires_at: string
  accepted_at: string | null
  revoked_at: string | null
}

type OnboardingUserInput = {
  name?: string | null
  email?: string | null
}

export type CreateBrfRequestInput = {
  name: string
  origin?: string | null
  orgNumber?: string | null
  address?: string | null
  contactName: string
  contactEmail: string
  contactPhone?: string | null
  message?: string | null
}

export type CreateBrfRequestResult = {
  id: string
  status: 'pending'
  receipt: {
    emailSent: boolean
    emailError: string | null
  }
}

export type BrfRequestListItem = {
  id: string
  name: string
  orgNumber: string | null
  address: string | null
  contactName: string
  contactEmail: string
  contactPhone: string | null
  message: string | null
  status: 'pending' | 'approved' | 'rejected'
  reviewNote: string | null
  reviewedAt: string | null
  approvedBrfId: string | null
  createdAt: string
}

export type AdminCreateBrfInput = {
  name: string
  orgNumber?: string | null
  address?: string | null
  boardEmail: string
}

export type AdminCreateBrfResult = {
  brf: {
    id: string
    name: string
    slug: string
  }
  invite: {
    email: string
    role: 'board'
    expiresAt: string
    inviteUrl: string
    emailSent: boolean
    emailError: string | null
  }
}

export type ReviewBrfRequestInput = {
  action: 'approve' | 'reject'
  reviewNote?: string | null
}

export type ReviewBrfRequestResult = {
  request: BrfRequestListItem
  brf: {
    id: string
    name: string
    slug: string
  } | null
  invite: AdminCreateBrfResult['invite'] | null
  decisionEmail: {
    emailSent: boolean
    emailError: string | null
  } | null
}

export type RenoAppInvitePreview = {
  mode: 'brf_onboarding' | 'member_invite'
  state: 'open' | 'expired' | 'revoked' | 'accepted'
  invite: {
    email: string
    fullName: string | null
    role: 'board'
    expiresAt: string
    acceptedAt: string | null
    revokedAt: string | null
  }
  brf: {
    id: string
    name: string
    slug: string
    orgNumber: string | null
    propertyDesignation: string | null
    address: string | null
    addressLine2: string | null
    postalCode: string | null
    city: string | null
    invoiceAddress: string | null
    invoiceEmail: string | null
    invoiceReference: string | null
    primaryContactName: string | null
    primaryContactEmail: string | null
    primaryContactPhone: string | null
    unitCount: number | null
    generalEmail: string | null
    brfPhone: string | null
    technicalContact: string | null
    onboardingComment: string | null
    onboardingCompletedAt: string | null
    isPublicApplyEnabled: boolean
    isPublicApplyListed: boolean
  }
  currentUser: {
    email: string | null
    matchesInvite: boolean
  }
}

export type AcceptBrfInviteInput = {
  origin?: string | null
  password?: string | null
  termsAccepted?: boolean | null
  termsVersion?: string | null
  inviteUserName?: string | null
  name?: string | null
  orgNumber?: string | null
  propertyDesignation?: string | null
  address?: string | null
  addressLine2?: string | null
  postalCode?: string | null
  city?: string | null
  invoiceAddress?: string | null
  invoiceEmail?: string | null
  invoiceReference?: string | null
  primaryContactName?: string | null
  primaryContactEmail?: string | null
  primaryContactPhone?: string | null
  unitCount?: string | number | null
  generalEmail?: string | null
  brfPhone?: string | null
  technicalContact?: string | null
  onboardingComment?: string | null
  publicApplyMode?: string | null
  additionalUsers?: OnboardingUserInput[] | null
}

export type AcceptBrfInviteResult = {
  accepted: true
  signedInViaExistingSession: boolean
  createdUser: boolean
  signInEmail: string
  additionalInvitesCreated: number
  mode: 'brf_onboarding' | 'member_invite'
}

function normalizeText(value: unknown) {
  const text = String(value ?? '').trim()
  return text === '' ? null : text
}

function normalizeEmail(value: unknown) {
  const text = normalizeText(value)
  return text ? text.toLowerCase() : null
}

function normalizePostalCode(value: unknown) {
  const text = normalizeText(value)
  if (!text) return null

  const digits = text.replace(/\s+/g, '')
  if (!/^\d{5}$/.test(digits)) {
    return text
  }

  return `${digits.slice(0, 3)} ${digits.slice(3)}`
}

function assertValidEmail(value: string | null, fieldName: string) {
  if (!value || !EMAIL_REGEX.test(value)) {
    throw new Error(fieldName)
  }
}

function assertValidOrgNumber(value: string | null, fieldName: string) {
  if (!value || !ORG_NUMBER_REGEX.test(value)) {
    throw new Error(fieldName)
  }
}

function assertRequiredText(value: string | null, fieldName: string) {
  if (!value) {
    throw new Error(fieldName)
  }
}

function assertValidPostalCode(value: string | null, fieldName: string) {
  if (!value || !POSTAL_CODE_REGEX.test(value)) {
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

function slugify(value: string) {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
}

async function requireInternalAdminContext(): Promise<InternalAdminContext> {
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
    .select('id,email,full_name,is_admin')
    .eq('id', user.id)
    .maybeSingle()

  if (profileError || !profileData) {
    throw new Error(profileError?.message ?? 'PROFILE_NOT_FOUND')
  }

  if (!profileData.is_admin) {
    throw new Error('ADMIN_REQUIRED')
  }

  return {
    userId: user.id,
    profile: {
      id: String(profileData.id ?? user.id),
      email: (profileData.email as string | null | undefined) ?? null,
      full_name: (profileData.full_name as string | null | undefined) ?? null,
      is_admin: Boolean(profileData.is_admin),
    },
  }
}

async function createUniqueBrfSlug(admin: SupabaseAdminClient, name: string) {
  const base = slugify(name)
  const slugBase = base.length > 0 ? base : 'brf'

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const candidate = attempt === 0 ? slugBase : `${slugBase}-${attempt + 1}`
    const { data, error } = await admin
      .from('brf_associations')
      .select('id')
      .eq('slug', candidate)
      .maybeSingle()

    if (error) {
      throw new Error(error.message ?? 'Kunde inte generera unik BRF-slug.')
    }

    if (!data) return candidate
  }

  throw new Error('Kunde inte generera unik BRF-slug.')
}

type PreparedBrfCompletionInput = {
  name: string
  orgNumber: string
  propertyDesignation: string
  address: string
  addressLine2: string | null
  postalCode: string
  city: string
  invoiceAddress: string
  invoiceEmail: string
  invoiceReference: string | null
  primaryContactName: string
  primaryContactEmail: string
  primaryContactPhone: string
  unitCount: number | null
  generalEmail: string | null
  brfPhone: string | null
  technicalContact: string | null
  onboardingComment: string | null
  publicApplyMode: 'listed' | 'direct_link'
}

function parseOptionalPositiveInteger(value: unknown, fieldName: string) {
  const text = normalizeText(value)
  if (!text) {
    return null
  }

  const parsed = Number.parseInt(text, 10)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(fieldName)
  }

  return parsed
}

type PreparedInviteUserInput = {
  fullName: string
  email: string
}

function prepareBrfCompletionInput(input: AcceptBrfInviteInput): PreparedBrfCompletionInput {
  const name = normalizeText(input.name)
  const orgNumber = normalizeText(input.orgNumber)
  const propertyDesignation = normalizeText(input.propertyDesignation)
  const address = normalizeText(input.address)
  const addressLine2 = normalizeText(input.addressLine2)
  const postalCode = normalizePostalCode(input.postalCode)
  const city = normalizeText(input.city)
  const invoiceAddress = normalizeText(input.invoiceAddress)
  const invoiceEmail = normalizeEmail(input.invoiceEmail)
  const invoiceReference = normalizeText(input.invoiceReference)
  const primaryContactName = normalizeText(input.primaryContactName)
  const primaryContactEmail = normalizeEmail(input.primaryContactEmail)
  const primaryContactPhone = normalizeText(input.primaryContactPhone)
  const generalEmail = normalizeEmail(input.generalEmail)
  const brfPhone = normalizeText(input.brfPhone)
  const technicalContact = normalizeText(input.technicalContact)
  const onboardingComment = normalizeText(input.onboardingComment)
  const publicApplyMode = normalizeText(input.publicApplyMode)
  const unitCount = parseOptionalPositiveInteger(input.unitCount, 'UNIT_COUNT_INVALID')

  assertRequiredText(name, 'BRF_NAME_REQUIRED')
  assertValidOrgNumber(orgNumber, 'ORG_NUMBER_INVALID')
  assertRequiredText(propertyDesignation, 'PROPERTY_DESIGNATION_REQUIRED')
  assertRequiredText(address, 'ADDRESS_REQUIRED')
  assertValidPostalCode(postalCode, 'POSTAL_CODE_INVALID')
  assertRequiredText(city, 'CITY_REQUIRED')
  assertRequiredText(invoiceAddress, 'INVOICE_ADDRESS_REQUIRED')
  assertValidEmail(invoiceEmail, 'INVOICE_EMAIL_INVALID')
  assertRequiredText(primaryContactName, 'PRIMARY_CONTACT_NAME_REQUIRED')
  assertValidEmail(primaryContactEmail, 'PRIMARY_CONTACT_EMAIL_INVALID')
  assertRequiredText(primaryContactPhone, 'PRIMARY_CONTACT_PHONE_REQUIRED')

  if (generalEmail) {
    assertValidEmail(generalEmail, 'GENERAL_EMAIL_INVALID')
  }

  if (publicApplyMode !== 'listed' && publicApplyMode !== 'direct_link') {
    throw new Error('PUBLIC_APPLY_MODE_REQUIRED')
  }

  const requiredName = name as string
  const requiredOrgNumber = orgNumber as string
  const requiredPropertyDesignation = propertyDesignation as string
  const requiredAddress = address as string
  const requiredPostalCode = postalCode as string
  const requiredCity = city as string
  const requiredInvoiceAddress = invoiceAddress as string
  const requiredInvoiceEmail = invoiceEmail as string
  const requiredPrimaryContactName = primaryContactName as string
  const requiredPrimaryContactEmail = primaryContactEmail as string
  const requiredPrimaryContactPhone = primaryContactPhone as string

  return {
    name: requiredName,
    orgNumber: requiredOrgNumber,
    propertyDesignation: requiredPropertyDesignation,
    address: requiredAddress,
    addressLine2,
    postalCode: requiredPostalCode,
    city: requiredCity,
    invoiceAddress: requiredInvoiceAddress,
    invoiceEmail: requiredInvoiceEmail,
    invoiceReference,
    primaryContactName: requiredPrimaryContactName,
    primaryContactEmail: requiredPrimaryContactEmail,
    primaryContactPhone: requiredPrimaryContactPhone,
    unitCount,
    generalEmail,
    brfPhone,
    technicalContact,
    onboardingComment,
    publicApplyMode,
  }
}

function prepareAdditionalInviteUsers(
  users: OnboardingUserInput[] | null | undefined,
  inviteEmail: string
): PreparedInviteUserInput[] {
  const rows = Array.isArray(users) ? users : []

  if (rows.length > 3) {
    throw new Error('TOO_MANY_ADDITIONAL_USERS')
  }

  const seenEmails = new Set<string>([inviteEmail])

  return rows
    .map((user) => ({
      fullName: normalizeText(user?.name),
      email: normalizeEmail(user?.email),
    }))
    .filter((user) => user.fullName !== null || user.email !== null)
    .map((user) => {
      if (!user.fullName) throw new Error('ADDITIONAL_USER_NAME_REQUIRED')
      if (!user.email) throw new Error('ADDITIONAL_USER_EMAIL_REQUIRED')
      assertValidEmail(user.email, 'ADDITIONAL_USER_EMAIL_INVALID')

      if (seenEmails.has(user.email)) {
        throw new Error('ADDITIONAL_USER_DUPLICATE_EMAIL')
      }

      seenEmails.add(user.email)

      return {
        fullName: user.fullName,
        email: user.email,
      }
    })
}

async function ensureProfile(
  admin: SupabaseAdminClient,
  input: {
    userId: string
    email: string | null
    fullName: string | null
  }
) {
  const { data: existingProfile, error: existingProfileError } = await admin
    .from('profiles')
    .select('id')
    .eq('id', input.userId)
    .maybeSingle()

  if (existingProfileError) {
    throw new Error(existingProfileError.message ?? 'Kunde inte läsa profil.')
  }

  if (existingProfile) {
    const { error: updateProfileError } = await admin
      .from('profiles')
      .update({
        email: input.email,
        full_name: input.fullName,
      })
      .eq('id', input.userId)

    if (updateProfileError) {
      throw new Error(updateProfileError.message ?? 'Kunde inte uppdatera profil.')
    }
    return
  }

  const { error: createProfileError } = await admin.from('profiles').upsert(
    {
      id: input.userId,
      email: input.email,
      full_name: input.fullName,
      is_admin: false,
    },
    { onConflict: 'id' } as never
  )

  if (createProfileError) {
    throw new Error(createProfileError.message ?? 'Kunde inte skapa profil.')
  }
}

async function ensureBrfMember(
  admin: SupabaseAdminClient,
  input: {
    brfId: string
    profileId: string
    role: 'board' | 'admin'
  }
) {
  const { data: existingMember, error: existingMemberError } = await admin
    .from('brf_members')
    .select('id')
    .eq('brf_id', input.brfId)
    .eq('profile_id', input.profileId)
    .maybeSingle()

  if (existingMemberError) {
    throw new Error(existingMemberError.message ?? 'Kunde inte läsa BRF-medlemskap.')
  }

  if (existingMember) {
    const { error: updateError } = await admin
      .from('brf_members')
      .update({ role: input.role, is_active: true, accepted_at: new Date().toISOString() })
      .eq('id', String(existingMember.id ?? ''))

    if (updateError) {
      throw new Error(updateError.message ?? 'Kunde inte uppdatera BRF-medlemskap.')
    }
    return
  }

  const { error: insertError } = await admin.from('brf_members').insert({
    brf_id: input.brfId,
    profile_id: input.profileId,
    role: input.role,
    is_active: true,
    accepted_at: new Date().toISOString(),
  })

  if (insertError) {
    throw new Error(insertError.message ?? 'Kunde inte skapa BRF-medlemskap.')
  }
}

async function createInviteRecord(
  admin: SupabaseAdminClient,
  input: {
    brfId: string
    brfName: string
    email: string
    fullName?: string | null
    role: 'board' | 'admin'
    createdBy: string
    origin: string
    approvalContext?: {
      contactName: string | null
      reviewNote: string | null
    } | null
  }
): Promise<AdminCreateBrfResult['invite']> {
  const token = makeToken()
  const tokenHash = hashToken(token)
  const expiresAt = new Date(Date.now() + INVITE_TTL_HOURS * 60 * 60 * 1000).toISOString()

  const { error: insertError } = await admin.from('brf_member_invites').insert({
    brf_id: input.brfId,
    email: input.email,
    full_name: normalizeText(input.fullName),
    role: input.role,
    token_hash: tokenHash,
    expires_at: expiresAt,
    created_by: input.createdBy,
  })

  if (insertError) {
    throw new Error(insertError.message ?? 'Kunde inte skapa invite.')
  }

  const inviteUrl = buildAbsoluteUrl(input.origin, `/renoapp/invite/${token}`)
  const mailFrom = getMailFromAddress()
  let emailSent = false
  let emailError: string | null = null

  if (mailFrom) {
    try {
      const safeBrfName = escapeHtml(input.brfName)
      const safeReviewNote = input.approvalContext?.reviewNote
        ? escapeHtml(input.approvalContext.reviewNote)
        : null
      const recipientName = input.approvalContext?.contactName ?? input.fullName ?? null
      const safeContactName = escapeHtml(recipientName ?? 'er')
      const isCombinedApprovalInvite = Boolean(input.approvalContext)
      const subject = isCombinedApprovalInvite
        ? `Er BRF-förfrågan för ${input.brfName} har godkänts`
        : `Inbjudan till RenoApp för ${input.brfName}`
      const htmlBody = isCombinedApprovalInvite
        ? `
          <p>Hej ${safeContactName},</p>
          <p>Er intresseanmälan för <strong>${safeBrfName}</strong> har godkänts.</p>
          <p>Öppna länken nedan för att aktivera ditt styrelsekonto i RenoApp:</p>
          <p><a href="${inviteUrl}">${inviteUrl}</a></p>
          <p>Länken gäller till ${new Date(expiresAt).toLocaleString('sv-SE')}.</p>
          ${safeReviewNote ? `<p><strong>Kommentar:</strong> ${safeReviewNote}</p>` : ''}
        `
        : `
          <p>Hej ${safeContactName},</p>
          <p>Du har blivit inbjuden till RenoApp för <strong>${safeBrfName}</strong>.</p>
          <p>Öppna länken nedan för att aktivera ditt styrelsekonto:</p>
          <p><a href="${inviteUrl}">${inviteUrl}</a></p>
          <p>Länken gäller till ${new Date(expiresAt).toLocaleString('sv-SE')}.</p>
        `
      const text = isCombinedApprovalInvite
        ? [
            `Hej ${input.approvalContext?.contactName ?? 'er'},`,
            `Er intresseanmälan för ${input.brfName} har godkänts.`,
            `Öppna länken nedan för att aktivera ditt styrelsekonto i RenoApp: ${inviteUrl}`,
            `Länken gäller till ${new Date(expiresAt).toLocaleString('sv-SE')}.`,
            input.approvalContext?.reviewNote ? `Kommentar: ${input.approvalContext.reviewNote}` : null,
            '',
            'Med vänlig hälsning,',
            'RenoApp-teamet på HusHub',
          ]
            .filter(Boolean)
            .join('\n')
        : [
            `Hej ${input.fullName ?? 'er'},`,
            `Du har blivit inbjuden till RenoApp för ${input.brfName}.`,
            `Öppna länken för att aktivera ditt konto: ${inviteUrl}`,
            `Länken gäller till ${new Date(expiresAt).toLocaleString('sv-SE')}.`,
            '',
            'Med vänlig hälsning,',
            'RenoApp-teamet på HusHub',
          ].join('\n')

      await sendAssignmentEmail({
        to: input.email,
        from: mailFrom,
        subject,
        html: buildRenoAppEmailHtml({
          origin: input.origin,
          preheader: subject,
          bodyHtml: htmlBody,
        }),
        text,
      })
      emailSent = true
    } catch (error) {
      emailError = error instanceof Error ? error.message : 'Mejlutskick misslyckades.'
    }
  } else {
    emailError = 'ASSIGNMENTS_MAIL_FROM saknas. Invite skapades men inget mejl skickades.'
  }

  return {
    email: input.email,
    role: 'board',
    expiresAt,
    inviteUrl,
    emailSent,
    emailError,
  }
}

async function sendRenoAppEmail(input: {
  to: string | null
  origin: string
  subject: string
  htmlBody: string
  text: string
}) {
  const recipient = normalizeEmail(input.to)
  assertValidEmail(recipient, 'EMAIL_INVALID')

  const mailFrom = getMailFromAddress()
  if (!mailFrom) {
    return {
      emailSent: false,
      emailError: 'ASSIGNMENTS_MAIL_FROM saknas. Mejlet kunde inte skickas.',
    }
  }

  try {
    await sendAssignmentEmail({
      to: recipient as string,
      from: mailFrom,
      subject: input.subject,
      html: buildRenoAppEmailHtml({
        origin: input.origin,
        preheader: input.subject,
        bodyHtml: input.htmlBody,
      }),
      text: `${input.text}\n\nMed vänlig hälsning,\nRenoApp-teamet på HusHub`,
    })

    return {
      emailSent: true,
      emailError: null,
    }
  } catch (error) {
    return {
      emailSent: false,
      emailError: error instanceof Error ? error.message : 'Mejlutskick misslyckades.',
    }
  }
}

async function sendBrfRequestReceiptEmail(input: {
  origin: string
  brfName: string
  contactName: string | null
  contactEmail: string | null
}) {
  const safeBrfName = escapeHtml(input.brfName)
  const safeContactName = escapeHtml(input.contactName ?? 'er')

  return sendRenoAppEmail({
    to: input.contactEmail,
    origin: input.origin,
    subject: `Vi har tagit emot er BRF-förfrågan för ${input.brfName}`,
    htmlBody: `
      <p>Hej ${safeContactName},</p>
      <p>Vi har tagit emot er intresseanmälan för <strong>${safeBrfName}</strong> i RenoApp.</p>
      <p>Förfrågan granskas nu av admin. Om BRF:en godkänns skickas en säker invite till styrelsen.</p>
      <p>Ni hör från oss när förfrågan har behandlats.</p>
    `,
    text: [
      `Hej ${input.contactName ?? 'er'},`,
      `Vi har tagit emot er intresseanmälan för ${input.brfName} i RenoApp.`,
      'Förfrågan granskas nu av admin. Om BRF:en godkänns skickas en säker invite till styrelsen.',
      'Ni hör från oss när förfrågan har behandlats.',
    ].join('\n'),
  })
}

async function sendBrfRequestRejectedEmail(input: {
  origin: string
  brfName: string
  contactName: string | null
  contactEmail: string | null
  reviewNote: string | null
}) {
  const safeBrfName = escapeHtml(input.brfName)
  const safeContactName = escapeHtml(input.contactName ?? 'er')
  const safeReviewNote = input.reviewNote ? escapeHtml(input.reviewNote) : null

  return sendRenoAppEmail({
    to: input.contactEmail,
    origin: input.origin,
    subject: `Er BRF-förfrågan för ${input.brfName} har behandlats`,
    htmlBody: `
      <p>Hej ${safeContactName},</p>
      <p>Er intresseanmälan för <strong>${safeBrfName}</strong> har behandlats, men går inte vidare i nuläget.</p>
      ${safeReviewNote ? `<p><strong>Kommentar:</strong> ${safeReviewNote}</p>` : ''}
      <p>Om ni vill kan ni återkomma med uppdaterade uppgifter längre fram.</p>
    `,
    text: [
      `Hej ${input.contactName ?? 'er'},`,
      `Er intresseanmälan för ${input.brfName} har behandlats, men går inte vidare i nuläget.`,
      input.reviewNote ? `Kommentar: ${input.reviewNote}` : null,
      'Om ni vill kan ni återkomma med uppdaterade uppgifter längre fram.',
    ]
      .filter(Boolean)
      .join('\n'),
  })
}

function mapRequestRow(row: BrfRequestRow): BrfRequestListItem {
  return {
    id: row.id,
    name: row.name,
    orgNumber: row.org_number,
    address: row.address,
    contactName: row.contact_name,
    contactEmail: row.contact_email,
    contactPhone: row.contact_phone,
    message: row.message,
    status: row.status,
    reviewNote: row.review_note,
    reviewedAt: row.reviewed_at,
    approvedBrfId: row.approved_brf_id,
    createdAt: row.created_at,
  }
}

export async function createBrfRequest(input: CreateBrfRequestInput): Promise<CreateBrfRequestResult> {
  const origin = normalizeText(input.origin)
  const admin = createSupabaseAdminClient() as unknown as SupabaseAdminClient
  const name = normalizeText(input.name)
  const orgNumber = normalizeText(input.orgNumber)
  const address = normalizeText(input.address)
  const contactName = normalizeText(input.contactName)
  const contactEmail = normalizeEmail(input.contactEmail)
  const contactPhone = normalizeText(input.contactPhone)
  const message = normalizeText(input.message)

  if (!name) throw new Error('BRF_NAME_REQUIRED')
  assertValidOrgNumber(orgNumber, 'ORG_NUMBER_INVALID')
  if (!contactName) throw new Error('CONTACT_NAME_REQUIRED')
  assertValidEmail(contactEmail, 'CONTACT_EMAIL_INVALID')

  const { data, error } = await admin
    .from('brf_requests')
    .insert({
      name,
      org_number: orgNumber,
      address,
      contact_name: contactName,
      contact_email: contactEmail,
      contact_phone: contactPhone,
      message,
      status: 'pending',
    })
    .select('id,status')
    .single()

  if (error || !data) {
    throw new Error(error?.message ?? 'Kunde inte skapa BRF-intresseanmälan.')
  }

  const receipt = await sendBrfRequestReceiptEmail({
    origin: origin ?? process.env.NEXT_PUBLIC_SITE_URL ?? 'https://hushub.se',
    brfName: name as string,
    contactName,
    contactEmail,
  })

  return {
    id: String(data.id ?? ''),
    status: 'pending',
    receipt,
  }
}

export async function listBrfRequests(): Promise<BrfRequestListItem[]> {
  await requireInternalAdminContext()
  const admin = createSupabaseAdminClient() as unknown as SupabaseAdminClient

  const { data, error } = await admin
    .from('brf_requests')
    .select(
      'id,name,org_number,address,contact_name,contact_email,contact_phone,message,status,review_note,reviewed_at,approved_brf_id,created_at'
    )
    .order('created_at', { ascending: false })

  if (error) {
    throw new Error(error.message ?? 'Kunde inte läsa BRF-intresseanmälningar.')
  }

  return ((data ?? []) as BrfRequestRow[]).map(mapRequestRow)
}

export async function createBrfWithInvite(
  input: AdminCreateBrfInput,
  origin: string
): Promise<AdminCreateBrfResult> {
  const context = await requireInternalAdminContext()
  const admin = createSupabaseAdminClient() as unknown as SupabaseAdminClient

  const name = normalizeText(input.name)
  const orgNumber = normalizeText(input.orgNumber)
  const address = normalizeText(input.address)
  const boardEmail = normalizeEmail(input.boardEmail)

  if (!name) throw new Error('BRF_NAME_REQUIRED')
  assertValidEmail(boardEmail, 'BOARD_EMAIL_INVALID')

  const slug = await createUniqueBrfSlug(admin, name)

  const { data: brfData, error: brfError } = await admin
    .from('brf_associations')
    .insert({
      name,
      slug,
      org_number: orgNumber,
      address,
      primary_contact_email: boardEmail,
      created_by: context.profile.id,
      is_public_apply_enabled: false,
    })
    .select(
      'id,name,slug,org_number,address,address_line_2,postal_code,city,email,phone,property_designation,invoice_address,invoice_email,invoice_reference,primary_contact_name,primary_contact_email,primary_contact_phone,unit_count,technical_contact,onboarding_comment,onboarding_completed_at,is_public_apply_enabled,is_public_apply_listed'
    )
    .single()

  if (brfError || !brfData) {
    throw new Error(brfError?.message ?? 'Kunde inte skapa BRF.')
  }

  const brf = brfData as BrfRow
  const invite = await createInviteRecord(admin, {
    brfId: brf.id,
    brfName: brf.name,
    email: boardEmail as string,
    fullName: null,
    role: 'board',
    createdBy: context.profile.id,
    origin,
  })

  return {
    brf: {
      id: brf.id,
      name: brf.name,
      slug: brf.slug,
    },
    invite,
  }
}

export async function reviewBrfRequest(
  requestId: string,
  input: ReviewBrfRequestInput,
  origin: string
): Promise<ReviewBrfRequestResult> {
  const context = await requireInternalAdminContext()
  const admin = createSupabaseAdminClient() as unknown as SupabaseAdminClient

  const reviewNote = normalizeText(input.reviewNote)
  const { data: requestData, error: requestError } = await admin
    .from('brf_requests')
    .select(
      'id,name,org_number,address,contact_name,contact_email,contact_phone,message,status,review_note,reviewed_at,approved_brf_id,created_at'
    )
    .eq('id', requestId)
    .maybeSingle()

  if (requestError) {
    throw new Error(requestError.message ?? 'Kunde inte läsa BRF-intresseanmälan.')
  }

  if (!requestData) {
    throw new Error('BRF_REQUEST_NOT_FOUND')
  }

  const requestRow = requestData as BrfRequestRow
  if (requestRow.status !== 'pending') {
    throw new Error('BRF_REQUEST_ALREADY_REVIEWED')
  }

  if (input.action === 'reject') {
    const { data: rejectedData, error: rejectError } = await admin
      .from('brf_requests')
      .update({
        status: 'rejected',
        review_note: reviewNote,
        reviewed_by: context.profile.id,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', requestId)
      .select(
        'id,name,org_number,address,contact_name,contact_email,contact_phone,message,status,review_note,reviewed_at,approved_brf_id,created_at'
      )
      .single()

    if (rejectError || !rejectedData) {
      throw new Error(rejectError?.message ?? 'Kunde inte avslå BRF-intresseanmälan.')
    }

    const decisionEmail = await sendBrfRequestRejectedEmail({
      origin,
      brfName: requestRow.name,
      contactName: requestRow.contact_name,
      contactEmail: requestRow.contact_email,
      reviewNote,
    })

    return {
      request: mapRequestRow(rejectedData as BrfRequestRow),
      brf: null,
      invite: null,
      decisionEmail,
    }
  }

  const boardEmail = normalizeEmail(requestRow.contact_email)
  assertValidEmail(boardEmail, 'BOARD_EMAIL_INVALID')
  const slug = await createUniqueBrfSlug(admin, requestRow.name)

  const { data: brfData, error: brfError } = await admin
    .from('brf_associations')
    .insert({
      name: requestRow.name,
      slug,
      org_number: requestRow.org_number,
      address: requestRow.address,
      primary_contact_name: requestRow.contact_name,
      primary_contact_email: boardEmail,
      primary_contact_phone: normalizeText(requestRow.contact_phone),
      created_by: context.profile.id,
      is_public_apply_enabled: false,
    })
    .select(
      'id,name,slug,org_number,address,address_line_2,postal_code,city,email,phone,property_designation,invoice_address,invoice_email,invoice_reference,primary_contact_name,primary_contact_email,primary_contact_phone,unit_count,technical_contact,onboarding_comment,onboarding_completed_at,is_public_apply_enabled,is_public_apply_listed'
    )
    .single()

  if (brfError || !brfData) {
    throw new Error(brfError?.message ?? 'Kunde inte skapa BRF från intresseanmälan.')
  }

  const brf = brfData as BrfRow
  const invite = await createInviteRecord(admin, {
    brfId: brf.id,
    brfName: brf.name,
    email: boardEmail as string,
    fullName: requestRow.contact_name,
    role: 'board',
    createdBy: context.profile.id,
    origin,
    approvalContext: {
      contactName: requestRow.contact_name,
      reviewNote,
    },
  })

  const { data: approvedData, error: approveError } = await admin
    .from('brf_requests')
    .update({
      status: 'approved',
      review_note: reviewNote,
      reviewed_by: context.profile.id,
      reviewed_at: new Date().toISOString(),
      approved_brf_id: brf.id,
    })
    .eq('id', requestId)
    .select(
      'id,name,org_number,address,contact_name,contact_email,contact_phone,message,status,review_note,reviewed_at,approved_brf_id,created_at'
    )
    .single()

  if (approveError || !approvedData) {
    throw new Error(approveError?.message ?? 'Kunde inte uppdatera BRF-intresseanmälan.')
  }

  const decisionEmail = null

  return {
    request: mapRequestRow(approvedData as BrfRequestRow),
    brf: {
      id: brf.id,
      name: brf.name,
      slug: brf.slug,
    },
    invite,
    decisionEmail,
  }
}

export async function getBrfInviteByToken(token: string): Promise<RenoAppInvitePreview | null> {
  const admin = createSupabaseAdminClient() as unknown as SupabaseAdminClient
  const tokenHash = hashToken(token)

  const { data: inviteData, error: inviteError } = await admin
    .from('brf_member_invites')
    .select('id,brf_id,email,full_name,role,expires_at,accepted_at,revoked_at')
    .eq('token_hash', tokenHash)
    .maybeSingle()

  if (inviteError) {
    throw new Error(inviteError.message ?? 'Kunde inte läsa invite.')
  }

  if (!inviteData) {
    return null
  }

  const invite = inviteData as InviteRow
  const { data: brfData, error: brfError } = await admin
    .from('brf_associations')
    .select(
      'id,name,slug,org_number,address,address_line_2,postal_code,city,email,phone,property_designation,invoice_address,invoice_email,invoice_reference,primary_contact_name,primary_contact_email,primary_contact_phone,unit_count,technical_contact,onboarding_comment,onboarding_completed_at,is_public_apply_enabled,is_public_apply_listed'
    )
    .eq('id', invite.brf_id)
    .maybeSingle()

  if (brfError || !brfData) {
    throw new Error(brfError?.message ?? 'Kunde inte läsa BRF för invite.')
  }

  const userClient = createSupabaseServerClient()
  const {
    data: { user },
  } = await userClient.auth.getUser()

  const currentUserEmail = normalizeEmail(user?.email ?? null)
  const inviteEmail = normalizeEmail(invite.email)
  const now = Date.now()
  const state: RenoAppInvitePreview['state'] = invite.accepted_at
    ? 'accepted'
    : invite.revoked_at
      ? 'revoked'
      : new Date(invite.expires_at).getTime() < now
        ? 'expired'
        : 'open'

  return {
    mode: brfData.onboarding_completed_at ? 'member_invite' : 'brf_onboarding',
    state,
    invite: {
      email: invite.email,
      fullName: invite.full_name,
      role: 'board',
      expiresAt: invite.expires_at,
      acceptedAt: invite.accepted_at,
      revokedAt: invite.revoked_at,
    },
    brf: {
      id: String(brfData.id ?? ''),
      name: String(brfData.name ?? ''),
      slug: String(brfData.slug ?? ''),
      orgNumber: (brfData.org_number as string | null | undefined) ?? null,
      propertyDesignation: (brfData.property_designation as string | null | undefined) ?? null,
      address: (brfData.address as string | null | undefined) ?? null,
      addressLine2: (brfData.address_line_2 as string | null | undefined) ?? null,
      postalCode: (brfData.postal_code as string | null | undefined) ?? null,
      city: (brfData.city as string | null | undefined) ?? null,
      invoiceAddress: (brfData.invoice_address as string | null | undefined) ?? null,
      invoiceEmail: (brfData.invoice_email as string | null | undefined) ?? null,
      invoiceReference: (brfData.invoice_reference as string | null | undefined) ?? null,
      primaryContactName: (brfData.primary_contact_name as string | null | undefined) ?? null,
      primaryContactEmail: (brfData.primary_contact_email as string | null | undefined) ?? null,
      primaryContactPhone: (brfData.primary_contact_phone as string | null | undefined) ?? null,
      unitCount:
        typeof brfData.unit_count === 'number'
          ? brfData.unit_count
          : brfData.unit_count !== null && brfData.unit_count !== undefined
            ? Number(brfData.unit_count)
            : null,
      generalEmail: (brfData.email as string | null | undefined) ?? null,
      brfPhone: (brfData.phone as string | null | undefined) ?? null,
      technicalContact: (brfData.technical_contact as string | null | undefined) ?? null,
      onboardingComment: (brfData.onboarding_comment as string | null | undefined) ?? null,
      onboardingCompletedAt: (brfData.onboarding_completed_at as string | null | undefined) ?? null,
      isPublicApplyEnabled: Boolean(brfData.is_public_apply_enabled),
      isPublicApplyListed: Boolean(brfData.is_public_apply_listed),
    },
    currentUser: {
      email: currentUserEmail,
      matchesInvite: currentUserEmail !== null && currentUserEmail === inviteEmail,
    },
  }
}

export async function acceptBrfInvite(
  token: string,
  input: AcceptBrfInviteInput
): Promise<AcceptBrfInviteResult> {
  const admin = createSupabaseAdminClient() as unknown as SupabaseAdminClient
  const tokenHash = hashToken(token)
  const origin = normalizeText(input.origin) ?? process.env.NEXT_PUBLIC_SITE_URL ?? 'https://hushub.se'

  const { data: inviteData, error: inviteError } = await admin
    .from('brf_member_invites')
    .select('id,brf_id,email,full_name,role,expires_at,accepted_at,revoked_at')
    .eq('token_hash', tokenHash)
    .maybeSingle()

  if (inviteError) {
    throw new Error(inviteError.message ?? 'Kunde inte läsa invite.')
  }

  if (!inviteData) {
    throw new Error('INVITE_NOT_FOUND')
  }

  const invite = inviteData as InviteRow
  if (invite.accepted_at) throw new Error('INVITE_ALREADY_ACCEPTED')
  if (invite.revoked_at) throw new Error('INVITE_REVOKED')
  if (new Date(invite.expires_at).getTime() < Date.now()) throw new Error('INVITE_EXPIRED')

  const inviteEmail = normalizeEmail(invite.email)
  assertValidEmail(inviteEmail, 'INVITE_EMAIL_INVALID')
  const inviteUserName = normalizeText(input.inviteUserName) ?? normalizeText(invite.full_name)
  if (!inviteUserName) throw new Error('INVITE_USER_NAME_REQUIRED')
  const acceptedAt = new Date().toISOString()

  const userClient = createSupabaseServerClient()
  const {
    data: { user },
  } = await userClient.auth.getUser()

  const { data: brfStateData, error: brfStateError } = await admin
    .from('brf_associations')
    .select('onboarding_completed_at,name')
    .eq('id', invite.brf_id)
    .maybeSingle()

  if (brfStateError || !brfStateData) {
    throw new Error(brfStateError?.message ?? 'Kunde inte läsa BRF-status för inviten.')
  }

  const resolvedInviteMode: AcceptBrfInviteResult['mode'] = brfStateData.onboarding_completed_at
    ? 'member_invite'
    : 'brf_onboarding'

  const termsVersion = normalizeText(input.termsVersion)
  if (resolvedInviteMode === 'brf_onboarding') {
    if (input.termsAccepted !== true) {
      throw new Error('TERMS_NOT_ACCEPTED')
    }
    if (!termsVersion) {
      throw new Error('TERMS_VERSION_REQUIRED')
    }
    if (termsVersion !== RENOAPP_BRF_TERMS_VERSION) {
      throw new Error('TERMS_VERSION_MISMATCH')
    }
  }

  const persistBrfCompletion = async (acceptedByProfileId: string) => {
    const { error: updateBrfError } = await admin
      .from('brf_associations')
      .update({
        name: completion.name,
        org_number: completion.orgNumber,
        property_designation: completion.propertyDesignation,
        address: completion.address,
        address_line_2: completion.addressLine2,
        postal_code: completion.postalCode,
        city: completion.city,
        invoice_address: completion.invoiceAddress,
        invoice_email: completion.invoiceEmail,
        invoice_reference: completion.invoiceReference,
        primary_contact_name: completion.primaryContactName,
        primary_contact_email: completion.primaryContactEmail,
        primary_contact_phone: completion.primaryContactPhone,
        unit_count: completion.unitCount,
        email: completion.generalEmail,
        phone: completion.brfPhone ?? completion.primaryContactPhone,
        technical_contact: completion.technicalContact,
        onboarding_comment: completion.onboardingComment,
        is_public_apply_enabled: true,
        is_public_apply_listed: completion.publicApplyMode === 'listed',
        onboarding_completed_at: acceptedAt,
        onboarding_terms_version: termsVersion,
        onboarding_terms_accepted_at: acceptedAt,
        onboarding_terms_accepted_by: acceptedByProfileId,
      })
      .eq('id', invite.brf_id)

    if (updateBrfError) {
      throw new Error(updateBrfError.message ?? 'Kunde inte spara BRF-uppgifter.')
    }
  }

  const markInviteAccepted = async () => {
    const { error: updateInviteError } = await admin
      .from('brf_member_invites')
      .update({ accepted_at: acceptedAt })
      .eq('id', invite.id)

    if (updateInviteError) {
      throw new Error(updateInviteError.message ?? 'Kunde inte markera invite som accepterad.')
    }
  }

  const acceptMemberInviteForUser = async (profileId: string, email: string | null, fullName: string) => {
    await ensureProfile(admin, {
      userId: profileId,
      email,
      fullName,
    })
    await ensureBrfMember(admin, {
      brfId: invite.brf_id,
      profileId,
      role: 'board',
    })
    await markInviteAccepted()
  }

  if (resolvedInviteMode === 'member_invite') {
    if (user) {
      const currentUserEmail = normalizeEmail(user.email ?? null)
      if (currentUserEmail !== inviteEmail) {
        throw new Error('INVITE_EMAIL_MISMATCH')
      }

      await acceptMemberInviteForUser(
        user.id,
        currentUserEmail,
        normalizeText(typeof user.user_metadata?.full_name === 'string' ? user.user_metadata.full_name : inviteUserName) ??
          inviteUserName
      )

      return {
        accepted: true,
        signedInViaExistingSession: true,
        createdUser: false,
        signInEmail: invite.email,
        additionalInvitesCreated: 0,
        mode: resolvedInviteMode,
      }
    }

    const fullName = inviteUserName
    const password = String(input.password ?? '')

    if (!fullName) throw new Error('FULL_NAME_REQUIRED')
    if (password.length < MIN_PASSWORD_LENGTH) throw new Error('PASSWORD_TOO_SHORT')

    const createUserResult = await admin.auth.admin.createUser({
      email: invite.email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: fullName,
      },
    })

    if (createUserResult.error) {
      const message = createUserResult.error.message ?? 'Kunde inte skapa användare.'
      if (message.toLowerCase().includes('already') || message.toLowerCase().includes('registered')) {
        throw new Error('EXISTING_USER_LOGIN_REQUIRED')
      }
      throw new Error(message)
    }

    const createdUser = createUserResult.data.user
    if (!createdUser) {
      throw new Error('Kunde inte skapa användare.')
    }

    await acceptMemberInviteForUser(
      createdUser.id,
      normalizeEmail(createdUser.email ?? invite.email),
      fullName
    )

    return {
      accepted: true,
      signedInViaExistingSession: false,
      createdUser: true,
      signInEmail: invite.email,
      additionalInvitesCreated: 0,
      mode: resolvedInviteMode,
    }
  }

  const completion = prepareBrfCompletionInput(input)
  const additionalUsers = prepareAdditionalInviteUsers(input.additionalUsers, inviteEmail as string)

  if (user) {
    const currentUserEmail = normalizeEmail(user.email ?? null)
    if (currentUserEmail !== inviteEmail) {
      throw new Error('INVITE_EMAIL_MISMATCH')
    }

    await ensureProfile(admin, {
      userId: user.id,
      email: currentUserEmail,
      fullName: normalizeText(
        typeof user.user_metadata?.full_name === 'string'
          ? user.user_metadata.full_name
          : inviteUserName
      ),
    })
    await ensureBrfMember(admin, {
      brfId: invite.brf_id,
      profileId: user.id,
      role: 'board',
    })
    await persistBrfCompletion(user.id)
    await markInviteAccepted()

    for (const additionalUser of additionalUsers) {
      await createInviteRecord(admin, {
        brfId: invite.brf_id,
        brfName: completion.name,
        email: additionalUser.email,
        fullName: additionalUser.fullName,
        role: 'board',
        createdBy: user.id,
        origin,
      })
    }

    return {
      accepted: true,
      signedInViaExistingSession: true,
      createdUser: false,
      signInEmail: invite.email,
      additionalInvitesCreated: additionalUsers.length,
      mode: resolvedInviteMode,
    }
  }

  const fullName = inviteUserName
  const password = String(input.password ?? '')

  if (!fullName) throw new Error('FULL_NAME_REQUIRED')
  if (password.length < MIN_PASSWORD_LENGTH) throw new Error('PASSWORD_TOO_SHORT')

  const createUserResult = await admin.auth.admin.createUser({
    email: invite.email,
    password,
    email_confirm: true,
    user_metadata: {
      full_name: fullName,
    },
  })

  if (createUserResult.error) {
    const message = createUserResult.error.message ?? 'Kunde inte skapa användare.'
    if (message.toLowerCase().includes('already') || message.toLowerCase().includes('registered')) {
      throw new Error('EXISTING_USER_LOGIN_REQUIRED')
    }
    throw new Error(message)
  }

  const createdUser = createUserResult.data.user
  if (!createdUser) {
    throw new Error('Kunde inte skapa användare.')
  }

  await ensureProfile(admin, {
    userId: createdUser.id,
    email: normalizeEmail(createdUser.email ?? invite.email),
    fullName,
  })
  await ensureBrfMember(admin, {
    brfId: invite.brf_id,
    profileId: createdUser.id,
    role: 'board',
  })
  await persistBrfCompletion(createdUser.id)
  await markInviteAccepted()

  for (const additionalUser of additionalUsers) {
    await createInviteRecord(admin, {
      brfId: invite.brf_id,
      brfName: completion.name,
      email: additionalUser.email,
      fullName: additionalUser.fullName,
      role: 'board',
      createdBy: createdUser.id,
      origin,
    })
  }

  return {
    accepted: true,
    signedInViaExistingSession: false,
    createdUser: true,
    signInEmail: invite.email,
    additionalInvitesCreated: additionalUsers.length,
    mode: resolvedInviteMode,
  }
}
