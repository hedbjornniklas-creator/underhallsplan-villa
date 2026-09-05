import 'server-only'

import { createHmac, timingSafeEqual } from 'node:crypto'

export const INTERNAL_REPORT_RENDER_AUTH_HEADER = 'x-hushub-report-render-authorization'

const TOKEN_VERSION = 'v1'
const DEFAULT_TOKEN_TTL_MS = 5 * 60 * 1000
const MAX_TOKEN_TTL_MS = 10 * 60 * 1000
const CLOCK_SKEW_MS = 15 * 1000
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu
const SIGNATURE_PATTERN = /^[0-9a-f]{64}$/u

function internalRenderSecret() {
  const secret =
    process.env.REPORT_RENDER_SECRET?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    ''

  return secret.length >= 32 ? secret : null
}

function normalizeLinkId(value: string) {
  const linkId = value.trim().toLowerCase()
  return UUID_PATTERN.test(linkId) ? linkId : null
}

function signedPayload(linkId: string, issuedAtSeconds: number, expiresAtSeconds: number) {
  return [TOKEN_VERSION, linkId, issuedAtSeconds, expiresAtSeconds].join('\n')
}

function signatureFor(input: {
  linkId: string
  issuedAtSeconds: number
  expiresAtSeconds: number
  secret: string
}) {
  return createHmac('sha256', input.secret)
    .update(signedPayload(input.linkId, input.issuedAtSeconds, input.expiresAtSeconds))
    .digest('hex')
}

function safeSignatureEqual(left: string, right: string) {
  if (!SIGNATURE_PATTERN.test(left) || !SIGNATURE_PATTERN.test(right)) return false
  return timingSafeEqual(Buffer.from(left, 'hex'), Buffer.from(right, 'hex'))
}

/**
 * Creates a short-lived, report-link-bound credential for the internal print page.
 * The token contains no user session, public delivery token, or database secret.
 */
export function createInternalReportRenderAuthorization(input: {
  linkId: string
  now?: number
  ttlMs?: number
}) {
  const linkId = normalizeLinkId(input.linkId)
  if (!linkId) throw new Error('INTERNAL_REPORT_RENDER_LINK_ID_INVALID')

  const secret = internalRenderSecret()
  if (!secret) throw new Error('INTERNAL_REPORT_RENDER_SECRET_MISSING')

  const ttlMs = input.ttlMs ?? DEFAULT_TOKEN_TTL_MS
  if (!Number.isFinite(ttlMs) || ttlMs <= 0 || ttlMs > MAX_TOKEN_TTL_MS) {
    throw new Error('INTERNAL_REPORT_RENDER_TTL_INVALID')
  }

  const issuedAtSeconds = Math.floor((input.now ?? Date.now()) / 1000)
  const expiresAtSeconds = issuedAtSeconds + Math.max(1, Math.ceil(ttlMs / 1000))
  const signature = signatureFor({ linkId, issuedAtSeconds, expiresAtSeconds, secret })

  return `${TOKEN_VERSION}.${issuedAtSeconds}.${expiresAtSeconds}.${signature}`
}

export function createInternalReportRenderHeaders(input: {
  linkId: string
  now?: number
  ttlMs?: number
}): Record<string, string> {
  return {
    [INTERNAL_REPORT_RENDER_AUTH_HEADER]: createInternalReportRenderAuthorization(input),
  }
}

/** Fail-closed verification for requests to the internal snapshot print page. */
export function verifyInternalReportRenderAuthorization(input: {
  linkId: string
  authorization: string | null | undefined
  now?: number
}) {
  const linkId = normalizeLinkId(input.linkId)
  const secret = internalRenderSecret()
  const authorization = String(input.authorization ?? '').trim()
  if (!linkId || !secret || authorization.length > 256) return false

  const [version, issuedAtRaw, expiresAtRaw, signature, ...extra] = authorization.split('.')
  if (
    extra.length > 0 ||
    version !== TOKEN_VERSION ||
    !/^\d{10}$/u.test(issuedAtRaw ?? '') ||
    !/^\d{10}$/u.test(expiresAtRaw ?? '') ||
    !signature
  ) {
    return false
  }

  const issuedAtSeconds = Number(issuedAtRaw)
  const expiresAtSeconds = Number(expiresAtRaw)
  const nowMs = input.now ?? Date.now()
  const issuedAtMs = issuedAtSeconds * 1000
  const expiresAtMs = expiresAtSeconds * 1000
  if (
    !Number.isSafeInteger(issuedAtSeconds) ||
    !Number.isSafeInteger(expiresAtSeconds) ||
    expiresAtSeconds <= issuedAtSeconds ||
    expiresAtMs - issuedAtMs > MAX_TOKEN_TTL_MS ||
    issuedAtMs > nowMs + CLOCK_SKEW_MS ||
    expiresAtMs < nowMs - CLOCK_SKEW_MS
  ) {
    return false
  }

  const expectedSignature = signatureFor({
    linkId,
    issuedAtSeconds,
    expiresAtSeconds,
    secret,
  })
  return safeSignatureEqual(signature, expectedSignature)
}
