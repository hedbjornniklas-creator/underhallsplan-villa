import { customerOfferContext, customerOfferError } from '@/lib/action-cases/customerOffersHttp'
import { diaryError, diaryJson, diaryRequestBody } from '@/lib/action-cases/projectDiaryHttp'
import { attachDiaryImageToQuestion } from '@/lib/action-cases/questionDiaryImagesServer'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60
export async function POST(request: Request, route: { params: Promise<{ caseId: string; questionId: string }> }) {
  try {
    const ctx = await customerOfferContext(), { caseId, questionId } = await route.params, body = await diaryRequestBody(request)
    return diaryJson({ file: await attachDiaryImageToQuestion(ctx, caseId, questionId, body.photoId) })
  } catch (error) { return error instanceof Error && error.message.startsWith('PROJECT_DIARY_') ? diaryError(error) : customerOfferError(error) }
}
