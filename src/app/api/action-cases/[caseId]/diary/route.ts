import { after } from 'next/server'
import { customerOfferContext } from '@/lib/action-cases/customerOffersHttp'
import { addDiaryPerson, cleanupDiaryUploads, correctDiaryEntry, getProjectDiary, getDiaryHistory, reviseDiaryEntry, setDiaryLink, submitDiaryEntry } from '@/lib/action-cases/projectDiaryServer'
import { diaryError, diaryJson, diaryRequestBody } from '@/lib/action-cases/projectDiaryHttp'
export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
type Route = { params: Promise<{ caseId: string }> }
export async function GET(request: Request, route: Route) {
  try {
    const ctx = await customerOfferContext(), { caseId } = await route.params
    const search = new URL(request.url).searchParams
    if (search.has('history')) return diaryJson(await getDiaryHistory(ctx, caseId, search.get('history')!, search.get('beforeRevision')))
    const result = await getProjectDiary(ctx, caseId, search)
    if (result.canManage) after(async () => { try { await cleanupDiaryUploads(ctx, caseId) } catch { console.error('PROJECT_DIARY_CLEANUP_FAILED') } })
    return diaryJson(result)
  } catch (error) { return diaryError(error) }
}
export async function POST(request: Request, route: Route) {
  try {
    const ctx = await customerOfferContext(), { caseId } = await route.params, data = await diaryRequestBody(request)
    if (data.operation === 'link') return diaryJson(await setDiaryLink(ctx, caseId, data))
    if (data.operation === 'person') return diaryJson(await addDiaryPerson({ ctx, caseId }, data))
    if (data.operation === 'entry') return diaryJson(await submitDiaryEntry({ ctx, caseId }, data))
    if (data.operation === 'correction') return diaryJson(await correctDiaryEntry(ctx, caseId, data))
    if (data.operation === 'revision') return diaryJson(await reviseDiaryEntry(ctx, caseId, data))
    throw new Error('PROJECT_DIARY_INVALID')
  } catch (error) { return diaryError(error) }
}
