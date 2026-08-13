import { NextResponse } from 'next/server'
import { requireModuleAccess } from '@/lib/access/server'
import { requireOrgContext } from '@/lib/assignments/server'
import { getEbProjectById } from '@/lib/eb/server'
import { createSupabaseAdminClient } from '@/lib/supabase/admin'

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

async function requireEbContext() {
  await requireModuleAccess({
    productKey: 'dashboard',
    moduleKey: 'construction_inspections',
  })
  return requireOrgContext()
}

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string; inspectionId: string }> }
) {
  try {
    const { projectId, inspectionId } = await context.params
    const org = await requireEbContext()
    const body = (await request.json().catch(() => null)) as { reason?: unknown } | null
    const reason = normalizeReason(body?.reason)
    if (!reason) {
      return jsonError('Anledning måste vara minst 10 tecken.', 400)
    }

    const admin = createSupabaseAdminClient()
    const { error } = await admin.rpc('unlock_eb_inspection_report', {
      p_org_id: org.orgId,
      p_project_id: projectId,
      p_inspection_id: inspectionId,
      p_reason: reason,
      p_performed_by: org.userId,
    })

    if (error) {
      const message = error.message ?? 'Kunde inte låsa upp EB-utlåtandet.'
      if (message.includes('EB_INSPECTION_NOT_FOUND')) return jsonError('Besiktningen hittades inte.', 404)
      if (message.includes('EB_INSPECTION_ALREADY_UNLOCKED')) {
        return jsonError('Besiktningen är redan upplåst.', 409)
      }
      if (message.includes('UNLOCK_REASON_REQUIRED')) {
        return jsonError('Anledning måste vara minst 10 tecken.', 400)
      }
      throw new Error(message)
    }

    const project = await getEbProjectById({ orgId: org.orgId, projectId })

    return NextResponse.json({
      ok: true,
      inspectionId,
      reportLockedAt: null,
      project,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okänt fel.'
    if (message === 'UNAUTHORIZED') return jsonError('Inte inloggad.', 401)
    if (message === 'ORG_MEMBERSHIP_REQUIRED') return jsonError('Ingen organisationskoppling hittades.', 403)
    if (message === 'MODULE_ACCESS_REQUIRED') return jsonError('EB kräver egen modulbehörighet.', 403)
    return jsonError('Kunde inte låsa upp EB-utlåtandet.', 500)
  }
}
