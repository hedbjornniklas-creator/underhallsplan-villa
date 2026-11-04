import type { NextRequest } from 'next/server'
import { beginDiaryCode, getDiaryPublic, logoutDiary, submitDiaryEntry, verifyDiaryCode } from '@/lib/action-cases/projectDiaryServer'
import { diaryError, diaryJson, diaryRequestBody, diaryRequestCookie, setDiaryCookie } from '@/lib/action-cases/projectDiaryHttp'
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
type Route = { params: Promise<{ token: string }> }
export async function GET(request: NextRequest, route: Route) {
  try { const { token } = await route.params; return diaryJson(await getDiaryPublic(token, diaryRequestCookie(request, token, 'session'))) }
  catch (error) { return diaryError(error) }
}
export async function POST(request: NextRequest, route: Route) {
  try {
    const { token } = await route.params, data = await diaryRequestBody(request)
    const identity = { token, session: diaryRequestCookie(request, token, 'session') }
    if (data.operation === 'request_code') {
      const result = await beginDiaryCode(token, data.email, (request.headers.get('x-forwarded-for')?.split(',')[0] || request.headers.get('x-real-ip') || 'unknown').trim().slice(0, 200))
      const response = diaryJson(result.response); setDiaryCookie(response, token, 'code', result.cookie); return response
    }
    if (data.operation === 'verify_code') {
      const verified = await verifyDiaryCode(token, diaryRequestCookie(request, token, 'code'), data.code)
      if (verified.result.outcome !== 'verified') return diaryJson({ error: verified.result.outcome === 'invalid' ? 'Koden stämmer inte.' : 'Koden har gått ut eller är spärrad. Begär en ny kod.', ...verified.result }, 400)
      const response = diaryJson(await getDiaryPublic(token, verified.session))
      setDiaryCookie(response, token, 'session', verified.session, verified.result.expiresAt); setDiaryCookie(response, token, 'code', null); return response
    }
    if (data.operation === 'logout') {
      try { await logoutDiary(identity) } catch (error) { if (!(error instanceof Error) || error.message !== 'PROJECT_DIARY_SESSION') throw error }
      const response = diaryJson({ loggedOut: true }); setDiaryCookie(response, token, 'session', null); setDiaryCookie(response, token, 'code', null); return response
    }
    if (data.operation === 'entry') return diaryJson(await submitDiaryEntry(identity, data))
    throw new Error('PROJECT_DIARY_INVALID')
  } catch (error) { return diaryError(error) }
}
