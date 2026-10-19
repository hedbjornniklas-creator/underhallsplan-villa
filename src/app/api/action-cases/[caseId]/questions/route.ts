import { after, NextResponse } from 'next/server'
import { customerOfferContext, customerOfferError, offerRequestBody } from '@/lib/action-cases/customerOffersHttp'
import { getProjectQuestions, mutateProjectQuestion } from '@/lib/action-cases/projectQuestionsServer'
import { runTaskFollowupBatch } from '@/lib/tasks/automation'

export const dynamic = 'force-dynamic'
type Route = { params: Promise<{ caseId: string }> }
export async function GET(_request: Request, route: Route) {
  try { return NextResponse.json(await getProjectQuestions(await customerOfferContext(), (await route.params).caseId), { headers: { 'Cache-Control': 'no-store' } }) }
  catch (error) { return customerOfferError(error) }
}
export async function POST(request: Request, route: Route) {
  try {
    const ctx = await customerOfferContext(), body = await offerRequestBody(request)
    const result = await mutateProjectQuestion(ctx, (await route.params).caseId, body)
    if (body.operation === 'send') after(async () => {
      try { await runTaskFollowupBatch({ limit: 5 }) } catch { console.error('PROJECT_QUESTION_FOLLOWUP_FAILED') }
    })
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) { return customerOfferError(error) }
}
