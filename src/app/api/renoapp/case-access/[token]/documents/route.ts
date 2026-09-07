import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { getCaseAccessByToken } from '@/lib/renoapp/server'
import { getLatestCompletion } from '@/lib/renoapp/completionServer'
import { COMPLETION_ERRORS } from '@/lib/renoapp/completion'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const DOCUMENT_BUCKET = 'renoapp-case-documents'
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024
const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
])

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

function resolveFileExtension(file: File) {
  const fromName = file.name.split('.').pop()?.trim().toLowerCase() ?? ''
  const normalizedNameExt = fromName.replace(/[^a-z0-9]/g, '')
  if (normalizedNameExt.length > 0) return normalizedNameExt

  const mime = (file.type || '').toLowerCase()
  if (mime === 'application/pdf') return 'pdf'
  if (mime === 'image/png') return 'png'
  if (mime === 'image/webp') return 'webp'
  if (mime === 'image/heic') return 'heic'
  if (mime === 'image/heif') return 'heif'
  return 'jpg'
}

type RouteContext = {
  params: Promise<{
    token: string
  }>
}

async function getWritableAccess(token: string) {
  const access = await getCaseAccessByToken(token)

  if (!access) {
    return { error: jsonError('Länken hittades inte.', 404), access: null }
  }
  if (access.state !== 'open') {
    return { error: jsonError('Länken är inte längre aktiv.', 409), access: null }
  }
  if (access.case.status !== 'draft' && access.case.status !== 'need_info') {
    return { error: jsonError('Ansökan är inskickad och låst för ändringar.', 409), access: null }
  }
  if (!access.access.allowedActions.includes('upload_documents')) {
    return { error: jsonError('Länken saknar rätt att ladda upp dokument.', 403), access: null }
  }

  return { error: null, access }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const { token } = await context.params
    const accessResult = await getWritableAccess(token)
    if (accessResult.error || !accessResult.access) {
      return accessResult.error
    }

    const access = accessResult.access
    const formData = await request.formData()
    const completionRequestId = String(formData.get('completion_request_id') ?? '') || null
    const fileEntry = formData.get('file')
    const note = String(formData.get('note') ?? '').trim() || null
    const documentTypeId = String(formData.get('document_type_id') ?? '').trim() || null
    const participantRoleId = String(formData.get('participant_role_id') ?? '').trim() || null
    const documentScope =
      String(formData.get('document_scope') ?? '').trim() === 'participant_insurance'
        ? 'participant_insurance'
        : 'general'

    if ((documentTypeId && participantRoleId) || (participantRoleId && documentScope !== 'participant_insurance') || (documentScope === 'participant_insurance' && !participantRoleId)) {
      return jsonError('Välj en dokumenttyp eller en företagsroll för filen.', 400)
    }
    if (!(fileEntry instanceof File)) return jsonError('Fil saknas.', 400)
    if (fileEntry.size <= 0) return jsonError('Tom fil kan inte laddas upp.', 400)
    if (fileEntry.size > MAX_UPLOAD_BYTES) return jsonError('Filen är för stor (max 15 MB).', 400)
    if (!ALLOWED_MIME_TYPES.has((fileEntry.type || '').toLowerCase())) {
      return jsonError('Filtypen är inte tillåten.', 400)
    }

    const admin = createSupabaseAdminClient()
    if (access.case.status === 'need_info') {
      if (!documentTypeId && !participantRoleId) {
        return jsonError('Välj den komplettering som dokumentet hör till.', 400)
      }

      const round = await getLatestCompletion(access.case.id)
      if (!round || round.id !== completionRequestId || round.submitted_at) return jsonError(COMPLETION_ERRORS.COMPLETION_CHANGED, 409)
      const key = documentTypeId ? `document:${documentTypeId}` : `participant:${participantRoleId}`
      if (documentTypeId && participantRoleId) return jsonError('Välj en dokumenttyp eller en företagsroll.', 400)
      if (!round.items.some(item => item.id === key)) return jsonError('Styrelsen har inte begärt den här kompletteringen.', 403)
    }

    const ext = resolveFileExtension(fileEntry)
    const fileName = `${Date.now()}-${randomUUID().slice(0, 8)}.${ext}`
    const filePath = `${access.case.id}/documents/${fileName}`

    const { error: uploadError } = await admin.storage.from(DOCUMENT_BUCKET).upload(filePath, fileEntry, {
      cacheControl: '3600',
      upsert: false,
      contentType: fileEntry.type || undefined,
    })

    if (uploadError) {
      throw new Error(uploadError.message ?? 'Kunde inte ladda upp dokument.')
    }

    const { data: insertedDocument, error: insertError } = await admin
      .from('renovation_case_documents')
      .insert({
        case_id: access.case.id,
        completion_request_id: access.case.status === 'need_info' ? completionRequestId : null,
        contact_id: access.contact.id,
        document_type_id: documentTypeId,
        participant_role_id: participantRoleId,
        document_scope: documentScope,
        storage_bucket: DOCUMENT_BUCKET,
        file_path: filePath,
        file_name: fileEntry.name || fileName,
        mime_type: fileEntry.type || null,
        file_size_bytes: fileEntry.size,
        status: 'uploaded',
        note,
      })
      .select('id,document_type_id,participant_role_id,document_scope,file_name,status,uploaded_at,note,completion_request_id')
      .single()

    if (insertError) {
      await admin.storage.from(DOCUMENT_BUCKET).remove([filePath])
      throw new Error(insertError.message ?? 'Kunde inte spara dokumentrad.')
    }

    await admin.from('renovation_case_messages').insert({
      case_id: access.case.id,
      type: 'document_uploaded',
      author_role: 'applicant',
      author_contact_id: access.contact.id,
      message: fileEntry.name || fileName,
      metadata: {
        documentId: insertedDocument.id,
        documentTypeId,
        participantRoleId,
        documentScope,
      },
    })

    return NextResponse.json({ ok: true, document: {
      id: insertedDocument.id, documentTypeId: insertedDocument.document_type_id,
      participantRoleId: insertedDocument.participant_role_id, documentScope: insertedDocument.document_scope,
      fileName: insertedDocument.file_name, status: insertedDocument.status,
      uploadedAt: insertedDocument.uploaded_at, note: insertedDocument.note,
      completionRequestId: insertedDocument.completion_request_id,
    } }, { status: 201 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okänt fel.'
    if (COMPLETION_ERRORS[message]) return jsonError(COMPLETION_ERRORS[message], 409)
    return jsonError(message || 'Kunde inte ladda upp dokument.', 500)
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    const { token } = await context.params
    const accessResult = await getWritableAccess(token)
    if (accessResult.error || !accessResult.access) {
      return accessResult.error
    }

    const access = accessResult.access
    const documentId = new URL(request.url).searchParams.get('documentId')?.trim() ?? ''
    if (!documentId) {
      return jsonError('Dokument saknas.', 400)
    }

    const admin = createSupabaseAdminClient()
    const { data: documentRow, error: documentError } = await admin
      .from('renovation_case_documents')
      .select('id,case_id,document_type_id,participant_role_id,uploaded_at,storage_bucket,file_path,completion_request_id')
      .eq('id', documentId)
      .eq('case_id', access.case.id)
      .maybeSingle()

    if (documentError) {
      throw new Error(documentError.message ?? 'Kunde inte läsa dokumentet.')
    }
    if (!documentRow) {
      return jsonError('Dokumentet hittades inte.', 404)
    }

    if (access.case.status === 'need_info') {
      const round = await getLatestCompletion(access.case.id)
      const requestId = new URL(request.url).searchParams.get('completionRequestId')
      if (!round || round.id !== requestId || round.submitted_at) return jsonError(COMPLETION_ERRORS.COMPLETION_CHANGED, 409)
      if (documentRow.completion_request_id !== round.id) return jsonError(COMPLETION_ERRORS.COMPLETION_PREVIOUS_DOCUMENT, 409)
    }

    const bucket = String(documentRow.storage_bucket ?? '')
    const filePath = String(documentRow.file_path ?? '')
    const { error: deleteError } = await admin
      .from('renovation_case_documents')
      .delete()
      .eq('id', documentId)
      .eq('case_id', access.case.id)

    if (deleteError) {
      throw new Error(deleteError.message ?? 'Kunde inte radera dokumentet.')
    }

    // Validate the round in the database before removing the stored file.
    if (bucket && filePath) {
      const { error: storageError } = await admin.storage.from(bucket).remove([filePath])
      if (storageError) console.error('[renoapp] Deleted document storage cleanup failed', storageError)
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okänt fel.'
    if (COMPLETION_ERRORS[message]) return jsonError(COMPLETION_ERRORS[message], 409)
    return jsonError(message || 'Kunde inte radera dokumentet.', 500)
  }
}
