import { NextResponse } from 'next/server'
import {
  EB_REMEDIATION_MAX_IMAGE_BYTES,
  getEbRemediationWorkspaceByToken,
  uploadEbRemediationImageByToken,
} from '@/lib/eb/remediation'
import { assertEbCustomerRequestOrigin } from '@/lib/eb/customerSession'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie' } })
}

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : 'Okänt fel.'
  if (message === 'EB_CUSTOMER_ORIGIN_FORBIDDEN') return jsonError('Begäran måste göras från den här webbplatsen.', 403)
  if (message === 'EB_REMEDIATION_OWNER_VERIFICATION_REQUIRED') return jsonError('Öppna din personliga åtgärdslänk igen innan du lägger till bilder.', 403)
  if (message === 'EB_REMEDIATION_OWNER_LINK_EXPIRED') return jsonError('Länken har gått ut.', 410)
  if (message === 'EB_FOLLOW_UP_UNAVAILABLE' || message === 'EB_FOLLOW_UP_CONFIGURATION') return jsonError('Tjänsten är tillfälligt otillgänglig. Försök igen om en stund.', 503)
  if (message === 'EB_REMEDIATION_CONFLICT') return jsonError('Punkten ändrades av någon annan. Aktuella uppgifter har hämtats. Din osparade text finns kvar; kontrollera läget och försök igen.', 409)
  if (message === 'EB_FOLLOW_UP_ORDER_INACTIVE') return jsonError('Uppföljningen är pausad. Befintlig historik finns kvar.', 403)
  if (message === 'EB_REMEDIATION_COMPLETION_EVIDENCE_REQUIRED') return jsonError('Lägg till en åtgärdsbild eller en förklarande kommentar om arbetet inte kan fotograferas.', 400)
  if (message === 'EB_REMEDIATION_ACCESS_NOT_FOUND') return jsonError('Länken hittades inte.', 404)
  if (message === 'EB_REMEDIATION_ACCESS_REVOKED') return jsonError('Länken har återkallats.', 410)
  if (message === 'EB_REMEDIATION_ACCESS_EXPIRED') return jsonError('Länken har gått ut.', 410)
  if (message === 'EB_REMEDIATION_ACTION_FORBIDDEN') return jsonError('Du får inte lägga till bilder via denna länk.', 403)
  if (message === 'EB_REMEDIATION_TASK_NOT_FOUND') return jsonError('Åtgärdsuppgiften hittades inte.', 404)
  if (message === 'EB_REMEDIATION_IMAGE_TYPE_INVALID') return jsonError('Endast bildfiler är tillåtna.', 400)
  if (message === 'EB_REMEDIATION_IMAGE_EMPTY') return jsonError('Bilden är tom.', 400)
  if (message === 'EB_REMEDIATION_IMAGE_TOO_LARGE') {
    return jsonError(`Bilden är för stor (max ${EB_REMEDIATION_MAX_IMAGE_BYTES / 1024 / 1024} MB).`, 400)
  }
  return jsonError('Kunde inte ladda upp bilden. Försök igen om en stund.', 500)
}

export async function POST(
  request: Request,
  context: { params: Promise<{ token: string }> }
) {
  try {
    assertEbCustomerRequestOrigin(request)
    const { token } = await context.params
    const form = await request.formData()
    const taskId = typeof form.get('taskId') === 'string' ? String(form.get('taskId')).trim() : ''
    const file = form.get('file')
    if (!taskId) return jsonError('Åtgärdsuppgift saknas.', 400)
    if (!(file instanceof File)) return jsonError('Bild saknas.', 400)
    await uploadEbRemediationImageByToken({ token, taskId, file })
    const workspace = await getEbRemediationWorkspaceByToken(token)
    return NextResponse.json({ workspace }, { headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie' } })
  } catch (error) {
    return errorResponse(error)
  }
}
