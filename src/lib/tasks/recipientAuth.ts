import 'server-only'

import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { createSupabaseServerClient } from '@/lib/supabase/server'
import { generateAssignmentToken, hashAssignmentToken } from '@/lib/assignments/tokens'
import { recipientTaskPath } from './recipientAuthPaths'

const ACTIVATION_LIFETIME_MS = 14 * 24 * 60 * 60 * 1000
const DIRECT_TASK_ACCESS_LIFETIME_MS = 180 * 24 * 60 * 60 * 1000
const MIN_PASSWORD_LENGTH = 8
const MAX_PASSWORD_LENGTH = 128
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

type RecipientIdentityStatus = 'dormant' | 'invited' | 'active' | 'disabled'

type RecipientIdentityRow = {
  id: string
  email: string
  email_normalized: string
  display_name: string | null
  auth_user_id: string | null
  status: RecipientIdentityStatus
}

type ActivationPreviewRow = {
  recipient_identity_id: string
  email: string
  display_name: string | null
  identity_status: RecipientIdentityStatus
  task_id: string
  has_account: boolean
  expires_at: string
}

type ActivationAcceptRow = {
  recipient_identity_id: string
  task_id: string
  contact_id: string
  identity_status: RecipientIdentityStatus
  already_consumed: boolean
}

type ActivationTokenRow = {
  id: string
  recipient_identity_id: string
}

type RecipientPortalGrantRow = {
  id: string
  recipient_identity_id: string
}

type DirectTaskAccessLinkRow = {
  id: string
}

export type RecipientActivationPreview = {
  recipientIdentityId: string
  email: string
  displayName: string
  status: RecipientIdentityStatus
  hasAccount: boolean
  expiresAt: string
  task: {
    id: string
    title: string
    organizationName: string
  }
  currentUser: {
    email: string | null
    matchesRecipient: boolean
    emailVerified: boolean
  }
}

type RecipientTaskEntryLinkBase = {
  recipientIdentityId: string
  recipientEmail: string
  deliveryKey: string
}

type RecipientPortalEntryLinkResult = RecipientTaskEntryLinkBase & {
  url: string
  mode: 'portal'
}

type RecipientActivationEntryLinkResult = RecipientTaskEntryLinkBase & {
  url: string
  mode: 'activation'
}

type RecipientActivationRequiredResult = RecipientTaskEntryLinkBase & {
  url: null
  mode: 'activation_required'
}

export type EnsureRecipientTaskEntryLinkResult =
  | RecipientPortalEntryLinkResult
  | RecipientActivationEntryLinkResult
  | RecipientActivationRequiredResult

type EnsureRecipientTaskEntryLinkInput = {
  contactId: string
  taskId: string
  baseUrl: string
  allowActivation?: boolean
}

function oneRpcRow<T>(data: unknown): T | null {
  if (Array.isArray(data)) return (data[0] as T | undefined) ?? null
  if (data && typeof data === 'object') return data as T
  return null
}

function normalizeEmail(value: unknown) {
  return typeof value === 'string' ? value.trim().toLocaleLowerCase('sv-SE') : ''
}

function cleanDisplayName(value: unknown) {
  if (typeof value !== 'string') return ''
  return value.replace(/\s+/g, ' ').trim().slice(0, 160)
}

function canonicalRecipientEmail(identity: Pick<RecipientIdentityRow, 'email' | 'email_normalized'>) {
  const email = normalizeEmail(identity.email_normalized)
  if (!email || email.length > 320 || email !== normalizeEmail(identity.email)) {
    throw new Error('TASK_RECIPIENT_IDENTITY_EMAIL_INVALID')
  }
  return email
}

function assertUuid(value: string, code: string) {
  if (!UUID_PATTERN.test(value)) throw new Error(code)
}

function activationHash(token: string) {
  if (!token || token.length < 32 || token.length > 512) throw new Error('TASK_RECIPIENT_ACTIVATION_INVALID')
  return hashAssignmentToken(token)
}

function absolutePortalUrl(baseUrl: string, path: string) {
  let base: URL
  try {
    base = new URL(baseUrl)
  } catch {
    throw new Error('INVALID_ENV:APP_BASE_URL')
  }
  if (base.protocol !== 'https:' && base.protocol !== 'http:') {
    throw new Error('INVALID_ENV:APP_BASE_URL')
  }
  return new URL(path, `${base.origin}/`).toString()
}

/**
 * Issues a new exact-task bearer credential without exposing its plaintext to
 * Postgres. The caller may pass the returned URL only to the delivery provider;
 * it must never be persisted, logged or returned through an internal API.
 */
export async function issueDirectTaskAccessLink(input: {
  taskId: string
  contactId: string
  createdByProfileId: string
  baseUrl: string
  issuedBySystem?: boolean
}) {
  assertUuid(input.taskId, 'TASK_RECIPIENT_TASK_INVALID')
  assertUuid(input.contactId, 'TASK_RECIPIENT_CONTACT_INVALID')
  assertUuid(input.createdByProfileId, 'TASK_ACCESS_CREATOR_INVALID')

  const token = generateAssignmentToken()
  const expiresAt = new Date(Date.now() + DIRECT_TASK_ACCESS_LIFETIME_MS).toISOString()
  const admin = createSupabaseAdminClient()
  const { data, error } = await admin.rpc('issue_task_bearer_access_link', {
    p_task_id: input.taskId,
    p_contact_id: input.contactId,
    p_token_hash: hashAssignmentToken(token),
    p_expires_at: expiresAt,
    p_created_by_profile_id: input.createdByProfileId,
    p_issued_by_system: input.issuedBySystem === true,
  })
  if (error) {
    if (
      error.code === 'PGRST202' ||
      error.message?.includes('issue_task_bearer_access_link')
    ) {
      throw new Error('TASKS_SCHEMA_REQUIRED')
    }
    const databaseCode = error.message?.match(/TASK_[A-Z0-9_]+/)?.[0]
    throw new Error(databaseCode ?? 'TASK_ACCESS_CREATE_FAILED')
  }

  const link = oneRpcRow<DirectTaskAccessLinkRow>(data)
  if (!link?.id) throw new Error('TASK_ACCESS_CREATE_FAILED')

  const { data: currentContact, error: contactError } = await admin
    .from('organization_contacts')
    .select('email,phone,whatsapp_number,recipient_identity_id')
    .eq('id', input.contactId)
    .eq('is_active', true)
    .maybeSingle()
  if (contactError || !currentContact) throw new Error('TASK_CONTACT_NOT_FOUND')

  const recipientEmail = normalizeEmail(currentContact.email) || null
  const recipientWhatsappNumber =
    (typeof currentContact.whatsapp_number === 'string' && currentContact.whatsapp_number.trim()) ||
    (typeof currentContact.phone === 'string' && currentContact.phone.trim()) ||
    null

  return {
    accessLinkId: link.id,
    url: absolutePortalUrl(input.baseUrl, `/signe/${encodeURIComponent(token)}`),
    deliveryKey: `bearer:${link.id}`,
    recipientEmail,
    recipientWhatsappNumber,
    recipientIdentityId:
      typeof currentContact.recipient_identity_id === 'string'
        ? currentContact.recipient_identity_id
        : null,
  }
}

async function ensureIdentityForContact(contactId: string) {
  const admin = createSupabaseAdminClient()
  const { data, error } = await admin.rpc('ensure_task_recipient_identity_for_contact', {
    p_contact_id: contactId,
  })
  if (error) {
    const databaseCode = error.message?.match(/TASK_RECIPIENT_[A-Z0-9_]+/)?.[0]
    throw new Error(databaseCode ?? 'TASK_RECIPIENT_IDENTITY_ENSURE_FAILED')
  }
  const identity = oneRpcRow<RecipientIdentityRow>(data)
  if (!identity?.id || !identity.email) throw new Error('TASK_RECIPIENT_IDENTITY_ENSURE_FAILED')
  return identity
}

async function requireRecipientIdentity(identityId: string) {
  assertUuid(identityId, 'TASK_RECIPIENT_IDENTITY_INVALID')
  const admin = createSupabaseAdminClient()
  const { data, error } = await admin
    .from('task_recipient_identities')
    .select('id,email,email_normalized,display_name,auth_user_id,status')
    .eq('id', identityId)
    .maybeSingle()
  if (error || !data) throw new Error('TASK_RECIPIENT_IDENTITY_READ_FAILED')
  const identity = data as RecipientIdentityRow
  canonicalRecipientEmail(identity)
  return identity
}

/**
 * Chooses the optional account link shown beside a direct task link. Active
 * recipients get an authenticated portal URL. Everyone else gets a newly
 * rotated, hash-only activation link; its plaintext only exists in this
 * process and the provider-bound notification URL.
 */
export function ensureRecipientTaskEntryLink(
  input: EnsureRecipientTaskEntryLinkInput & { allowActivation: false }
): Promise<RecipientPortalEntryLinkResult | RecipientActivationRequiredResult>
export function ensureRecipientTaskEntryLink(
  input: EnsureRecipientTaskEntryLinkInput & { allowActivation?: true }
): Promise<RecipientPortalEntryLinkResult | RecipientActivationEntryLinkResult>
export function ensureRecipientTaskEntryLink(
  input: EnsureRecipientTaskEntryLinkInput
): Promise<EnsureRecipientTaskEntryLinkResult>
export async function ensureRecipientTaskEntryLink(
  input: EnsureRecipientTaskEntryLinkInput
): Promise<EnsureRecipientTaskEntryLinkResult> {
  assertUuid(input.contactId, 'TASK_RECIPIENT_CONTACT_INVALID')
  assertUuid(input.taskId, 'TASK_RECIPIENT_TASK_INVALID')

  let identity = await ensureIdentityForContact(input.contactId)
  if (identity.status === 'disabled') throw new Error('TASK_RECIPIENT_IDENTITY_DISABLED')

  if (identity.status === 'active' && identity.auth_user_id) {
    const admin = createSupabaseAdminClient()
    const { data, error } = await admin.rpc('ensure_task_recipient_portal_grant', {
      p_contact_id: input.contactId,
      p_task_id: input.taskId,
    })
    const grant = oneRpcRow<RecipientPortalGrantRow>(data)
    if (error || !grant?.id || !grant.recipient_identity_id) {
      const databaseCode = error?.message?.match(/TASK_RECIPIENT_[A-Z0-9_]+/)?.[0]
      throw new Error(databaseCode ?? 'TASK_RECIPIENT_PORTAL_GRANT_FAILED')
    }
    const grantedIdentity = await requireRecipientIdentity(grant.recipient_identity_id)
    if (grantedIdentity.status === 'disabled') throw new Error('TASK_RECIPIENT_IDENTITY_DISABLED')
    if (grantedIdentity.status === 'active' && grantedIdentity.auth_user_id) {
      return {
        url: absolutePortalUrl(input.baseUrl, recipientTaskPath(input.taskId)),
        mode: 'portal',
        recipientIdentityId: grantedIdentity.id,
        recipientEmail: canonicalRecipientEmail(grantedIdentity),
        deliveryKey: `portal:${grant.id}`,
      }
    }
    identity = grantedIdentity
  }

  if (input.allowActivation === false) {
    return {
      url: null,
      mode: 'activation_required',
      recipientIdentityId: identity.id,
      recipientEmail: canonicalRecipientEmail(identity),
      deliveryKey: `activation-required:${identity.id}:${input.taskId}`,
    }
  }

  const token = generateAssignmentToken()
  const expiresAt = new Date(Date.now() + ACTIVATION_LIFETIME_MS).toISOString()
  const admin = createSupabaseAdminClient()
  const { data, error } = await admin.rpc('rotate_task_recipient_activation', {
    p_contact_id: input.contactId,
    p_task_id: input.taskId,
    p_token_hash: hashAssignmentToken(token),
    p_expires_at: expiresAt,
  })
  const activation = oneRpcRow<ActivationTokenRow>(data)
  if (error || !activation?.id || !activation.recipient_identity_id) {
    const databaseCode = error?.message?.match(/TASK_RECIPIENT_[A-Z0-9_]+/)?.[0]
    throw new Error(databaseCode ?? 'TASK_RECIPIENT_ACTIVATION_CREATE_FAILED')
  }
  const activationIdentity = await requireRecipientIdentity(activation.recipient_identity_id)
  if (activationIdentity.status === 'disabled') throw new Error('TASK_RECIPIENT_IDENTITY_DISABLED')

  return {
    url: absolutePortalUrl(input.baseUrl, `/mina-uppdrag/aktivera/${encodeURIComponent(token)}`),
    mode: 'activation',
    recipientIdentityId: activationIdentity.id,
    recipientEmail: canonicalRecipientEmail(activationIdentity),
    deliveryKey: `activation:${activation.id}`,
  }
}

export async function getRecipientActivationPreview(token: string): Promise<RecipientActivationPreview | null> {
  let tokenHash: string
  try {
    tokenHash = activationHash(token)
  } catch {
    return null
  }

  const admin = createSupabaseAdminClient()
  const { data, error } = await admin.rpc('preview_task_recipient_activation', {
    p_token_hash: tokenHash,
  })
  if (error) {
    if (error.message?.includes('TASK_RECIPIENT_ACTIVATION_INVALID')) return null
    throw new Error('TASK_RECIPIENT_ACTIVATION_READ_FAILED')
  }
  const activation = oneRpcRow<ActivationPreviewRow>(data)
  if (!activation) return null

  const { data: task, error: taskError } = await admin
    .from('operational_tasks')
    .select('id,title,org_id')
    .eq('id', activation.task_id)
    .is('archived_at', null)
    .maybeSingle()
  if (taskError) throw new Error('TASK_RECIPIENT_ACTIVATION_READ_FAILED')
  if (!task) return null

  const { data: organization, error: organizationError } = await admin
    .from('organizations')
    .select('name')
    .eq('id', String((task as { org_id: string }).org_id))
    .maybeSingle()
  if (organizationError) throw new Error('TASK_RECIPIENT_ACTIVATION_READ_FAILED')

  const serverClient = createSupabaseServerClient()
  const {
    data: { user },
  } = await serverClient.auth.getUser()
  const currentEmail = normalizeEmail(user?.email)
  const expectedEmail = normalizeEmail(activation.email)
  const emailVerified = Boolean(user && (user.email_confirmed_at || user.confirmed_at))

  return {
    recipientIdentityId: activation.recipient_identity_id,
    email: activation.email,
    displayName: activation.display_name?.trim() ?? '',
    status: activation.identity_status,
    hasAccount: Boolean(activation.has_account),
    expiresAt: activation.expires_at,
    task: {
      id: activation.task_id,
      title: String((task as { title: string }).title ?? 'Uppdrag'),
      organizationName: String((organization as { name?: string } | null)?.name ?? 'HusHub'),
    },
    currentUser: {
      email: user?.email ?? null,
      matchesRecipient: Boolean(currentEmail && currentEmail === expectedEmail),
      emailVerified,
    },
  }
}

async function acceptActivationToken(tokenHash: string, authUserId: string) {
  const admin = createSupabaseAdminClient()
  const { data, error } = await admin.rpc('accept_task_recipient_activation', {
    p_token_hash: tokenHash,
    p_auth_user_id: authUserId,
  })
  if (error) {
    const databaseCode = error.message?.match(/TASK_RECIPIENT_[A-Z0-9_]+/)?.[0]
    throw new Error(databaseCode ?? 'TASK_RECIPIENT_ACTIVATION_FAILED')
  }
  const accepted = oneRpcRow<ActivationAcceptRow>(data)
  if (!accepted?.recipient_identity_id || !accepted.task_id) {
    throw new Error('TASK_RECIPIENT_ACTIVATION_FAILED')
  }
  return accepted
}

export async function acceptRecipientActivation(input: {
  token: string
  password?: unknown
  displayName?: unknown
}) {
  const tokenHash = activationHash(input.token)
  const serverClient = createSupabaseServerClient()
  const {
    data: { user: signedInUser },
  } = await serverClient.auth.getUser()

  if (signedInUser) {
    if (!signedInUser.email_confirmed_at && !signedInUser.confirmed_at) {
      throw new Error('TASK_RECIPIENT_EMAIL_NOT_VERIFIED')
    }

    const accepted = await acceptActivationToken(tokenHash, signedInUser.id)
    const displayName = cleanDisplayName(input.displayName)
    if (displayName) {
      const admin = createSupabaseAdminClient()
      await admin
        .from('task_recipient_identities')
        .update({ display_name: displayName })
        .eq('id', accepted.recipient_identity_id)
    }
    return {
      activated: true,
      createdUser: false,
      signInEmail: signedInUser.email ?? '',
      recipientIdentityId: accepted.recipient_identity_id,
      destination: recipientTaskPath(accepted.task_id),
    }
  }

  const preview = await getRecipientActivationPreview(input.token)
  if (!preview) throw new Error('TASK_RECIPIENT_ACTIVATION_INVALID')
  const displayName = cleanDisplayName(input.displayName) || preview.displayName

  if (preview.hasAccount) throw new Error('TASK_RECIPIENT_ACCOUNT_LOGIN_REQUIRED')

  const password = typeof input.password === 'string' ? input.password : ''
  if (password.length < MIN_PASSWORD_LENGTH) throw new Error('TASK_RECIPIENT_PASSWORD_TOO_SHORT')
  if (password.length > MAX_PASSWORD_LENGTH) throw new Error('TASK_RECIPIENT_PASSWORD_TOO_LONG')

  const admin = createSupabaseAdminClient()
  const createResult = await admin.auth.admin.createUser({
    email: preview.email,
    password,
    email_confirm: true,
    user_metadata: {
      full_name: displayName || undefined,
      account_type: 'task_recipient',
    },
  })

  if (createResult.error || !createResult.data.user) {
    const message = createResult.error?.message?.toLocaleLowerCase('en-US') ?? ''
    if (message.includes('already') || message.includes('registered') || message.includes('exists')) {
      throw new Error('TASK_RECIPIENT_ACCOUNT_LOGIN_REQUIRED')
    }
    throw new Error('TASK_RECIPIENT_ACCOUNT_CREATE_FAILED')
  }

  const createdUser = createResult.data.user
  try {
    const accepted = await acceptActivationToken(tokenHash, createdUser.id)
    if (displayName) {
      await admin
        .from('task_recipient_identities')
        .update({ display_name: displayName })
        .eq('id', accepted.recipient_identity_id)
    }
    return {
      activated: true,
      createdUser: true,
      signInEmail: preview.email,
      recipientIdentityId: accepted.recipient_identity_id,
      destination: recipientTaskPath(accepted.task_id),
    }
  } catch {
    // Auth and Postgres cannot share a transaction, and a committed RPC may
    // still surface as a network error. Confirm the durable binding, but never
    // delete the Auth user when the database outcome is ambiguous.
    const [identityResult, grantResult] = await Promise.all([
      admin
        .from('task_recipient_identities')
        .select('id,auth_user_id,status')
        .eq('id', preview.recipientIdentityId)
        .maybeSingle(),
      admin
        .from('task_recipient_portal_grants')
        .select('id,contact_id,org_id')
        .eq('recipient_identity_id', preview.recipientIdentityId)
        .eq('task_id', preview.task.id)
        .is('revoked_at', null)
        .limit(1)
        .maybeSingle(),
    ])

    const identity = identityResult.data as {
      id: string
      auth_user_id: string | null
      status: RecipientIdentityStatus
    } | null
    const grant = grantResult.data as {
      id: string
      contact_id: string
      org_id: string
    } | null
    let taskIsCurrent = false
    let taskReadFailed = false
    if (!grantResult.error && grant) {
      const taskResult = await admin
        .from('operational_tasks')
        .select('id')
        .eq('id', preview.task.id)
        .eq('org_id', grant.org_id)
        .eq('assignee_contact_id', grant.contact_id)
        .is('archived_at', null)
        .maybeSingle()
      taskReadFailed = Boolean(taskResult.error)
      taskIsCurrent = !taskResult.error && Boolean(taskResult.data)
    }
    const bindingWasCommitted = Boolean(
      !identityResult.error &&
      !grantResult.error &&
      identity?.auth_user_id === createdUser.id &&
      identity.status === 'active' &&
      grant &&
      taskIsCurrent
    )

    if (bindingWasCommitted) {
      return {
        activated: true,
        createdUser: true,
        signInEmail: preview.email,
        recipientIdentityId: preview.recipientIdentityId,
        destination: recipientTaskPath(preview.task.id),
      }
    }

    console.error('[tasks.recipient.activation] activation outcome could not be confirmed', {
      recipientIdentityId: preview.recipientIdentityId,
      taskId: preview.task.id,
      identityReadFailed: Boolean(identityResult.error),
      grantReadFailed: Boolean(grantResult.error),
      taskReadFailed,
    })
    throw new Error('TASK_RECIPIENT_ACTIVATION_RECOVERY_REQUIRED')
  }
}
