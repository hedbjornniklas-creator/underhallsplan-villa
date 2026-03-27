import { NextResponse } from 'next/server'
import { getCaseAccessByToken } from '@/lib/renoapp/server'

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
    const payload = await getCaseAccessByToken(token)

    if (!payload) {
      return jsonError('Länken hittades inte.', 404)
    }

    return NextResponse.json(payload)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okänt fel.'
    return jsonError(message || 'Kunde inte läsa åtkomstlänk.', 500)
  }
}
