import { NextResponse } from 'next/server'
import { removeRenoAppUserMember, updateRenoAppUserMemberEmailPreferences } from '@/lib/renoapp/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

export async function DELETE(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>

    const result = await removeRenoAppUserMember({
      brfId: typeof body.brfId === 'string' ? body.brfId : '',
      profileId: typeof body.profileId === 'string' ? body.profileId : '',
    })

    return NextResponse.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okänt fel.'
    if (message === 'UNAUTHORIZED') return jsonError('Inte inloggad.', 401)
    if (message === 'RENOAPP_MEMBERSHIP_REQUIRED') return jsonError('Ingen RenoApp-koppling hittades.', 403)
    if (message === 'PROFILE_NOT_FOUND') return jsonError('Ingen profil hittades för användaren.', 403)
    if (message === 'BRF_NOT_FOUND') return jsonError('BRF hittades inte.', 404)
    if (message === 'MEMBER_NOT_FOUND') return jsonError('Användaren hittades inte.', 404)
    if (message === 'CANNOT_REMOVE_SELF') {
      return jsonError('Du kan inte ta bort dig själv från BRF:n här.', 409)
    }
    if (message === 'CANNOT_REMOVE_LAST_MEMBER') {
      return jsonError('Du kan inte ta bort den sista aktiva användaren i BRF:n.', 409)
    }
    return jsonError(message || 'Kunde inte ta bort användaren.', 500)
  }
}

export async function PATCH(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>

    const result = await updateRenoAppUserMemberEmailPreferences({
      brfId: typeof body.brfId === 'string' ? body.brfId : '',
      profileId: typeof body.profileId === 'string' ? body.profileId : '',
      receivesGeneralInfoEmails: body.receivesGeneralInfoEmails === true,
      receivesCaseEventEmails: body.receivesCaseEventEmails === true,
    })

    return NextResponse.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okänt fel.'
    if (message === 'UNAUTHORIZED') return jsonError('Inte inloggad.', 401)
    if (message === 'RENOAPP_MEMBERSHIP_REQUIRED') return jsonError('Ingen RenoApp-koppling hittades.', 403)
    if (message === 'PROFILE_NOT_FOUND') return jsonError('Ingen profil hittades för användaren.', 403)
    if (message === 'BRF_NOT_FOUND') return jsonError('BRF hittades inte.', 404)
    if (message === 'MEMBER_NOT_FOUND') return jsonError('Användaren hittades inte.', 404)
    if (message === 'EMAIL_PREFERENCES_MIGRATION_REQUIRED') {
      return jsonError('E-postinställningarna kan inte sparas ännu. Kör RenoApp-migreringen för medlemsmejl först.', 409)
    }
    return jsonError(message || 'Kunde inte spara e-postinställningar.', 500)
  }
}
