import { NextResponse } from 'next/server'
import { requireModuleAccess } from '@/lib/access/server'
import { requireOrgContext } from '@/lib/assignments/server'
import {
  getEbInvitationContext,
  saveEbInvitationDraft,
  sendEbInvitation,
  type EbInvitationParticipantInput,
  type EbPartyKey,
} from '@/lib/eb/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

function toText(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function toPartyKey(value: unknown): EbPartyKey | null {
  const key = toText(value)
  return key === 'client' || key === 'contractor' || key === 'other' ? key : null
}

function toParticipant(value: unknown, index: number): EbInvitationParticipantInput | null {
  if (!value || typeof value !== 'object') return null
  const record = value as Record<string, unknown>

  return {
    id: toText(record.id) || null,
    roleLabel: toText(record.roleLabel) || null,
    companyName: toText(record.companyName) || null,
    personName: toText(record.personName) || null,
    email: toText(record.email) || null,
    phone: toText(record.phone) || null,
    receivesInvitation: record.receivesInvitation !== false,
    attended: record.attended === true,
    receivesReport: record.receivesReport !== false,
    representsPartyKey: toPartyKey(record.representsPartyKey),
    canRepresentParty: record.canRepresentParty === true,
    sortOrder: typeof record.sortOrder === 'number' ? record.sortOrder : (index + 1) * 100,
  }
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
  if (message === 'INVITATION_SUBJECT_REQUIRED') return jsonError('Ange ämne.', 400)
  if (message === 'INVITATION_BODY_REQUIRED') return jsonError('Ange kallelsetext.', 400)
  if (message === 'INVITATION_RECIPIENT_REQUIRED') {
    return jsonError('Lägg till minst en mottagare med giltig mejladress.', 400)
  }
  if (message.startsWith('MISSING_ENV:')) {
    return jsonError('Mejlmiljö saknas. Konfigurera avsändaradress innan utskick.', 409)
  }
  if (message.startsWith('INVITATION_SEND_FAILED:')) {
    return jsonError(message.replace('INVITATION_SEND_FAILED:', ''), 502)
  }
  return jsonError(message || fallback, 500)
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ projectId: string; inspectionId: string }> }
) {
  try {
    const { projectId, inspectionId } = await context.params
    const org = await requireEbContext()
    const invitation = await getEbInvitationContext({
      orgId: org.orgId,
      requestedByUserId: org.userId,
      projectId,
      inspectionId,
    })

    return NextResponse.json(invitation)
  } catch (error) {
    return mapError(error, 'Kunde inte hämta kallelse.')
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string; inspectionId: string }> }
) {
  try {
    const { projectId, inspectionId } = await context.params
    const org = await requireEbContext()
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const participants = Array.isArray(body.participants)
      ? body.participants
          .map((participant, index) => toParticipant(participant, index))
          .filter((participant): participant is EbInvitationParticipantInput => Boolean(participant))
      : []

    const result = await sendEbInvitation({
      orgId: org.orgId,
      requestedByUserId: org.userId,
      projectId,
      inspectionId,
      subject: toText(body.subject),
      body: toText(body.body),
      participants,
    })

    return NextResponse.json(result)
  } catch (error) {
    return mapError(error, 'Kunde inte skicka kallelse.')
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ projectId: string; inspectionId: string }> }
) {
  try {
    const { projectId, inspectionId } = await context.params
    const org = await requireEbContext()
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const participants = Array.isArray(body.participants)
      ? body.participants
          .map((participant, index) => toParticipant(participant, index))
          .filter((participant): participant is EbInvitationParticipantInput => Boolean(participant))
      : []

    const invitation = await saveEbInvitationDraft({
      orgId: org.orgId,
      requestedByUserId: org.userId,
      projectId,
      inspectionId,
      subject: toText(body.subject) || null,
      body: toText(body.body) || null,
      participants,
    })

    return NextResponse.json(invitation)
  } catch (error) {
    return mapError(error, 'Kunde inte spara kallelse och deltagare.')
  }
}
