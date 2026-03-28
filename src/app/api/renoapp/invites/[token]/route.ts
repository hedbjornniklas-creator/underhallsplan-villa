import { NextResponse } from 'next/server'
import { getBrfInviteByToken } from '@/lib/renoapp/onboarding'

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
    const item = await getBrfInviteByToken(token)

    if (!item) {
      return jsonError('Inviten hittades inte.', 404)
    }

    return NextResponse.json(item)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okänt fel.'
    return jsonError(message || 'Kunde inte läsa invite.', 500)
  }
}
