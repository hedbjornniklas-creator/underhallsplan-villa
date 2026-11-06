import { customerOfferContext } from '@/lib/action-cases/customerOffersHttp'
import { storeDiaryPhotoPart } from '@/lib/action-cases/projectDiaryServer'
import { diaryError, diaryJson, diaryPhotoPartBody } from '@/lib/action-cases/projectDiaryHttp'
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60
export async function POST(request: Request, route: { params: Promise<{ caseId: string; photoId: string; part: string }> }) {
  try {
    const ctx = await customerOfferContext(), { caseId, photoId, part } = await route.params
    if (!/^[0-3]$/.test(part)) throw new Error('PROJECT_DIARY_PHOTO')
    return diaryJson(await storeDiaryPhotoPart({ ctx, caseId }, photoId, Number(part), await diaryPhotoPartBody(request)))
  } catch (error) { return diaryError(error) }
}
