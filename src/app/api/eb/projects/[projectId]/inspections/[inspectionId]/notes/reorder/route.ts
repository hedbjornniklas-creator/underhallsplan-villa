import { NextResponse } from 'next/server'
import { requireModuleAccess } from '@/lib/access/server'
import { requireOrgContext } from '@/lib/assignments/server'
import { reorderEbNotes } from '@/lib/eb/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
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
  if (message === 'EB_INSPECTION_NOT_FOUND') return jsonError('Besiktningen hittades inte.', 404)
  if (message === 'EB_NOTE_ORDER_EMPTY') return jsonError('Ingen noteringsordning skickades.', 400)
  if (message === 'EB_NOTE_ORDER_INVALID') return jsonError('Noteringsordningen stämmer inte med besiktningen.', 400)
  return jsonError(message || fallback, 500)
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ projectId: string; inspectionId: string }> }
) {
  try {
    const { projectId, inspectionId } = await context.params
    const org = await requireEbContext()
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const orderedNoteIds = Array.isArray(body.orderedNoteIds)
      ? body.orderedNoteIds.filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
      : []

    await reorderEbNotes({
      orgId: org.orgId,
      projectId,
      inspectionId,
      orderedNoteIds,
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    return mapError(error, 'Kunde inte spara noteringsordningen.')
  }
}
