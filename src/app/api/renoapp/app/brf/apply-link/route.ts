import { NextResponse } from 'next/server'
import { sendRenoAppPublicApplyLink } from '@/lib/renoapp/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const origin = new URL(request.url).origin

    const result = await sendRenoAppPublicApplyLink({
      brfId: typeof body.brfId === 'string' ? body.brfId : '',
      fullName: typeof body.fullName === 'string' ? body.fullName : '',
      email: typeof body.email === 'string' ? body.email : '',
      origin,
    })

    return NextResponse.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okänt fel.'
    if (message === 'UNAUTHORIZED') return jsonError('Inte inloggad.', 401)
    if (message === 'RENOAPP_MEMBERSHIP_REQUIRED') return jsonError('Ingen RenoApp-koppling hittades.', 403)
    if (message === 'PROFILE_NOT_FOUND') return jsonError('Ingen profil hittades för användaren.', 403)
    if (message === 'BRF_NOT_FOUND') return jsonError('BRF hittades inte.', 404)
    if (message === 'FULL_NAME_REQUIRED') return jsonError('Ange den boendes namn.', 400)
    if (message === 'EMAIL_INVALID') return jsonError('Ange giltig e-postadress.', 400)
    if (message === 'PUBLIC_APPLY_DISABLED') {
      return jsonError('Publik ansökan är inte aktiv för BRF:en.', 409)
    }
    return jsonError(message || 'Kunde inte skicka ansökningslänken.', 500)
  }
}
