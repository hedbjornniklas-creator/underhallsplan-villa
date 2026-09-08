import { NextResponse } from 'next/server'
import {
  getEbRemediationWorkspaceByToken,
  performEbRemediationTokenAction,
} from '@/lib/eb/remediation'
import { requestEbOwnerAccessCode, verifyEbOwnerAccessCode } from '@/lib/eb/ownerAuth'
import { requestEbFollowUpOwnerRenewal } from '@/lib/eb/followUpServer'
import { assertEbCustomerRequestOrigin } from '@/lib/eb/customerSession'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function jsonError(message: string, status: number) {
  return json({ error: message }, status)
}

function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: {
    'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie', 'X-Content-Type-Options': 'nosniff',
  } })
}

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : 'Okänt fel.'
  if (message === 'EB_CUSTOMER_ORIGIN_FORBIDDEN') return jsonError('Begäran måste göras från den här webbplatsen.', 403)
  if (message === 'EB_REMEDIATION_OWNER_VERIFICATION_REQUIRED') return jsonError('Verifiera din e-post för att öppna den personliga portalen. Ladda om sidan för att ange en engångskod.', 403)
  if (message === 'EB_REMEDIATION_OWNER_LINK_EXPIRED') return jsonError('Länken har gått ut. Ladda om sidan för att begära en ny personlig länk.', 410)
  if (message === 'EB_REMEDIATION_CONFLICT') return jsonError('Punkten ändrades av någon annan. Aktuella uppgifter har hämtats. Din osparade text finns kvar; kontrollera läget och försök igen.', 409)
  if (message === 'EB_FOLLOW_UP_ORDER_INACTIVE') return jsonError('Uppföljningen är pausad. Befintlig historik finns kvar.', 403)
  if (message === 'EB_REMEDIATION_COMPLETION_EVIDENCE_REQUIRED') return jsonError('Lägg till en åtgärdsbild eller en förklarande kommentar om arbetet inte kan fotograferas.', 400)
  if (message === 'EB_FOLLOW_UP_RATE_LIMITED') return jsonError('Vänta en stund innan du begär en ny länk.', 429)
  if (message.startsWith('EB_FOLLOW_UP_MAIL_') || message === 'EB_FOLLOW_UP_CONFIGURATION' || message === 'EB_FOLLOW_UP_UNAVAILABLE') return jsonError('Tjänsten kunde inte slutföra åtgärden just nu. Försök igen om en stund.', 503)
  if (message === 'EB_REMEDIATION_COMMENT_INVALID') return jsonError('Kommentaren får vara högst 6 000 tecken och får inte innehålla ogiltiga kontrolltecken.', 400)
  if (message === 'EB_REMEDIATION_ACCESS_NOT_FOUND') return jsonError('Länken hittades inte.', 404)
  if (message === 'EB_REMEDIATION_ACCESS_REVOKED') return jsonError('Länken har återkallats.', 410)
  if (message === 'EB_REMEDIATION_ACCESS_EXPIRED') return jsonError('Länken har gått ut.', 410)
  if (message === 'EB_REMEDIATION_ACTION_FORBIDDEN') return jsonError('Åtgärden är inte tillåten via denna länk.', 403)
  if (message === 'EB_REMEDIATION_TASK_NOT_FOUND') return jsonError('Åtgärdsuppgiften hittades inte.', 404)
  if (message === 'EB_REMEDIATION_ASSIGNEE_NOT_FOUND') return jsonError('Mottagaren hittades inte.', 404)
  if (message === 'EB_REMEDIATION_ASSIGNEE_NAME_REQUIRED') return jsonError('Ange vem som ska åtgärda.', 400)
  if (message === 'EB_REMEDIATION_ASSIGNEE_REQUIRED') return jsonError('Välj vem länken gäller.', 400)
  if (message === 'EB_REMEDIATION_EMAIL_INVALID') return jsonError('Ange en giltig e-postadress.', 400)
  if (message === 'EB_REMEDIATION_COMMENT_REQUIRED') return jsonError('Skriv en kommentar.', 400)
  if (message === 'EB_REMEDIATION_COMPLETION_IMAGE_REQUIRED') {
    return jsonError('Lägg till minst en åtgärdsbild innan punkten markeras klar för kontroll.', 400)
  }
  if (message === 'EB_REMEDIATION_TASK_REQUIRED') return jsonError('Välj minst en anmärkning.', 400)
  if (message.startsWith('MISSING_ENV:')) return jsonError('E-postinställningarna är inte klara.', 503)
  return jsonError('Kunde inte hantera åtgärdslistan. Försök igen om en stund.', 500)
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await context.params
    const workspace = await getEbRemediationWorkspaceByToken(token)
    if (!workspace) return jsonError('Länken hittades inte.', 404)
    return json({ workspace })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ token: string }> }
) {
  try {
    assertEbCustomerRequestOrigin(request)
    const { token } = await context.params
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const action = typeof body.action === 'string' ? body.action : ''
    const payload = body.payload && typeof body.payload === 'object'
      ? (body.payload as Record<string, unknown>)
      : {}
    if (action === 'request_owner_code') return json(await requestEbOwnerAccessCode({ token }))
    if (action === 'verify_owner_code') return json(await verifyEbOwnerAccessCode({
      token, challengeId: payload.challengeId, code: payload.code,
    }))
    if (action === 'renew_owner_link') return json(await requestEbFollowUpOwnerRenewal({
      accessToken: token, baseUrl: new URL(request.url).origin,
    }))
    const workspace = await performEbRemediationTokenAction({
      token,
      action,
      payload,
      requestOrigin: new URL(request.url).origin,
    })
    return json({ workspace })
  } catch (error) {
    return errorResponse(error)
  }
}
