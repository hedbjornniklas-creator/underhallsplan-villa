import { NextResponse } from 'next/server'
import { getRenoAppCaseDetail, updateRenoAppCaseStatus } from '@/lib/renoapp/server'

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

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params
    const item = await getRenoAppCaseDetail(id)

    if (!item) {
      return jsonError('RenoApp-ärendet hittades inte.', 404)
    }

    return NextResponse.json({ item })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okänt fel.'
    if (message === 'UNAUTHORIZED') return jsonError('Inte inloggad.', 401)
    if (message === 'RENOAPP_MEMBERSHIP_REQUIRED') return jsonError('Ingen RenoApp-koppling hittades.', 403)
    if (message === 'PROFILE_NOT_FOUND') return jsonError('Ingen profil hittades för användaren.', 403)
    if (message === 'CASE_NOT_FOUND') return jsonError('RenoApp-ärendet hittades inte.', 404)
    return jsonError(message || 'Kunde inte läsa RenoApp-ärendet.', 500)
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params
    const body = (await request.json().catch(() => ({}))) as {
      status?: 'review' | 'need_info' | 'approved' | 'conditional' | 'rejected'
      reason?: string | null
      conditions?: string | null
    }

    if (!body.status) {
      return jsonError('Status saknas.', 400)
    }

    const item = await updateRenoAppCaseStatus(id, {
      status: body.status,
      reason: body.reason ?? null,
      conditions: body.conditions ?? null,
    })

    return NextResponse.json({ item })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okänt fel.'
    if (message === 'UNAUTHORIZED') return jsonError('Inte inloggad.', 401)
    if (message === 'RENOAPP_MEMBERSHIP_REQUIRED') return jsonError('Ingen RenoApp-koppling hittades.', 403)
    if (message === 'PROFILE_NOT_FOUND') return jsonError('Ingen profil hittades för användaren.', 403)
    if (message === 'CASE_NOT_FOUND') return jsonError('RenoApp-ärendet hittades inte.', 404)
    if (message === 'INVALID_CASE_STATUS') return jsonError('Ogiltig status för RenoApp-ärendet.', 400)
    if (message === 'DECISION_REASON_REQUIRED') return jsonError('Motivering krävs för avslag.', 400)
    if (message === 'DECISION_CONDITIONS_REQUIRED') return jsonError('Villkor krävs för villkorat beslut.', 400)
    return jsonError(message || 'Kunde inte uppdatera RenoApp-ärendet.', 500)
  }
}
