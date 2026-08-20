import { NextResponse } from 'next/server'
import { requireModuleAccess } from '@/lib/access/server'
import { requireOrgContext } from '@/lib/assignments/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { getTaskWorkspace } from '@/lib/tasks/server'
import { requireInternalTaskActor } from '@/lib/tasks/internalActor'
import { transcribeAndStoreTaskAudio } from '@/lib/tasks/attachments'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function errorResponse(error: unknown) {
  const code = error instanceof Error ? error.message : 'TASK_TRANSCRIPTION_FAILED'
  const status = code === 'UNAUTHORIZED' ? 401 : code.includes('FORBIDDEN') || code === 'MODULE_ACCESS_REQUIRED' ? 403 : code === 'TASK_NOT_FOUND' ? 404 : code === 'TASK_RATE_LIMITED' ? 429 : code === 'TASK_ATTACHMENT_LOCKED' ? 409 : code.includes('EMPTY') || code.includes('TYPE_INVALID') || code.includes('TOO_LARGE') ? 400 : code === 'TASK_TRANSCRIPTION_EMPTY' ? 422 : 502
  const message =
    code === 'MISSING_ENV:OPENAI_API_KEY'
      ? 'Taltranskribering är inte konfigurerad på servern.'
      : code === 'TASK_RATE_LIMITED'
        ? 'För många röstmeddelanden på kort tid. Försök igen senare.'
      : code === 'TASK_ATTACHMENT_LOCKED'
        ? 'Uppgiften är inskickad för kontroll och underlaget är låst.'
      : code === 'TASK_ATTACHMENT_TOO_LARGE'
        ? 'Inspelningen är för stor. Maximal storlek är 25 MB.'
        : code === 'TASK_TRANSCRIPTION_EMPTY'
          ? 'Ingen text kunde uppfattas i inspelningen.'
          : 'Kunde inte transkribera inspelningen.'
  return NextResponse.json({ error: message, code }, { status })
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
    const audio = form.get('audio')
    if (!(audio instanceof File)) throw new Error('TASK_ATTACHMENT_EMPTY')
    const rawDuration = Number(form.get('durationSeconds'))
    const admin = createSupabaseAdminClient()
    const { error: attemptError } = await admin.rpc('register_operational_task_transcription_attempt', {
      p_org_id: org.orgId,
      p_task_id: taskId,
      p_actor_profile_id: org.userId,
      p_actor_contact_id: null,
      p_actor_access_link_id: null,
      p_byte_size: audio.size,
    })
    if (attemptError) {
      const knownCode = [
        'TASK_RATE_LIMITED',
        'TASK_ATTACHMENT_LOCKED',
        'TASK_NOT_FOUND',
        'TASK_TRANSCRIPTION_ACTOR_FORBIDDEN',
      ].find((code) => attemptError.message.includes(code))
      if (knownCode) {
        throw new Error(knownCode)
      }
      throw new Error('TASK_RATE_LIMIT_AUDIT_FAILED')
    }
    const result = await transcribeAndStoreTaskAudio({
      orgId: org.orgId,
      taskId,
      actor,
      audio,
      durationSeconds: Number.isFinite(rawDuration) ? rawDuration : null,
      completionEvidence: form.get('completionEvidence') !== 'false',
    })
    const workspace = await getTaskWorkspace({
      orgId: org.orgId,
      userId: org.userId,
      isOrgAdmin: org.role === 'admin',
    })
    return NextResponse.json({ workspace, transcript: result.transcript, notice: 'Röstmeddelandet transkriberades.' })
  } catch (error) {
    return errorResponse(error)
  }
}
