import { NextResponse } from 'next/server'
import { requireModuleAccess } from '@/lib/access/server'
import { requireOrgContext } from '@/lib/assignments/server'
import { createEbNote } from '@/lib/eb/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

function toText(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
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
  if (message === 'EB_DISCIPLINE_REQUIRED') return jsonError('Välj fack innan noteringen sparas.', 400)
  if (message === 'EB_NOTE_TEXT_REQUIRED') return jsonError('Skriv en noteringstext.', 400)
  return jsonError(message || fallback, 500)
}

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string; inspectionId: string }> }
) {
  try {
    const { projectId, inspectionId } = await context.params
    const org = await requireEbContext()
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const note = await createEbNote({
      orgId: org.orgId,
      requestedByUserId: org.userId,
      projectId,
      inspectionId,
      disciplineId: toText(body.disciplineId) || null,
      markerKey: toText(body.markerKey) || null,
      statusKey: toText(body.statusKey) || null,
      location: toText(body.location) || null,
      room: toText(body.room) || null,
      placeDetail: toText(body.placeDetail) || null,
      noteText: toText(body.noteText) || null,
      responsibleParty: toText(body.responsibleParty) || null,
      tradeGroup: toText(body.tradeGroup) || null,
    })

    return NextResponse.json({ note }, { status: 201 })
  } catch (error) {
    return mapError(error, 'Kunde inte skapa notering.')
  }
}
