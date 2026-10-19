import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

const creationPath = '/settings/organisation/skapa'
const dashboardPath = '/dashboard-v1'

function privateResponse(response: NextResponse) {
  response.headers.set('Cache-Control', 'private, no-store, max-age=0')
  response.headers.set('Pragma', 'no-cache')
  response.headers.set('Expires', '0')
  return response
}

// Refresh these exact RSC entries in a writable request/response boundary,
// before each page's independent access checks read the updated cookies.
export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname
  if (pathname !== creationPath && pathname !== dashboardPath) return NextResponse.next()

  let response = NextResponse.next({ request })
  const unavailable = () => {
    const result = pathname === dashboardPath
      ? NextResponse.rewrite(new URL('/auth/session-unavailable', request.url), { status: 503 })
      : new NextResponse('Inloggningen kunde inte kontrolleras. Försök igen om en stund.', { status: 503 })
    response.cookies.getAll().forEach(cookie => result.cookies.set(cookie))
    return privateResponse(result)
  }
  const login = () => {
    const url = new URL('/login', request.url)
    url.searchParams.set('next', pathname)
    const redirect = NextResponse.redirect(url)
    // A rejected/revoked session can clear cookies before returning an error.
    // Preserve those clears, including their options, on the redirect too.
    response.cookies.getAll().forEach(cookie => redirect.cookies.set(cookie))
    return privateResponse(redirect)
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) return unavailable()

  try {
    const supabase = createServerClient(url, key, {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll(cookies) {
          cookies.forEach(({ name, value }) => request.cookies.set(name, value))
          const previousCookies = response.cookies.getAll()
          response = NextResponse.next({ request })
          previousCookies.forEach(cookie => response.cookies.set(cookie))
          cookies.forEach(({ name, value, options }) => response.cookies.set(name, value, options))
        },
      },
    })
    // Never authorize from getSession or an unverified cookie payload.
    const { data, error } = await supabase.auth.getUser()
    if (error) {
      if (error.name === 'AuthSessionMissingError' || [400, 401, 403].includes(error.status ?? 0)) return login()
      return unavailable()
    }
    if (!data.user) return login()
    return privateResponse(response)
  } catch {
    // Upstream/configuration failures must not render protected content or
    // bounce an otherwise signed-in browser indefinitely through /login.
    return unavailable()
  }
}

export const config = { matcher: ['/settings/organisation/skapa', '/dashboard-v1'] }
