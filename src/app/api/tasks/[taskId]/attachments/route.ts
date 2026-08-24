import { NextResponse } from 'next/server'
import { requireModuleAccess } from '@/lib/access/server'
import { requireOrgContext } from '@/lib/assignments/server'
import { getTaskWorkspace } from '@/lib/tasks/server'
import { requireInternalTaskActor } from '@/lib/tasks/internalActor'
import { storeTaskFileEvidence, storeTaskTextEvidence } from '@/lib/tasks/attachments'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function errorResponse(error: unknown) {
  const code = error instanceof Error ? error.message : 'TASK_ATTACHMENT_FAILED'
  const errors: Record<string, [string, number]> = {
    UNAUTHORIZED: ['Inte inloggad.', 401],
    MODULE_ACCESS_REQUIRED: ['Du saknar behörighet till Uppdrag.', 403],
    ORG_MEMBERSHIP_REQUIRED: ['Du saknar en aktiv organisation.', 403],
    TASK_NOT_FOUND: ['Uppgiften kunde inte hittas.', 404],
    TASK_ATTACHMENT_FORBIDDEN: ['Du får inte lägga till underlag på uppgiften.', 403],
    TASK_ATTACHMENT_LOCKED: ['Uppgiften är inskickad för kontroll och underlaget är låst.', 409],
    TASK_EVIDENCE_TEXT_REQUIRED: ['Skriv en textredovisning.', 400],
    TASK_ATTACHMENT_EMPTY: ['Filen är tom.', 400],
    TASK_ATTACHMENT_TOO_LARGE: ['Filen är för stor. Maximal storlek är 25 MB.', 400],
    TASK_ATTACHMENT_TYPE_INVALID: ['Filtypen stöds inte.', 400],
    TASK_COMPLETION_EVIDENCE_TYPE_INVALID: ['Filtypen motsvarar inte något valt krav på färdigbevis.', 400],
  }
  const mapped = errors[code]
  return NextResponse.json(
    { error: mapped?.[0] ?? 'Kunde inte spara underlaget.', code },
    { status: mapped?.[1] ?? 500 }
  )
}

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
    const form = await request.formData()
    const text = String(form.get('text') ?? '').trim()
    if (text) {
      await storeTaskTextEvidence({
        orgId: org.orgId,
        taskId,
        actor,
        text,
        title: String(form.get('title') ?? '').trim() || null,
        completionEvidence: form.get('completionEvidence') !== 'false',
      })
    } else {
      const file = form.get('file')
      if (!(file instanceof File)) throw new Error('TASK_ATTACHMENT_EMPTY')
      await storeTaskFileEvidence({
        orgId: org.orgId,
        taskId,
        actor,
        file,
        completionEvidence: form.get('completionEvidence') !== 'false',
        title: String(form.get('title') ?? '').trim() || null,
      })
    }
    const workspace = await getTaskWorkspace({
      orgId: org.orgId,
      userId: org.userId,
      isOrgAdmin: org.role === 'admin',
    })
    return NextResponse.json({ workspace, notice: 'Underlaget sparades.' })
  } catch (error) {
    return errorResponse(error)
  }
}
