import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { getTuInvestigationById, requireTuContext } from '@/lib/tu/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const IMAGE_BUCKET = 'inspection-images'
const BANK_SECTION_KEY = 'bank'
const APPENDIX_SECTION_KEY = 'appendix'
const COVER_SECTION_KEY = 'cover'
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

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
  limit: (count: number) => QueryBuilder<T>
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
  getPublicUrl: (path: string) => { data: { publicUrl: string } }
}

type TuImageSupabaseClient = {
  from: (table: string) => QueryBuilder
  storage: {
    from: (bucket: string) => StorageBucket
  }
}

type TuInvestigationImageRow = {
  id: string
  inspection_id: string
  org_id: string
  section_key: string | null
  storage_bucket: string | null
  file_path: string
  caption: string | null
  sort_order: number | null
  uploaded_by: string | null
  created_at: string | null
  updated_at: string | null
}

const IMAGE_COLUMNS =
  'id,inspection_id,org_id,section_key,storage_bucket,file_path,caption,sort_order,uploaded_by,created_at,updated_at'

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
  if (isMissingImagesTableError(message)) return jsonError('TU-bilder är inte aktiverade i databasen ännu.', 409)
  return null
}

function isMissingImagesTableError(message: string) {
  const normalized = message.toLowerCase()
  return (
    normalized.includes('technical_investigation_images') ||
    normalized.includes('42p01') ||
    normalized.includes('does not exist')
  )
}

function normalizeUuid(value: unknown) {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toLowerCase()
  if (!UUID_PATTERN.test(normalized)) return null
  return normalized
}

function cleanText(value: unknown) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function normalizeSectionKey(value: unknown) {
  if (typeof value !== 'string') return BANK_SECTION_KEY
  const normalized = value.trim()
  if (normalized === APPENDIX_SECTION_KEY) return APPENDIX_SECTION_KEY
  if (normalized === COVER_SECTION_KEY) return COVER_SECTION_KEY
  return BANK_SECTION_KEY
}

function resolveFileExtension(file: File) {
  const fromName = file.name.split('.').pop()?.trim().toLowerCase() ?? ''
  const normalizedNameExt = fromName.replace(/[^a-z0-9]/g, '')
  if (normalizedNameExt.length > 0) return normalizedNameExt

  const mime = (file.type || '').toLowerCase()
  if (mime === 'image/jpeg') return 'jpg'
  if (mime === 'image/png') return 'png'
  if (mime === 'image/webp') return 'webp'
  if (mime === 'image/heic') return 'heic'
  if (mime === 'image/heif') return 'heif'
  return 'jpg'
}

function getFormFiles(formData: FormData) {
  const files = formData.getAll('files').filter((entry): entry is File => entry instanceof File)
  const single = formData.get('file')
  if (single instanceof File) files.push(single)
  return files
}

function mapImage(row: TuInvestigationImageRow, admin: TuImageSupabaseClient) {
  const bucket = row.storage_bucket?.trim() || IMAGE_BUCKET
  return {
    id: row.id,
    inspectionId: row.inspection_id,
    orgId: row.org_id,
    sectionKey: normalizeSectionKey(row.section_key),
    storageBucket: bucket,
    filePath: row.file_path,
    publicUrl: admin.storage.from(bucket).getPublicUrl(row.file_path).data.publicUrl,
    caption: row.caption,
    sortOrder: row.sort_order ?? 100,
    uploadedBy: row.uploaded_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

async function assertInvestigation(
  orgId: string,
  inspectionId: string,
  options?: { editable?: boolean }
) {
  const investigation = await getTuInvestigationById({ orgId, inspectionId })
  if (!investigation) throw new Error('TU_INVESTIGATION_NOT_FOUND')
  if (options?.editable && investigation.reportLockedAt) throw new Error('TU_REPORT_LOCKED')
  return investigation
}

async function readImageRow(
  admin: TuImageSupabaseClient,
  orgId: string,
  inspectionId: string,
  imageId: string
) {
  const { data, error } = await admin
    .from('technical_investigation_images')
    .select(IMAGE_COLUMNS)
    .eq('id', imageId)
    .eq('org_id', orgId)
    .eq('inspection_id', inspectionId)
    .maybeSingle()

  if (error) throw new Error(error.message ?? 'Kunde inte läsa bild.')
  return data as TuInvestigationImageRow | null
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ inspectionId: string }> }
) {
  try {
    const { inspectionId } = await context.params
    const orgContext = await requireTuContext()
    const admin = createSupabaseAdminClient() as unknown as TuImageSupabaseClient

    await assertInvestigation(orgContext.orgId, inspectionId)

    const { data, error } = await admin
      .from('technical_investigation_images')
      .select(IMAGE_COLUMNS)
      .eq('org_id', orgContext.orgId)
      .eq('inspection_id', inspectionId)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true })

    if (error) throw new Error(error.message ?? 'Kunde inte hämta TU-bilder.')

    const rows = (data ?? []) as TuInvestigationImageRow[]
    return NextResponse.json({ images: rows.map((row) => mapImage(row, admin)) })
  } catch (error) {
    const mapped = mapError(error)
    if (mapped) return mapped
    return jsonError('Kunde inte hämta TU-bilder.', 500)
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ inspectionId: string }> }
) {
  try {
    const { inspectionId } = await context.params
    const orgContext = await requireTuContext()
    const admin = createSupabaseAdminClient() as unknown as TuImageSupabaseClient

    await assertInvestigation(orgContext.orgId, inspectionId, { editable: true })

    const formData = await request.formData()
    const sectionKey = normalizeSectionKey(formData.get('sectionKey'))
    const files = getFormFiles(formData)
    if (files.length === 0) return jsonError('Fil saknas.', 400)

    for (const file of files) {
      if (!file.type.toLowerCase().startsWith('image/')) {
        return jsonError('Endast bildfiler är tillåtna.', 400)
      }
      if (file.size <= 0) return jsonError('Tom fil kan inte laddas upp.', 400)
      if (file.size > MAX_UPLOAD_BYTES) return jsonError('Filen är för stor (max 15 MB).', 400)
    }

    const { data: currentImages, error: currentImagesError } = await admin
      .from('technical_investigation_images')
      .select('sort_order')
      .eq('org_id', orgContext.orgId)
      .eq('inspection_id', inspectionId)
      .order('sort_order', { ascending: false })
      .limit(1)

    if (currentImagesError) throw new Error(currentImagesError.message ?? 'Kunde inte läsa befintliga bilder.')

    const maxSort = Array.isArray(currentImages)
      ? Number((currentImages[0] as { sort_order?: unknown } | undefined)?.sort_order ?? 0)
      : 0
    let sortOrder = Number.isFinite(maxSort) ? maxSort + 10 : 10
    const insertedImages: Array<ReturnType<typeof mapImage>> = []

    for (const file of files) {
      const ext = resolveFileExtension(file)
      const fileName = `${Date.now()}-${randomUUID().slice(0, 8)}.${ext}`
      const filePath = `${inspectionId}/technical-investigations/${sectionKey}/${fileName}`

      const { error: uploadError } = await admin.storage.from(IMAGE_BUCKET).upload(filePath, file, {
        cacheControl: '3600',
        upsert: false,
        contentType: file.type || undefined,
      })

      if (uploadError) throw new Error(uploadError.message ?? 'Kunde inte ladda upp bild.')

      const { data: insertedImage, error: insertError } = await admin
        .from('technical_investigation_images')
        .insert({
          inspection_id: inspectionId,
          org_id: orgContext.orgId,
          section_key: sectionKey,
          storage_bucket: IMAGE_BUCKET,
          file_path: filePath,
          sort_order: sortOrder,
          uploaded_by: orgContext.userId,
        })
        .select(IMAGE_COLUMNS)
        .single()

      if (insertError) {
        await admin.storage.from(IMAGE_BUCKET).remove([filePath])
        throw new Error(insertError.message ?? 'Kunde inte spara bildrad.')
      }

      insertedImages.push(mapImage(insertedImage as TuInvestigationImageRow, admin))
      sortOrder += 10
    }

    return NextResponse.json({ ok: true, images: insertedImages })
  } catch (error) {
    const mapped = mapError(error)
    if (mapped) return mapped
    return jsonError('Kunde inte ladda upp TU-bild.', 500)
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ inspectionId: string }> }
) {
  try {
    const { inspectionId } = await context.params
    const orgContext = await requireTuContext()
    const admin = createSupabaseAdminClient() as unknown as TuImageSupabaseClient
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const imageId = normalizeUuid(body.imageId ?? body.image_id)

    if (!imageId) return jsonError('Ogiltigt image_id.', 400)
    await assertInvestigation(orgContext.orgId, inspectionId, { editable: true })

    const existing = await readImageRow(admin, orgContext.orgId, inspectionId, imageId)
    if (!existing) return jsonError('Bilden hittades inte.', 404)

    const patch: Record<string, unknown> = {}
    if ('caption' in body) patch.caption = cleanText(body.caption)
    if ('sectionKey' in body || 'section_key' in body) {
      patch.section_key = normalizeSectionKey(body.sectionKey ?? body.section_key)
    }
    if ('sortOrder' in body || 'sort_order' in body) {
      const rawSortOrder = Number(body.sortOrder ?? body.sort_order)
      if (!Number.isFinite(rawSortOrder)) return jsonError('Ogiltig sortering.', 400)
      patch.sort_order = Math.round(rawSortOrder)
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ ok: true, image: mapImage(existing, admin) })
    }

    const { data: updatedImage, error } = await admin
      .from('technical_investigation_images')
      .update(patch)
      .eq('id', imageId)
      .eq('org_id', orgContext.orgId)
      .eq('inspection_id', inspectionId)
      .select(IMAGE_COLUMNS)
      .single()

    if (error) throw new Error(error.message ?? 'Kunde inte spara bild.')
    return NextResponse.json({ ok: true, image: mapImage(updatedImage as TuInvestigationImageRow, admin) })
  } catch (error) {
    const mapped = mapError(error)
    if (mapped) return mapped
    return jsonError('Kunde inte spara TU-bild.', 500)
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ inspectionId: string }> }
) {
  try {
    const { inspectionId } = await context.params
    const orgContext = await requireTuContext()
    const admin = createSupabaseAdminClient() as unknown as TuImageSupabaseClient
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const imageId = normalizeUuid(body.imageId ?? body.image_id)

    if (!imageId) return jsonError('Ogiltigt image_id.', 400)
    await assertInvestigation(orgContext.orgId, inspectionId, { editable: true })

    const existing = await readImageRow(admin, orgContext.orgId, inspectionId, imageId)
    if (!existing) return jsonError('Bilden hittades inte.', 404)

    const bucket = existing.storage_bucket?.trim() || IMAGE_BUCKET
    if (existing.file_path.trim().length > 0) {
      const { error: storageDeleteError } = await admin.storage.from(bucket).remove([existing.file_path])
      if (storageDeleteError) throw new Error(storageDeleteError.message ?? 'Kunde inte ta bort bildfil.')
    }

    const { error: deleteError } = await admin
      .from('technical_investigation_images')
      .delete()
      .eq('id', imageId)
      .eq('org_id', orgContext.orgId)
      .eq('inspection_id', inspectionId)

    if (deleteError) throw new Error(deleteError.message ?? 'Kunde inte ta bort bildrad.')

    return NextResponse.json({ ok: true, imageId })
  } catch (error) {
    const mapped = mapError(error)
    if (mapped) return mapped
    return jsonError('Kunde inte ta bort TU-bild.', 500)
  }
}
