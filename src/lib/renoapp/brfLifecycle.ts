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
  if (!value || value.includes('\\') || /[\r\n]/.test(value)) return '/renoapp/app'
  if (value === '/renoapp/app' || value.startsWith('/renoapp/app/')) return value
  if (/^\/renoapp\/invite\/[A-Za-z0-9_-]+$/.test(value)) return value
  return '/renoapp/app'
}

export function getBrfVisibilityLabel(brf: { isPublicApplyEnabled: boolean; isPublicApplyListed: boolean }) {
  if (!brf.isPublicApplyEnabled) return 'Avstängd'
  return brf.isPublicApplyListed ? 'Publikt sökbar' : 'Endast direktlänk'
}
