import { requireObAssignmentContext } from '@/lib/ob/organizationBindings'
import { obRequestOrgId, obOrganizationFailure } from '@/lib/ob/organizationHttp'
import { NextResponse } from 'next/server'
import { AssignmentEmailSendError, buildBaseUrl, getAssignmentById, isMissingEnvError, sendAssignmentConfirmation } from '@/lib/assignments/server'

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
    const org = await requireObAssignmentContext((await context.params).id, obRequestOrgId(request))
    const assignment = await getAssignmentById(org.orgId, id)

    if (!assignment) return jsonError('Uppdraget hittades inte.', 404)
    if (assignment.status !== 'draft') {
      return jsonError(
        'Uppdragsbekraftelsen kan endast skickas fran utkast. Anvand "Skicka om uppdragsbekraftelse" for ny version.',
        409
      )
    }
    const sendResult = await sendAssignmentConfirmation({
      assignment,
      orgName: org.orgName,
      requestedByUserId: org.userId,
      responsibleEmail: null,
      baseUrl: buildBaseUrl(),
    })

    return NextResponse.json({
      assignmentId: assignment.id,
      status: 'sent',
      acceptUrl: sendResult.acceptUrl,
      expiresAt: sendResult.expiresAt,
    })
  } catch (error) {
    const organizationFailure = obOrganizationFailure(error)
    if (organizationFailure) return organizationFailure

    const message = error instanceof Error ? error.message : 'Okant fel.'

    if (message === 'UNAUTHORIZED') {
      console.warn('[assignments.send] unauthorized')
      return jsonError('Inte inloggad.', 401)
    }

    if (message === 'ORG_MEMBERSHIP_REQUIRED') {
      console.warn('[assignments.send] org membership required')
      return jsonError('Ingen organisationskoppling hittades.', 403)
    }

    if (message === 'ORDERER_ROLE_REQUIRED') {
      return jsonError('Valj uppdragsgivare (Säljare, Köpare eller Lägenhet) innan utskick.', 400)
    }
    if (message === 'PRICE_REQUIRED') {
      return jsonError('Ange pris (SEK) innan utskick.', 400)
    }
    if (message === 'STATUS_CANCELLATION_FEE_REQUIRED') {
      return jsonError('Ange avbokningsbeloppet enligt uppdragsbekräftelsen (0 kr är tillåtet).', 400)
    }
    if (message === 'STATUS_SCOPE_REQUIRED') return jsonError('Ange vad statusbesiktningen omfattar.', 400)
    if (message === 'STATUS_OBJECT_TYPE_INVALID') return jsonError('Välj om statusbesiktningen gäller fastighet eller lägenhet.', 400)
    if (message === 'STATUS_OBJECT_TYPE_NOT_CONFIGURED') return jsonError('Statusbesiktningens objekttyp är inte konfigurerad i databasen ännu.', 503)
    if (message === 'ASSIGNMENT_NOT_ACCEPTED') {
      return jsonError('Uppdraget är inte godkänt och kan inte skickas som kopia ännu.', 409)
    }

    if (message.includes('SUPABASE_SERVICE_ROLE_KEY')) {
      console.error('[assignments.send] missing env', { env: 'SUPABASE_SERVICE_ROLE_KEY' })
      return jsonError('Servern saknar SUPABASE_SERVICE_ROLE_KEY i env.', 500)
    }

    if (message.includes('RESEND_API_KEY')) {
      console.error('[assignments.send] missing env', { env: 'RESEND_API_KEY' })
      return jsonError('Servern saknar RESEND_API_KEY i env.', 500)
    }

    if (error instanceof AssignmentEmailSendError) {
      console.error('[assignments.send] resend failed', {
        error: message,
        acceptUrl: error.acceptUrl,
      })
      return jsonError('Kunde inte skicka mejl just nu.', 502, { acceptUrl: error.acceptUrl })
    }

    if (isMissingEnvError(error)) {
      console.error('[assignments.send] missing env', { error: message })
      return jsonError('Servern saknar mejlkonfiguration i env.', 500)
    }

    console.error('[assignments.send] unhandled error', { error: message })
    return jsonError('Kunde inte skicka uppdragsbekraftelsen.', 500)
  }
}
