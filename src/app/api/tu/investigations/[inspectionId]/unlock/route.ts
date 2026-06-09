import { NextResponse } from 'next/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'
import { requireTuContext } from '@/lib/tu/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

function normalizeReason(value: unknown) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length >= 10 ? trimmed : null
}

function isMissingUnlockSchemaError(message: string) {
  const normalized = message.toLowerCase()
  return (
    normalized.includes('unlock_tu_investigation_report') ||
    normalized.includes('inspection_lock_events') ||
    normalized.includes('report_locked_at') ||
    normalized.includes('report_locked_by') ||
    normalized.includes('locked_at') ||
    normalized.includes('locked_by') ||
    normalized.includes('42p01') ||
    normalized.includes('42883') ||
    normalized.includes('42703') ||
    normalized.includes('does not exist')
  )
}

export async function POST(
  request: Request,
  context: { params: Promise<{ inspectionId: string }> }
) {
  try {
    const { inspectionId } = await context.params
    const org = await requireTuContext()
    const body = (await request.json().catch(() => null)) as { reason?: unknown } | null
    const reason = normalizeReason(body?.reason)
    if (!reason) {
      return jsonError('Anledning måste vara minst 10 tecken.', 400)
    }

    const admin = createSupabaseAdminClient()
    const { error } = await admin.rpc('unlock_tu_investigation_report', {
      p_org_id: org.orgId,
      p_inspection_id: inspectionId,
      p_reason: reason,
      p_performed_by: org.userId,
    })

    if (error) {
      const message = error.message ?? 'Kunde inte låsa upp TU-utlåtandet.'
      if (message.includes('TU_INSPECTION_NOT_FOUND')) return jsonError('TU-utredningen hittades inte.', 404)
      if (message.includes('TU_INSPECTION_ALREADY_UNLOCKED')) {
        return jsonError('Utlåtandet är redan upplåst.', 409)
      }
      if (message.includes('UNLOCK_REASON_REQUIRED')) {
        return jsonError('Anledning måste vara minst 10 tecken.', 400)
      }
      throw new Error(message)
    }

    return NextResponse.json({
      ok: true,
      inspectionId,
      reportLockedAt: null,
      inspectionLockedAt: null,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okänt fel.'
    if (message === 'UNAUTHORIZED') return jsonError('Inte inloggad.', 401)
    if (message === 'ORG_MEMBERSHIP_REQUIRED') return jsonError('Ingen organisationskoppling hittades.', 403)
    if (message === 'MODULE_ACCESS_REQUIRED') return jsonError('TU kräver egen modulbehörighet.', 403)
    if (isMissingUnlockSchemaError(message)) {
      return jsonError('Databasstöd för TU-upplåsning saknas. Kör senaste migration först.', 409)
    }
    return jsonError(message || 'Kunde inte låsa upp TU-utlåtandet.', 500)
  }
}
