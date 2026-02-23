import { NextResponse } from 'next/server'
import {
  InspectionCompletedEmailSendError,
  buildBaseUrl,
  getAssignmentById,
  getProfileContact,
  isMissingEnvError,
  requireOrgContext,
  sendInspectionCompletedEmail,
} from '@/lib/assignments/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function jsonError(message: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...(extra ?? {}) }, { status })
}

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params
    const org = await requireOrgContext()
    const assignment = await getAssignmentById(org.orgId, id)

    if (!assignment) return jsonError('Uppdraget hittades inte.', 404)

    if (assignment.status !== 'completed') {
      return jsonError('Besiktningen maste vara klar innan slutmejl kan skickas.', 400)
    }

    if (!assignment.inspection_id || !assignment.property_id) {
      return jsonError('Uppdraget saknar koppling till besiktning.', 400)
    }

    const responsibleProfile = await getProfileContact(assignment.responsible_profile_id)
    const result = await sendInspectionCompletedEmail({
      assignment,
      orgName: org.orgName,
      requestedByUserId: org.userId,
      responsibleEmail: responsibleProfile?.email ?? null,
      baseUrl: buildBaseUrl(),
    })

    return NextResponse.json({
      assignmentId: assignment.id,
      status: assignment.status,
      detailsUrl: result.detailsUrl,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okant fel.'

    if (message === 'UNAUTHORIZED') {
      console.warn('[assignments.send-completed] unauthorized')
      return jsonError('Inte inloggad.', 401)
    }

    if (message === 'ORG_MEMBERSHIP_REQUIRED') {
      console.warn('[assignments.send-completed] org membership required')
      return jsonError('Ingen organisationskoppling hittades.', 403)
    }

    if (message === 'INSPECTION_REFERENCE_MISSING') {
      return jsonError('Uppdraget saknar koppling till besiktning.', 400)
    }

    if (message.includes('SUPABASE_SERVICE_ROLE_KEY')) {
      console.error('[assignments.send-completed] missing env', { env: 'SUPABASE_SERVICE_ROLE_KEY' })
      return jsonError('Servern saknar SUPABASE_SERVICE_ROLE_KEY i env.', 500)
    }

    if (message.includes('RESEND_API_KEY')) {
      console.error('[assignments.send-completed] missing env', { env: 'RESEND_API_KEY' })
      return jsonError('Servern saknar RESEND_API_KEY i env.', 500)
    }

    if (error instanceof InspectionCompletedEmailSendError) {
      console.error('[assignments.send-completed] resend failed', {
        error: message,
        detailsUrl: error.detailsUrl,
      })
      return jsonError('Kunde inte skicka slutmejl just nu.', 502, {
        detailsUrl: error.detailsUrl,
      })
    }

    if (isMissingEnvError(error)) {
      console.error('[assignments.send-completed] missing env', { error: message })
      return jsonError('Servern saknar mejlkonfiguration i env.', 500)
    }

    console.error('[assignments.send-completed] unhandled error', { error: message })
    return jsonError('Kunde inte skicka slutmejl.', 500)
  }
}
