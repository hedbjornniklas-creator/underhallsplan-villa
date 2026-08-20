import { NextResponse } from 'next/server'
import { requireModuleAccess } from '@/lib/access/server'
import { requireOrgContext } from '@/lib/assignments/server'
import { createTaskAttachmentSignedUrl } from '@/lib/tasks/attachments'
import { requireInternalTaskViewer } from '@/lib/tasks/internalActor'

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
