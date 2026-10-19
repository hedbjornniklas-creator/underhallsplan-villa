const INTERNAL_ORIGIN = 'https://auth-return.hushub.invalid'
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'
const RECIPIENT_TASK = new RegExp(`^/mina-uppdrag/uppdrag/${UUID}$`, 'i')
const RENO_REVIEW = new RegExp(`^/renoapp/review/${UUID}$`, 'i')
const OB_REPORT = new RegExp(`^/utlatande/${UUID}/${UUID}$`, 'i')
const MODULE_ROOTS = ['ob', 'eb', 'tu', 'fuktsakerhet', 'uppdrag', 'properties', 'inspections', 'settings', 'admin']
const EXACT_ONLY = new Set(['/organisation/inbjudan', '/settings/organisation/skapa'])
// Preserve current/future view filters, but never carry authentication secrets
// or a second redirect destination into a return link.
const UNSAFE_QUERY_KEY = /^(?:next|redirect.*|return.*|callback.*|continue.*|url|uri|destination|target|accesstoken|refreshtoken|idtoken|token.*|code|state|secret.*|password.*|otp|type|auth.*|credential.*|session.*)$/i

function validPathSyntax(pathname: string) {
  // Current protected routes use fixed slugs and UUIDs. Restricting segments
  // avoids URL normalization, encoded separators, traversal and asset requests.
  return /^\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*$/.test(pathname) &&
    !/(?:^|\/)(?:api|public|auth|login|logga-in|reset|reset-password|invite|inbjudan|aktivera|activation|token|accept|callback)(?:\/|$)/i.test(pathname)
}

/** Classify application pages only; public links and authentication stay outside recovery. */
export function isProtectedAppPath(pathname: string): boolean {
  if (typeof pathname !== 'string' || !validPathSyntax(pathname)) return false
  if (pathname === '/app' || pathname === '/dashboard-v1' || pathname === '/mina-uppdrag') return true
  if (RECIPIENT_TASK.test(pathname) || RENO_REVIEW.test(pathname) || OB_REPORT.test(pathname)) return true
  if (pathname === '/renoapp/app' || pathname.startsWith('/renoapp/app/')) return true
  if (pathname.startsWith('/settings/organisation/skapa/')) return false
  return MODULE_ROOTS.some(root => pathname === `/${root}` || pathname.startsWith(`/${root}/`))
}

function validatedReturnPath(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4096 || value !== value.trim()) return null
  if (/[\\\u0000-\u001f\u007f-\u009f]/.test(value)) return null
  if (EXACT_ONLY.has(value)) return value

  try {
    // decodeURIComponent also rejects malformed UTF-8/percent escapes instead
    // of accepting URLSearchParams' replacement characters.
    const decoded = decodeURIComponent(value)
    if (/[\\\u0000-\u001f\u007f-\u009f]/.test(decoded)) return null
    const url = new URL(value, INTERNAL_ORIGIN)
    if (url.origin !== INTERNAL_ORIGIN || !value.startsWith('/') || value.startsWith('//')) return null
    if (!isProtectedAppPath(url.pathname)) return null
    const pathEnd = value.search(/[?#]/)
    const rawPath = pathEnd < 0 ? value : value.slice(0, pathEnd)
    if (rawPath !== url.pathname || !validPathSyntax(rawPath) || EXACT_ONLY.has(rawPath)) return null

    const search = new URLSearchParams()
    for (const [key, entry] of url.searchParams) {
      if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(key) || UNSAFE_QUERY_KEY.test(key.replace(/[-_]/g, '')) || entry.length > 512) continue
      // UI state is scalar, never a URL, double-encoded value or nested query.
      if (/[\\/%?#&=]/.test(entry) || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(entry) || entry === '.' || entry === '..') continue
      search.append(key, entry)
    }
    const query = search.toString()
    const hash = /^#[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(url.hash) ? url.hash : ''
    return `${url.pathname}${query ? `?${query}` : ''}${hash}`
  } catch {
    return null
  }
}

/** Return to a known local application page, retaining safe organization/view state. */
export function safeAuthReturnPath(value: unknown, fallback = '/app'): string {
  return validatedReturnPath(value) ?? validatedReturnPath(fallback) ?? '/app'
}

/** Use each product's established login screen while retaining the selected page. */
export function authLoginUrl(value: unknown): string {
  const destination = safeAuthReturnPath(value)
  const pathname = new URL(destination, INTERNAL_ORIGIN).pathname
  const login = pathname.startsWith('/renoapp/') ? '/renoapp/login'
    : pathname === '/mina-uppdrag' || RECIPIENT_TASK.test(pathname) ? '/mina-uppdrag/logga-in'
      : '/login'
  return `${login}?next=${encodeURIComponent(destination)}`
}
