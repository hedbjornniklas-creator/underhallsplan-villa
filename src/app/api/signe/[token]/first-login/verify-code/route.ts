import { NextRequest, NextResponse } from 'next/server'
import {
  RECIPIENT_FIRST_LOGIN_COOKIE,
  verifyRecipientFirstLoginCode,
} from '@/lib/tasks/recipientFirstLogin'
import {
  recipientFirstLoginErrorResponse,
  setRecipientFirstLoginCookie,
} from '@/lib/tasks/recipientFirstLoginHttp'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ token: string }> }
) {
  try {
    const contentLength = Number(request.headers.get('content-length'))
    if (Number.isFinite(contentLength) && contentLength > 8 * 1024) {
      const response = NextResponse.json(
        { error: 'Begäran är för stor.', code: 'REQUEST_TOO_LARGE' },
        { status: 413 }
      )
      response.headers.set('Cache-Control', 'no-store')
      return response
    }
    const { token } = await context.params
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const result = await verifyRecipientFirstLoginCode({
      token,
      cookie: request.cookies.get(RECIPIENT_FIRST_LOGIN_COOKIE)?.value,
      code: body.code,
    })
    const response = NextResponse.json(result.response)
    setRecipientFirstLoginCookie(response, token, result.cookieValue, result.cookieMaxAge)
    return response
  } catch (error) {
    return recipientFirstLoginErrorResponse(error)
  }
}
