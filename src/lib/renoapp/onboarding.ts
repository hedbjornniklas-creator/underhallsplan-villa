import crypto from 'node:crypto'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { sendAssignmentEmail } from '@/lib/assignments/mailer'

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const ORG_NUMBER_REGEX = /^\d{6}-\d{4}$/
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
  email: string | null
}

type InviteRow = {
  id: string
  brf_id: string
  email: string
  role: 'board' | 'admin'
  expires_at: string
  accepted_at: string | null
  revoked_at: string | null
}

export type CreateBrfRequestInput = {
  name: string
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
  boardFullName?: string | null
  role?: 'board' | 'admin'
}

export type AdminCreateBrfResult = {
  brf: {
    id: string
    name: string
    slug: string
  }
  invite: {
    email: string
    role: 'board' | 'admin'
    expiresAt: string
    inviteUrl: string
    emailSent: boolean
    emailError: string | null
  }
}

export type ReviewBrfRequestInput = {
  action: 'approve' | 'reject'
  reviewNote?: string | null
  boardEmail?: string | null
  boardFullName?: string | null
  role?: 'board' | 'admin'
}

export type ReviewBrfRequestResult = {
  request: BrfRequestListItem
  brf: {
    id: string
    name: string
    slug: string
  } | null
  invite: AdminCreateBrfResult['invite'] | null
}

export type RenoAppInvitePreview = {
  state: 'open' | 'expired' | 'revoked' | 'accepted'
  invite: {
    email: string
    role: 'board' | 'admin'
    expiresAt: string
    acceptedAt: string | null
    revokedAt: string | null
  }
  brf: {
    id: string
    name: string
    slug: string
  }
  currentUser: {
    email: string | null
    matchesInvite: boolean
  }
}

export type AcceptBrfInviteInput = {
  fullName?: string | null
  password?: string | null
}

export type AcceptBrfInviteResult = {
  accepted: true
  signedInViaExistingSession: boolean
  createdUser: boolean
  signInEmail: string
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

function assertValidOrgNumber(value: string | null, fieldName: string) {
  if (!value || !ORG_NUMBER_REGEX.test(value)) {
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
    role: 'board' | 'admin'
    createdBy: string
    origin: string
  }
) {
  const token = makeToken()
  const tokenHash = hashToken(token)
  const expiresAt = new Date(Date.now() + INVITE_TTL_HOURS * 60 * 60 * 1000).toISOString()

  const { error: insertError } = await admin.from('brf_member_invites').insert({
    brf_id: input.brfId,
    email: input.email,
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
      await sendAssignmentEmail({
        to: input.email,
        from: mailFrom,
        subject: `Inbjudan till RenoApp för ${input.brfName}`,
        html: `
          <p>Du har blivit inbjuden till RenoApp för <strong>${input.brfName}</strong>.</p>
          <p>Öppna länken nedan för att aktivera ditt styrelsekonto:</p>
          <p><a href="${inviteUrl}">${inviteUrl}</a></p>
          <p>Länken gäller till ${new Date(expiresAt).toLocaleString('sv-SE')}.</p>
        `,
        text: [
          `Du har blivit inbjuden till RenoApp för ${input.brfName}.`,
          `Öppna länken för att aktivera ditt konto: ${inviteUrl}`,
          `Länken gäller till ${new Date(expiresAt).toLocaleString('sv-SE')}.`,
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
    email: input.email,
    role: input.role,
    expiresAt,
    inviteUrl,
    emailSent,
    emailError,
  }
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

  return {
    id: String(data.id ?? ''),
    status: 'pending',
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
  const role = input.role ?? 'board'

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
      email: boardEmail,
      created_by: context.profile.id,
      is_public_apply_enabled: false,
    })
    .select('id,name,slug,org_number,address,email')
    .single()

  if (brfError || !brfData) {
    throw new Error(brfError?.message ?? 'Kunde inte skapa BRF.')
  }

  const brf = brfData as BrfRow
  const invite = await createInviteRecord(admin, {
    brfId: brf.id,
    brfName: brf.name,
    email: boardEmail as string,
    role,
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
  const role = input.role ?? 'board'
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

    return {
      request: mapRequestRow(rejectedData as BrfRequestRow),
      brf: null,
      invite: null,
    }
  }

  const boardEmail = normalizeEmail(input.boardEmail ?? requestRow.contact_email)
  assertValidEmail(boardEmail, 'BOARD_EMAIL_INVALID')
  const slug = await createUniqueBrfSlug(admin, requestRow.name)

  const { data: brfData, error: brfError } = await admin
    .from('brf_associations')
    .insert({
      name: requestRow.name,
      slug,
      org_number: requestRow.org_number,
      address: requestRow.address,
      email: boardEmail,
      created_by: context.profile.id,
      is_public_apply_enabled: false,
    })
    .select('id,name,slug,org_number,address,email')
    .single()

  if (brfError || !brfData) {
    throw new Error(brfError?.message ?? 'Kunde inte skapa BRF från intresseanmälan.')
  }

  const brf = brfData as BrfRow
  const invite = await createInviteRecord(admin, {
    brfId: brf.id,
    brfName: brf.name,
    email: boardEmail as string,
    role,
    createdBy: context.profile.id,
    origin,
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

  return {
    request: mapRequestRow(approvedData as BrfRequestRow),
    brf: {
      id: brf.id,
      name: brf.name,
      slug: brf.slug,
    },
    invite,
  }
}

export async function getBrfInviteByToken(token: string): Promise<RenoAppInvitePreview | null> {
  const admin = createSupabaseAdminClient() as unknown as SupabaseAdminClient
  const tokenHash = hashToken(token)

  const { data: inviteData, error: inviteError } = await admin
    .from('brf_member_invites')
    .select('id,brf_id,email,role,expires_at,accepted_at,revoked_at')
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
    .select('id,name,slug')
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
    state,
    invite: {
      email: invite.email,
      role: invite.role,
      expiresAt: invite.expires_at,
      acceptedAt: invite.accepted_at,
      revokedAt: invite.revoked_at,
    },
    brf: {
      id: String(brfData.id ?? ''),
      name: String(brfData.name ?? ''),
      slug: String(brfData.slug ?? ''),
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

  const { data: inviteData, error: inviteError } = await admin
    .from('brf_member_invites')
    .select('id,brf_id,email,role,expires_at,accepted_at,revoked_at')
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

  const userClient = createSupabaseServerClient()
  const {
    data: { user },
  } = await userClient.auth.getUser()

  if (user) {
    const currentUserEmail = normalizeEmail(user.email ?? null)
    if (currentUserEmail !== inviteEmail) {
      throw new Error('INVITE_EMAIL_MISMATCH')
    }

    await ensureProfile(admin, {
      userId: user.id,
      email: currentUserEmail,
      fullName: normalizeText(
        typeof user.user_metadata?.full_name === 'string' ? user.user_metadata.full_name : input.fullName
      ),
    })
    await ensureBrfMember(admin, {
      brfId: invite.brf_id,
      profileId: user.id,
      role: invite.role,
    })

    const { error: updateInviteError } = await admin
      .from('brf_member_invites')
      .update({ accepted_at: new Date().toISOString() })
      .eq('id', invite.id)

    if (updateInviteError) {
      throw new Error(updateInviteError.message ?? 'Kunde inte markera invite som accepterad.')
    }

    return {
      accepted: true,
      signedInViaExistingSession: true,
      createdUser: false,
      signInEmail: invite.email,
    }
  }

  const fullName = normalizeText(input.fullName)
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
    role: invite.role,
  })

  const { error: updateInviteError } = await admin
    .from('brf_member_invites')
    .update({ accepted_at: new Date().toISOString() })
    .eq('id', invite.id)

  if (updateInviteError) {
    throw new Error(updateInviteError.message ?? 'Kunde inte markera invite som accepterad.')
  }

  return {
    accepted: true,
    signedInViaExistingSession: false,
    createdUser: true,
    signInEmail: invite.email,
  }
}
