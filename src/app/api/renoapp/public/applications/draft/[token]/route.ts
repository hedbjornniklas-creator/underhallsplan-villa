import { NextResponse } from 'next/server'
import { getPublicApplicationDraftByToken } from '@/lib/renoapp/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

type RouteContext = {
  params: Promise<{
    token: string
  }>
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { token } = await context.params
    const payload = await getPublicApplicationDraftByToken(token)

    if (!payload) {
      return jsonError('Ansökan hittades inte.', 404)
    }

    return NextResponse.json(payload)
  } catch {
    return jsonError('Din ansökan kunde inte laddas just nu. Försök igen om en stund.', 503)
  }
}
