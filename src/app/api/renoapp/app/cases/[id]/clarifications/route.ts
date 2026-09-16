import { NextResponse } from 'next/server'
import { reviewRenoAppClarification } from '@/lib/renoapp/server'
import { CLARIFICATION_ERRORS, type ClarificationAction } from '@/lib/renoapp/clarifications'

export const runtime = 'nodejs'
const actions = new Set<ClarificationAction>(['request', 'not_requested', 'resolve', 'not_relevant', 'reopen'])

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params
    const body = await request.json().catch(() => null)
    if (!body || typeof body.questionId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.questionId) ||
      !Number.isInteger(body.revision) || body.revision < 0 || !actions.has(body.action) ||
      (body.note !== undefined && (typeof body.note !== 'string' || body.note.length > 4000))) {
      return NextResponse.json({ error: 'Ogiltig bedömning.' }, { status: 400 })
    }
    const item = await reviewRenoAppClarification(id, { questionId: body.questionId,
      revision: body.revision, action: body.action, note: body.note ?? '' })
    return NextResponse.json({ item })
  } catch (error) {
    const code = error instanceof Error ? error.message : ''
    const status = code === 'UNAUTHORIZED' ? 401 : code === 'CASE_NOT_FOUND' ? 404 :
      ['RENOAPP_MEMBERSHIP_REQUIRED', 'PROFILE_NOT_FOUND'].includes(code) ? 403 : CLARIFICATION_ERRORS[code] ? 409 : 500
    return NextResponse.json({ error: CLARIFICATION_ERRORS[code] ?? (status === 404 ? 'Ärendet hittades inte.' :
      status === 401 || status === 403 ? 'Du saknar åtkomst till ärendet.' : 'Kunde inte spara bedömningen.') }, { status })
  }
}
