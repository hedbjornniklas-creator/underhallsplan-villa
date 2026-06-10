import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { requireModuleAccess } from '@/lib/access/server'
import { requireOrgContext } from '@/lib/assignments/server'
import {
  EB_PROJECT_ATTACHMENTS_BUCKET,
  getEbProjectById,
  listEbProjectAttachments,
  type EbAttachmentType,
} from '@/lib/eb/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024
const DOCUMENT_MIME_TYPES = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
])
const IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

function toText(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function toAttachmentType(value: unknown, file: File): EbAttachmentType {
  const normalized = toText(value)
  if (normalized === 'image' || normalized === 'document') return normalized
  return file.type.toLowerCase().startsWith('image/') ? 'image' : 'document'
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
  if (mime === 'image/jpeg') return 'jpg'
  if (mime === 'image/png') return 'png'
  if (mime === 'image/webp') return 'webp'
  if (mime === 'image/heic') return 'heic'
  if (mime === 'image/heif') return 'heif'
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
  if (extension === 'jpg' || extension === 'jpeg') return 'image/jpeg'
  if (extension === 'png') return 'image/png'
  if (extension === 'webp') return 'image/webp'
  if (extension === 'heic') return 'image/heic'
  if (extension === 'heif') return 'image/heif'
  return 'application/octet-stream'
}

function validateFile(file: File, attachmentType: EbAttachmentType, contentType: string) {
  if (file.size <= 0) return 'Tom fil kan inte laddas upp.'
  if (file.size > MAX_UPLOAD_BYTES) return 'Filen är för stor (max 25 MB).'
  if (attachmentType === 'image' && !IMAGE_MIME_TYPES.has(contentType)) {
    return 'Endast bildfiler är tillåtna som bilder.'
  }
  if (attachmentType === 'document' && !DOCUMENT_MIME_TYPES.has(contentType)) {
    return 'Endast PDF, Word, Excel eller textfiler är tillåtna som handlingar.'
  }
  return null
}

function safeStoredFileName(file: File, extension: string) {
  const base = file.name.replace(/\.[^.]+$/, '').trim() || 'bilaga'
  const safeBase = base
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 70) || 'bilaga'
  return `${Date.now()}-${randomUUID().slice(0, 8)}-${safeBase}.${extension}`
}

async function requireEbContext() {
  await requireModuleAccess({
    productKey: 'dashboard',
    moduleKey: 'construction_inspections',
  })
  return requireOrgContext()
}

function mapError(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : 'Okänt fel.'
  if (message === 'UNAUTHORIZED') return jsonError('Inte inloggad.', 401)
  if (message === 'ORG_MEMBERSHIP_REQUIRED') {
    return jsonError('Ingen organisationskoppling hittades.', 403)
  }
  if (message === 'MODULE_ACCESS_REQUIRED') {
    return jsonError('EB kräver egen modulbehörighet.', 403)
  }
  if (message === 'EB_PROJECT_NOT_FOUND') return jsonError('Entreprenaden hittades inte.', 404)
  return jsonError(message || fallback, 500)
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await context.params
    const org = await requireEbContext()
    const attachments = await listEbProjectAttachments({
      orgId: org.orgId,
      projectId,
    })

    return NextResponse.json({ attachments })
  } catch (error) {
    return mapError(error, 'Kunde inte hämta bilagor.')
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string }> }
) {
  let uploadedPath: string | null = null
  let uploadedThumbnailPath: string | null = null

  try {
    const { projectId } = await context.params
    const org = await requireEbContext()
    const project = await getEbProjectById({ orgId: org.orgId, projectId })
    if (!project) throw new Error('EB_PROJECT_NOT_FOUND')

    const formData = await request.formData()
    const fileEntry = formData.get('file')
    if (!(fileEntry instanceof File)) return jsonError('Fil saknas.', 400)
    const thumbnailEntry = formData.get('thumbnail')

    const attachmentType = toAttachmentType(formData.get('attachmentType'), fileEntry)
    const extension = normalizeFileExtension(fileEntry)
    const contentType = resolveContentType(fileEntry, extension)
    const validationError = validateFile(fileEntry, attachmentType, contentType)
    if (validationError) return jsonError(validationError, 400)

    const admin = createSupabaseAdminClient()
    const fileName = safeStoredFileName(fileEntry, extension)
    const filePath = `${projectId}/${attachmentType}/${fileName}`
    const thumbnailPath = attachmentType === 'image' && thumbnailEntry instanceof File
      ? `${projectId}/${attachmentType}/thumb-${fileName.replace(/\.[^.]+$/, '.jpg')}`
      : null
    uploadedPath = filePath

    const { error: uploadError } = await admin.storage
      .from(EB_PROJECT_ATTACHMENTS_BUCKET)
      .upload(filePath, fileEntry, {
        cacheControl: '3600',
        upsert: false,
        contentType,
      })

    if (uploadError) {
      throw new Error(uploadError.message ?? 'Kunde inte ladda upp bilaga.')
    }

    if (thumbnailEntry instanceof File && thumbnailPath) {
      const { error: thumbnailUploadError } = await admin.storage
        .from(EB_PROJECT_ATTACHMENTS_BUCKET)
        .upload(thumbnailPath, thumbnailEntry, {
          cacheControl: '3600',
          upsert: false,
          contentType: thumbnailEntry.type || 'image/jpeg',
        })

      if (thumbnailUploadError) {
        throw new Error(thumbnailUploadError.message ?? 'Kunde inte ladda upp miniatyrbild.')
      }
      uploadedThumbnailPath = thumbnailPath
    }

    const { error: insertError } = await admin.from('eb_project_attachments').insert({
      org_id: org.orgId,
      eb_project_id: projectId,
      attachment_type: attachmentType,
      title: toText(formData.get('title')) || fileEntry.name || fileName,
      storage_bucket: EB_PROJECT_ATTACHMENTS_BUCKET,
      file_path: filePath,
      thumbnail_file_path: thumbnailPath,
      file_name: fileEntry.name || fileName,
      content_type: contentType,
      file_size_bytes: fileEntry.size,
      uploaded_by: org.userId,
    })

    if (insertError) {
      await admin.storage.from(EB_PROJECT_ATTACHMENTS_BUCKET).remove(
        [filePath, thumbnailPath].filter((path): path is string => Boolean(path))
      )
      uploadedPath = null
      uploadedThumbnailPath = null
      throw new Error(insertError.message ?? 'Kunde inte spara bilaga.')
    }

    const attachments = await listEbProjectAttachments({
      orgId: org.orgId,
      projectId,
    })

    return NextResponse.json({ attachments }, { status: 201 })
  } catch (error) {
    if (uploadedPath) {
      await createSupabaseAdminClient().storage.from(EB_PROJECT_ATTACHMENTS_BUCKET).remove([uploadedPath])
    }
    if (uploadedThumbnailPath) {
      await createSupabaseAdminClient().storage.from(EB_PROJECT_ATTACHMENTS_BUCKET).remove([uploadedThumbnailPath])
    }
    return mapError(error, 'Kunde inte ladda upp bilaga.')
  }
}
