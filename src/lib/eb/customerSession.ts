import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { cookies } from 'next/headers'

export type EbCustomerSession = {
  orgId: string
  inspectionId: string
  email: string
  kind: 'report' | 'owner'
  expiresAt: number
  reportLinkId?: string
  challengeId?: string
  code?: string
  portalPath?: string
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const MAX_AGE = 8 * 60 * 60
const PURPOSE = 'eb-customer-session-v1'

function key() {
  const secret = process.env.EB_FOLLOW_UP_EMAIL_ENCRYPTION_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!secret) throw new Error('EB_FOLLOW_UP_CONFIGURATION')
  // Separate encryption domain from queued emails: neither format is a credential for the other.
  return createHash('sha256').update(`${PURPOSE}:${secret}`).digest()
}

function valid(session: EbCustomerSession, now: number) {
  return session && UUID.test(session.orgId) && UUID.test(session.inspectionId)
    && typeof session.email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(session.email)
    && session.email.length <= 254 && ['report', 'owner'].includes(session.kind)
    && Number.isFinite(session.expiresAt) && session.expiresAt > now
    && session.expiresAt <= now + MAX_AGE * 1000 + 1000
    && (session.kind !== 'report' || (UUID.test(session.reportLinkId ?? '')
      && UUID.test(session.challengeId ?? '') && /^\d{6}$/.test(session.code ?? '')))
    && (!session.portalPath || /^\/atgarder\/[A-Za-z0-9_-]{20,200}$/.test(session.portalPath))
}

export function encodeEbCustomerSession(session: EbCustomerSession, now = Date.now()): string {
  if (!valid(session, now)) throw new Error('EB_FOLLOW_UP_VERIFICATION_REQUIRED')
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key(), iv)
  const payload = Buffer.concat([cipher.update(JSON.stringify({ purpose: PURPOSE, ...session }), 'utf8'), cipher.final()])
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), payload.toString('base64url')].join('.')
}

export function decodeEbCustomerSession(value: string, inspectionId: string, now = Date.now()): EbCustomerSession | null {
  try {
    if (value.length > 4096) return null
    const parts = value.split('.')
    if (parts.length !== 4 || parts[0] !== 'v1') return null
    const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(parts[1], 'base64url'))
    decipher.setAuthTag(Buffer.from(parts[2], 'base64url'))
    const decoded = JSON.parse(Buffer.concat([decipher.update(Buffer.from(parts[3], 'base64url')), decipher.final()]).toString('utf8'))
    if (decoded.purpose !== PURPOSE || decoded.inspectionId !== inspectionId || !valid(decoded, now)) return null
    return decoded as EbCustomerSession
  } catch { return null }
}

function cookieName(inspectionId: string) {
  if (!UUID.test(inspectionId)) throw new Error('EB_FOLLOW_UP_VERIFICATION_REQUIRED')
  return `${process.env.NODE_ENV === 'production' ? '__Host-' : ''}eb_customer_${inspectionId}`
}

export async function readEbCustomerSession(inspectionId: string): Promise<EbCustomerSession | null> {
  const value = (await cookies()).get(cookieName(inspectionId))?.value
  return value ? decodeEbCustomerSession(value, inspectionId) : null
}

export async function setEbCustomerSession(session: EbCustomerSession): Promise<void> {
  const value = encodeEbCustomerSession(session)
  ;(await cookies()).set(cookieName(session.inspectionId), value, {
    httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/',
    maxAge: Math.max(1, Math.floor((session.expiresAt - Date.now()) / 1000)),
    expires: new Date(session.expiresAt),
  })
}

export async function clearEbCustomerSession(inspectionId: string): Promise<void> {
  ;(await cookies()).set(cookieName(inspectionId), '', {
    httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 0,
  })
}

/** Cookie-authorized writes must originate in the same application, never a shared-link recipient's site. */
export function assertEbCustomerRequestOrigin(request: Request): void {
  const origin = request.headers.get('origin')
  const fetchSite = request.headers.get('sec-fetch-site')
  if (!origin || origin !== new URL(request.url).origin || (fetchSite && !['same-origin', 'none'].includes(fetchSite))) {
    throw new Error('EB_CUSTOMER_ORIGIN_FORBIDDEN')
  }
}
