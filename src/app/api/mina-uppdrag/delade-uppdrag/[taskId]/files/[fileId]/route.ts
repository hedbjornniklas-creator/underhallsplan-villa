import { NextResponse } from 'next/server'
import { requireRecipientPortalSession } from '@/lib/tasks/recipientPortal'
import { recipientParticipationFile } from '@/lib/tasks/recipientParticipation'
import { recipientPortalErrorResponse } from '@/lib/tasks/recipientPortalHttp'

export const dynamic = 'force-dynamic'
export async function GET(_request: Request, route: { params: Promise<{ taskId: string; fileId: string }> }) {
  try {
    const session = await requireRecipientPortalSession(), { taskId, fileId } = await route.params
    return NextResponse.redirect(await recipientParticipationFile(session, taskId, fileId), { status: 307, headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) { return recipientPortalErrorResponse(error) }
}
