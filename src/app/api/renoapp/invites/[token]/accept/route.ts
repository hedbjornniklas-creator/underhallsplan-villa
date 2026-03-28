import { NextResponse } from 'next/server'
import { acceptBrfInvite } from '@/lib/renoapp/onboarding'

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

export async function POST(request: Request, context: RouteContext) {
  try {
    const { token } = await context.params
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const result = await acceptBrfInvite(token, {
      fullName: typeof body.fullName === 'string' ? body.fullName : null,
      password: typeof body.password === 'string' ? body.password : null,
    })

    return NextResponse.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okänt fel.'
    if (message === 'INVITE_NOT_FOUND') return jsonError('Inviten hittades inte.', 404)
    if (message === 'INVITE_ALREADY_ACCEPTED') return jsonError('Inviten har redan accepterats.', 409)
    if (message === 'INVITE_REVOKED') return jsonError('Inviten har återkallats.', 409)
    if (message === 'INVITE_EXPIRED') return jsonError('Inviten har gått ut.', 409)
    if (message === 'FULL_NAME_REQUIRED') return jsonError('Ange fullständigt namn.', 400)
    if (message === 'PASSWORD_TOO_SHORT') return jsonError('Lösenordet måste vara minst 8 tecken.', 400)
    if (message === 'EXISTING_USER_LOGIN_REQUIRED') {
      return jsonError('E-postadressen har redan ett konto. Logga in först och öppna inviten igen.', 409)
    }
    if (message === 'INVITE_EMAIL_MISMATCH') {
      return jsonError('Du är inloggad med fel e-postadress för den här inviten.', 409)
    }
    return jsonError(message || 'Kunde inte acceptera invite.', 500)
  }
}
