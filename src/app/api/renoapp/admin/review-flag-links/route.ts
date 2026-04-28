import { NextResponse } from 'next/server'
import {
  listRenoAppAdminReviewFlagLinks,
  saveRenoAppAdminReviewFlagLink,
} from '@/lib/renoapp/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

export async function GET() {
  try {
    const items = await listRenoAppAdminReviewFlagLinks()
    return NextResponse.json({ items })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okänt fel.'
    if (message === 'UNAUTHORIZED') return jsonError('Inte inloggad.', 401)
    if (message === 'ADMIN_REQUIRED') return jsonError('Endast admin har åtkomst.', 403)
    return jsonError(message || 'Kunde inte läsa flaggkopplingar.', 500)
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>

    await saveRenoAppAdminReviewFlagLink({
      reviewFlagId: typeof body.reviewFlagId === 'string' ? body.reviewFlagId : '',
      actionTypeId: typeof body.actionTypeId === 'string' ? body.actionTypeId : null,
      documentTypeId: typeof body.documentTypeId === 'string' ? body.documentTypeId : null,
      participantRoleId: typeof body.participantRoleId === 'string' ? body.participantRoleId : null,
      isEnabled: typeof body.isEnabled === 'boolean' ? body.isEnabled : true,
      sortOrder: typeof body.sortOrder === 'number' ? body.sortOrder : Number(body.sortOrder ?? 100),
    })

    return NextResponse.json({ ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okänt fel.'
    if (message === 'UNAUTHORIZED') return jsonError('Inte inloggad.', 401)
    if (message === 'ADMIN_REQUIRED') return jsonError('Endast admin har åtkomst.', 403)
    if (message === 'REVIEW_FLAG_LINK_TARGET_REQUIRED') {
      return jsonError('Välj exakt en flagga och ett objekt att koppla den till.', 400)
    }
    return jsonError(message || 'Kunde inte spara flaggkoppling.', 500)
  }
}
