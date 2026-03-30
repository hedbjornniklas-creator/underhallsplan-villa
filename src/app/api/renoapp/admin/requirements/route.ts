import { NextResponse } from 'next/server'
import { listRenoAppAdminRequirementConfig, saveRenoAppAdminRequirement } from '@/lib/renoapp/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

export async function GET() {
  try {
    const payload = await listRenoAppAdminRequirementConfig()
    return NextResponse.json(payload)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okänt fel.'
    if (message === 'UNAUTHORIZED') return jsonError('Inte inloggad.', 401)
    if (message === 'ADMIN_REQUIRED') return jsonError('Endast admin har åtkomst.', 403)
    return jsonError(message || 'Kunde inte läsa dokumentkrav.', 500)
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const result = await saveRenoAppAdminRequirement({
      actionTypeId: typeof body.actionTypeId === 'string' ? body.actionTypeId : '',
      documentTypeId: typeof body.documentTypeId === 'string' ? body.documentTypeId : '',
      isEnabled: Boolean(body.isEnabled),
      isRequired: typeof body.isRequired === 'boolean' ? body.isRequired : true,
      note: typeof body.note === 'string' ? body.note : null,
      sortOrder: typeof body.sortOrder === 'number' ? body.sortOrder : Number(body.sortOrder ?? 100),
    })
    return NextResponse.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okänt fel.'
    if (message === 'UNAUTHORIZED') return jsonError('Inte inloggad.', 401)
    if (message === 'ADMIN_REQUIRED') return jsonError('Endast admin har åtkomst.', 403)
    if (message === 'REQUIREMENT_TARGET_REQUIRED') return jsonError('Välj renoveringstyp och dokumenttyp.', 400)
    return jsonError(message || 'Kunde inte spara dokumentkrav.', 500)
  }
}
