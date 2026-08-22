import { NextResponse } from 'next/server'
import { storeTaskFileEvidence, storeTaskTextEvidence } from '@/lib/tasks/attachments'
import {
  getRecipientPortalTaskWorkspace,
  requireRecipientPortalSession,
  requireRecipientPortalTaskActor,
} from '@/lib/tasks/recipientPortal'
import { recipientPortalErrorResponse } from '@/lib/tasks/recipientPortalHttp'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(
  request: Request,
  context: { params: Promise<{ taskId: string }> }
) {
  try {
    const contentLength = Number(request.headers.get('content-length'))
    if (Number.isFinite(contentLength) && contentLength > 26 * 1024 * 1024) {
      throw new Error('TASK_ATTACHMENT_TOO_LARGE')
    }
    const { taskId } = await context.params
    const session = await requireRecipientPortalSession()
    const actorContext = await requireRecipientPortalTaskActor({ session, taskId })
    const form = await request.formData()
    const text = String(form.get('text') ?? '').trim()
    if (text) {
      await storeTaskTextEvidence({
        orgId: actorContext.orgId,
        taskId,
        actor: actorContext.actor,
        text,
        completionEvidence: form.get('completionEvidence') !== 'false',
      })
    } else {
      const file = form.get('file')
      if (!(file instanceof File)) throw new Error('TASK_ATTACHMENT_EMPTY')
      await storeTaskFileEvidence({
        orgId: actorContext.orgId,
        taskId,
        actor: actorContext.actor,
        file,
        completionEvidence: form.get('completionEvidence') !== 'false',
      })
    }
    const workspace = await getRecipientPortalTaskWorkspace(session, taskId)
    if (!workspace) throw new Error('TASK_NOT_FOUND')
    return NextResponse.json(
      { workspace, notice: 'Underlaget sparades.' },
      { headers: { 'Cache-Control': 'private, no-store' } }
    )
  } catch (error) {
    return recipientPortalErrorResponse(error, 'Kunde inte spara underlaget.')
  }
}
