import { NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { createTaskAttachmentSignedUrl, updateTaskAudioTranscript } from '@/lib/tasks/attachments'
import { getExternalTaskWorkspace, requireExternalTaskActor } from '@/lib/tasks/external'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  _request: Request,
  context: { params: Promise<{ token: string; attachmentId: string }> }
) {
  try {
    const { token, attachmentId } = await context.params
    const { access, task } = await requireExternalTaskActor(token, {
      allowLocked: true,
      allowTerminalReadOnlyRecipient: true,
    })
    const admin = createSupabaseAdminClient()
    const { data: attachment, error } = await admin
      .from('task_attachments')
      .select('id')
      .eq('id', attachmentId)
      .eq('task_id', task.id)
      .or(
        `uploaded_by_contact_id.eq.${access.contact_id},and(is_completion_evidence.eq.false,uploaded_by_profile_id.eq.${task.issuer_profile_id})`
      )
      .maybeSingle()
    if (error || !attachment) throw new Error('TASK_ATTACHMENT_NOT_FOUND')
    const signedUrl = await createTaskAttachmentSignedUrl({
      orgId: access.org_id,
      taskId: task.id,
      attachmentId,
    })
    const response = NextResponse.redirect(signedUrl)
    response.headers.set('Cache-Control', 'private, no-store')
    response.headers.set('Referrer-Policy', 'no-referrer')
    return response
  } catch (error) {
    const code = error instanceof Error ? error.message : 'TASK_ATTACHMENT_FAILED'
    const status = code === 'TASK_ACCESS_NOT_FOUND' || code === 'TASK_ATTACHMENT_NOT_FOUND' ? 404 : code === 'TASK_ACCESS_CLOSED' ? 410 : 403
    return NextResponse.json({ error: 'Bilagan kunde inte öppnas.', code }, { status })
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ token: string; attachmentId: string }> }
) {
  try {
    const { token, attachmentId } = await context.params
    const { access, task, actor } = await requireExternalTaskActor(token)
    const body = (await request.json().catch(() => ({}))) as { transcript?: unknown }
    await updateTaskAudioTranscript({
      orgId: access.org_id,
      taskId: task.id,
      attachmentId,
      actor,
      transcript: body.transcript,
    })
    const workspace = await getExternalTaskWorkspace(token)
    if (!workspace) throw new Error('TASK_ACCESS_NOT_FOUND')
    return NextResponse.json({ workspace, notice: 'Transkriberingen uppdaterades.' })
  } catch (error) {
    const code = error instanceof Error ? error.message : 'TASK_TRANSCRIPT_UPDATE_FAILED'
    const status = code === 'TASK_ACCESS_NOT_FOUND' || code === 'TASK_ATTACHMENT_NOT_FOUND'
      ? 404
      : code === 'TASK_ACCESS_CLOSED'
        ? 410
        : code === 'TASK_ATTACHMENT_LOCKED'
          ? 409
          : code === 'TASK_TRANSCRIPT_REQUIRED' || code === 'TASK_TRANSCRIPT_TOO_LONG'
            ? 400
            : code.includes('FORBIDDEN')
              ? 403
              : 500
    const message = code === 'TASK_TRANSCRIPT_REQUIRED'
      ? 'Transkriberingen får inte vara tom.'
      : code === 'TASK_TRANSCRIPT_TOO_LONG'
        ? 'Transkriberingen är för lång.'
        : code === 'TASK_ATTACHMENT_LOCKED'
          ? 'Uppgiften är inskickad för kontroll och underlaget är låst.'
          : code === 'TASK_ACCESS_CLOSED'
            ? 'Länken har gått ut eller återkallats.'
            : 'Transkriberingen kunde inte uppdateras.'
    return NextResponse.json({ error: message, code }, { status })
  }
}
