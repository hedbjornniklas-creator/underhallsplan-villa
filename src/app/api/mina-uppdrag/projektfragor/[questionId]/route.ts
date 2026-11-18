import { after, NextResponse } from 'next/server'
import { getRecipientQuestionDialogue, replyRecipientQuestion, deliverQuestionMessages } from '@/lib/action-cases/questionDialogueServer'
import { customerOfferError, offerRequestBody } from '@/lib/action-cases/customerOffersHttp'
import { requireRecipientPortalSession } from '@/lib/tasks/recipientPortal'

export const dynamic = 'force-dynamic'
type Route = { params: Promise<{ questionId: string }> }
const headers = { 'Cache-Control': 'private, no-store' }
export async function GET(_request: Request, route: Route) {
  try {
    const session = await requireRecipientPortalSession(), { questionId } = await route.params
    return NextResponse.json(await getRecipientQuestionDialogue(session.authUserId, questionId), { headers })
  } catch (error) { return customerOfferError(error) }
}
export async function POST(request: Request, route: Route) {
  try {
    const session = await requireRecipientPortalSession(), { questionId } = await route.params
    const body = await offerRequestBody(request)
    const result = await replyRecipientQuestion(session.authUserId, questionId, body)
    after(async () => { try { await deliverQuestionMessages(questionId) } catch { console.error('PROJECT_QUESTION_DELIVERY_FAILED') } })
    return NextResponse.json(result, { headers })
  } catch (error) { return customerOfferError(error) }
}
