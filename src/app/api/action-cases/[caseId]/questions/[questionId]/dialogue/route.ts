import { after, NextResponse } from 'next/server'
import { customerOfferContext, customerOfferError, offerRequestBody } from '@/lib/action-cases/customerOffersHttp'
import { createQuestionContact, deliverQuestionMessages, getQuestionDialogue, writeQuestionDialogue, replyQuestionTask } from '@/lib/action-cases/questionDialogueServer'
import { runTaskFollowupBatch } from '@/lib/tasks/automation'

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
    if (body.operation === 'contact') return NextResponse.json({ person: await createQuestionContact(ctx, caseId, questionId, body) }, { headers: { 'Cache-Control': 'no-store' } })
    if (body.operation === 'task_reply') {
      const result = await replyQuestionTask(ctx, caseId, questionId, body)
      after(async () => { try { await runTaskFollowupBatch({ limit: 5 }) } catch { console.error('PROJECT_QUESTION_TASK_DELIVERY_FAILED') } })
      return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } })
    }
    const result = await writeQuestionDialogue(ctx, caseId, questionId, body)
    if (['share', 'reply'].includes(String(body.operation))) after(async () => { try { await deliverQuestionMessages(questionId) } catch { console.error('PROJECT_QUESTION_DELIVERY_FAILED') } })
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    if (error instanceof Error && error.message === 'PROJECT_QUESTION_TASK_RECIPIENT_CHANGED') return NextResponse.json({ error: 'Uppgiftens mottagare har ändrats. Din text finns kvar. Hämta frågan och bekräfta den aktuella mottagaren innan du skickar igen.', code: error.message }, { status: 409, headers: { 'Cache-Control': 'no-store' } })
    return customerOfferError(error)
  }
}
