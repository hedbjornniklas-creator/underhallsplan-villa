import { NextResponse } from 'next/server'
import { saveRenoAppCaseRequirementDecision } from '@/lib/renoapp/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

type RouteContext = {
  params: Promise<{
    id: string
  }>
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const item = await saveRenoAppCaseRequirementDecision(id, {
      targetType: body.targetType === 'participant' ? 'participant' : 'document',
      targetId: typeof body.targetId === 'string' ? body.targetId : '',
      decision: body.decision === 'not_requested' ? 'not_requested' : 'requested',
      note: typeof body.note === 'string' ? body.note : null,
    })

    return NextResponse.json({ item })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okänt fel.'
    if (message === 'UNAUTHORIZED') return jsonError('Inte inloggad.', 401)
    if (message === 'RENOAPP_MEMBERSHIP_REQUIRED') return jsonError('Ingen RenoApp-koppling hittades.', 403)
    if (message === 'PROFILE_NOT_FOUND') return jsonError('Ingen profil hittades för användaren.', 403)
    if (message === 'CASE_NOT_FOUND') return jsonError('RenoApp-ärendet hittades inte.', 404)
    if (message === 'INVALID_REQUIREMENT_DECISION_TARGET') return jsonError('Ogiltigt kompletteringsval.', 400)
    if (message === 'INVALID_REQUIREMENT_DECISION') return jsonError('Ogiltigt beslut för kompletteringsval.', 400)
    return jsonError(message || 'Kunde inte spara kompletteringsval.', 500)
  }
}
