import { NextResponse } from 'next/server'
import { requireOrgContext } from '@/lib/assignments/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

function isMissingUnlockSchemaError(message: string) {
  const normalized = message.toLowerCase()
  return (
    normalized.includes('inspection_lock_events') ||
    normalized.includes('locked_at') ||
    normalized.includes('locked_by') ||
    normalized.includes('42p01') ||
    normalized.includes('42703') ||
    normalized.includes('does not exist')
  )
}

function normalizeReason(value: unknown) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed.length < 10) return null
  return trimmed
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params
    const org = await requireOrgContext()
    const admin = createSupabaseAdminClient()

    const body = (await request.json().catch(() => null)) as
      | {
          reason?: unknown
        }
      | null
    const reason = normalizeReason(body?.reason)
    if (!reason) {
      return jsonError('Anledning måste vara minst 10 tecken.', 400)
    }

    const { data: inspection, error: inspectionError } = await admin
      .from('inspections')
      .select('id,property_id,locked_at,locked_by')
      .eq('id', id)
      .maybeSingle()

    if (inspectionError) {
      throw new Error(inspectionError.message ?? 'Kunde inte läsa besiktning.')
    }
    if (!inspection) return jsonError('Besiktningen hittades inte.', 404)

    const wasLockedAt = inspection.locked_at as string | null
    const wasLockedBy = inspection.locked_by as string | null

    if (!wasLockedAt) {
      return jsonError('Besiktningen är redan upplåst.', 409)
    }

    const { data: property, error: propertyError } = await admin
      .from('properties')
      .select('id,owner')
      .eq('id', inspection.property_id)
      .maybeSingle()

    if (propertyError) {
      throw new Error(propertyError.message ?? 'Kunde inte läsa fastighet.')
    }

    const propertyOwner = String(property?.owner ?? '').trim()
    if (!propertyOwner || propertyOwner !== org.userId) {
      return jsonError('Du får bara låsa upp dina egna besiktningar.', 403)
    }

    const { data: unlockedRows, error: unlockError } = await admin
      .from('inspections')
      .update({
        locked_at: null,
        locked_by: null,
      })
      .eq('id', id)
      .not('locked_at', 'is', null)
      .select('id')

    if (unlockError) {
      throw new Error(unlockError.message ?? 'Kunde inte låsa upp besiktningen.')
    }
    if (!Array.isArray(unlockedRows) || unlockedRows.length === 0) {
      return jsonError('Besiktningen är redan upplåst.', 409)
    }

    const { error: logError } = await admin.from('inspection_lock_events').insert({
      org_id: org.orgId,
      inspection_id: id,
      action: 'unlock',
      reason,
      performed_by: org.userId,
    })

    if (logError) {
      await admin
        .from('inspections')
        .update({
          locked_at: wasLockedAt,
          locked_by: wasLockedBy,
        })
        .eq('id', id)

      throw new Error(logError.message ?? 'Kunde inte logga upplåsningen.')
    }

    return NextResponse.json({
      ok: true,
      inspection_id: id,
      locked_at: null,
      locked_by: null,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okänt fel.'
    if (message === 'UNAUTHORIZED') return jsonError('Inte inloggad.', 401)
    if (message === 'ORG_MEMBERSHIP_REQUIRED') return jsonError('Ingen organisationskoppling hittades.', 403)
    if (isMissingUnlockSchemaError(message)) {
      return jsonError('Databasstöd för lås/upplåsning saknas. Kör senaste migration först.', 409)
    }
    return jsonError(message || 'Kunde inte låsa upp besiktningen.', 500)
  }
}
