import { NextResponse } from 'next/server'
import {
  createReissuedAssignmentDraft,
  getProfileContact,
  requireOrgContext,
  sendAssignmentCancelledNotice,
} from '@/lib/assignments/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params
    const org = await requireOrgContext()
    const { draft, cancelledSource } = await createReissuedAssignmentDraft({
      orgId: org.orgId,
      sourceAssignmentId: id,
      createdBy: org.userId,
    })
    let cancelledNoticeEmailSent = false
    try {
      const responsibleProfile = await getProfileContact(cancelledSource.responsible_profile_id)
      await sendAssignmentCancelledNotice({
        assignment: cancelledSource,
        orgName: org.orgName,
        requestedByUserId: org.userId,
        responsibleEmail: responsibleProfile?.email ?? null,
      })
      cancelledNoticeEmailSent = true
    } catch (mailError) {
      console.error('[assignments.reissue] failed to send cancelled notice', {
        assignmentId: cancelledSource.id,
        error: mailError instanceof Error ? mailError.message : String(mailError),
      })
    }

    return NextResponse.json({
      assignmentId: draft.id,
      status: draft.status,
      cancelledAssignmentId: cancelledSource.id,
      cancelledNoticeEmailSent,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okänt fel.'

    if (message === 'UNAUTHORIZED') return jsonError('Inte inloggad.', 401)
    if (message === 'ORG_MEMBERSHIP_REQUIRED') {
      return jsonError('Ingen organisationskoppling hittades.', 403)
    }
    if (message === 'ASSIGNMENT_NOT_FOUND') {
      return jsonError('Uppdraget hittades inte.', 404)
    }
    if (message === 'ASSIGNMENT_REISSUE_NOT_ALLOWED') {
      return jsonError(
        'Omgiltigering är endast tillåten för skickad, beställd eller bokad uppdragsbekräftelse.',
        409
      )
    }

    return jsonError('Kunde inte skapa ny version av uppdragsbekräftelsen.', 500)
  }
}
