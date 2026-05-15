import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { requireModuleAccess } from '@/lib/access/server'
import { requireOrgContext } from '@/lib/assignments/server'
import { EB_NOTE_IMAGE_BUCKET } from '@/lib/eb/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

function normalizeUuid(value: unknown) {
  if (typeof value !== 'string') return null
  const normalized = value.trim().toLowerCase()
  return UUID_PATTERN.test(normalized) ? normalized : null
}

function mapImage(row: {
  id: string
  inspection_id: string
  eb_note_id: string | null
  file_path: string
  label: string | null
  sort_order: number | null
  created_at: string | null
}) {
  const publicUrl = createSupabaseAdminClient()
    .storage
    .from(EB_NOTE_IMAGE_BUCKET)
    .getPublicUrl(row.file_path).data.publicUrl

  return {
    id: row.id,
    noteId: row.eb_note_id ?? null,
    inspectionId: row.inspection_id,
    filePath: row.file_path,
    label: row.label,
    sortOrder: row.sort_order ?? 100,
    publicUrl,
    createdAt: row.created_at ?? null,
  }
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
  if (message === 'EB_NOTE_NOT_FOUND') return jsonError('Noteringen hittades inte.', 404)
  return jsonError(message || fallback, 500)
}

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string; inspectionId: string; noteId: string }> }
) {
  let uploadedPath: string | null = null

  try {
    const { projectId, inspectionId, noteId } = await context.params
    const org = await requireEbContext()
    const admin = createSupabaseAdminClient()

    const { data: noteRow, error: noteError } = await admin
      .from('eb_notes')
      .select('id')
      .eq('id', noteId)
      .eq('org_id', org.orgId)
      .eq('eb_project_id', projectId)
      .eq('inspection_id', inspectionId)
      .maybeSingle()

    if (noteError) {
      throw new Error(noteError.message ?? 'Kunde inte verifiera noteringen.')
    }
    if (!noteRow?.id) {
      throw new Error('EB_NOTE_NOT_FOUND')
    }

    const formData = await request.formData()
    const fileEntry = formData.get('file')
    if (!(fileEntry instanceof File)) return jsonError('Fil saknas.', 400)
    if (!fileEntry.type.toLowerCase().startsWith('image/')) {
      return jsonError('Endast bildfiler är tillåtna.', 400)
    }
    if (fileEntry.size <= 0) return jsonError('Tom fil kan inte laddas upp.', 400)
    if (fileEntry.size > MAX_UPLOAD_BYTES) {
      return jsonError('Filen är för stor (max 15 MB).', 400)
    }

    const { data: currentImages, error: currentImagesError } = await admin
      .from('inspection_images')
      .select('sort_order')
      .eq('inspection_id', inspectionId)
      .eq('eb_note_id', noteId)
      .order('sort_order', { ascending: false })
      .limit(1)

    if (currentImagesError) {
      throw new Error(currentImagesError.message ?? 'Kunde inte läsa befintliga bilder.')
    }

    const maxSort = Array.isArray(currentImages)
      ? Number((currentImages[0] as { sort_order?: unknown } | undefined)?.sort_order ?? 0)
      : 0
    const sortOrder = Number.isFinite(maxSort) ? maxSort + 10 : 10
    const capturedAt = new Date().toISOString()
    const fileName = `${Date.now()}-${randomUUID().slice(0, 8)}.${resolveFileExtension(fileEntry)}`
    const filePath = `${inspectionId}/eb-notes/${noteId}/${capturedAt.slice(0, 10)}/${fileName}`

    const { error: uploadError } = await admin.storage.from(EB_NOTE_IMAGE_BUCKET).upload(filePath, fileEntry, {
      cacheControl: '3600',
      upsert: false,
      contentType: fileEntry.type || undefined,
    })

    if (uploadError) {
      throw new Error(uploadError.message ?? 'Kunde inte ladda upp bild.')
    }
    uploadedPath = filePath

    const { data: insertedImage, error: insertError } = await admin
      .from('inspection_images')
      .insert({
        inspection_id: inspectionId,
        eb_note_id: noteId,
        file_path: filePath,
        label: null,
        sort_order: sortOrder,
      })
      .select('id,inspection_id,eb_note_id,file_path,label,sort_order,created_at')
      .single()

    if (insertError) {
      throw new Error(insertError.message ?? 'Kunde inte spara bildrad.')
    }

    const publicUrl = admin.storage.from(EB_NOTE_IMAGE_BUCKET).getPublicUrl(filePath).data.publicUrl
    return NextResponse.json({
      image: {
        id: insertedImage.id,
        noteId: insertedImage.eb_note_id,
        inspectionId: insertedImage.inspection_id,
        filePath: insertedImage.file_path,
        label: insertedImage.label,
        sortOrder: insertedImage.sort_order ?? sortOrder,
        publicUrl,
        createdAt: insertedImage.created_at ?? null,
      },
    })
  } catch (error) {
    if (uploadedPath) {
      await createSupabaseAdminClient().storage.from(EB_NOTE_IMAGE_BUCKET).remove([uploadedPath])
    }
    return mapError(error, 'Kunde inte ladda upp bild.')
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ projectId: string; inspectionId: string; noteId: string }> }
) {
  try {
    const { projectId, inspectionId, noteId } = await context.params
    const imageId = normalizeUuid(((await request.json().catch(() => ({}))) as { imageId?: unknown }).imageId)
    if (!imageId) return jsonError('Ogiltigt imageId.', 400)

    const org = await requireEbContext()
    const admin = createSupabaseAdminClient()

    const { data: noteRow, error: noteError } = await admin
      .from('eb_notes')
      .select('id')
      .eq('id', noteId)
      .eq('org_id', org.orgId)
      .eq('eb_project_id', projectId)
      .eq('inspection_id', inspectionId)
      .maybeSingle()

    if (noteError) {
      throw new Error(noteError.message ?? 'Kunde inte verifiera noteringen.')
    }
    if (!noteRow?.id) {
      throw new Error('EB_NOTE_NOT_FOUND')
    }

    const { data: imageRow, error: imageError } = await admin
      .from('inspection_images')
      .select('id,file_path')
      .eq('id', imageId)
      .eq('inspection_id', inspectionId)
      .eq('eb_note_id', noteId)
      .maybeSingle()

    if (imageError) {
      throw new Error(imageError.message ?? 'Kunde inte läsa bildrad.')
    }
    if (!imageRow?.id) return jsonError('Bilden hittades inte.', 404)

    const filePath = String(imageRow.file_path ?? '').trim()
    if (filePath.length > 0) {
      const { error: storageDeleteError } = await admin.storage.from(EB_NOTE_IMAGE_BUCKET).remove([filePath])
      if (storageDeleteError) {
        throw new Error(storageDeleteError.message ?? 'Kunde inte ta bort bildfil.')
      }
    }

    const { error: deleteError } = await admin
      .from('inspection_images')
      .delete()
      .eq('id', imageId)
      .eq('inspection_id', inspectionId)
      .eq('eb_note_id', noteId)

    if (deleteError) {
      throw new Error(deleteError.message ?? 'Kunde inte ta bort bildrad.')
    }

    return NextResponse.json({ ok: true })
  } catch (error) {
    return mapError(error, 'Kunde inte ta bort bild.')
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ projectId: string; inspectionId: string; noteId: string }> }
) {
  try {
    const { projectId, inspectionId, noteId } = await context.params
    const body = (await request.json().catch(() => ({}))) as { imageId?: unknown; action?: unknown }
    const imageId = normalizeUuid(body.imageId)
    const action = body.action === 'attach' ? 'attach' : body.action === 'detach' ? 'detach' : null
    if (!imageId) return jsonError('Ogiltigt imageId.', 400)
    if (!action) return jsonError('Ogiltig bildåtgärd.', 400)

    const org = await requireEbContext()
    const admin = createSupabaseAdminClient()

    const { data: noteRow, error: noteError } = await admin
      .from('eb_notes')
      .select('id')
      .eq('id', noteId)
      .eq('org_id', org.orgId)
      .eq('eb_project_id', projectId)
      .eq('inspection_id', inspectionId)
      .maybeSingle()

    if (noteError) {
      throw new Error(noteError.message ?? 'Kunde inte verifiera noteringen.')
    }
    if (!noteRow?.id) {
      throw new Error('EB_NOTE_NOT_FOUND')
    }

    const { data: imageRow, error: imageError } = await admin
      .from('inspection_images')
      .select('id,inspection_id,eb_note_id,file_path,label,sort_order,created_at')
      .eq('id', imageId)
      .eq('inspection_id', inspectionId)
      .like('file_path', `${inspectionId}/eb-notes/%`)
      .maybeSingle()

    if (imageError) {
      throw new Error(imageError.message ?? 'Kunde inte läsa bildrad.')
    }
    if (!imageRow?.id) return jsonError('Bilden hittades inte.', 404)

    const nextNoteId = action === 'attach' ? noteId : null
    const { data: updatedImage, error: updateError } = await admin
      .from('inspection_images')
      .update({ eb_note_id: nextNoteId })
      .eq('id', imageId)
      .eq('inspection_id', inspectionId)
      .select('id,inspection_id,eb_note_id,file_path,label,sort_order,created_at')
      .single()

    if (updateError || !updatedImage) {
      throw new Error(updateError?.message ?? 'Kunde inte uppdatera bildkoppling.')
    }

    return NextResponse.json({ image: mapImage(updatedImage) })
  } catch (error) {
    return mapError(error, 'Kunde inte uppdatera bildkoppling.')
  }
}
