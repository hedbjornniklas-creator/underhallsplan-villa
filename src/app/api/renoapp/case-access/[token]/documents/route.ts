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

export async function POST(request: Request, context: RouteContext) {
  try {
    const { token } = await context.params
    const access = await getCaseAccessByToken(token)

    if (!access) {
      return jsonError('Länken hittades inte.', 404)
    }
    if (access.state !== 'open') {
      return jsonError('Länken är inte längre aktiv.', 409)
    }
    if (!access.access.allowedActions.includes('upload_documents')) {
      return jsonError('Länken saknar rätt att ladda upp dokument.', 403)
    }

    const formData = await request.formData()
    const fileEntry = formData.get('file')
    const note = String(formData.get('note') ?? '').trim() || null
    const documentTypeId = String(formData.get('document_type_id') ?? '').trim() || null

    if (!(fileEntry instanceof File)) return jsonError('Fil saknas.', 400)
    if (fileEntry.size <= 0) return jsonError('Tom fil kan inte laddas upp.', 400)
    if (fileEntry.size > MAX_UPLOAD_BYTES) return jsonError('Filen är för stor (max 15 MB).', 400)
    if (!ALLOWED_MIME_TYPES.has((fileEntry.type || '').toLowerCase())) {
      return jsonError('Filtypen är inte tillåten.', 400)
    }

    const admin = createSupabaseAdminClient()
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
        storage_bucket: DOCUMENT_BUCKET,
        file_path: filePath,
        file_name: fileEntry.name || fileName,
        mime_type: fileEntry.type || null,
        file_size_bytes: fileEntry.size,
        status: 'uploaded',
        note,
      })
      .select('id,document_type_id,file_name,status,uploaded_at,note')
      .single()

    if (insertError) {
      await admin.storage.from(DOCUMENT_BUCKET).remove([filePath])
      throw new Error(insertError.message ?? 'Kunde inte spara dokumentrad.')
    }

    return NextResponse.json({ ok: true, document: insertedDocument }, { status: 201 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okänt fel.'
    return jsonError(message || 'Kunde inte ladda upp dokument.', 500)
  }
}
