// @ts-expect-error Node's strip-types runner requires the TypeScript extension.
import { safeAuthReturnPath } from '../auth/returnPath.ts'

export function normalizeBrfOrgNumber(value: string) {
  const digits = value.replace(/\D/g, '')
  return /^\d{10}$/.test(digits) ? `${digits.slice(0, 6)}-${digits.slice(6)}` : value.trim()
}

export function getBrfInviteState(invite: {
  acceptedAt: string | null
  revokedAt: string | null
  expiresAt: string
}, now = Date.now()): 'accepted' | 'revoked' | 'expired' | 'open' {
  if (invite.acceptedAt) return 'accepted'
  if (invite.revokedAt) return 'revoked'
  return new Date(invite.expiresAt).getTime() <= now ? 'expired' : 'open'
}

export function getRenoAppReturnPath(value: string | null) {
  // Preserve existing token invitation acceptance; it is not an app recovery
  // destination and deliberately accepts no query or fragment.
  if (typeof value === 'string' && /^\/renoapp\/invite\/[A-Za-z0-9_-]+$/.test(value)) return value
  const destination = safeAuthReturnPath(value, '/renoapp/app')
  return destination.startsWith('/renoapp/') ? destination : '/renoapp/app'
}

export function getBrfVisibilityLabel(brf: { isPublicApplyEnabled: boolean; isPublicApplyListed: boolean }) {
  if (!brf.isPublicApplyEnabled) return 'Avstängd'
  return brf.isPublicApplyListed ? 'Publikt sökbar' : 'Endast direktlänk'
}
