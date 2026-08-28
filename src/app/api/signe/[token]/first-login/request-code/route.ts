import { NextResponse } from 'next/server'
import { requestRecipientFirstLoginCode } from '@/lib/tasks/recipientFirstLogin'
import {
  recipientFirstLoginErrorResponse,
  setRecipientFirstLoginCookie,
} from '@/lib/tasks/recipientFirstLoginHttp'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(
  request: Request,
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
    const result = await requestRecipientFirstLoginCode({ token })
    const response = NextResponse.json(result.response)
    setRecipientFirstLoginCookie(response, token, result.cookieValue, result.cookieMaxAge)
    return response
  } catch (error) {
    return recipientFirstLoginErrorResponse(error)
  }
}
