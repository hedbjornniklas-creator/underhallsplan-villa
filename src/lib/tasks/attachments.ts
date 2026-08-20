import 'server-only'

import { randomUUID } from 'node:crypto'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'

export const TASK_EVIDENCE_BUCKET = 'task-evidence'
export const MAX_TASK_ATTACHMENT_BYTES = 25 * 1024 * 1024

const TRANSCRIPTIONS_URL = 'https://api.openai.com/v1/audio/transcriptions'
const TRANSCRIPTION_MODEL = process.env.OPENAI_TASK_TRANSCRIPTION_MODEL?.trim() || 'gpt-4o-transcribe'

type AllowedAttachment = { type: 'photo' | 'document' | 'audio'; extension: string }

const ALLOWED_CONTENT_TYPES: Record<string, AllowedAttachment> = {
  'image/jpeg': { type: 'photo', extension: 'jpg' },
  'image/png': { type: 'photo', extension: 'png' },
  'image/webp': { type: 'photo', extension: 'webp' },
  'image/heic': { type: 'photo', extension: 'heic' },
  'image/heif': { type: 'photo', extension: 'heif' },
  'application/pdf': { type: 'document', extension: 'pdf' },
  'application/msword': { type: 'document', extension: 'doc' },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': {
    type: 'document',
    extension: 'docx',
  },
  'application/vnd.ms-excel': { type: 'document', extension: 'xls' },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': {
    type: 'document',
    extension: 'xlsx',
  },
  'text/plain': { type: 'document', extension: 'txt' },
  'audio/webm': { type: 'audio', extension: 'webm' },
  'audio/ogg': { type: 'audio', extension: 'ogg' },
  'audio/mpeg': { type: 'audio', extension: 'mp3' },
  'audio/mp4': { type: 'audio', extension: 'm4a' },
  'audio/wav': { type: 'audio', extension: 'wav' },
  'audio/x-wav': { type: 'audio', extension: 'wav' },
  'audio/x-m4a': { type: 'audio', extension: 'm4a' },
}

const FALLBACK_CONTENT_TYPES: Record<string, { contentType: string; allowed: AllowedAttachment }> = {
  jpg: { contentType: 'image/jpeg', allowed: { type: 'photo', extension: 'jpg' } },
  jpeg: { contentType: 'image/jpeg', allowed: { type: 'photo', extension: 'jpg' } },
  png: { contentType: 'image/png', allowed: { type: 'photo', extension: 'png' } },
  webp: { contentType: 'image/webp', allowed: { type: 'photo', extension: 'webp' } },
  heic: { contentType: 'image/heic', allowed: { type: 'photo', extension: 'heic' } },
  heif: { contentType: 'image/heif', allowed: { type: 'photo', extension: 'heif' } },
  pdf: { contentType: 'application/pdf', allowed: { type: 'document', extension: 'pdf' } },
  doc: { contentType: 'application/msword', allowed: { type: 'document', extension: 'doc' } },
  docx: {
    contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    allowed: { type: 'document', extension: 'docx' },
  },
  xls: { contentType: 'application/vnd.ms-excel', allowed: { type: 'document', extension: 'xls' } },
  xlsx: {
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    allowed: { type: 'document', extension: 'xlsx' },
  },
  txt: { contentType: 'text/plain', allowed: { type: 'document', extension: 'txt' } },
}

export type TaskAttachmentActor =
  | {
      type: 'profile'
      profileId: string
      contactId?: null
      accessLinkId?: null
      name: string
    }
  | {
      type: 'contact'
      profileId?: null
      contactId: string
      accessLinkId: string
      name: string
    }

function normalizedContentType(value: string) {
  return value.split(';')[0]?.trim().toLowerCase() ?? ''
}

function resolveFileType(file: File) {
  const declaredContentType = normalizedContentType(file.type)
  const declared = ALLOWED_CONTENT_TYPES[declaredContentType]
  if (declared) return { contentType: declaredContentType, allowed: declared }
  if (declaredContentType && declaredContentType !== 'application/octet-stream') return null
  const extension = file.name.split('.').pop()?.toLowerCase() ?? ''
  return FALLBACK_CONTENT_TYPES[extension] ?? null
}

function safeFileName(value: string, fallbackExtension: string) {
  const normalized = value
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120)
  return normalized || `bilaga.${fallbackExtension}`
}

async function insertAttachmentEvent(input: {
  orgId: string
  taskId: string
  actor: TaskAttachmentActor
  message: string
  attachmentId: string
}) {
  const admin = createSupabaseAdminClient()
  const { error } = await admin.from('task_events').insert({
    org_id: input.orgId,
    task_id: input.taskId,
    event_type: 'attachment_added',
    actor_type: input.actor.type,
    actor_profile_id: input.actor.type === 'profile' ? input.actor.profileId : null,
    actor_contact_id: input.actor.type === 'contact' ? input.actor.contactId : null,
    actor_access_link_id: input.actor.type === 'contact' ? input.actor.accessLinkId : null,
    actor_name: input.actor.name,
    message: input.message,
    metadata: { attachmentId: input.attachmentId },
  })
  if (error) throw new Error('TASK_EVENT_CREATE_FAILED')
}

export async function storeTaskTextEvidence(input: {
  orgId: string
  taskId: string
  actor: TaskAttachmentActor
  text: string
  title?: string | null
  completionEvidence?: boolean
}) {
  const text = input.text.trim()
  if (!text) throw new Error('TASK_EVIDENCE_TEXT_REQUIRED')
  const admin = createSupabaseAdminClient()
  const { data, error } = await admin
    .from('task_attachments')
    .insert({
      org_id: input.orgId,
      task_id: input.taskId,
      attachment_type: 'text',
      title: input.title?.trim() || 'Textredovisning',
      text_content: text,
      is_completion_evidence: input.completionEvidence !== false,
      uploaded_by_profile_id: input.actor.type === 'profile' ? input.actor.profileId : null,
      uploaded_by_contact_id: input.actor.type === 'contact' ? input.actor.contactId : null,
      uploaded_by_access_link_id: input.actor.type === 'contact' ? input.actor.accessLinkId : null,
    })
    .select('id')
    .single()
  if (error || !data) throw new Error('TASK_ATTACHMENT_CREATE_FAILED')
  await insertAttachmentEvent({
    ...input,
    attachmentId: String(data.id),
    message: `Textredovisning lades till${
      input.completionEvidence !== false ? ' som färdigbevis' : ' som underlag'
    }.`,
  })
  return String(data.id)
}

export async function storeTaskFileEvidence(input: {
  orgId: string
  taskId: string
  actor: TaskAttachmentActor
  file: File
  completionEvidence?: boolean
  title?: string | null
}) {
  if (input.file.size <= 0) throw new Error('TASK_ATTACHMENT_EMPTY')
  if (input.file.size > MAX_TASK_ATTACHMENT_BYTES) throw new Error('TASK_ATTACHMENT_TOO_LARGE')
  const resolvedType = resolveFileType(input.file)
  if (!resolvedType) throw new Error('TASK_ATTACHMENT_TYPE_INVALID')
  const { contentType, allowed } = resolvedType
  const originalName = safeFileName(input.file.name, allowed.extension)
  const storagePath = `${input.orgId}/${input.taskId}/${Date.now()}-${randomUUID()}.${allowed.extension}`
  const bytes = await input.file.arrayBuffer()
  const admin = createSupabaseAdminClient()
  const { error: uploadError } = await admin.storage.from(TASK_EVIDENCE_BUCKET).upload(storagePath, bytes, {
    contentType,
    cacheControl: '3600',
    upsert: false,
  })
  if (uploadError) throw new Error('TASK_ATTACHMENT_UPLOAD_FAILED')

  const completionEvidence = input.completionEvidence !== false
  const { data, error } = await admin
    .from('task_attachments')
    .insert({
      org_id: input.orgId,
      task_id: input.taskId,
      attachment_type: allowed.type,
      title: input.title?.trim() || null,
      storage_bucket: TASK_EVIDENCE_BUCKET,
      file_path: storagePath,
      file_name: originalName,
      content_type: contentType,
      file_size_bytes: input.file.size,
      is_completion_evidence: completionEvidence,
      uploaded_by_profile_id: input.actor.type === 'profile' ? input.actor.profileId : null,
      uploaded_by_contact_id: input.actor.type === 'contact' ? input.actor.contactId : null,
      uploaded_by_access_link_id: input.actor.type === 'contact' ? input.actor.accessLinkId : null,
    })
    .select('id')
    .single()
  if (error || !data) {
    await admin.storage.from(TASK_EVIDENCE_BUCKET).remove([storagePath])
    throw new Error('TASK_ATTACHMENT_CREATE_FAILED')
  }
  await insertAttachmentEvent({
    ...input,
    attachmentId: String(data.id),
    message: `${allowed.type === 'photo' ? 'Foto' : allowed.type === 'audio' ? 'Ljudfil' : 'Dokument'} lades till${completionEvidence ? ' som färdigbevis' : ''}.`,
  })
  return String(data.id)
}

export async function transcribeAndStoreTaskAudio(input: {
  orgId: string
  taskId: string
  actor: TaskAttachmentActor
  audio: File
  durationSeconds?: number | null
  completionEvidence?: boolean
}) {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('MISSING_ENV:OPENAI_API_KEY')
  if (input.audio.size <= 0) throw new Error('TASK_ATTACHMENT_EMPTY')
  if (input.audio.size > MAX_TASK_ATTACHMENT_BYTES) throw new Error('TASK_ATTACHMENT_TOO_LARGE')
  const contentType = normalizedContentType(input.audio.type)
  const allowed = ALLOWED_CONTENT_TYPES[contentType]
  if (!allowed || allowed.type !== 'audio') throw new Error('TASK_ATTACHMENT_TYPE_INVALID')

  const storagePath = `${input.orgId}/${input.taskId}/${Date.now()}-${randomUUID()}.${allowed.extension}`
  const bytes = await input.audio.arrayBuffer()
  const admin = createSupabaseAdminClient()
  const { error: uploadError } = await admin.storage.from(TASK_EVIDENCE_BUCKET).upload(storagePath, bytes, {
    contentType,
    cacheControl: '3600',
    upsert: false,
  })
  if (uploadError) throw new Error('TASK_ATTACHMENT_UPLOAD_FAILED')

  try {
    const form = new FormData()
    form.append('model', TRANSCRIPTION_MODEL)
    form.append('language', 'sv')
    form.append(
      'prompt',
      'Svenskt bygg- och fastighetsprojekt. Behåll namn, byggtermer, platsangivelser, datum, belopp och måttenheter korrekt.'
    )
    form.append('file', new File([bytes], `rostmeddelande.${allowed.extension}`, { type: contentType }))
    const response = await fetch(TRANSCRIPTIONS_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    })
    if (!response.ok) {
      const detail = await response.text()
      console.error('[tasks.transcription] OpenAI request failed', {
        status: response.status,
        detail: detail.slice(0, 300),
      })
      throw new Error('TASK_TRANSCRIPTION_FAILED')
    }
    const payload = (await response.json()) as { text?: unknown }
    const transcript = typeof payload.text === 'string' ? payload.text.trim() : ''
    if (!transcript) throw new Error('TASK_TRANSCRIPTION_EMPTY')

    const { data, error } = await admin
      .from('task_attachments')
      .insert({
        org_id: input.orgId,
        task_id: input.taskId,
        attachment_type: 'audio',
        title: 'Röstmeddelande',
        storage_bucket: TASK_EVIDENCE_BUCKET,
        file_path: storagePath,
        file_name: safeFileName(input.audio.name, allowed.extension),
        content_type: contentType,
        file_size_bytes: input.audio.size,
        transcript_text: transcript,
        transcription_model: TRANSCRIPTION_MODEL,
        audio_duration_seconds:
          input.durationSeconds == null || !Number.isFinite(input.durationSeconds)
            ? null
            : Math.max(0, Math.round(input.durationSeconds)),
        is_completion_evidence: input.completionEvidence !== false,
        uploaded_by_profile_id: input.actor.type === 'profile' ? input.actor.profileId : null,
        uploaded_by_contact_id: input.actor.type === 'contact' ? input.actor.contactId : null,
        uploaded_by_access_link_id: input.actor.type === 'contact' ? input.actor.accessLinkId : null,
      })
      .select('id')
      .single()
    if (error || !data) throw new Error('TASK_ATTACHMENT_CREATE_FAILED')
    await insertAttachmentEvent({
      ...input,
      attachmentId: String(data.id),
      message: `Röstmeddelande transkriberades och lades till${
        input.completionEvidence !== false ? ' som färdigbevis' : ' som underlag'
      }.`,
    })
    return { attachmentId: String(data.id), transcript, model: TRANSCRIPTION_MODEL }
  } catch (error) {
    await admin.storage.from(TASK_EVIDENCE_BUCKET).remove([storagePath])
    throw error
  }
}

export async function createTaskAttachmentSignedUrl(input: {
  orgId: string
  taskId: string
  attachmentId: string
}) {
  const admin = createSupabaseAdminClient()
  const { data, error } = await admin
    .from('task_attachments')
    .select('storage_bucket,file_path,file_name,content_type')
    .eq('id', input.attachmentId)
    .eq('task_id', input.taskId)
    .eq('org_id', input.orgId)
    .maybeSingle()
  if (error) throw new Error('TASK_ATTACHMENT_READ_FAILED')
  if (!data?.storage_bucket || !data.file_path) throw new Error('TASK_ATTACHMENT_NOT_FOUND')
  const opensInline =
    data.content_type?.startsWith('image/') || data.content_type === 'application/pdf'
  const { data: signed, error: signedError } = await admin.storage
    .from(data.storage_bucket)
    .createSignedUrl(
      data.file_path,
      60,
      opensInline ? undefined : { download: data.file_name ?? true }
    )
  if (signedError || !signed) throw new Error('TASK_ATTACHMENT_SIGN_FAILED')
  return signed.signedUrl
}
