import { after, NextResponse } from 'next/server'
import { customerOfferError, offerRequestBody } from '@/lib/action-cases/customerOffersHttp'
import { deliverQuestionMessages, getPublicQuestionDialogue, writePublicQuestionDialogue } from '@/lib/action-cases/questionDialogueServer'

export const dynamic = 'force-dynamic'
type Route = { params: Promise<{ token: string }> }
const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }
export async function GET(_request: Request, route: Route) {
  try { return NextResponse.json(await getPublicQuestionDialogue((await route.params).token), { headers }) }
  catch (error) { return customerOfferError(error) }
}
export async function POST(request: Request, route: Route) {
  try {
    const result = await writePublicQuestionDialogue((await route.params).token, await offerRequestBody(request))
    after(async () => { try { await deliverQuestionMessages(result.questionId) } catch { console.error('PROJECT_QUESTION_DELIVERY_FAILED') } })
    return NextResponse.json(result, { headers })
  } catch (error) { return customerOfferError(error) }
}
