import { NextRequest, NextResponse } from 'next/server'
import {
  completeRecipientFirstLogin,
  RECIPIENT_FIRST_LOGIN_COOKIE,
} from '@/lib/tasks/recipientFirstLogin'
import {
  clearRecipientFirstLoginCookie,
  recipientFirstLoginErrorResponse,
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
    const result = await completeRecipientFirstLogin({
      token,
      cookie: request.cookies.get(RECIPIENT_FIRST_LOGIN_COOKIE)?.value,
      password: body.password,
      displayName: body.displayName,
    })
    const response = NextResponse.json(result)
    clearRecipientFirstLoginCookie(response, token)
    return response
  } catch (error) {
    return recipientFirstLoginErrorResponse(error)
  }
}
