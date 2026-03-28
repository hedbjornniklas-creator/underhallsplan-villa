import { NextResponse } from 'next/server'
import { revokeRenoAppUserInvite } from '@/lib/renoapp/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

type RouteContext = {
  params: Promise<{
    inviteId: string
  }>
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { inviteId } = await context.params
    const result = await revokeRenoAppUserInvite(inviteId)
    return NextResponse.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okänt fel.'
    if (message === 'UNAUTHORIZED') return jsonError('Inte inloggad.', 401)
    if (message === 'RENOAPP_MEMBERSHIP_REQUIRED') return jsonError('Ingen RenoApp-koppling hittades.', 403)
    if (message === 'PROFILE_NOT_FOUND') return jsonError('Ingen profil hittades för användaren.', 403)
    if (message === 'INVITE_NOT_FOUND') return jsonError('Inviten hittades inte.', 404)
    if (message === 'INVITE_ALREADY_ACCEPTED') return jsonError('Inviten har redan accepterats.', 409)
    if (message === 'INVITE_ALREADY_REVOKED') return jsonError('Inviten är redan återkallad.', 409)
    return jsonError(message || 'Kunde inte återkalla invite.', 500)
  }
}
