import { NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { getExternalTaskWorkspace, requireExternalTaskActor } from '@/lib/tasks/external'
import { transcribeAndStoreTaskAudio } from '@/lib/tasks/attachments'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

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
    const audio = form.get('audio')
    if (!(audio instanceof File)) throw new Error('TASK_ATTACHMENT_EMPTY')
    const duration = Number(form.get('durationSeconds'))
    const admin = createSupabaseAdminClient()
    const { error: attemptError } = await admin.rpc('register_operational_task_transcription_attempt', {
      p_org_id: access.org_id,
      p_task_id: task.id,
      p_actor_profile_id: null,
      p_actor_contact_id: access.contact_id,
      p_actor_access_link_id: access.id,
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
      orgId: access.org_id,
      taskId: task.id,
      actor,
      audio,
      durationSeconds: Number.isFinite(duration) ? duration : null,
      completionEvidence: form.get('completionEvidence') !== 'false',
    })
    const workspace = await getExternalTaskWorkspace(token)
    if (!workspace) throw new Error('TASK_ACCESS_NOT_FOUND')
    return NextResponse.json({
      workspace,
      transcript: result.transcript,
      notice: 'Röstmeddelandet transkriberades.',
    })
  } catch (error) {
    const code = error instanceof Error ? error.message : 'TASK_TRANSCRIPTION_FAILED'
    const status = code === 'TASK_ACCESS_NOT_FOUND' ? 404 : code === 'TASK_ACCESS_CLOSED' ? 410 : code === 'TASK_RATE_LIMITED' ? 429 : code === 'TASK_ATTACHMENT_LOCKED' ? 409 : code.includes('FORBIDDEN') ? 403 : code.includes('EMPTY') || code.includes('TYPE_INVALID') || code.includes('TOO_LARGE') ? 400 : code === 'TASK_TRANSCRIPTION_EMPTY' ? 422 : 502
    return NextResponse.json(
      {
        error:
          code === 'TASK_ACCESS_CLOSED'
            ? 'Länken har gått ut eller återkallats.'
            : code === 'TASK_RATE_LIMITED'
              ? 'För många röstmeddelanden på kort tid. Försök igen senare.'
            : code === 'TASK_ATTACHMENT_LOCKED'
              ? 'Uppgiften är inskickad för kontroll och underlaget är låst.'
            : code === 'MISSING_ENV:OPENAI_API_KEY'
              ? 'Taltranskribering är inte konfigurerad.'
              : 'Kunde inte transkribera inspelningen.',
        code,
      },
      { status }
    )
  }
}
