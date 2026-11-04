import type { NextRequest } from 'next/server'
import { addDiaryPerson, getDiaryPublic, submitDiaryEntry } from '@/lib/action-cases/projectDiaryServer'
import { diaryError, diaryJson, diaryRequestBody, diaryRequestCookie, rememberDiaryDevice } from '@/lib/action-cases/projectDiaryHttp'
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
type Route = { params: Promise<{ token: string }> }
export async function GET(request: NextRequest, route: Route) {
  try { const { token } = await route.params; const response = diaryJson(await getDiaryPublic(token)); rememberDiaryDevice(response, request, token); return response }
  catch (error) { return diaryError(error) }
}
export async function POST(request: NextRequest, route: Route) {
  try {
    const { token } = await route.params, data = await diaryRequestBody(request)
    const identity = { token, device: diaryRequestCookie(request, token) }
    if (['request_code','verify_code','logout'].includes(String(data.operation))) throw new Error('PROJECT_DIARY_RELOAD')
    if (data.operation === 'person') return diaryJson(await addDiaryPerson(identity, data))
    if (data.operation === 'entry') return diaryJson(await submitDiaryEntry(identity, data))
    throw new Error('PROJECT_DIARY_INVALID')
  } catch (error) { return diaryError(error) }
}
