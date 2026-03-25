import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { requireOrgContext } from '@/lib/assignments/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const IMAGE_BUCKET = 'inspection-images'
const MAX_UPLOAD_BYTES = 15 * 1024 * 1024
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

function normalizeUuid(value: unknown) {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toLowerCase()
  if (!UUID_PATTERN.test(normalized)) return null
  return normalized
}

function isMissingImagesTableError(message: string) {
  const normalized = message.toLowerCase()
  return (
    normalized.includes('inspection_moisture_control_images') ||
    normalized.includes('42p01') ||
    normalized.includes('does not exist')
  )
}

function isMissingLockColumnError(message: string) {
  const normalized = message.toLowerCase()
  return normalized.includes('locked_at') || normalized.includes('42703') || normalized.includes('column')
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

async function assertInspectionEditable(
  admin: ReturnType<typeof createSupabaseAdminClient>,
  inspectionId: string
) {
  const { data, error } = await admin
    .from('inspections')
    .select('id,locked_at')
    .eq('id', inspectionId)
    .maybeSingle()

  if (error) {
    const message = error.message ?? ''
    if (!isMissingLockColumnError(message)) {
      throw new Error(message || 'Kunde inte lasa besiktning.')
    }
    return
  }
  if (!data) {
    throw new Error('INSPECTION_NOT_FOUND')
  }
  if (data.locked_at) {
    throw new Error('INSPECTION_LOCKED')
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id: inspectionId } = await context.params
    const org = await requireOrgContext()
    const admin = createSupabaseAdminClient()

    await assertInspectionEditable(admin, inspectionId)

    const formData = await request.formData()
    const rowId = normalizeUuid(formData.get('row_id'))
    if (!rowId) return jsonError('Ogiltigt row_id.', 400)

    const fileEntry = formData.get('file')
    if (!(fileEntry instanceof File)) return jsonError('Fil saknas.', 400)
    if (!fileEntry.type.toLowerCase().startsWith('image/')) {
      return jsonError('Endast bildfiler ar tillatna.', 400)
    }
    if (fileEntry.size <= 0) return jsonError('Tom fil kan inte laddas upp.', 400)
    if (fileEntry.size > MAX_UPLOAD_BYTES) {
      return jsonError('Filen ar for stor (max 15 MB).', 400)
    }

    const { data: moistureRow, error: moistureRowError } = await admin
      .from('inspection_moisture_control_rows')
      .select('id')
      .eq('id', rowId)
      .eq('inspection_id', inspectionId)
      .eq('org_id', org.orgId)
      .maybeSingle()

    if (moistureRowError) {
      throw new Error(moistureRowError.message ?? 'Kunde inte verifiera fuktkontrollrad.')
    }
    if (!moistureRow?.id) return jsonError('Kontrollplatsen hittades inte.', 404)

    const { data: currentImages, error: currentImagesError } = await admin
      .from('inspection_moisture_control_images')
      .select('sort_order')
      .eq('org_id', org.orgId)
      .eq('inspection_id', inspectionId)
      .eq('moisture_control_row_id', rowId)
      .order('sort_order', { ascending: false })
      .limit(1)

    if (currentImagesError) {
      const message = currentImagesError.message ?? ''
      if (isMissingImagesTableError(message)) {
        return jsonError('Fuktkontroll-bilder ar inte aktiverade i databasen annu.', 409)
      }
      throw new Error(message || 'Kunde inte lasa befintliga bilder.')
    }

    const maxSort = Array.isArray(currentImages)
      ? Number((currentImages[0] as { sort_order?: unknown } | undefined)?.sort_order ?? 0)
      : 0
    const sortOrder = Number.isFinite(maxSort) ? maxSort + 10 : 10

    const ext = resolveFileExtension(fileEntry)
    const fileName = `${Date.now()}-${randomUUID().slice(0, 8)}.${ext}`
    const filePath = `${inspectionId}/moisture-control/${rowId}/${fileName}`

    const { error: uploadError } = await admin.storage.from(IMAGE_BUCKET).upload(filePath, fileEntry, {
      cacheControl: '3600',
      upsert: false,
      contentType: fileEntry.type || undefined,
    })

    if (uploadError) {
      throw new Error(uploadError.message ?? 'Kunde inte ladda upp bild.')
    }

    const { data: insertedImage, error: insertError } = await admin
      .from('inspection_moisture_control_images')
      .insert({
        moisture_control_row_id: rowId,
        inspection_id: inspectionId,
        org_id: org.orgId,
        file_path: filePath,
        sort_order: sortOrder,
      })
      .select('id,moisture_control_row_id,inspection_id,org_id,file_path,sort_order,created_at,updated_at')
      .single()

    if (insertError) {
      await admin.storage.from(IMAGE_BUCKET).remove([filePath])
      const message = insertError.message ?? 'Kunde inte spara bildrad.'
      if (isMissingImagesTableError(message)) {
        return jsonError('Fuktkontroll-bilder ar inte aktiverade i databasen annu.', 409)
      }
      throw new Error(message)
    }

    return NextResponse.json({ ok: true, image: insertedImage })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okant fel.'
    if (message === 'UNAUTHORIZED') return jsonError('Inte inloggad.', 401)
    if (message === 'ORG_MEMBERSHIP_REQUIRED') return jsonError('Ingen organisationskoppling hittades.', 403)
    if (message === 'INSPECTION_NOT_FOUND') return jsonError('Besiktningen hittades inte.', 404)
    if (message === 'INSPECTION_LOCKED') return jsonError('Besiktningen ar last och kan inte andras.', 409)
    return jsonError(message || 'Kunde inte ladda upp bild.', 500)
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id: inspectionId } = await context.params
    const org = await requireOrgContext()
    const admin = createSupabaseAdminClient()

    await assertInspectionEditable(admin, inspectionId)

    const body = (await request.json().catch(() => null)) as { image_id?: unknown } | null
    const imageId = normalizeUuid(body?.image_id)
    if (!imageId) return jsonError('Ogiltigt image_id.', 400)

    const { data: imageRow, error: imageError } = await admin
      .from('inspection_moisture_control_images')
      .select('id,file_path')
      .eq('id', imageId)
      .eq('inspection_id', inspectionId)
      .eq('org_id', org.orgId)
      .maybeSingle()

    if (imageError) {
      const message = imageError.message ?? ''
      if (isMissingImagesTableError(message)) {
        return jsonError('Fuktkontroll-bilder ar inte aktiverade i databasen annu.', 409)
      }
      throw new Error(message || 'Kunde inte lasa bildrad.')
    }
    if (!imageRow?.id) return jsonError('Bilden hittades inte.', 404)

    const filePath = String(imageRow.file_path ?? '').trim()
    if (filePath.length > 0) {
      const { error: storageDeleteError } = await admin.storage.from(IMAGE_BUCKET).remove([filePath])
      if (storageDeleteError) {
        throw new Error(storageDeleteError.message ?? 'Kunde inte ta bort bildfil.')
      }
    }

    const { error: deleteError } = await admin
      .from('inspection_moisture_control_images')
      .delete()
      .eq('id', imageId)
      .eq('inspection_id', inspectionId)
      .eq('org_id', org.orgId)

    if (deleteError) {
      throw new Error(deleteError.message ?? 'Kunde inte ta bort bildrad.')
    }

    return NextResponse.json({ ok: true, image_id: imageId })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okant fel.'
    if (message === 'UNAUTHORIZED') return jsonError('Inte inloggad.', 401)
    if (message === 'ORG_MEMBERSHIP_REQUIRED') return jsonError('Ingen organisationskoppling hittades.', 403)
    if (message === 'INSPECTION_NOT_FOUND') return jsonError('Besiktningen hittades inte.', 404)
    if (message === 'INSPECTION_LOCKED') return jsonError('Besiktningen ar last och kan inte andras.', 409)
    return jsonError(message || 'Kunde inte ta bort bild.', 500)
  }
}
