import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { getCaseAccessByToken } from '@/lib/renoapp/server'

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
    const fileEntry = formData.get('file')
    const note = String(formData.get('note') ?? '').trim() || null
    const documentTypeId = String(formData.get('document_type_id') ?? '').trim() || null
    const participantRoleId = String(formData.get('participant_role_id') ?? '').trim() || null
    const documentScope =
      String(formData.get('document_scope') ?? '').trim() === 'participant_insurance'
        ? 'participant_insurance'
        : 'general'

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

      let requestedTargetQuery = admin
        .from('renoapp_case_requirement_decisions')
        .select('id')
        .eq('case_id', access.case.id)
        .eq('decision', 'requested')

      requestedTargetQuery = documentTypeId
        ? requestedTargetQuery.eq('document_type_id', documentTypeId)
        : requestedTargetQuery.eq('participant_role_id', participantRoleId)

      const { data: requestedTarget, error: requestedTargetError } = await requestedTargetQuery.maybeSingle()
      if (requestedTargetError) {
        throw new Error(requestedTargetError.message ?? 'Kunde inte kontrollera begärd komplettering.')
      }
      if (!requestedTarget) {
        return jsonError('Styrelsen har inte begärt den här kompletteringen.', 403)
      }
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
      .select('id,document_type_id,participant_role_id,document_scope,file_name,status,uploaded_at,note')
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

    return NextResponse.json({ ok: true, document: insertedDocument }, { status: 201 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okänt fel.'
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
      .select('id,case_id,document_type_id,participant_role_id,uploaded_at,storage_bucket,file_path')
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
      const documentTypeId = String(documentRow.document_type_id ?? '').trim()
      const participantRoleId = String(documentRow.participant_role_id ?? '').trim()
      let requestedTargetQuery = admin
        .from('renoapp_case_requirement_decisions')
        .select('id,decided_at')
        .eq('case_id', access.case.id)
        .eq('decision', 'requested')
        .order('decided_at', { ascending: false })
        .limit(1)

      requestedTargetQuery = documentTypeId
        ? requestedTargetQuery.eq('document_type_id', documentTypeId)
        : requestedTargetQuery.eq('participant_role_id', participantRoleId)

      const { data: requestedTarget, error: requestedTargetError } = await requestedTargetQuery.maybeSingle()
      if (requestedTargetError) {
        throw new Error(requestedTargetError.message ?? 'Kunde inte kontrollera begärd komplettering.')
      }

      const uploadedAt = new Date(String(documentRow.uploaded_at ?? '')).getTime()
      const requestedAt = new Date(String(requestedTarget?.decided_at ?? '')).getTime()
      if (!requestedTarget || !Number.isFinite(uploadedAt) || !Number.isFinite(requestedAt) || uploadedAt < requestedAt) {
        return jsonError('Tidigare inskickade handlingar kan inte raderas under kompletteringen.', 409)
      }
    }

    const bucket = String(documentRow.storage_bucket ?? '')
    const filePath = String(documentRow.file_path ?? '')
    if (bucket && filePath) {
      const { error: storageError } = await admin.storage.from(bucket).remove([filePath])
      if (storageError) {
        throw new Error(storageError.message ?? 'Kunde inte radera filen.')
      }
    }

    const { error: deleteError } = await admin
      .from('renovation_case_documents')
      .delete()
      .eq('id', documentId)
      .eq('case_id', access.case.id)

    if (deleteError) {
      throw new Error(deleteError.message ?? 'Kunde inte radera dokumentet.')
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okänt fel.'
    return jsonError(message || 'Kunde inte radera dokumentet.', 500)
  }
}
