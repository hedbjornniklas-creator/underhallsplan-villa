import type { NextRequest } from 'next/server'
import { storeDiaryPhotoPart } from '@/lib/action-cases/projectDiaryServer'
import { diaryError, diaryJson, diaryPhotoPartBody, diaryRequestCookie } from '@/lib/action-cases/projectDiaryHttp'
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60
export async function POST(request: NextRequest, route: { params: Promise<{ token: string; photoId: string; part: string }> }) {
  try {
    const { token, photoId, part } = await route.params
    if (!/^[0-3]$/.test(part)) throw new Error('PROJECT_DIARY_PHOTO')
    const identity = { token, device: diaryRequestCookie(request, token) }
    return diaryJson(await storeDiaryPhotoPart(identity, photoId, Number(part), await diaryPhotoPartBody(request)))
  } catch (error) { return diaryError(error) }
}
