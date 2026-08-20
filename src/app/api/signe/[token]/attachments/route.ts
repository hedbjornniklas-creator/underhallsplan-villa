import { NextResponse } from 'next/server'
import { getExternalTaskWorkspace, requireExternalTaskActor } from '@/lib/tasks/external'
import { storeTaskFileEvidence, storeTaskTextEvidence } from '@/lib/tasks/attachments'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function errorResponse(error: unknown) {
  const code = error instanceof Error ? error.message : 'TASK_ATTACHMENT_FAILED'
  const status = code === 'TASK_ACCESS_NOT_FOUND' ? 404 : code === 'TASK_ACCESS_CLOSED' ? 410 : code === 'TASK_ATTACHMENT_LOCKED' ? 409 : code.includes('FORBIDDEN') ? 403 : code.includes('EMPTY') || code.includes('TOO_LARGE') || code.includes('TYPE_INVALID') || code.includes('TEXT_REQUIRED') ? 400 : 500
  const message =
    code === 'TASK_ACCESS_CLOSED'
      ? 'Länken har gått ut eller återkallats.'
      : code === 'TASK_ATTACHMENT_LOCKED'
        ? 'Uppgiften är inskickad för kontroll och underlaget är låst.'
      : code === 'TASK_ATTACHMENT_TOO_LARGE'
        ? 'Filen är för stor. Maximal storlek är 25 MB.'
        : code === 'TASK_ATTACHMENT_TYPE_INVALID'
          ? 'Filtypen stöds inte.'
          : 'Kunde inte spara underlaget.'
  return NextResponse.json({ error: message, code }, { status })
}

export async function POST(
  request: Request,
  context: { params: Promise<{ token: string }> }
) {
  try {
    const contentLength = Number(request.headers.get('content-length'))
    if (Number.isFinite(contentLength) && contentLength > 26 * 1024 * 1024) {
      throw new Error('TASK_ATTACHMENT_TOO_LARGE')
    }
    const { token } = await context.params
    const { access, task, actor } = await requireExternalTaskActor(token)
    const form = await request.formData()
    const text = String(form.get('text') ?? '').trim()
    if (text) {
      await storeTaskTextEvidence({
        orgId: access.org_id,
        taskId: task.id,
        actor,
        text,
        completionEvidence: form.get('completionEvidence') !== 'false',
      })
    } else {
      const file = form.get('file')
      if (!(file instanceof File)) throw new Error('TASK_ATTACHMENT_EMPTY')
      await storeTaskFileEvidence({
        orgId: access.org_id,
        taskId: task.id,
        actor,
        file,
        completionEvidence: form.get('completionEvidence') !== 'false',
      })
    }
    const workspace = await getExternalTaskWorkspace(token)
    if (!workspace) throw new Error('TASK_ACCESS_NOT_FOUND')
    return NextResponse.json({ workspace, notice: 'Underlaget sparades.' })
  } catch (error) {
    return errorResponse(error)
  }
}
