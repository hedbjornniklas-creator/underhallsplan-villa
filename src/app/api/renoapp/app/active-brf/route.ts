import { cookies } from 'next/headers'
import { NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { brfId?: unknown }
    const brfId = typeof body.brfId === 'string' ? body.brfId.trim() : ''

    if (!brfId) {
      return jsonError('BRF saknas.', 400)
    }

    const cookieStore = await cookies()
    cookieStore.set('renoapp_active_brf_id', brfId, {
      path: '/',
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 365,
    })

    return NextResponse.json({ ok: true, brfId })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okänt fel.'
    return jsonError(message || 'Kunde inte spara vald BRF.', 500)
  }
}
