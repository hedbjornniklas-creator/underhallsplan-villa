import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { requireModuleAccess } from '@/lib/access/server'
import { requireOrgContext } from '@/lib/assignments/server'
import { assertEbInspectionEditable, EB_NOTE_IMAGE_BUCKET } from '@/lib/eb/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

type InspectionImageRow = {
  id: string
  inspection_id: string
  eb_note_id: string | null
  source_attachment_id?: string | null
  file_path: string
  thumbnail_file_path?: string | null
  label: string | null
  sort_order: number | null
  created_at: string | null
}

const IMAGE_SELECT =
  'id,inspection_id,eb_note_id,source_attachment_id,file_path,thumbnail_file_path,label,sort_order,created_at'
const FALLBACK_IMAGE_SELECT = 'id,inspection_id,eb_note_id,file_path,label,sort_order,created_at'

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

function normalizeUuid(value: unknown) {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toLowerCase()
  return UUID_PATTERN.test(normalized) ? normalized : null
}

function isMissingColumnError(error: { code?: string | null; message?: string | null; details?: string | null }) {
  const text = `${error.code ?? ''} ${error.message ?? ''} ${error.details ?? ''}`.toLowerCase()
  return error.code === '42703' || text.includes('thumbnail_file_path') || text.includes('source_attachment_id')
}

function isUniqueViolation(error: { code?: string | null; message?: string | null; details?: string | null }) {
  const text = `${error.code ?? ''} ${error.message ?? ''} ${error.details ?? ''}`.toLowerCase()
  return error.code === '23505' || text.includes('duplicate key')
}

function mapImage(row: InspectionImageRow) {
  const storage = createSupabaseAdminClient().storage.from(EB_NOTE_IMAGE_BUCKET)
  return {
    id: row.id,
    noteId: null,
    inspectionId: row.inspection_id,
    sourceAttachmentId: row.source_attachment_id ?? null,
    filePath: row.file_path,
    thumbnailFilePath: row.thumbnail_file_path ?? null,
    label: row.label,
    sortOrder: row.sort_order ?? 100,
    publicUrl: storage.getPublicUrl(row.file_path).data.publicUrl,
    thumbnailUrl: row.thumbnail_file_path
      ? storage.getPublicUrl(row.thumbnail_file_path).data.publicUrl
      : null,
    createdAt: row.created_at ?? null,
  }
}

function resolveFileExtension(file: File) {
  const fromName = file.name.split('.').pop()?.trim().toLowerCase() ?? ''
  const normalizedNameExt = fromName.replace(/[^a-z0-9]/g, '')
  if (normalizedNameExt.length > 0) return normalizedNameExt

  const mime = file.type.toLowerCase()
  if (mime === 'image/jpeg') return 'jpg'
  if (mime === 'image/png') return 'png'
  if (mime === 'image/webp') return 'webp'
  if (mime === 'image/heic') return 'heic'
  if (mime === 'image/heif') return 'heif'
  return 'jpg'
}

async function loadExistingImage(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  imageId: string,
  inspectionId: string
) {
  const result = await admin
    .from('inspection_images')
    .select(IMAGE_SELECT)
    .eq('id', imageId)
    .eq('inspection_id', inspectionId)
    .maybeSingle()

  if (result.error && isMissingColumnError(result.error)) {
    const fallback = await admin
      .from('inspection_images')
      .select(FALLBACK_IMAGE_SELECT)
      .eq('id', imageId)
      .eq('inspection_id', inspectionId)
      .maybeSingle()
    if (fallback.error) throw new Error(fallback.error.message ?? 'Kunde inte kontrollera bilden.')
    return (fallback.data as InspectionImageRow | null) ?? null
  }

  if (result.error) throw new Error(result.error.message ?? 'Kunde inte kontrollera bilden.')
  return (result.data as InspectionImageRow | null) ?? null
}

async function loadNextSortOrder(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  inspectionId: string
) {
  const { data, error } = await admin
    .from('inspection_images')
    .select('sort_order')
    .eq('inspection_id', inspectionId)
    .like('file_path', `${inspectionId}/eb-notes/%`)
    .order('sort_order', { ascending: false })
    .limit(1)

  if (error) throw new Error(error.message ?? 'Kunde inte läsa befintliga bilder.')
  const maxSort = Number((data?.[0] as { sort_order?: unknown } | undefined)?.sort_order ?? 0)
  return Number.isFinite(maxSort) ? maxSort + 10 : 10
}

async function requireEbContext() {
  await requireModuleAccess({
    productKey: 'dashboard',
    moduleKey: 'construction_inspections',
  })
  return requireOrgContext()
}

function mapError(error: unknown) {
  const message = error instanceof Error ? error.message : 'Okänt fel.'
  if (message === 'UNAUTHORIZED') return jsonError('Inte inloggad.', 401)
  if (message === 'ORG_MEMBERSHIP_REQUIRED') return jsonError('Ingen organisationskoppling hittades.', 403)
  if (message === 'MODULE_ACCESS_REQUIRED') return jsonError('EB kräver egen modulbehörighet.', 403)
  if (message === 'EB_PROJECT_NOT_FOUND') return jsonError('Entreprenaden hittades inte.', 404)
  if (message === 'EB_INSPECTION_NOT_FOUND') return jsonError('Besiktningen hittades inte.', 404)
  if (message === 'EB_REPORT_LOCKED') return jsonError('Utlåtandet är låst och kan inte ändras.', 409)
  return jsonError('Kunde inte ladda upp besiktningsbild.', 500)
}

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string; inspectionId: string }> }
) {
  let uploadedPath: string | null = null
  let uploadedThumbnailPath: string | null = null
  let createdImageId: string | null = null

  try {
    const { projectId, inspectionId } = await context.params
    const org = await requireEbContext()
    const admin = createSupabaseAdminClient()
    await assertEbInspectionEditable({ orgId: org.orgId, projectId, inspectionId })

    const formData = await request.formData()
    const fileEntry = formData.get('file')
    const thumbnailEntry = formData.get('thumbnail')
    const clientImageIdEntry = formData.get('clientImageId')
    const clientImageId = normalizeUuid(clientImageIdEntry)
    if (clientImageIdEntry !== null && !clientImageId) {
      return jsonError('Ogiltigt clientImageId.', 400)
    }

    if (clientImageId) {
      const existingImage = await loadExistingImage(admin, clientImageId, inspectionId)
      if (existingImage) return NextResponse.json({ image: mapImage(existingImage) })
    }

    if (!(fileEntry instanceof File)) return jsonError('Fil saknas.', 400)
    if (!fileEntry.type.toLowerCase().startsWith('image/')) {
      return jsonError('Endast bildfiler är tillåtna.', 400)
    }
    if (fileEntry.size <= 0) return jsonError('Tom fil kan inte laddas upp.', 400)
    if (fileEntry.size > MAX_UPLOAD_BYTES) return jsonError('Filen är för stor (max 15 MB).', 400)
    if (thumbnailEntry instanceof File && !thumbnailEntry.type.toLowerCase().startsWith('image/')) {
      return jsonError('Miniatyrbilden har ett ogiltigt filformat.', 400)
    }

    const sortOrder = await loadNextSortOrder(admin, inspectionId)
    const capturedAt = new Date().toISOString()
    const imageId = clientImageId ?? randomUUID()
    const fileName = `${Date.now()}-${imageId.slice(0, 8)}.${resolveFileExtension(fileEntry)}`
    const filePath = `${inspectionId}/eb-notes/unlinked/${capturedAt.slice(0, 10)}/${fileName}`
    const thumbnailPath = thumbnailEntry instanceof File
      ? `${inspectionId}/eb-notes/unlinked/${capturedAt.slice(0, 10)}/thumb-${fileName.replace(/\.[^.]+$/, '.jpg')}`
      : null

    const { error: uploadError } = await admin.storage.from(EB_NOTE_IMAGE_BUCKET).upload(filePath, fileEntry, {
      cacheControl: '3600',
      upsert: Boolean(clientImageId),
      contentType: fileEntry.type || undefined,
    })
    if (uploadError) throw new Error(uploadError.message ?? 'Kunde inte ladda upp bildfilen.')
    uploadedPath = filePath

    if (thumbnailEntry instanceof File && thumbnailPath) {
      const { error: thumbnailUploadError } = await admin.storage
        .from(EB_NOTE_IMAGE_BUCKET)
        .upload(thumbnailPath, thumbnailEntry, {
          cacheControl: '3600',
          upsert: Boolean(clientImageId),
          contentType: thumbnailEntry.type || 'image/jpeg',
        })
      if (thumbnailUploadError) {
        throw new Error(thumbnailUploadError.message ?? 'Kunde inte ladda upp miniatyrbilden.')
      }
      uploadedThumbnailPath = thumbnailPath
    }

    const imageValues = {
      id: imageId,
      inspection_id: inspectionId,
      eb_note_id: null,
      file_path: filePath,
      thumbnail_file_path: thumbnailPath,
      label: fileEntry.name.trim() || null,
      sort_order: sortOrder,
    }
    const { data: insertedImage, error: insertError } = await admin
      .from('inspection_images')
      .insert(imageValues)
      .select(IMAGE_SELECT)
      .single()

    if (insertError && isMissingColumnError(insertError)) {
      if (uploadedThumbnailPath) {
        await admin.storage.from(EB_NOTE_IMAGE_BUCKET).remove([uploadedThumbnailPath])
        uploadedThumbnailPath = null
      }
      const fallbackValues = {
        id: imageValues.id,
        inspection_id: imageValues.inspection_id,
        eb_note_id: imageValues.eb_note_id,
        file_path: imageValues.file_path,
        label: imageValues.label,
        sort_order: imageValues.sort_order,
      }
      const { data: fallbackImage, error: fallbackError } = await admin
        .from('inspection_images')
        .insert(fallbackValues)
        .select(FALLBACK_IMAGE_SELECT)
        .single()

      if (fallbackError) {
        if (clientImageId && isUniqueViolation(fallbackError)) {
          const existingImage = await loadExistingImage(admin, clientImageId, inspectionId)
          if (existingImage) {
            uploadedPath = null
            return NextResponse.json({ image: mapImage(existingImage) })
          }
        }
        throw new Error(fallbackError.message ?? 'Kunde inte spara bildraden.')
      }
      createdImageId = fallbackImage.id

      return NextResponse.json({ image: mapImage(fallbackImage) }, { status: 201 })
    }

    if (insertError) {
      if (clientImageId && isUniqueViolation(insertError)) {
        const existingImage = await loadExistingImage(admin, clientImageId, inspectionId)
        if (existingImage) {
          uploadedPath = null
          uploadedThumbnailPath = null
          return NextResponse.json({ image: mapImage(existingImage) })
        }
      }
      throw new Error(insertError.message ?? 'Kunde inte spara bildraden.')
    }
    createdImageId = insertedImage.id

    return NextResponse.json({ image: mapImage(insertedImage) }, { status: 201 })
  } catch (error) {
    if (createdImageId) {
      await createSupabaseAdminClient().from('inspection_images').delete().eq('id', createdImageId)
    }
    const paths = [uploadedPath, uploadedThumbnailPath].filter((path): path is string => Boolean(path))
    if (paths.length > 0) {
      await createSupabaseAdminClient().storage.from(EB_NOTE_IMAGE_BUCKET).remove(paths)
    }
    return mapError(error)
  }
}
