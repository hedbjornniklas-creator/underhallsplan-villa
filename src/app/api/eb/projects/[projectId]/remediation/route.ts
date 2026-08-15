import { NextResponse } from 'next/server'
import { requireModuleAccess } from '@/lib/access/server'
import { requireOrgContext } from '@/lib/assignments/server'
import {
  getEbRemediationWorkspace,
  performEbRemediationInternalAction,
} from '@/lib/eb/remediation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

async function requireEbContext() {
  await requireModuleAccess({
    productKey: 'dashboard',
    moduleKey: 'construction_inspections',
  })
  return requireOrgContext()
}

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : 'Okänt fel.'
  if (message === 'UNAUTHORIZED') return jsonError('Inte inloggad.', 401)
  if (message === 'ORG_MEMBERSHIP_REQUIRED' || message === 'MODULE_ACCESS_REQUIRED') {
    return jsonError('Du saknar behörighet till EB.', 403)
  }
  if (message === 'EB_PROJECT_NOT_FOUND') return jsonError('Entreprenaden hittades inte.', 404)
  if (message === 'EB_REMEDIATION_TASK_NOT_FOUND') return jsonError('Åtgärdsuppgiften hittades inte.', 404)
  if (message === 'EB_REMEDIATION_ASSIGNEE_NOT_FOUND') return jsonError('Mottagaren hittades inte.', 404)
  if (message === 'EB_REMEDIATION_ACCESS_NOT_FOUND') return jsonError('Åtkomstlänken hittades inte.', 404)
  if (message === 'EB_REMEDIATION_ASSIGNEE_NAME_REQUIRED') {
    return jsonError('Ange vem som ska åtgärda.', 400)
  }
  if (message === 'EB_REMEDIATION_EMAIL_INVALID') return jsonError('Ange en giltig e-postadress.', 400)
  if (message === 'EB_REMEDIATION_TASK_REQUIRED') return jsonError('Välj minst en anmärkning.', 400)
  if (message.startsWith('MISSING_ENV:')) return jsonError('E-postinställningarna är inte klara.', 503)
  return jsonError(message || 'Kunde inte hantera åtgärdsportalen.', 500)
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await context.params
    const org = await requireEbContext()
    const workspace = await getEbRemediationWorkspace({ orgId: org.orgId, projectId })
    return NextResponse.json({ workspace })
  } catch (error) {
    return errorResponse(error)
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ projectId: string }> }
) {
  try {
    const { projectId } = await context.params
    const org = await requireEbContext()
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const action = typeof body.action === 'string' ? body.action : ''
    const payload = body.payload && typeof body.payload === 'object'
      ? (body.payload as Record<string, unknown>)
      : {}
    const workspace = await performEbRemediationInternalAction({
      orgId: org.orgId,
      projectId,
      profileId: org.userId,
      action,
      payload,
      requestOrigin: new URL(request.url).origin,
    })
    return NextResponse.json({ workspace })
  } catch (error) {
    return errorResponse(error)
  }
}
