import { NextResponse } from 'next/server'
import {
  AssignmentEmailSendError,
  buildBaseUrl,
  createAssignment,
  getProfileContact,
  requireOrgContext,
  sendAssignmentConfirmation,
} from '@/lib/assignments/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function jsonError(message: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...(extra ?? {}) }, { status })
}

export async function POST(request: Request) {
  try {
    const context = await requireOrgContext()
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const customerEmail = String(body.customerEmail ?? '').trim().toLowerCase()

    if (!customerEmail || !EMAIL_REGEX.test(customerEmail)) {
      return jsonError('Ange en giltig mejladress.', 400)
    }

    const assignment = await createAssignment({
      orgId: context.orgId,
      createdBy: context.userId,
      responsibleProfileId: context.userId,
      assignmentType: 'OB',
      customerEmail,
      customerName: null,
      customerPhone: null,
      preliminaryAddress: null,
      preferredDate: null,
      preferredTime: null,
      notesInternal: null,
    })

    const responsibleProfile = await getProfileContact(context.userId)
    const sendResult = await sendAssignmentConfirmation({
      assignment,
      orgName: context.orgName,
      orgEmailFrom: context.orgEmailFrom,
      requestedByUserId: context.userId,
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

    return jsonError('Kunde inte skapa och skicka uppdragsbekräftelse.', 500)
  }
}
