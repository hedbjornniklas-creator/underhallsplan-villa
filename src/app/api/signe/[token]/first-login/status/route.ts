import { NextRequest, NextResponse } from 'next/server'
import {
  getRecipientFirstLoginStatus,
  RECIPIENT_FIRST_LOGIN_COOKIE,
} from '@/lib/tasks/recipientFirstLogin'
import {
  clearRecipientFirstLoginCookie,
  recipientFirstLoginErrorResponse,
  setRecipientFirstLoginCookie,
} from '@/lib/tasks/recipientFirstLoginHttp'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await context.params
    const result = await getRecipientFirstLoginStatus({
      token,
      cookie: request.cookies.get(RECIPIENT_FIRST_LOGIN_COOKIE)?.value,
    })
    const response = NextResponse.json(result.response)
    response.headers.set('Cache-Control', 'no-store')
    if (result.clearCookie) {
      clearRecipientFirstLoginCookie(response, token)
    } else if (result.cookieValue && result.cookieMaxAge) {
      setRecipientFirstLoginCookie(
        response,
        token,
        result.cookieValue,
        result.cookieMaxAge
      )
    }
    return response
  } catch (error) {
    return recipientFirstLoginErrorResponse(error)
  }
}
