import { NextResponse } from 'next/server'
import { requireModuleAccess } from '@/lib/access/server'
import { requireOrgContext } from '@/lib/assignments/server'
import { createTaskAttachmentSignedUrl, updateTaskAudioTranscript } from '@/lib/tasks/attachments'
import { requireInternalTaskActor, requireInternalTaskViewer } from '@/lib/tasks/internalActor'
import { getTaskWorkspace } from '@/lib/tasks/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  _request: Request,
  context: { params: Promise<{ taskId: string; attachmentId: string }> }
) {
  try {
    const { taskId, attachmentId } = await context.params
    const org = await requireOrgContext()
    await requireModuleAccess({
      productKey: 'dashboard',
      moduleKey: 'tasks',
      scopeType: 'organization',
      scopeId: org.orgId,
    })
    await requireInternalTaskViewer({
      orgId: org.orgId,
      userId: org.userId,
      isOrgAdmin: org.role === 'admin',
      taskId,
    })
    const signedUrl = await createTaskAttachmentSignedUrl({
      orgId: org.orgId,
      taskId,
      attachmentId,
    })
    return NextResponse.redirect(signedUrl)
  } catch (error) {
    const code = error instanceof Error ? error.message : 'TASK_ATTACHMENT_FAILED'
    const status = code === 'UNAUTHORIZED' ? 401 : code.includes('FORBIDDEN') || code === 'MODULE_ACCESS_REQUIRED' ? 403 : 404
    return NextResponse.json({ error: 'Bilagan kunde inte öppnas.', code }, { status })
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ taskId: string; attachmentId: string }> }
) {
  try {
    const { taskId, attachmentId } = await context.params
    const org = await requireOrgContext()
    await requireModuleAccess({
      productKey: 'dashboard',
      moduleKey: 'tasks',
      scopeType: 'organization',
      scopeId: org.orgId,
    })
    const { actor } = await requireInternalTaskActor({
      orgId: org.orgId,
      userId: org.userId,
      isOrgAdmin: org.role === 'admin',
      taskId,
    })
    const body = (await request.json().catch(() => ({}))) as { transcript?: unknown }
    await updateTaskAudioTranscript({
      orgId: org.orgId,
      taskId,
      attachmentId,
      actor,
      transcript: body.transcript,
    })
    const workspace = await getTaskWorkspace({
      orgId: org.orgId,
      userId: org.userId,
      isOrgAdmin: org.role === 'admin',
    })
    return NextResponse.json({ workspace, notice: 'Transkriberingen uppdaterades.' })
  } catch (error) {
    const code = error instanceof Error ? error.message : 'TASK_TRANSCRIPT_UPDATE_FAILED'
    const status = code === 'UNAUTHORIZED'
      ? 401
      : code.includes('FORBIDDEN') || code === 'MODULE_ACCESS_REQUIRED'
        ? 403
        : code === 'TASK_ATTACHMENT_NOT_FOUND' || code === 'TASK_NOT_FOUND'
          ? 404
          : code === 'TASK_ATTACHMENT_LOCKED'
            ? 409
            : code === 'TASK_TRANSCRIPT_REQUIRED' || code === 'TASK_TRANSCRIPT_TOO_LONG'
              ? 400
              : 500
    const message = code === 'TASK_TRANSCRIPT_REQUIRED'
      ? 'Transkriberingen får inte vara tom.'
      : code === 'TASK_TRANSCRIPT_TOO_LONG'
        ? 'Transkriberingen är för lång.'
        : code === 'TASK_ATTACHMENT_LOCKED'
          ? 'Uppgiften är inskickad för kontroll och underlaget är låst.'
          : 'Transkriberingen kunde inte uppdateras.'
    return NextResponse.json({ error: message, code }, { status })
  }
}
