import { customerOfferContext } from '@/lib/action-cases/customerOffersHttp'
import { completeDiaryPhoto, prepareDiaryPhoto } from '@/lib/action-cases/projectDiaryServer'
import { diaryError, diaryJson, diaryRequestBody } from '@/lib/action-cases/projectDiaryHttp'
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
export const maxDuration = 60
export async function POST(request: Request, route: { params: Promise<{ caseId: string }> }) {
  try {
    const ctx = await customerOfferContext(), { caseId } = await route.params, data = await diaryRequestBody(request)
    if (data.operation === 'prepare') return diaryJson(await prepareDiaryPhoto({ ctx, caseId }, data))
    if (data.operation === 'complete') return diaryJson(await completeDiaryPhoto({ ctx, caseId }, data.id))
    throw new Error('PROJECT_DIARY_INVALID')
  } catch (error) { return diaryError(error) }
}
