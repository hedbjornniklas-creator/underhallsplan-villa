import 'server-only'

import { createHmac, randomInt, randomUUID } from 'node:crypto'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { generateAssignmentToken, hashAssignmentToken } from '@/lib/assignments/tokens'
import { isAmbiguousTaskDeliveryError, sendTaskAccessLinkEmail } from './automation'
import { buildTaskEmailHtml } from './emailTemplates'
import { formatTaskDateTime } from './dateTime'
import { requireExternalTaskActor } from './external'
import { recipientTaskPath } from './recipientAuthPaths'

export const RECIPIENT_FIRST_LOGIN_COOKIE = 'hh_recipient_first_login'
export const RECIPIENT_FIRST_LOGIN_EXPIRES_IN_SECONDS = 10 * 60
export const RECIPIENT_FIRST_LOGIN_MAX_ATTEMPTS = 5

const MIN_PASSWORD_LENGTH = 8
const MAX_PASSWORD_LENGTH = 128
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const CODE_PATTERN = /^\d{6}$/

type BeginChallengeRow = {
  challenge_id: string
  recipient_identity_id: string
  recipient_email: string
  recipient_display_name: string
  expires_at: string
  max_attempts: number
}

type VerifyChallengeRow = {
  outcome: 'verified' | 'invalid' | 'expired' | 'locked'
  attempts_remaining: number
  expires_at: string
}

type ChallengeStatusRow = {
  phase: 'code' | 'password'
  recipient_email: string
  expires_at: string
  attempts_remaining: number | null
  max_attempts: number
  resend_after_seconds: number | null
  rotate_cookie_to_setup: boolean
}

type SetupPreviewRow = {
  recipient_identity_id: string
  recipient_email: string
  recipient_display_name: string
  contact_id: string
  task_id: string
  expires_at: string
  already_consumed: boolean
  recovery_auth_user_id: string | null
}

type AcceptChallengeRow = {
  recipient_identity_id: string
  task_id: string
  contact_id: string
}

export class RecipientFirstLoginError extends Error {
  readonly attemptsRemaining?: number
  readonly retryAfterSeconds?: number

  constructor(
    code: string,
    details?: { attemptsRemaining?: number; retryAfterSeconds?: number }
  ) {
    super(code)
    this.name = 'RecipientFirstLoginError'
    this.attemptsRemaining = details?.attemptsRemaining
    this.retryAfterSeconds = details?.retryAfterSeconds
  }
}

function oneRpcRow<T>(data: unknown): T | null {
  if (Array.isArray(data)) return (data[0] as T | undefined) ?? null
  if (data && typeof data === 'object') return data as T
  return null
}

function databaseError(error: { message?: string | null } | null, fallback: string) {
  const code = error?.message?.match(/TASK_RECIPIENT_[A-Z0-9_]+/)?.[0]
  return new RecipientFirstLoginError(code ?? fallback, {
    ...(code === 'TASK_RECIPIENT_FIRST_LOGIN_RATE_LIMITED'
      ? { retryAfterSeconds: 60 }
      : {}),
  })
}

function normalizedEmail(value: unknown) {
  return typeof value === 'string' ? value.trim().toLocaleLowerCase('sv-SE') : ''
}

function cleanDisplayName(value: unknown) {
  if (typeof value !== 'string') return ''
  return value.replace(/\s+/g, ' ').trim().slice(0, 160)
}

function maskedEmail(value: string) {
  const email = normalizedEmail(value)
  const separator = email.lastIndexOf('@')
  if (separator <= 0 || separator === email.length - 1) return ''
  const local = email.slice(0, separator)
  const domain = email.slice(separator + 1)
  const visible = local.slice(0, Math.min(local.length, 2))
  return `${visible}${'*'.repeat(Math.max(3, Math.min(8, local.length - visible.length)))}@${domain}`
}

function challengeCodeHash(challengeId: string, browserSecret: string, code: string) {
  return createHmac('sha256', browserSecret)
    .update(`task-recipient-first-login:v1:${challengeId}:${code}`)
    .digest('hex')
}

function setupSecretForChallenge(challengeId: string, browserSecret: string) {
  return createHmac('sha256', browserSecret)
    .update(`task-recipient-first-login:setup:v1:${challengeId}`)
    .digest('base64url')
}

function cookieValue(challengeId: string, secret: string) {
  return `${challengeId}.${secret}`
}

function parseCookie(value: unknown) {
  if (typeof value !== 'string' || value.length > 1024) {
    throw new RecipientFirstLoginError('TASK_RECIPIENT_FIRST_LOGIN_COOKIE_REQUIRED')
  }
  const parts = value.split('.')
  if (
    parts.length !== 2
    || !UUID_PATTERN.test(parts[0] ?? '')
    || (parts[1]?.length ?? 0) < 32
    || (parts[1]?.length ?? 0) > 512
  ) {
    throw new RecipientFirstLoginError('TASK_RECIPIENT_FIRST_LOGIN_COOKIE_REQUIRED')
  }
  return { challengeId: parts[0]!, secret: parts[1]! }
}

function remainingSeconds(expiresAt: string) {
  const remaining = Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000)
  return Math.max(1, Math.min(RECIPIENT_FIRST_LOGIN_EXPIRES_IN_SECONDS, remaining))
}

function firstLoginEmail(input: {
  recipientName: string
  taskTitle: string
  dueLabel: string
  code: string
}) {
  const recipientName = input.recipientName || 'mottagare'
  const subject = 'Din kod för Mina uppdrag'
  const text = [
    `Hej ${recipientName},`,
    '',
    'Använd koden nedan för att verifiera din e-post och välja lösenord till Mina uppdrag.',
    '',
    input.code,
    '',
    `Koden gäller i ${RECIPIENT_FIRST_LOGIN_EXPIRES_IN_SECONDS / 60} minuter.`,
    'Om du inte begärde koden kan du bortse från mejlet.',
  ].join('\n')
  const html = buildTaskEmailHtml({
    previewText: 'Din engångskod för Mina uppdrag.',
    eyebrow: 'Mina uppdrag',
    heading: 'Verifiera din e-post',
    recipientName,
    lead: 'Använd den sexsiffriga koden för att fortsätta och välja ett lösenord.',
    taskTitle: input.taskTitle,
    dueLabel: input.dueLabel,
    instruction: `Din kod: ${input.code}\n\nKoden gäller i ${RECIPIENT_FIRST_LOGIN_EXPIRES_IN_SECONDS / 60} minuter.`,
    notice: 'Om du inte begärde koden kan du bortse från mejlet. Dela aldrig koden med någon annan.',
  })
  return { subject, text, html }
}

async function requireFirstLoginAssignee(token: string) {
  const actor = await requireExternalTaskActor(token, {
    allowLocked: true,
    allowTerminalReadOnlyRecipient: true,
  })
  const terminalReadOnlyRecipient = actor.access.role === 'viewer'
    && actor.access.scope === 'task'
    && ['approved', 'cancelled'].includes(actor.task.status)
  if (
    (actor.access.role !== 'assignee' && !terminalReadOnlyRecipient)
    || actor.task.assignee_contact_id !== actor.access.contact_id
  ) {
    throw new RecipientFirstLoginError('TASK_RECIPIENT_FIRST_LOGIN_UNAVAILABLE')
  }
  return actor
}

function emptyFirstLoginStatus() {
  return {
    status: 'ready' as const,
    phase: 'none' as const,
    emailHint: '',
    expiresInSeconds: 0,
    attemptsRemaining: null,
    maxAttempts: RECIPIENT_FIRST_LOGIN_MAX_ATTEMPTS,
    resendAfterSeconds: 0,
  }
}

export async function getRecipientFirstLoginStatus(input: {
  token: string
  cookie: unknown
}) {
  const { access } = await requireFirstLoginAssignee(input.token)
  let current: { challengeId: string; secret: string }
  try {
    current = parseCookie(input.cookie)
  } catch (error) {
    if (
      error instanceof RecipientFirstLoginError
      && error.message === 'TASK_RECIPIENT_FIRST_LOGIN_COOKIE_REQUIRED'
    ) {
      return {
        response: emptyFirstLoginStatus(),
        clearCookie: true,
        cookieValue: null,
        cookieMaxAge: null,
      }
    }
    throw error
  }

  const admin = createSupabaseAdminClient()
  const { data, error } = await admin.rpc('preview_task_recipient_first_login_status', {
    p_challenge_id: current.challengeId,
    p_access_link_id: access.id,
    p_cookie_secret_hash: hashAssignmentToken(current.secret),
  })
  if (error) throw databaseError(error, 'TASK_RECIPIENT_FIRST_LOGIN_UNAVAILABLE')
  const status = oneRpcRow<ChallengeStatusRow>(data)
  if (
    !status
    || !['code', 'password'].includes(status.phase)
    || !normalizedEmail(status.recipient_email)
  ) {
    return {
      response: emptyFirstLoginStatus(),
      clearCookie: true,
      cookieValue: null,
      cookieMaxAge: null,
    }
  }

  const expiresInSeconds = remainingSeconds(status.expires_at)
  const attemptsRemaining = status.phase === 'code'
    ? Math.max(
        0,
        Math.min(
          RECIPIENT_FIRST_LOGIN_MAX_ATTEMPTS,
          Number(status.attempts_remaining) || 0
        )
      )
    : null
  const resendAfterSeconds = status.phase === 'code'
    ? Math.max(0, Math.min(60, Number(status.resend_after_seconds) || 0))
    : null

  const rotatedSetupSecret = status.phase === 'password' && status.rotate_cookie_to_setup
    ? setupSecretForChallenge(current.challengeId, current.secret)
    : null

  return {
    response: {
      status: 'ready' as const,
      phase: status.phase,
      emailHint: maskedEmail(status.recipient_email),
      expiresInSeconds,
      attemptsRemaining,
      maxAttempts: RECIPIENT_FIRST_LOGIN_MAX_ATTEMPTS,
      resendAfterSeconds,
    },
    clearCookie: false,
    cookieValue: rotatedSetupSecret
      ? cookieValue(current.challengeId, rotatedSetupSecret)
      : null,
    cookieMaxAge: rotatedSetupSecret ? expiresInSeconds : null,
  }
}

export async function requestRecipientFirstLoginCode(input: { token: string }) {
  const { access, task } = await requireFirstLoginAssignee(input.token)
  const challengeId = randomUUID()
  const browserSecret = generateAssignmentToken()
  const code = randomInt(0, 1_000_000).toString().padStart(6, '0')
  const expiresAt = new Date(
    Date.now() + RECIPIENT_FIRST_LOGIN_EXPIRES_IN_SECONDS * 1000
  ).toISOString()
  const admin = createSupabaseAdminClient()
  const { data, error } = await admin.rpc('begin_task_recipient_first_login', {
    p_challenge_id: challengeId,
    p_access_link_id: access.id,
    p_contact_id: access.contact_id,
    p_task_id: task.id,
    p_browser_secret_hash: hashAssignmentToken(browserSecret),
    p_code_hash: challengeCodeHash(challengeId, browserSecret, code),
    p_expires_at: expiresAt,
  })
  if (error) throw databaseError(error, 'TASK_RECIPIENT_FIRST_LOGIN_UNAVAILABLE')
  const challenge = oneRpcRow<BeginChallengeRow>(data)
  if (
    !challenge?.challenge_id
    || challenge.challenge_id !== challengeId
    || !challenge.recipient_identity_id
    || !normalizedEmail(challenge.recipient_email)
  ) {
    throw new RecipientFirstLoginError('TASK_RECIPIENT_FIRST_LOGIN_UNAVAILABLE')
  }

  const email = firstLoginEmail({
    recipientName: challenge.recipient_display_name,
    taskTitle: task.title,
    dueLabel: formatTaskDateTime(task.due_at, task.due_timezone, 'long'),
    code,
  })
  try {
    await sendTaskAccessLinkEmail({
      to: normalizedEmail(challenge.recipient_email),
      replyTo: null,
      subject: email.subject,
      text: email.text,
      html: email.html,
      idempotencyKey: `recipient-first-login:${challengeId}`,
    })
  } catch (error) {
    // A provider timeout may occur after accepting the message. Keep the
    // challenge usable and answer conservatively so a delivered code works.
    if (!isAmbiguousTaskDeliveryError(error)) {
      await admin
        .from('task_recipient_first_login_challenges')
        .update({ revoked_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('id', challengeId)
      throw error
    }
  }

  return {
    cookieValue: cookieValue(challengeId, browserSecret),
    cookieMaxAge: remainingSeconds(challenge.expires_at),
    response: {
      status: 'code_sent' as const,
      emailHint: maskedEmail(challenge.recipient_email),
      expiresInSeconds: remainingSeconds(challenge.expires_at),
      maxAttempts: RECIPIENT_FIRST_LOGIN_MAX_ATTEMPTS,
    },
  }
}

export async function verifyRecipientFirstLoginCode(input: {
  token: string
  cookie: unknown
  code: unknown
}) {
  const code = typeof input.code === 'string' ? input.code.trim() : ''
  if (!CODE_PATTERN.test(code)) {
    throw new RecipientFirstLoginError('TASK_RECIPIENT_FIRST_LOGIN_CODE_INVALID')
  }
  const current = parseCookie(input.cookie)
  const { access } = await requireFirstLoginAssignee(input.token)
  // Deterministic rotation makes a repeated verify request recoverable if the
  // first HTTP response was lost; the RPC still requires the correct code and
  // original browser-bound secret before returning the verified state.
  const setupSecret = setupSecretForChallenge(current.challengeId, current.secret)
  const admin = createSupabaseAdminClient()
  const { data, error } = await admin.rpc('verify_task_recipient_first_login_code', {
    p_challenge_id: current.challengeId,
    p_access_link_id: access.id,
    p_browser_secret_hash: hashAssignmentToken(current.secret),
    p_code_hash: challengeCodeHash(current.challengeId, current.secret, code),
    p_setup_secret_hash: hashAssignmentToken(setupSecret),
  })
  if (error) throw databaseError(error, 'TASK_RECIPIENT_FIRST_LOGIN_CODE_INVALID')
  const verification = oneRpcRow<VerifyChallengeRow>(data)
  if (!verification) {
    throw new RecipientFirstLoginError('TASK_RECIPIENT_FIRST_LOGIN_CODE_INVALID')
  }
  if (verification.outcome === 'expired') {
    throw new RecipientFirstLoginError('TASK_RECIPIENT_FIRST_LOGIN_CODE_EXPIRED')
  }
  if (verification.outcome === 'locked') {
    throw new RecipientFirstLoginError('TASK_RECIPIENT_FIRST_LOGIN_CODE_LOCKED', {
      attemptsRemaining: 0,
    })
  }
  if (verification.outcome !== 'verified') {
    throw new RecipientFirstLoginError('TASK_RECIPIENT_FIRST_LOGIN_CODE_INVALID', {
      attemptsRemaining: Math.max(0, Number(verification.attempts_remaining) || 0),
    })
  }

  return {
    cookieValue: cookieValue(current.challengeId, setupSecret),
    cookieMaxAge: remainingSeconds(verification.expires_at),
    response: {
      status: 'code_verified' as const,
      expiresInSeconds: remainingSeconds(verification.expires_at),
    },
  }
}

export async function completeRecipientFirstLogin(input: {
  token: string
  cookie: unknown
  password: unknown
  displayName?: unknown
}) {
  const current = parseCookie(input.cookie)
  const password = typeof input.password === 'string' ? input.password : ''
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new RecipientFirstLoginError('TASK_RECIPIENT_PASSWORD_TOO_SHORT')
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    throw new RecipientFirstLoginError('TASK_RECIPIENT_PASSWORD_TOO_LONG')
  }
  const { access } = await requireFirstLoginAssignee(input.token)
  const setupHash = hashAssignmentToken(current.secret)
  const admin = createSupabaseAdminClient()
  const loadSetupPreview = async () => {
    const { data, error } = await admin.rpc('preview_task_recipient_first_login_setup', {
      p_challenge_id: current.challengeId,
      p_access_link_id: access.id,
      p_setup_secret_hash: setupHash,
    })
    if (error) throw databaseError(error, 'TASK_RECIPIENT_FIRST_LOGIN_SETUP_INVALID')
    const preview = oneRpcRow<SetupPreviewRow>(data)
    if (!preview?.recipient_identity_id || !normalizedEmail(preview.recipient_email)) {
      throw new RecipientFirstLoginError('TASK_RECIPIENT_FIRST_LOGIN_SETUP_INVALID')
    }
    return preview
  }
  let preview = await loadSetupPreview()
  const displayName = cleanDisplayName(input.displayName) || cleanDisplayName(preview.recipient_display_name)

  // A client may retry after the database commit succeeded but the HTTP
  // response was lost. The verified setup cookie remains valid briefly, so
  // return the same terminal result without creating or mutating another user.
  if (preview.already_consumed) {
    return {
      status: 'account_created' as const,
      signInEmail: normalizedEmail(preview.recipient_email),
      destination: recipientTaskPath(preview.task_id),
    }
  }

  const recoverMarkedAuthUser = async (authUserId: string) => {
    const updateResult = await admin.auth.admin.updateUserById(authUserId, {
      password,
      user_metadata: displayName ? { full_name: displayName } : undefined,
    })
    if (updateResult.error || !updateResult.data.user) {
      throw new RecipientFirstLoginError('TASK_RECIPIENT_ACCOUNT_CREATE_FAILED')
    }
    return updateResult.data.user
  }

  let createdUser = preview.recovery_auth_user_id
    ? await recoverMarkedAuthUser(preview.recovery_auth_user_id)
    : null

  if (!createdUser) {
    const createResult = await admin.auth.admin.createUser({
      email: normalizedEmail(preview.recipient_email),
      password,
      email_confirm: true,
      app_metadata: {
        account_type: 'task_recipient',
        first_login_challenge_id: current.challengeId,
      },
      user_metadata: {
        full_name: displayName || undefined,
      },
    })
    if (!createResult.error && createResult.data.user) {
      createdUser = createResult.data.user
    } else {
      // A transport response can be lost after GoTrue has committed the user.
      // Reload the service-only preview and recover only the user carrying this
      // exact challenge marker; an ordinary existing account is never claimed.
      preview = await loadSetupPreview()
      if (preview.recovery_auth_user_id) {
        createdUser = await recoverMarkedAuthUser(preview.recovery_auth_user_id)
      } else {
        const message = createResult.error?.message?.toLocaleLowerCase('en-US') ?? ''
        if (message.includes('already') || message.includes('registered') || message.includes('exists')) {
          throw new RecipientFirstLoginError('TASK_RECIPIENT_ACCOUNT_LOGIN_REQUIRED')
        }
        throw new RecipientFirstLoginError('TASK_RECIPIENT_ACCOUNT_CREATE_FAILED')
      }
    }
  }
  let accepted: AcceptChallengeRow | null = null
  let acceptFailed = false
  try {
    const acceptResult = await admin.rpc('accept_task_recipient_first_login', {
      p_challenge_id: current.challengeId,
      p_access_link_id: access.id,
      p_setup_secret_hash: setupHash,
      p_auth_user_id: createdUser.id,
    })
    if (acceptResult.error) throw databaseError(
      acceptResult.error,
      'TASK_RECIPIENT_FIRST_LOGIN_ACTIVATION_FAILED'
    )
    accepted = oneRpcRow<AcceptChallengeRow>(acceptResult.data)
    if (!accepted?.recipient_identity_id || !accepted.task_id) {
      throw new RecipientFirstLoginError('TASK_RECIPIENT_FIRST_LOGIN_ACTIVATION_FAILED')
    }
  } catch {
    acceptFailed = true
  }

  if (acceptFailed) {
    const [identityResult, grantResult, challengeResult] = await Promise.all([
      admin
        .from('task_recipient_identities')
        .select('id,auth_user_id,status')
        .eq('id', preview.recipient_identity_id)
        .maybeSingle(),
      admin
        .from('task_recipient_portal_grants')
        .select('id')
        .eq('recipient_identity_id', preview.recipient_identity_id)
        .eq('contact_id', preview.contact_id)
        .eq('task_id', preview.task_id)
        .is('revoked_at', null)
        .limit(1)
        .maybeSingle(),
      admin
        .from('task_recipient_first_login_challenges')
        .select('id,consumed_at,revoked_at')
        .eq('id', current.challengeId)
        .eq('access_link_id', access.id)
        .maybeSingle(),
    ])
    const identity = identityResult.data as {
      id: string
      auth_user_id: string | null
      status: string
    } | null
    const bindingWasCommitted = Boolean(
      !identityResult.error
      && !grantResult.error
      && !challengeResult.error
      && identity?.auth_user_id === createdUser.id
      && identity.status === 'active'
      && challengeResult.data?.consumed_at
      && grantResult.data
    )
    if (!bindingWasCommitted) {
      console.error('[tasks.recipient.first-login] account binding outcome could not be confirmed', {
        recipientIdentityId: preview.recipient_identity_id,
        taskId: preview.task_id,
        identityReadFailed: Boolean(identityResult.error),
        grantReadFailed: Boolean(grantResult.error),
        challengeReadFailed: Boolean(challengeResult.error),
      })
      const definitelyUnbound = Boolean(
        !identityResult.error
        && !challengeResult.error
        && identity
        && identity.auth_user_id === null
        && challengeResult.data
        && challengeResult.data.consumed_at === null
      )
      if (definitelyUnbound) {
        const deleteResult = await admin.auth.admin.deleteUser(createdUser.id)
        if (deleteResult.error) {
          console.error('[tasks.recipient.first-login] unbound auth user cleanup failed', {
            recipientIdentityId: preview.recipient_identity_id,
            taskId: preview.task_id,
            code: 'TASK_RECIPIENT_AUTH_CLEANUP_FAILED',
          })
        }
      }
      throw new RecipientFirstLoginError('TASK_RECIPIENT_ACTIVATION_RECOVERY_REQUIRED')
    }
  }

  if (displayName) {
    await admin
      .from('task_recipient_identities')
      .update({ display_name: displayName })
      .eq('id', preview.recipient_identity_id)
  }

  return {
    status: 'account_created' as const,
    signInEmail: normalizedEmail(preview.recipient_email),
    destination: recipientTaskPath(preview.task_id),
  }
}
