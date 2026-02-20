import { NextResponse } from 'next/server'
import {
  AssignmentEmailSendError,
  buildBaseUrl,
  getAssignmentById,
  getProfileContact,
  requireOrgContext,
  sendAssignmentConfirmation,
} from '@/lib/assignments/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function jsonError(message: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...(extra ?? {}) }, { status })
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params
    const org = await requireOrgContext()
    const assignment = await getAssignmentById(org.orgId, id)

    if (!assignment) return jsonError('Uppdraget hittades inte.', 404)
    if (assignment.status === 'completed') {
      return jsonError('Uppdraget är redan avslutat och kan inte skickas igen.', 400)
    }

    const responsibleProfile = await getProfileContact(assignment.responsible_profile_id)
    const sendResult = await sendAssignmentConfirmation({
      assignment,
      orgName: org.orgName,
      orgEmailFrom: org.orgEmailFrom,
      requestedByUserId: org.userId,
      responsibleEmail: responsibleProfile?.email ?? null,
      baseUrl: buildBaseUrl(request),
    })

    return NextResponse.json({
      assignmentId: assignment.id,
      status: 'sent',
      acceptUrl: sendResult.acceptUrl,
      expiresAt: sendResult.expiresAt,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okänt fel.'
    if (message === 'UNAUTHORIZED') return jsonError('Inte inloggad.', 401)
    if (message === 'ORG_MEMBERSHIP_REQUIRED') return jsonError('Ingen organisationskoppling hittades.', 403)
    if (error instanceof AssignmentEmailSendError) {
      return jsonError('Kunde inte skicka mejl just nu.', 502, { acceptUrl: error.acceptUrl })
    }
    return jsonError('Kunde inte skicka uppdragsbekräftelsen.', 500)
  }
}
