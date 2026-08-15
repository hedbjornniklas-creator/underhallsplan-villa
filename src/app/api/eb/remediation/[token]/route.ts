import { NextResponse } from 'next/server'
import {
  getEbRemediationWorkspaceByToken,
  performEbRemediationTokenAction,
} from '@/lib/eb/remediation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : 'Okänt fel.'
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
  return jsonError(message || 'Kunde inte hantera åtgärdslistan.', 500)
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await context.params
    const workspace = await getEbRemediationWorkspaceByToken(token)
    if (!workspace) return jsonError('Länken hittades inte.', 404)
    return NextResponse.json({ workspace })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await context.params
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const action = typeof body.action === 'string' ? body.action : ''
    const payload = body.payload && typeof body.payload === 'object'
      ? (body.payload as Record<string, unknown>)
      : {}
    const workspace = await performEbRemediationTokenAction({
      token,
      action,
      payload,
      requestOrigin: new URL(request.url).origin,
    })
    return NextResponse.json({ workspace })
  } catch (error) {
    return errorResponse(error)
  }
}
