import { NextResponse } from 'next/server'
import {
  listRenoAppAdminActionTypeQuestionConfig,
  saveRenoAppAdminActionTypeQuestion,
} from '@/lib/renoapp/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

export async function GET() {
  try {
    const payload = await listRenoAppAdminActionTypeQuestionConfig()
    return NextResponse.json(payload)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okant fel.'
    if (message === 'UNAUTHORIZED') return jsonError('Inte inloggad.', 401)
    if (message === 'ADMIN_REQUIRED') return jsonError('Endast admin har atkomst.', 403)
    if (message === 'PROFILE_NOT_FOUND') return jsonError('Ingen profil hittades for anvandaren.', 403)
    return jsonError(message || 'Kunde inte lasa fragekopplingar.', 500)
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>

    await saveRenoAppAdminActionTypeQuestion({
      actionTypeId: typeof body.actionTypeId === 'string' ? body.actionTypeId : '',
      questionId: typeof body.questionId === 'string' ? body.questionId : '',
      isEnabled: typeof body.isEnabled === 'boolean' ? body.isEnabled : false,
      isRequired: typeof body.isRequired === 'boolean' ? body.isRequired : true,
      sortOrder: typeof body.sortOrder === 'number' ? body.sortOrder : Number(body.sortOrder ?? 100),
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okant fel.'
    if (message === 'UNAUTHORIZED') return jsonError('Inte inloggad.', 401)
    if (message === 'ADMIN_REQUIRED') return jsonError('Endast admin har atkomst.', 403)
    if (message === 'ACTION_TYPE_QUESTION_TARGET_REQUIRED') {
      return jsonError('Ange renoveringstyp och fraga.', 400)
    }
    return jsonError(message || 'Kunde inte spara fragekoppling.', 500)
  }
}
