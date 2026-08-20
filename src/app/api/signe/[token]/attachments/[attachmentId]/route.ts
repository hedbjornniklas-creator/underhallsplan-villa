import { NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { createTaskAttachmentSignedUrl } from '@/lib/tasks/attachments'
import { requireExternalTaskActor } from '@/lib/tasks/external'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  _request: Request,
  context: { params: Promise<{ token: string; attachmentId: string }> }
) {
  try {
    const { token, attachmentId } = await context.params
    const { access, task } = await requireExternalTaskActor(token, { allowLocked: true })
    const admin = createSupabaseAdminClient()
    const { data: attachment, error } = await admin
      .from('task_attachments')
      .select('id')
      .eq('id', attachmentId)
      .eq('task_id', task.id)
      .eq('uploaded_by_contact_id', access.contact_id)
      .maybeSingle()
    if (error || !attachment) throw new Error('TASK_ATTACHMENT_NOT_FOUND')
    const signedUrl = await createTaskAttachmentSignedUrl({
      orgId: access.org_id,
      taskId: task.id,
      attachmentId,
    })
    return NextResponse.redirect(signedUrl)
  } catch (error) {
    const code = error instanceof Error ? error.message : 'TASK_ATTACHMENT_FAILED'
    const status = code === 'TASK_ACCESS_NOT_FOUND' || code === 'TASK_ATTACHMENT_NOT_FOUND' ? 404 : code === 'TASK_ACCESS_CLOSED' ? 410 : 403
    return NextResponse.json({ error: 'Bilagan kunde inte öppnas.', code }, { status })
  }
}
