import { NextResponse } from 'next/server'
import { questionDialogueFile, recipientQuestionMember } from '@/lib/action-cases/questionDialogueServer'
import { customerOfferError } from '@/lib/action-cases/customerOffersHttp'
import { requireRecipientPortalSession } from '@/lib/tasks/recipientPortal'

export const dynamic = 'force-dynamic'
export async function GET(_request: Request, route: { params: Promise<{ questionId: string; fileId: string }> }) {
  try {
    const session = await requireRecipientPortalSession(), { questionId, fileId } = await route.params
    const member = await recipientQuestionMember(session.authUserId, questionId)
    return NextResponse.redirect(await questionDialogueFile(member.action_case_id, questionId, fileId, { recipientAuthUserId: session.authUserId }), { status: 307, headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) { return customerOfferError(error) }
}
