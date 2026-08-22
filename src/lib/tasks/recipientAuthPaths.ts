export const RECIPIENT_PORTAL_HOME = '/mina-uppdrag'
export const RECIPIENT_LOGIN_PATH = '/mina-uppdrag/logga-in'

/**
 * Recipient authentication only redirects back into the recipient portal.
 * This prevents `next` from becoming an open redirect while still preserving
 * task-specific query strings and fragments.
 */
export function safeRecipientReturnTo(value: unknown, fallback = RECIPIENT_PORTAL_HOME) {
  if (typeof value !== 'string') return fallback

  const candidate = value.trim()
  if (!candidate.startsWith('/') || candidate.startsWith('//') || /[\u0000-\u001f\u007f]/.test(candidate)) {
    return fallback
  }

  try {
    const parsed = new URL(candidate, 'https://recipient.hushub.invalid')
    if (parsed.origin !== 'https://recipient.hushub.invalid') return fallback
    if (parsed.pathname !== RECIPIENT_PORTAL_HOME && !parsed.pathname.startsWith(`${RECIPIENT_PORTAL_HOME}/`)) {
      return fallback
    }
    return `${parsed.pathname}${parsed.search}${parsed.hash}`
  } catch {
    return fallback
  }
}

export function recipientLoginUrl(returnTo: unknown = RECIPIENT_PORTAL_HOME) {
  const safeReturnTo = safeRecipientReturnTo(returnTo)
  return `${RECIPIENT_LOGIN_PATH}?next=${encodeURIComponent(safeReturnTo)}`
}

export function recipientTaskPath(taskId: string) {
  return `${RECIPIENT_PORTAL_HOME}/uppdrag/${encodeURIComponent(taskId)}`
}
