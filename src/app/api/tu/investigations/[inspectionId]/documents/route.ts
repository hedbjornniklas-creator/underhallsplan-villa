import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { getTuInvestigationById, requireTuContext } from '@/lib/tu/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const DOCUMENT_BUCKET = 'tu-investigation-documents'
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024
const SIGNED_URL_TTL_SECONDS = 60 * 10
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const DOCUMENT_MIME_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
])

type SupabaseError = {
  message?: string
} | null

type SupabaseListResponse<T> = { data: T[] | null; error: SupabaseError }
type SupabaseSingleResponse<T> = Promise<{ data: T | null; error: SupabaseError }>

type QueryBuilder<T = Record<string, unknown>> = {
  then: <TResult1 = SupabaseListResponse<T>, TResult2 = never>(
    onfulfilled?: ((value: SupabaseListResponse<T>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ) => PromiseLike<TResult1 | TResult2>
  select: (columns: string) => QueryBuilder<T>
  insert: (values: unknown) => QueryBuilder<T>
  update: (values: unknown) => QueryBuilder<T>
  delete: () => QueryBuilder<T>
  eq: (column: string, value: unknown) => QueryBuilder<T>
  order: (column: string, options?: { ascending?: boolean }) => QueryBuilder<T>
  single: () => SupabaseSingleResponse<T>
  maybeSingle: () => SupabaseSingleResponse<T>
}

type StorageBucket = {
  upload: (
    path: string,
    body: Blob,
    options?: { cacheControl?: string; upsert?: boolean; contentType?: string | undefined }
  ) => Promise<{ error: SupabaseError }>
  remove: (paths: string[]) => Promise<{ error: SupabaseError }>
  createSignedUrl: (path: string, expiresIn: number) => Promise<{ data: { signedUrl: string } | null; error: SupabaseError }>
}

type TuDocumentSupabaseClient = {
  from: (table: string) => QueryBuilder
  storage: {
    from: (bucket: string) => StorageBucket
  }
}

type TuDocumentRow = {
  id: string
  inspection_id: string
  org_id: string
  storage_bucket: string | null
  file_path: string
  file_name: string | null
  title: string | null
  content_type: string | null
  file_size_bytes: number | null
  uploaded_by: string | null
  created_at: string | null
  updated_at: string | null
}

const DOCUMENT_COLUMNS =
  'id,inspection_id,org_id,storage_bucket,file_path,file_name,title,content_type,file_size_bytes,uploaded_by,created_at,updated_at'

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

function mapError(error: unknown) {
  const message = error instanceof Error ? error.message : ''
  if (message === 'UNAUTHORIZED') return jsonError('Inte inloggad.', 401)
  if (message === 'MODULE_ACCESS_REQUIRED') return jsonError('TU kräver egen modulbehörighet.', 403)
  if (message === 'ORG_MEMBERSHIP_REQUIRED') return jsonError('Ingen organisationskoppling hittades.', 403)
  if (message === 'TU_INVESTIGATION_NOT_FOUND') return jsonError('TU-utredningen hittades inte.', 404)
  if (message === 'TU_REPORT_LOCKED') return jsonError('Utlåtandet är låst och kan inte ändras.', 409)
  if (isMissingDocumentsTableError(message)) return jsonError('TU-dokument är inte aktiverade i databasen ännu.', 409)
  return null
}

function isMissingDocumentsTableError(message: string) {
  const normalized = message.toLowerCase()
  return (
    normalized.includes('technical_investigation_documents') ||
    normalized.includes('42p01') ||
    normalized.includes('does not exist')
  )
}

function cleanText(value: unknown) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizeUuid(value: unknown) {
  const normalized = cleanText(value)?.toLowerCase() ?? null
  if (!normalized || !UUID_PATTERN.test(normalized)) return null
  return normalized
}

function normalizeFileExtension(file: File) {
  const fromName = file.name.split('.').pop()?.trim().toLowerCase() ?? ''
  const safeNameExt = fromName.replace(/[^a-z0-9]/g, '')
  if (safeNameExt) return safeNameExt

  const mime = file.type.toLowerCase()
  if (mime === 'application/pdf') return 'pdf'
  if (mime === 'application/msword') return 'doc'
  if (mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'docx'
  if (mime === 'application/vnd.ms-excel') return 'xls'
  if (mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') return 'xlsx'
  if (mime === 'text/plain') return 'txt'
  return 'bin'
}

function resolveContentType(file: File, extension: string) {
  const mime = file.type.toLowerCase()
  if (mime && mime !== 'application/octet-stream') return mime
  if (extension === 'pdf') return 'application/pdf'
  if (extension === 'doc') return 'application/msword'
  if (extension === 'docx') return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  if (extension === 'xls') return 'application/vnd.ms-excel'
  if (extension === 'xlsx') return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  if (extension === 'txt') return 'text/plain'
  return 'application/octet-stream'
}

function validateFile(file: File, contentType: string) {
  if (file.size <= 0) return 'Tom fil kan inte laddas upp.'
  if (file.size > MAX_UPLOAD_BYTES) return 'Filen är för stor (max 25 MB).'
  if (!DOCUMENT_MIME_TYPES.has(contentType)) return 'Endast PDF, Word, Excel eller textfiler är tillåtna.'
  return null
}

function safeStoredFileName(file: File, extension: string) {
  const base = file.name.replace(/\.[^.]+$/, '').trim() || 'dokument'
  const safeBase =
    base
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 70) || 'dokument'
  return `${Date.now()}-${randomUUID().slice(0, 8)}-${safeBase}.${extension}`
}

async function mapDocument(row: TuDocumentRow, admin: TuDocumentSupabaseClient) {
  const bucket = row.storage_bucket?.trim() || DOCUMENT_BUCKET
  const { data } = await admin.storage.from(bucket).createSignedUrl(row.file_path, SIGNED_URL_TTL_SECONDS)
  return {
    id: row.id,
    inspectionId: row.inspection_id,
    orgId: row.org_id,
    storageBucket: bucket,
    filePath: row.file_path,
    fileName: row.file_name,
    title: row.title,
    contentType: row.content_type,
    fileSizeBytes: row.file_size_bytes,
    uploadedBy: row.uploaded_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    signedUrl: data?.signedUrl ?? null,
  }
}

async function assertInvestigation(orgId: string, inspectionId: string, options?: { editable?: boolean }) {
  const investigation = await getTuInvestigationById({ orgId, inspectionId })
  if (!investigation) throw new Error('TU_INVESTIGATION_NOT_FOUND')
  if (options?.editable && investigation.reportLockedAt) throw new Error('TU_REPORT_LOCKED')
  return investigation
}

async function readDocumentRow(
  admin: TuDocumentSupabaseClient,
  orgId: string,
  inspectionId: string,
  documentId: string
) {
  const { data, error } = await admin
    .from('technical_investigation_documents')
    .select(DOCUMENT_COLUMNS)
    .eq('id', documentId)
    .eq('org_id', orgId)
    .eq('inspection_id', inspectionId)
    .maybeSingle()

  if (error) throw new Error(error.message ?? 'Kunde inte läsa dokument.')
  return data as TuDocumentRow | null
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ inspectionId: string }> }
) {
  try {
    const { inspectionId } = await context.params
    const orgContext = await requireTuContext()
    const admin = createSupabaseAdminClient() as unknown as TuDocumentSupabaseClient

    await assertInvestigation(orgContext.orgId, inspectionId)

    const { data, error } = await admin
      .from('technical_investigation_documents')
      .select(DOCUMENT_COLUMNS)
      .eq('org_id', orgContext.orgId)
      .eq('inspection_id', inspectionId)
      .order('created_at', { ascending: false })

    if (error) throw new Error(error.message ?? 'Kunde inte hämta TU-dokument.')

    const documents = await Promise.all(((data ?? []) as TuDocumentRow[]).map((row) => mapDocument(row, admin)))
    return NextResponse.json({ documents })
  } catch (error) {
    const mapped = mapError(error)
    if (mapped) return mapped
    return jsonError('Kunde inte hämta TU-dokument.', 500)
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ inspectionId: string }> }
) {
  let uploadedPath: string | null = null

  try {
    const { inspectionId } = await context.params
    const orgContext = await requireTuContext()
    const admin = createSupabaseAdminClient() as unknown as TuDocumentSupabaseClient

    await assertInvestigation(orgContext.orgId, inspectionId, { editable: true })

    const formData = await request.formData()
    const fileEntry = formData.get('file')
    if (!(fileEntry instanceof File)) return jsonError('Fil saknas.', 400)

    const extension = normalizeFileExtension(fileEntry)
    const contentType = resolveContentType(fileEntry, extension)
    const validationError = validateFile(fileEntry, contentType)
    if (validationError) return jsonError(validationError, 400)

    const fileName = safeStoredFileName(fileEntry, extension)
    const filePath = `${inspectionId}/documents/${fileName}`
    uploadedPath = filePath

    const { error: uploadError } = await admin.storage.from(DOCUMENT_BUCKET).upload(filePath, fileEntry, {
      cacheControl: '3600',
      upsert: false,
      contentType,
    })

    if (uploadError) throw new Error(uploadError.message ?? 'Kunde inte ladda upp dokument.')

    const { data: insertedDocument, error: insertError } = await admin
      .from('technical_investigation_documents')
      .insert({
        inspection_id: inspectionId,
        org_id: orgContext.orgId,
        storage_bucket: DOCUMENT_BUCKET,
        file_path: filePath,
        file_name: fileEntry.name || fileName,
        title: cleanText(formData.get('title')) ?? fileEntry.name ?? fileName,
        content_type: contentType,
        file_size_bytes: fileEntry.size,
        uploaded_by: orgContext.userId,
      })
      .select(DOCUMENT_COLUMNS)
      .single()

    if (insertError) {
      await admin.storage.from(DOCUMENT_BUCKET).remove([filePath])
      uploadedPath = null
      throw new Error(insertError.message ?? 'Kunde inte spara dokumentrad.')
    }

    return NextResponse.json(
      { ok: true, document: await mapDocument(insertedDocument as TuDocumentRow, admin) },
      { status: 201 }
    )
  } catch (error) {
    if (uploadedPath) {
      await createSupabaseAdminClient().storage.from(DOCUMENT_BUCKET).remove([uploadedPath])
    }
    const mapped = mapError(error)
    if (mapped) return mapped
    return jsonError('Kunde inte ladda upp TU-dokument.', 500)
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ inspectionId: string }> }
) {
  try {
    const { inspectionId } = await context.params
    const orgContext = await requireTuContext()
    const admin = createSupabaseAdminClient() as unknown as TuDocumentSupabaseClient
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const documentId = normalizeUuid(body.documentId ?? body.document_id)

    if (!documentId) return jsonError('Ogiltigt document_id.', 400)
    await assertInvestigation(orgContext.orgId, inspectionId, { editable: true })

    const existing = await readDocumentRow(admin, orgContext.orgId, inspectionId, documentId)
    if (!existing) return jsonError('Dokumentet hittades inte.', 404)

    const bucket = existing.storage_bucket?.trim() || DOCUMENT_BUCKET
    if (existing.file_path.trim()) {
      const { error: storageDeleteError } = await admin.storage.from(bucket).remove([existing.file_path])
      if (storageDeleteError) throw new Error(storageDeleteError.message ?? 'Kunde inte ta bort dokumentfil.')
    }

    const { error: deleteError } = await admin
      .from('technical_investigation_documents')
      .delete()
      .eq('id', documentId)
      .eq('org_id', orgContext.orgId)
      .eq('inspection_id', inspectionId)

    if (deleteError) throw new Error(deleteError.message ?? 'Kunde inte ta bort dokumentrad.')

    return NextResponse.json({ ok: true, documentId })
  } catch (error) {
    const mapped = mapError(error)
    if (mapped) return mapped
    return jsonError('Kunde inte ta bort TU-dokument.', 500)
  }
}
