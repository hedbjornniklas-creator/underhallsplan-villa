import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { getTuInvestigationById, requireTuContext } from '@/lib/tu/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const OPENAI_TRANSCRIPTIONS_URL = 'https://api.openai.com/v1/audio/transcriptions'
const TRANSCRIPTION_MODEL = process.env.OPENAI_TU_TRANSCRIPTION_MODEL?.trim() || 'gpt-4o-transcribe'
const AUDIO_BUCKET = 'tu-investigation-audio'
const MAX_AUDIO_BYTES = 25 * 1024 * 1024

const CONTENT_TYPE_EXTENSION: Record<string, string> = {
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/x-m4a': 'm4a',
}

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

function normalizedContentType(value: string) {
  const base = value.split(';')[0]?.trim().toLowerCase() ?? ''
  return base in CONTENT_TYPE_EXTENSION ? base : 'audio/webm'
}

function mapError(error: unknown) {
  const message = error instanceof Error ? error.message : ''
  if (message === 'UNAUTHORIZED') return jsonError('Inte inloggad.', 401)
  if (message === 'MODULE_ACCESS_REQUIRED') return jsonError('TU kräver egen modulbehörighet.', 403)
  if (message === 'ORG_MEMBERSHIP_REQUIRED') return jsonError('Ingen organisationskoppling hittades.', 403)
  if (message === 'TU_INVESTIGATION_NOT_FOUND') return jsonError('TU-utredningen hittades inte.', 404)
  if (message === 'TU_REPORT_LOCKED') return jsonError('Utlåtandet är låst och kan inte ändras.', 409)
  return null
}

export async function POST(
  request: Request,
  context: { params: Promise<{ inspectionId: string }> }
) {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return jsonError('OPENAI_API_KEY saknas på servern.', 500)

  let storedPath: string | null = null
  let storageClient: ReturnType<typeof createSupabaseAdminClient> | null = null
  try {
    const { inspectionId } = await context.params
    const orgContext = await requireTuContext()
    const investigation = await getTuInvestigationById({ orgId: orgContext.orgId, inspectionId })
    if (!investigation) throw new Error('TU_INVESTIGATION_NOT_FOUND')
    if (investigation.reportLockedAt) throw new Error('TU_REPORT_LOCKED')

    const formData = await request.formData()
    const audio = formData.get('audio')
    if (!(audio instanceof File)) return jsonError('Röstinspelning saknas.', 400)
    if (audio.size <= 0) return jsonError('Röstinspelningen är tom.', 400)
    if (audio.size > MAX_AUDIO_BYTES) return jsonError('Röstinspelningen är för stor (max 25 MB).', 400)

    const contentType = normalizedContentType(audio.type)
    const extension = CONTENT_TYPE_EXTENSION[contentType]
    storedPath = `${inspectionId}/voice/${Date.now()}-${randomUUID().slice(0, 8)}.${extension}`
    const admin = createSupabaseAdminClient()
    storageClient = admin
    const bytes = await audio.arrayBuffer()
    const { error: uploadError } = await admin.storage.from(AUDIO_BUCKET).upload(storedPath, bytes, {
      upsert: false,
      contentType,
      cacheControl: '3600',
    })
    if (uploadError) throw new Error(uploadError.message ?? 'Kunde inte lagra röstanteckningen.')

    const openAiForm = new FormData()
    openAiForm.append('model', TRANSCRIPTION_MODEL)
    openAiForm.append('language', 'sv')
    openAiForm.append(
      'prompt',
      'Svensk teknisk besiktning. Behåll byggtekniska termer, platsangivelser, måttenheter och osäkerhetsmarkörer ordagrant.'
    )
    openAiForm.append(
      'file',
      new File([bytes], `rostanteckning.${extension}`, { type: contentType })
    )

    const response = await fetch(OPENAI_TRANSCRIPTIONS_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: openAiForm,
    })
    if (!response.ok) {
      const detail = await response.text()
      console.error('[tu.observations.transcribe] OpenAI request failed', {
        status: response.status,
        detail: detail.slice(0, 500),
      })
      await admin.storage.from(AUDIO_BUCKET).remove([storedPath])
      storedPath = null
      return jsonError('Kunde inte transkribera röstanteckningen.', 502)
    }

    const payload = (await response.json()) as { text?: unknown }
    const transcript = typeof payload.text === 'string' ? payload.text.trim() : ''
    if (!transcript) {
      await admin.storage.from(AUDIO_BUCKET).remove([storedPath])
      storedPath = null
      return jsonError('Ingen text kunde uppfattas i inspelningen.', 422)
    }


    const rawDuration = Number(formData.get('durationSeconds'))
    return NextResponse.json({
      transcript,
      model: TRANSCRIPTION_MODEL,
      audio: {
        storageBucket: AUDIO_BUCKET,
        storagePath: storedPath,
        contentType,
        durationSeconds: Number.isFinite(rawDuration) ? Math.max(0, Math.round(rawDuration)) : null,
      },
    })
  } catch (error) {
    if (storedPath && storageClient) {
      const { error: cleanupError } = await storageClient.storage.from(AUDIO_BUCKET).remove([storedPath])
      if (cleanupError) {
        console.error('[tu.observations.transcribe] failed to clean up audio', cleanupError)
      }
    }
    const mapped = mapError(error)
    if (mapped) return mapped
    console.error('[tu.observations.transcribe] failed', error)
    return jsonError('Kunde inte hantera röstanteckningen.', 500)
  }
}
