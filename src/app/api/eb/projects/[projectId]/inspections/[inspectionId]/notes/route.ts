import { NextResponse } from 'next/server'
import { requireModuleAccess } from '@/lib/access/server'
import { requireOrgContext } from '@/lib/assignments/server'
import { createEbNote } from '@/lib/eb/server'
import type { EbPartyKey } from '@/lib/eb/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

function toText(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function toUuid(value: unknown) {
  const normalized = toText(value).toLowerCase()
  return UUID_PATTERN.test(normalized) ? normalized : null
}

function toPartyKey(value: unknown): EbPartyKey | null {
  const normalized = toText(value)
  if (normalized === 'client' || normalized === 'contractor' || normalized === 'other') {
    return normalized
  }
  return null
}

function toCostParty(value: unknown): 'client' | 'contractor' | null {
  const normalized = toText(value)
  if (normalized === 'client' || normalized === 'contractor') return normalized
  return null
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
  if (message === 'EB_REPORT_LOCKED') return jsonError('Utlåtandet är låst och kan inte ändras.', 409)
  if (message === 'EB_NOTE_ID_CONFLICT') return jsonError('Noteringens id används redan.', 409)
  if (message === 'EB_DISCIPLINE_REQUIRED') return jsonError('Välj fack innan noteringen sparas.', 400)
  if (message === 'EB_NOTE_TEXT_REQUIRED') return jsonError('Skriv en noteringstext.', 400)
  if (message === 'EB_REMEDIATION_ASSIGNEE_NOT_FOUND') {
    return jsonError('Valet Åtgärdas av finns inte längre. Välj ett annat.', 400)
  }
  return jsonError(fallback, 500)
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
      noteId: toUuid(body.clientNoteId),
      disciplineId: toText(body.disciplineId) || null,
      markerKey: toText(body.markerKey) || null,
      statusKey: toText(body.statusKey) || null,
      location: toText(body.location) || null,
      room: toText(body.room) || null,
      placeDetail: toText(body.placeDetail) || null,
      noteText: toText(body.noteText) || null,
      remediationAssigneeId: toUuid(body.remediationAssigneeId),
      remediationAssigneeName: toText(body.remediationAssigneeName) || null,
      remediationAssigneeCommit: body.remediationAssigneeCommit === true,
      responsibleParty: toText(body.responsibleParty) || null,
      tradeGroup: toText(body.tradeGroup) || null,
      investigationResponsibleParty: toPartyKey(body.investigationResponsibleParty),
      investigationResponsibleNote: toText(body.investigationResponsibleNote) || null,
      investigationCostParty: toCostParty(body.investigationCostParty),
      investigationDueDate: toText(body.investigationDueDate) || null,
      deductionAmount: toText(body.deductionAmount) || null,
    })

    return NextResponse.json({ note }, { status: 201 })
  } catch (error) {
    return mapError(error, 'Kunde inte skapa notering.')
  }
}
