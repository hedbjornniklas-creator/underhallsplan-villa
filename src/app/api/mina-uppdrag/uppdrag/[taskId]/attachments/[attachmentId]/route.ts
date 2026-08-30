import { NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { createTaskAttachmentSignedUrl, updateTaskAudioTranscript } from '@/lib/tasks/attachments'
import {
  getRecipientPortalTaskWorkspace,
  requireRecipientPortalSession,
  requireRecipientPortalTaskActor,
  requireRecipientPortalTaskScope,
} from '@/lib/tasks/recipientPortal'
import { recipientPortalErrorResponse } from '@/lib/tasks/recipientPortalHttp'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  _request: Request,
  context: { params: Promise<{ taskId: string; attachmentId: string }> }
) {
  try {
    const { taskId, attachmentId } = await context.params
    const session = await requireRecipientPortalSession()
    const taskContext = await requireRecipientPortalTaskScope({
      session,
      taskId,
    })
    const admin = createSupabaseAdminClient()
    const { data: attachment, error } = await admin
      .from('task_attachments')
      .select('id')
      .eq('id', attachmentId)
      .eq('task_id', taskId)
      .eq('org_id', taskContext.orgId)
      .or(
        `uploaded_by_contact_id.eq.${taskContext.contactId},and(is_completion_evidence.eq.false,uploaded_by_profile_id.eq.${taskContext.task.issuer_profile_id})`
      )
      .maybeSingle()
    if (error || !attachment) throw new Error('TASK_ATTACHMENT_NOT_FOUND')
    const signedUrl = await createTaskAttachmentSignedUrl({
      orgId: taskContext.orgId,
      taskId,
      attachmentId,
    })
    return NextResponse.redirect(signedUrl, {
      headers: { 'Cache-Control': 'private, no-store' },
    })
  } catch (error) {
    return recipientPortalErrorResponse(error, 'Bilagan kunde inte öppnas.')
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ taskId: string; attachmentId: string }> }
) {
  try {
    const { taskId, attachmentId } = await context.params
    const session = await requireRecipientPortalSession()
    const actorContext = await requireRecipientPortalTaskActor({ session, taskId })
    const body = (await request.json().catch(() => ({}))) as { transcript?: unknown }
    await updateTaskAudioTranscript({
      orgId: actorContext.orgId,
      taskId,
      attachmentId,
      actor: actorContext.actor,
      transcript: body.transcript,
    })
    const workspace = await getRecipientPortalTaskWorkspace(session, taskId)
    if (!workspace) throw new Error('TASK_NOT_FOUND')
    return NextResponse.json(
      { workspace, notice: 'Transkriberingen uppdaterades.' },
      { headers: { 'Cache-Control': 'private, no-store' } }
    )
  } catch (error) {
    return recipientPortalErrorResponse(error, 'Transkriberingen kunde inte uppdateras.')
  }
}
