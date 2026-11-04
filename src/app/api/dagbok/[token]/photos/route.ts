import type { NextRequest } from 'next/server'
import { completeDiaryPhoto, prepareDiaryPhoto } from '@/lib/action-cases/projectDiaryServer'
import { diaryError, diaryJson, diaryRequestBody, diaryRequestCookie } from '@/lib/action-cases/projectDiaryHttp'
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60
export async function POST(request: NextRequest, route: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await route.params, data = await diaryRequestBody(request), identity = { token, session: diaryRequestCookie(request, token, 'session') }
    if (data.operation === 'prepare') return diaryJson(await prepareDiaryPhoto(identity, data))
    if (data.operation === 'complete') return diaryJson(await completeDiaryPhoto(identity, data.id))
    throw new Error('PROJECT_DIARY_INVALID')
  } catch (error) { return diaryError(error) }
}
