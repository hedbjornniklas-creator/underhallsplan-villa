import { NextResponse } from 'next/server'
import {
  EB_REMEDIATION_MAX_IMAGE_BYTES,
  getEbRemediationWorkspaceByToken,
  uploadEbRemediationImageByToken,
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
  if (message === 'EB_REMEDIATION_ACTION_FORBIDDEN') return jsonError('Du får inte lägga till bilder via denna länk.', 403)
  if (message === 'EB_REMEDIATION_TASK_NOT_FOUND') return jsonError('Åtgärdsuppgiften hittades inte.', 404)
  if (message === 'EB_REMEDIATION_IMAGE_TYPE_INVALID') return jsonError('Endast bildfiler är tillåtna.', 400)
  if (message === 'EB_REMEDIATION_IMAGE_EMPTY') return jsonError('Bilden är tom.', 400)
  if (message === 'EB_REMEDIATION_IMAGE_TOO_LARGE') {
    return jsonError(`Bilden är för stor (max ${EB_REMEDIATION_MAX_IMAGE_BYTES / 1024 / 1024} MB).`, 400)
  }
  return jsonError(message || 'Kunde inte ladda upp bilden.', 500)
}

export async function POST(
  request: Request,
  context: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await context.params
    const form = await request.formData()
    const taskId = typeof form.get('taskId') === 'string' ? String(form.get('taskId')).trim() : ''
    const file = form.get('file')
    if (!taskId) return jsonError('Åtgärdsuppgift saknas.', 400)
    if (!(file instanceof File)) return jsonError('Bild saknas.', 400)
    await uploadEbRemediationImageByToken({ token, taskId, file })
    const workspace = await getEbRemediationWorkspaceByToken(token)
    return NextResponse.json({ workspace })
  } catch (error) {
    return errorResponse(error)
  }
}
