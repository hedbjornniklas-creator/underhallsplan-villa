import crypto from 'node:crypto'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { sendAssignmentEmail } from '@/lib/assignments/mailer'
import { RENOAPP_BRF_TERMS_VERSION } from '@/lib/renoapp/brfTerms'
import { requireBrfAdminContext } from '@/lib/renoapp/brfAdminAccess'
import { normalizeBrfOrgNumber } from '@/lib/renoapp/brfLifecycle'

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const ORG_NUMBER_REGEX = /^\d{6}-\d{4}$/
const POSTAL_CODE_REGEX = /^\d{3}\s\d{2}$/
const INVITE_TTL_HOURS = 24 * 7
const MIN_PASSWORD_LENGTH = 8
const BRF_REQUEST_ADMIN_NOTIFICATION_EMAIL = 'jn@hedbjorn.se'

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
  rpc: (name: string, args: Record<string, unknown>) => SupabaseResponse<Record<string, unknown>>
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
  external_message: string | null
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
  externalMessage: string | null
  reviewedAt: string | null
  approvedBrfId: string | null
  createdAt: string
}

export type AdminCreateBrfInput = {
  creationKey: string
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
    id: string
    email: string
    role: 'board'
    expiresAt: string
    inviteUrl: string
    emailSent: boolean
    emailError: string | null
  } | null
}

export type ReviewBrfRequestInput = {
  action: 'approve' | 'reject'
  reviewNote?: string | null
  externalMessage?: string | null
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
  brfId: string
  additionalInviteWarnings: string[]
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
  return requireBrfAdminContext()
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
    existingInvite?: { id: string; token: string; expiresAt: string }
    replace?: boolean
    approvalContext?: {
      contactName: string | null
      externalMessage: string | null
    } | null
  }
): Promise<NonNullable<AdminCreateBrfResult['invite']>> {
  const token = input.existingInvite?.token ?? makeToken()
  const tokenHash = hashToken(token)
  const expiresAt = input.existingInvite?.expiresAt ?? new Date(Date.now() + INVITE_TTL_HOURS * 60 * 60 * 1000).toISOString()
  let inviteId = input.existingInvite?.id
  if (!inviteId) {
    const { data, error } = await admin.rpc('renoapp_issue_brf_invite', {
      p_actor: input.createdBy, p_brf_id: input.brfId, p_email: input.email,
      p_full_name: normalizeText(input.fullName), p_token_hash: tokenHash,
      p_expires_at: expiresAt, p_replace: input.replace === true,
    })
    if (error || !data) throw new Error(error?.message ?? 'Kunde inte skapa inbjudan.')
    inviteId = String(data)
  }

  const inviteUrl = buildAbsoluteUrl(input.origin, `/renoapp/invite/${token}`)
  const mailFrom = getMailFromAddress()
  let emailSent = false
  let emailError: string | null = null

  if (mailFrom) {
    try {
      const safeBrfName = escapeHtml(input.brfName)
      const safeReviewNote = input.approvalContext?.externalMessage
        ? escapeHtml(input.approvalContext.externalMessage)
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
            input.approvalContext?.externalMessage ? `Kommentar: ${input.approvalContext.externalMessage}` : null,
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

  const { error: deliveryError } = await admin.from('brf_member_invites').update({
    delivery_status: emailSent ? 'sent' : 'failed',
    delivery_error: emailError,
    sent_at: emailSent ? new Date().toISOString() : null,
  }).eq('id', inviteId)
  if (deliveryError) throw new Error('Inbjudan skapades, men leveransstatus kunde inte sparas. Kontrollera föreningens inbjudningar.')

  return {
    id: inviteId,
    email: input.email,
    role: 'board',
    expiresAt,
    inviteUrl,
    emailSent,
    emailError,
  }
}

export async function issueBrfInviteForAuthorizedUser(input: {
  brfId: string; email: string; fullName: string | null; actorId: string; origin: string; replace?: boolean
}) {
  const admin = createSupabaseAdminClient() as unknown as SupabaseAdminClient
  const email = normalizeEmail(input.email)
  assertValidEmail(email, 'EMAIL_INVALID')
  const { data: brf, error } = await admin.from('brf_associations').select('id,name').eq('id', input.brfId).maybeSingle()
  if (error || !brf) throw new Error(error?.message ?? 'BRF_NOT_FOUND')
  return createInviteRecord(admin, {
    brfId: input.brfId, brfName: String(brf.name), email: email as string, fullName: input.fullName,
    role: 'board', createdBy: input.actorId, origin: input.origin, replace: input.replace,
  })
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

async function sendBrfRequestAdminNotificationEmail(input: {
  origin: string
  brfName: string
  orgNumber: string | null
  address: string | null
  contactName: string | null
  contactEmail: string | null
  contactPhone: string | null
  message: string | null
}) {
  const safeBrfName = escapeHtml(input.brfName)
  const safeOrgNumber = escapeHtml(input.orgNumber ?? 'Ej angivet')
  const safeAddress = escapeHtml(input.address ?? 'Ej angiven')
  const safeContactName = escapeHtml(input.contactName ?? 'Ej angiven')
  const safeContactEmail = escapeHtml(input.contactEmail ?? 'Ej angiven')
  const safeContactPhone = escapeHtml(input.contactPhone ?? 'Ej angivet')
  const safeMessage = escapeHtml(input.message ?? 'Inget meddelande')
  const reviewUrl = buildAbsoluteUrl(input.origin, '/admin/renoapp/brf-requests')

  return sendRenoAppEmail({
    to: BRF_REQUEST_ADMIN_NOTIFICATION_EMAIL,
    origin: input.origin,
    subject: `Ny BRF-ansökan: ${input.brfName}`,
    htmlBody: `
      <p>En ny BRF-ansökan har kommit in i RenoApp.</p>
      <p><strong>BRF:</strong> ${safeBrfName}</p>
      <p><strong>Organisationsnummer:</strong> ${safeOrgNumber}</p>
      <p><strong>Adress:</strong> ${safeAddress}</p>
      <p><strong>Kontaktperson:</strong> ${safeContactName}</p>
      <p><strong>E-post:</strong> ${safeContactEmail}</p>
      <p><strong>Telefon:</strong> ${safeContactPhone}</p>
      <p><strong>Meddelande:</strong> ${safeMessage}</p>
      <p><a href="${reviewUrl}">Öppna BRF-ansökningar</a></p>
    `,
    text: [
      'En ny BRF-ansökan har kommit in i RenoApp.',
      `BRF: ${input.brfName}`,
      `Organisationsnummer: ${input.orgNumber ?? 'Ej angivet'}`,
      `Adress: ${input.address ?? 'Ej angiven'}`,
      `Kontaktperson: ${input.contactName ?? 'Ej angiven'}`,
      `E-post: ${input.contactEmail ?? 'Ej angiven'}`,
      `Telefon: ${input.contactPhone ?? 'Ej angivet'}`,
      `Meddelande: ${input.message ?? 'Inget meddelande'}`,
      `Öppna BRF-ansökningar: ${reviewUrl}`,
    ].join('\n'),
  })
}

async function sendBrfRequestRejectedEmail(input: {
  origin: string
  brfName: string
  contactName: string | null
  contactEmail: string | null
  externalMessage: string | null
}) {
  const safeBrfName = escapeHtml(input.brfName)
  const safeContactName = escapeHtml(input.contactName ?? 'er')
  const safeReviewNote = input.externalMessage ? escapeHtml(input.externalMessage) : null

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
      input.externalMessage ? `Kommentar: ${input.externalMessage}` : null,
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
    externalMessage: row.external_message,
    reviewedAt: row.reviewed_at,
    approvedBrfId: row.approved_brf_id,
    createdAt: row.created_at,
  }
}

export async function createBrfRequest(input: CreateBrfRequestInput): Promise<CreateBrfRequestResult> {
  const origin = normalizeText(input.origin)
  const admin = createSupabaseAdminClient() as unknown as SupabaseAdminClient
  const name = normalizeText(input.name)
  const orgNumber = normalizeText(normalizeBrfOrgNumber(input.orgNumber ?? ''))
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

  await sendBrfRequestAdminNotificationEmail({
    origin: origin ?? process.env.NEXT_PUBLIC_SITE_URL ?? 'https://hushub.se',
    brfName: name as string,
    orgNumber,
    address,
    contactName,
    contactEmail,
    contactPhone,
    message,
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
      'id,name,org_number,address,contact_name,contact_email,contact_phone,message,status,review_note,external_message,reviewed_at,approved_brf_id,created_at'
    )
    .order('created_at', { ascending: false })

  if (error) {
    throw new Error(error.message ?? 'Kunde inte läsa BRF-intresseanmälningar.')
  }

  return ((data ?? []) as BrfRequestRow[]).map(mapRequestRow)
}

export async function createBrfWithInvite(input: AdminCreateBrfInput, origin: string): Promise<AdminCreateBrfResult> {
  const context = await requireInternalAdminContext()
  const admin = createSupabaseAdminClient() as unknown as SupabaseAdminClient
  const name = normalizeText(input.name)
  const orgNumber = normalizeText(normalizeBrfOrgNumber(input.orgNumber ?? ''))
  const email = normalizeEmail(input.boardEmail)
  if (!name) throw new Error('BRF_NAME_REQUIRED')
  assertValidOrgNumber(orgNumber, 'ORG_NUMBER_INVALID')
  assertValidEmail(email, 'BOARD_EMAIL_INVALID')
  if (!/^[0-9a-f-]{36}$/i.test(input.creationKey)) throw new Error('CREATION_KEY_REQUIRED')
  const token = makeToken()
  const expiresAt = new Date(Date.now() + INVITE_TTL_HOURS * 3600000).toISOString()
  const { data, error } = await admin.rpc('renoapp_start_brf_onboarding', {
    p_actor: context.userId, p_creation_key: input.creationKey,
    p_input: { name, orgNumber, email, address: normalizeText(input.address), slug: slugify(name) },
    p_token_hash: hashToken(token), p_expires_at: expiresAt,
  })
  if (error || !data) throw new Error(error?.message ?? 'Kunde inte skapa BRF.')
  const brf = data.brf as BrfRow
  const invite = data.reused ? null : await createInviteRecord(admin, {
    brfId: brf.id, brfName: brf.name, email: email as string, role: 'board',
    createdBy: context.userId, origin,
    existingInvite: { id: String(data.inviteId), token, expiresAt },
  })
  return { brf: { id: brf.id, name: brf.name, slug: brf.slug }, invite }
}

export async function reviewBrfRequest(requestId: string, input: ReviewBrfRequestInput, origin: string): Promise<ReviewBrfRequestResult> {
  const context = await requireInternalAdminContext()
  const admin = createSupabaseAdminClient() as unknown as SupabaseAdminClient
  const { data: request, error: requestError } = await admin.from('brf_requests').select('name,status').eq('id', requestId).maybeSingle()
  if (requestError) throw new Error(requestError.message)
  if (!request) throw new Error('BRF_REQUEST_NOT_FOUND')
  const token = makeToken()
  const expiresAt = new Date(Date.now() + INVITE_TTL_HOURS * 3600000).toISOString()
  const externalMessage = input.action === 'approve' && request.status === 'rejected'
    ? null
    : normalizeText(input.externalMessage)
  const { data, error } = await admin.rpc('renoapp_start_brf_onboarding', {
    p_actor: context.userId, p_request_id: requestId,
    p_input: { decision: input.action === 'approve' ? 'approved' : 'rejected',
      internalNote: normalizeText(input.reviewNote), externalMessage, slug: slugify(String(request.name)) },
    p_token_hash: hashToken(token), p_expires_at: expiresAt,
  })
  if (error || !data) throw new Error(error?.message ?? 'Kunde inte hantera intresseanmälan.')
  const row = data.request as BrfRequestRow
  const brf = data.brf as BrfRow | null
  let invite: AdminCreateBrfResult['invite'] = null
  let decisionEmail: ReviewBrfRequestResult['decisionEmail'] = null
  if (!data.reused && brf) {
    invite = await createInviteRecord(admin, {
      brfId: brf.id, brfName: brf.name, email: row.contact_email, fullName: row.contact_name,
      role: 'board', createdBy: context.userId, origin,
      existingInvite: { id: String(data.inviteId), token, expiresAt },
      approvalContext: { contactName: row.contact_name, externalMessage },
    })
  } else if (!data.reused && row.status === 'rejected') {
    decisionEmail = await sendBrfRequestRejectedEmail({
      origin, brfName: row.name, contactName: row.contact_name, contactEmail: row.contact_email, externalMessage,
    })
    const { error: eventError } = await admin.from('renoapp_brf_events').insert({
      request_id: row.id, actor_profile_id: context.userId, kind: 'decision_delivery', details: decisionEmail,
    })
    if (eventError) throw new Error('Beslutet sparades men mejlets leveransstatus kunde inte sparas.')
  }
  return { request: mapRequestRow(row), brf: brf ? { id: brf.id, name: brf.name, slug: brf.slug } : null, invite, decisionEmail }
}

export async function resendBrfRequestDecision(requestId: string, origin: string): Promise<ReviewBrfRequestResult> {
  const context = await requireInternalAdminContext()
  const admin = createSupabaseAdminClient() as unknown as SupabaseAdminClient
  const { data, error } = await admin.from('brf_requests').select('*').eq('id', requestId).maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) throw new Error('BRF_REQUEST_NOT_FOUND')
  const row = data as BrfRequestRow
  if (row.status !== 'rejected') throw new Error('INVALID_ACTION')
  const decisionEmail = await sendBrfRequestRejectedEmail({
    origin, brfName: row.name, contactName: row.contact_name, contactEmail: row.contact_email,
    externalMessage: row.external_message,
  })
  const { error: eventError } = await admin.from('renoapp_brf_events').insert({
    request_id: row.id, actor_profile_id: context.userId, kind: 'decision_delivery', details: decisionEmail,
  })
  if (eventError) throw new Error('Mejlets leveransstatus kunde inte sparas.')
  return { request: mapRequestRow(row), brf: null, invite: null, decisionEmail }
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

  const visibleBrf: Record<string, unknown> = state === 'open' ? brfData : {
    id: brfData.id, name: brfData.name, slug: brfData.slug, onboarding_completed_at: brfData.onboarding_completed_at,
  }
  return {
    mode: visibleBrf.onboarding_completed_at ? 'member_invite' : 'brf_onboarding',
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
      id: String(visibleBrf.id ?? ''),
      name: String(visibleBrf.name ?? ''),
      slug: String(visibleBrf.slug ?? ''),
      orgNumber: (visibleBrf.org_number as string | null | undefined) ?? null,
      propertyDesignation: (visibleBrf.property_designation as string | null | undefined) ?? null,
      address: (visibleBrf.address as string | null | undefined) ?? null,
      addressLine2: (visibleBrf.address_line_2 as string | null | undefined) ?? null,
      postalCode: (visibleBrf.postal_code as string | null | undefined) ?? null,
      city: (visibleBrf.city as string | null | undefined) ?? null,
      invoiceAddress: (visibleBrf.invoice_address as string | null | undefined) ?? null,
      invoiceEmail: (visibleBrf.invoice_email as string | null | undefined) ?? null,
      invoiceReference: (visibleBrf.invoice_reference as string | null | undefined) ?? null,
      primaryContactName: (visibleBrf.primary_contact_name as string | null | undefined) ?? null,
      primaryContactEmail: (visibleBrf.primary_contact_email as string | null | undefined) ?? null,
      primaryContactPhone: (visibleBrf.primary_contact_phone as string | null | undefined) ?? null,
      unitCount:
        typeof visibleBrf.unit_count === 'number'
          ? visibleBrf.unit_count
          : visibleBrf.unit_count !== null && visibleBrf.unit_count !== undefined
            ? Number(visibleBrf.unit_count)
            : null,
      generalEmail: (visibleBrf.email as string | null | undefined) ?? null,
      brfPhone: (visibleBrf.phone as string | null | undefined) ?? null,
      technicalContact: (visibleBrf.technical_contact as string | null | undefined) ?? null,
      onboardingComment: (visibleBrf.onboarding_comment as string | null | undefined) ?? null,
      onboardingCompletedAt: (visibleBrf.onboarding_completed_at as string | null | undefined) ?? null,
      isPublicApplyEnabled: Boolean(visibleBrf.is_public_apply_enabled),
      isPublicApplyListed: Boolean(visibleBrf.is_public_apply_listed),
    },
    currentUser: {
      email: currentUserEmail,
      matchesInvite: currentUserEmail !== null && currentUserEmail === inviteEmail,
    },
  }
}

export async function acceptBrfInvite(token: string, input: AcceptBrfInviteInput): Promise<AcceptBrfInviteResult> {
  const admin = createSupabaseAdminClient() as unknown as SupabaseAdminClient
  const tokenHash = hashToken(token)
  const origin = normalizeText(input.origin) ?? process.env.NEXT_PUBLIC_SITE_URL ?? 'https://hushub.se'
  const preview = await getBrfInviteByToken(token)
  if (!preview) throw new Error('INVITE_NOT_FOUND')
  if (preview.state === 'revoked') throw new Error('INVITE_REVOKED')
  if (preview.state === 'expired') throw new Error('INVITE_EXPIRED')
  const { data: { user } } = await createSupabaseServerClient().auth.getUser()
  if (user && normalizeEmail(user.email) !== normalizeEmail(preview.invite.email)) throw new Error('INVITE_EMAIL_MISMATCH')
  if (preview.state === 'accepted') {
    if (!user) throw new Error('EXISTING_USER_LOGIN_REQUIRED')
    const { error } = await admin.rpc('renoapp_accept_brf_invite', { p_actor: user.id, p_token_hash: tokenHash })
    if (error) throw new Error(error.message)
    return { accepted: true, brfId: preview.brf.id, mode: preview.mode, createdUser: false,
      signInEmail: preview.invite.email, signedInViaExistingSession: true, additionalInvitesCreated: 0, additionalInviteWarnings: [] }
  }
  const fullName = normalizeText(input.inviteUserName) ?? normalizeText(preview.invite.fullName)
  if (!fullName) throw new Error('INVITE_USER_NAME_REQUIRED')
  let completion: PreparedBrfCompletionInput | null = null
  if (preview.mode === 'brf_onboarding') {
    if (input.termsAccepted !== true) throw new Error('TERMS_NOT_ACCEPTED')
    if (input.termsVersion !== RENOAPP_BRF_TERMS_VERSION) throw new Error('TERMS_VERSION_MISMATCH')
    completion = prepareBrfCompletionInput(input)
  }
  const additionalUsers = preview.mode === 'brf_onboarding'
    ? prepareAdditionalInviteUsers(input.additionalUsers, preview.invite.email) : []
  let userId = user?.id
  let createdUser = false
  if (!userId) {
    const password = String(input.password ?? '')
    if (password.length < MIN_PASSWORD_LENGTH) throw new Error('PASSWORD_TOO_SHORT')
    const result = await admin.auth.admin.createUser({
      email: preview.invite.email, password, email_confirm: true, user_metadata: { full_name: fullName },
    })
    if (result.error) {
      if (/already|registered/i.test(result.error.message ?? '')) throw new Error('EXISTING_USER_LOGIN_REQUIRED')
      throw new Error(result.error.message ?? 'Kunde inte skapa användare.')
    }
    if (!result.data.user) throw new Error('Kunde inte skapa användare.')
    userId = result.data.user.id
    createdUser = true
  }
  const profileName = normalizeText(typeof user?.user_metadata?.full_name === 'string' ? user.user_metadata.full_name : fullName) ?? fullName
  await ensureProfile(admin, { userId, email: preview.invite.email, fullName: profileName })
  const { data: acceptance, error } = await admin.rpc('renoapp_accept_brf_invite', {
    p_actor: userId, p_token_hash: tokenHash,
    p_completion: completion ? { ...completion, termsVersion: RENOAPP_BRF_TERMS_VERSION } : null,
  })
  if (error) throw new Error(error.message ?? 'Kunde inte acceptera inbjudan.')
  const additionalInviteWarnings: string[] = []
  let additionalInvitesCreated = 0
  if (!acceptance?.reused) for (const additionalUser of additionalUsers) {
    try {
      const invite = await createInviteRecord(admin, {
        brfId: preview.brf.id, brfName: completion?.name ?? preview.brf.name,
        email: additionalUser.email, fullName: additionalUser.fullName, role: 'board', createdBy: userId, origin,
      })
      additionalInvitesCreated += 1
      if (!invite.emailSent) additionalInviteWarnings.push(additionalUser.email + ': mejlet kunde inte skickas.')
    } catch {
      additionalInviteWarnings.push(additionalUser.email + ': inbjudan kunde inte skapas.')
    }
  }
  return { accepted: true, brfId: preview.brf.id, signedInViaExistingSession: Boolean(user), createdUser,
    signInEmail: preview.invite.email, additionalInvitesCreated, additionalInviteWarnings, mode: preview.mode }
}
