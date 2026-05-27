import { NextResponse } from 'next/server'
import { getTuAssignmentById, requireTuContext, sendTuAssignmentConfirmation } from '@/lib/tu/server'
import { AssignmentEmailSendError, isMissingEnvError } from '@/lib/assignments/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function jsonError(message: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...(extra ?? {}) }, { status })
}

function mapAccessError(error: unknown) {
  const message = error instanceof Error ? error.message : ''
  if (message === 'UNAUTHORIZED') return jsonError('Inte inloggad.', 401)
  if (message === 'MODULE_ACCESS_REQUIRED') return jsonError('TU kräver egen modulbehörighet.', 403)
  if (message === 'ORG_MEMBERSHIP_REQUIRED') return jsonError('Ingen organisationskoppling hittades.', 403)
  if (message === 'TU_ASSIGNMENT_NOT_FOUND') return jsonError('TU-uppdraget hittades inte.', 404)
  return null
}

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params
    const orgContext = await requireTuContext()
    const assignment = await getTuAssignmentById(orgContext.orgId, id)
    if (!assignment) return jsonError('TU-uppdraget hittades inte.', 404)
    if (!assignment.customer_email) return jsonError('Uppdraget saknar kundmejl.', 400)
    if (!assignment.scope_description?.trim()) {
      return jsonError('Beskriv vad den tekniska utredningen ska omfatta innan utskick.', 400)
    }
    if (assignment.price_amount === null) return jsonError('Pris är obligatoriskt innan utskick.', 400)

    if (
      !assignment.cadastral_id?.trim() &&
      (!assignment.brf_name?.trim() || !assignment.apartment_number?.trim())
    ) {
      return jsonError('Ange fastighetsbeteckning eller BRF och lägenhetsnummer innan utskick.', 400)
    }

    const sendResult = await sendTuAssignmentConfirmation({
      assignment,
      orgName: orgContext.orgName,
      requestedByUserId: orgContext.userId,
    })

    return NextResponse.json({
      assignmentId: assignment.id,
      status: 'sent',
      acceptUrl: sendResult.acceptUrl,
      expiresAt: sendResult.expiresAt,
    })
  } catch (error) {
    const accessError = mapAccessError(error)
    if (accessError) return accessError
    if (error instanceof AssignmentEmailSendError) {
      return jsonError('Kunde inte skicka mejl just nu.', 502, { acceptUrl: error.acceptUrl })
    }
    if (isMissingEnvError(error)) return jsonError('Servern saknar mejlkonfiguration i env.', 500)
    return jsonError('Kunde inte skicka TU-uppdrag.', 500)
  }
}
