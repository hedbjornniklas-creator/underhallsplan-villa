import { NextResponse } from 'next/server'
import { getTuAssignmentById, requireTuContext } from '@/lib/tu/server'
import { updateAssignmentById, type AssignmentStatus } from '@/lib/assignments/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

function text(body: Record<string, unknown>, key: string) {
  const value = body[key]
  return typeof value === 'string' ? value.trim() : ''
}

function nullableText(body: Record<string, unknown>, key: string) {
  return key in body ? text(body, key) || null : undefined
}

function parsePrice(value: unknown) {
  if (value === undefined) return undefined
  const raw = typeof value === 'number' ? String(value) : typeof value === 'string' ? value.trim() : ''
  if (!raw) return null
  const parsed = Number(raw.replace(',', '.'))
  return Number.isFinite(parsed) && parsed >= 0 ? Number(parsed.toFixed(2)) : Number.NaN
}

function mapAccessError(error: unknown) {
  const message = error instanceof Error ? error.message : ''
  if (message === 'UNAUTHORIZED') return jsonError('Inte inloggad.', 401)
  if (message === 'MODULE_ACCESS_REQUIRED') return jsonError('TU kräver egen modulbehörighet.', 403)
  if (message === 'ORG_MEMBERSHIP_REQUIRED') return jsonError('Ingen organisationskoppling hittades.', 403)
  if (message === 'TU_ASSIGNMENT_NOT_FOUND') return jsonError('TU-uppdraget hittades inte.', 404)
  return null
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params
    const orgContext = await requireTuContext()
    const assignment = await getTuAssignmentById(orgContext.orgId, id)
    if (!assignment) return jsonError('TU-uppdraget hittades inte.', 404)
    return NextResponse.json({ assignment })
  } catch (error) {
    const accessError = mapAccessError(error)
    if (accessError) return accessError
    return jsonError('Kunde inte hämta TU-uppdrag.', 500)
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params
    const orgContext = await requireTuContext()
    const existing = await getTuAssignmentById(orgContext.orgId, id)
    if (!existing) return jsonError('TU-uppdraget hittades inte.', 404)

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const patch: Record<string, unknown> = {}
    const editableStatuses = new Set(['draft', 'sent'])
    const bodyKeys = Object.keys(body)
    const hasArchivedAtInBody = Object.prototype.hasOwnProperty.call(body, 'archived_at')
    const archiveValue = hasArchivedAtInBody ? body.archived_at : undefined
    const isArchiveSetValue =
      archiveValue !== undefined && archiveValue !== null && archiveValue !== ''
    const isArchiveClearValue = archiveValue === null || archiveValue === ''
    const isArchiveTogglePatch = bodyKeys.length === 1 && bodyKeys[0] === 'archived_at'
    const isArchiveClearOnlyPatch = isArchiveTogglePatch && isArchiveClearValue
    const isCancelAndArchivePatch =
      typeof body.status === 'string' &&
      body.status.trim().toLowerCase() === 'cancelled' &&
      bodyKeys.length >= 1 &&
      bodyKeys.length <= 2 &&
      bodyKeys.includes('archived_at') &&
      bodyKeys.every((key) => key === 'status' || key === 'archived_at')

    const statusRaw = typeof body.status === 'string' ? body.status.trim().toLowerCase() : ''
    if (statusRaw) {
      if (!['draft', 'sent', 'ordered', 'booked', 'completed', 'expired', 'cancelled'].includes(statusRaw)) {
        return jsonError('Ogiltig status.', 400)
      }
      patch.status = statusRaw as AssignmentStatus
      if (statusRaw === 'cancelled') {
        patch.archived_at = new Date().toISOString()
        patch.archived_by = orgContext.userId
      }
    }

    if (
      statusRaw &&
      statusRaw !== 'cancelled' &&
      !editableStatuses.has(existing.status)
    ) {
      return jsonError('Endast utkast och skickade TU-uppdrag kan redigeras.', 409)
    }

    if (hasArchivedAtInBody) {
      if (archiveValue === null || archiveValue === '') {
        patch.archived_at = null
        patch.archived_by = null
      } else if (typeof archiveValue === 'string') {
        const effectiveStatus = (patch.status as AssignmentStatus | undefined) ?? existing.status
        if (
          isArchiveSetValue &&
          effectiveStatus !== 'cancelled' &&
          (effectiveStatus === 'sent' || effectiveStatus === 'ordered' || effectiveStatus === 'booked')
        ) {
          return jsonError('Skickad, godkänd och bokad uppdragsbekräftelse kan inte arkiveras.', 409)
        }
        const parsed = new Date(archiveValue)
        if (Number.isNaN(parsed.getTime())) {
          return jsonError('Ogiltigt arkivdatum.', 400)
        }
        patch.archived_at = parsed.toISOString()
        patch.archived_by = orgContext.userId
      } else {
        return jsonError('Ogiltigt värde för arkivering.', 400)
      }
    }

    if (
      !editableStatuses.has(existing.status) &&
      !isArchiveClearOnlyPatch &&
      !isCancelAndArchivePatch &&
      !isArchiveTogglePatch
    ) {
      return jsonError('Endast utkast och skickade TU-uppdrag kan redigeras.', 409)
    }

    const textFields: Array<[string, string]> = [
      ['customerName', 'customer_name'],
      ['customerEmail', 'customer_email'],
      ['customerPhone', 'customer_phone'],
      ['customerPostalCode', 'customer_postal_code'],
      ['customerCity', 'customer_city'],
      ['customerAddress', 'customer_address'],
      ['propertyAddress', 'property_address'],
      ['propertyPostalCode', 'property_postal_code'],
      ['propertyCity', 'property_city'],
      ['propertyMunicipality', 'property_municipality'],
      ['propertyOwnerName', 'property_owner_name'],
      ['cadastralId', 'cadastral_id'],
      ['scopeDescription', 'scope_description'],
      ['preferredDate', 'preferred_date'],
      ['preferredTime', 'preferred_time'],
      ['notesInternal', 'notes_internal'],
      ['responsibleProfileId', 'responsible_profile_id'],
    ]

    for (const [inputKey, dbKey] of textFields) {
      const value = nullableText(body, inputKey)
      if (value !== undefined) patch[dbKey] = value
    }

    const priceAmount = parsePrice(body.priceAmount)
    if (Number.isNaN(priceAmount)) return jsonError('Ange ett giltigt pris.', 400)
    if (priceAmount !== undefined) patch.price_amount = priceAmount

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ assignment: existing })
    }

    const assignment = await updateAssignmentById({
      orgId: orgContext.orgId,
      assignmentId: id,
      updatedBy: orgContext.userId,
      patch: patch as Parameters<typeof updateAssignmentById>[0]['patch'] & Record<string, unknown>,
    })

    return NextResponse.json({ assignment })
  } catch (error) {
    const accessError = mapAccessError(error)
    if (accessError) return accessError
    return jsonError('Kunde inte uppdatera TU-uppdrag.', 500)
  }
}
