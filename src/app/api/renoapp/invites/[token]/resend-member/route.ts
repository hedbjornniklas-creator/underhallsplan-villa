import { NextResponse } from 'next/server'
import { brfApiError } from '@/lib/renoapp/brfApiError'
import { resendActivationMemberInvite } from '@/lib/renoapp/onboarding'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type RouteContext = {
  params: Promise<{
    token: string
  }>
}

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const { token } = await context.params
    const result = await resendActivationMemberInvite(token, new URL(request.url).origin)
    return NextResponse.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okänt fel.'
    if (message === 'INVITE_NOT_FOUND') return jsonError('Aktiveringslänken hittades inte.', 404)
    if (message === 'ACTIVATION_NOT_COMPLETED') return jsonError('Föreningen måste aktiveras först.', 409)
    if (message === 'INVITE_KIND_MISMATCH') return jsonError('Länken kan inte användas för den här åtgärden.', 409)
    if (message === 'INVITE_ALREADY_ACCEPTED') return jsonError('Din personliga inbjudan har redan accepterats.', 409)
    if (message === 'INVITE_REVOKED') return jsonError('Inbjudan har återkallats. Kontakta HusHub för hjälp.', 409)
    if (message === 'INVITE_EXPIRED') return jsonError('Aktiveringslänken har gått ut. Kontakta HusHub för hjälp.', 409)
    if (message === 'MEMBER_INVITE_NOT_FOUND') {
      return jsonError('Aktiveringsadressen lades inte till som användare. En administratör kan skicka en ny inbjudan.', 409)
    }
    if (message === 'INVITE_RESEND_TOO_SOON') return jsonError('Vänta en minut innan du skickar inbjudan igen.', 429)
    if (message === 'INVITE_RESEND_LIMIT') {
      return jsonError('Inbjudan har redan skickats om två gånger. Kontakta HusHub om den fortfarande saknas.', 429)
    }
    return brfApiError(error)
  }
}
