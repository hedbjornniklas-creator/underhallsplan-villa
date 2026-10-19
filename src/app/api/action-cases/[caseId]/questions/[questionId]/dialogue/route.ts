import { after, NextResponse } from 'next/server'
import { customerOfferContext, customerOfferError, offerRequestBody } from '@/lib/action-cases/customerOffersHttp'
import { deliverQuestionMessages, getQuestionDialogue, writeQuestionDialogue } from '@/lib/action-cases/questionDialogueServer'

export const dynamic = 'force-dynamic'
type Route = { params: Promise<{ caseId: string; questionId: string }> }
export async function GET(_request: Request, route: Route) {
  try {
    const ctx = await customerOfferContext(), { caseId, questionId } = await route.params
    return NextResponse.json(await getQuestionDialogue(ctx, caseId, questionId), { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) { return customerOfferError(error) }
}
export async function POST(request: Request, route: Route) {
  try {
    const ctx = await customerOfferContext(), { caseId, questionId } = await route.params, body = await offerRequestBody(request)
    const result = await writeQuestionDialogue(ctx, caseId, questionId, body)
    if (['share', 'reply'].includes(String(body.operation))) after(async () => { try { await deliverQuestionMessages(questionId) } catch { console.error('PROJECT_QUESTION_DELIVERY_FAILED') } })
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) { return customerOfferError(error) }
}
