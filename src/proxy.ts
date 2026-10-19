import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { authLoginUrl, isProtectedAppPath, safeAuthReturnPath } from '@/lib/auth/returnPath'

function privateResponse(response: NextResponse) {
  response.headers.set('Cache-Control', 'private, no-store, max-age=0')
  response.headers.set('Pragma', 'no-cache')
  response.headers.set('Expires', '0')
  return response
}

// Refresh protected app pages in a writable request/response boundary,
// before each page's independent access checks read the updated cookies.
export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname
  if (!isProtectedAppPath(pathname)) return NextResponse.next()

  const returnPath = safeAuthReturnPath(`${pathname}${request.nextUrl.search}`, pathname)
  // Only this boundary supplies the path consumed by server page/layout guards.
  // An incoming client header must never choose a different login destination.
  request.headers.set('x-hushub-return-path', returnPath)

  let response = NextResponse.next({ request: { headers: request.headers } })
  const unavailable = () => {
    const recoveryUrl = new URL('/auth/session-unavailable', request.url)
    recoveryUrl.searchParams.set('next', returnPath)
    const result = NextResponse.rewrite(recoveryUrl, {
      status: 503, request: { headers: request.headers },
    })
    response.cookies.getAll().forEach(cookie => result.cookies.set(cookie))
    return privateResponse(result)
  }
  const login = () => {
    const url = new URL(authLoginUrl(returnPath), request.url)
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
          response = NextResponse.next({ request: { headers: request.headers } })
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

export const config = {
  matcher: [
    '/dashboard-v1',
    '/ob/:path*',
    '/eb/:path*',
    '/tu/:path*',
    '/fuktsakerhet/:path*',
    '/uppdrag/:path*',
    '/properties/:path*',
    '/inspections/:path*',
    '/utlatande/:propertyId/:inspectionId',
    '/settings/:path*',
    '/admin/:path*',
    '/app',
    '/renoapp/app/:path*',
    '/renoapp/review/:id',
    '/mina-uppdrag',
    '/mina-uppdrag/((?!logga-in(?:/|$)|aktivera(?:/|$)).*)',
  ],
}
