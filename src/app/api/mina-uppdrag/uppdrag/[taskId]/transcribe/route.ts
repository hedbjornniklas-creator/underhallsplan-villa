import { NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { transcribeAndStoreTaskAudio } from '@/lib/tasks/attachments'
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
    const audio = form.get('audio')
    if (!(audio instanceof File)) throw new Error('TASK_ATTACHMENT_EMPTY')
    const rawDuration = Number(form.get('durationSeconds'))
    const admin = createSupabaseAdminClient()
    const { error: attemptError } = await admin.rpc('register_operational_task_transcription_attempt', {
      p_org_id: actorContext.orgId,
      p_task_id: taskId,
      p_actor_profile_id: null,
      p_actor_contact_id: actorContext.contactId,
      p_actor_access_link_id: actorContext.accessLinkId,
      p_byte_size: audio.size,
    })
    if (attemptError) {
      const knownCode = [
        'TASK_RATE_LIMITED',
        'TASK_ATTACHMENT_LOCKED',
        'TASK_NOT_FOUND',
        'TASK_TRANSCRIPTION_ACTOR_FORBIDDEN',
      ].find((code) => attemptError.message.includes(code))
      throw new Error(knownCode ?? 'TASK_RATE_LIMIT_AUDIT_FAILED')
    }
    const result = await transcribeAndStoreTaskAudio({
      orgId: actorContext.orgId,
      taskId,
      actor: actorContext.actor,
      audio,
      durationSeconds: Number.isFinite(rawDuration) ? rawDuration : null,
      completionEvidence: form.get('completionEvidence') !== 'false',
    })
    const workspace = await getRecipientPortalTaskWorkspace(session, taskId)
    if (!workspace) throw new Error('TASK_NOT_FOUND')
    return NextResponse.json(
      {
        workspace,
        transcript: result.transcript,
        notice: 'Röstmeddelandet transkriberades.',
      },
      { headers: { 'Cache-Control': 'private, no-store' } }
    )
  } catch (error) {
    const code = error instanceof Error ? error.message : 'TASK_TRANSCRIPTION_FAILED'
    if (code === 'MISSING_ENV:OPENAI_API_KEY') {
      return NextResponse.json(
        { error: 'Taltranskribering är inte konfigurerad.', code },
        { status: 503 }
      )
    }
    if (code === 'TASK_TRANSCRIPTION_EMPTY') {
      return NextResponse.json(
        { error: 'Ingen text kunde uppfattas i inspelningen.', code },
        { status: 422 }
      )
    }
    return recipientPortalErrorResponse(error, 'Kunde inte transkribera inspelningen.')
  }
}
