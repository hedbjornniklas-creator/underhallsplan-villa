import { NextResponse } from 'next/server'
import {
  deleteRenoAppAdminParticipantRole,
  listRenoAppAdminParticipantRoles,
  saveRenoAppAdminParticipantRole,
} from '@/lib/renoapp/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

export async function GET() {
  try {
    const items = await listRenoAppAdminParticipantRoles()
    return NextResponse.json({ items })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okant fel.'
    if (message === 'UNAUTHORIZED') return jsonError('Inte inloggad.', 401)
    if (message === 'ADMIN_REQUIRED') return jsonError('Endast admin har atkomst.', 403)
    if (message === 'PROFILE_NOT_FOUND') return jsonError('Ingen profil hittades for anvandaren.', 403)
    return jsonError(message || 'Kunde inte lasa medverkandetyper.', 500)
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>

    const item = await saveRenoAppAdminParticipantRole({
      id: typeof body.id === 'string' ? body.id : null,
      key: typeof body.key === 'string' ? body.key : '',
      label: typeof body.label === 'string' ? body.label : '',
      description: typeof body.description === 'string' ? body.description : null,
      reviewGuidance: typeof body.reviewGuidance === 'string' ? body.reviewGuidance : null,
      roleKind: body.roleKind === 'consultant' ? 'consultant' : 'contractor',
      verificationInstructions:
        typeof body.verificationInstructions === 'string' ? body.verificationInstructions : null,
      verificationUrl: typeof body.verificationUrl === 'string' ? body.verificationUrl : null,
      insuranceRequired:
        typeof body.insuranceRequired === 'boolean' ? body.insuranceRequired : false,
      requiresCompanyName:
        typeof body.requiresCompanyName === 'boolean' ? body.requiresCompanyName : true,
      requiresOrgNumber: typeof body.requiresOrgNumber === 'boolean' ? body.requiresOrgNumber : true,
      requiresContactName:
        typeof body.requiresContactName === 'boolean' ? body.requiresContactName : true,
      requiresEmail: typeof body.requiresEmail === 'boolean' ? body.requiresEmail : true,
      requiresPhone: typeof body.requiresPhone === 'boolean' ? body.requiresPhone : true,
      requiresCertification:
        typeof body.requiresCertification === 'boolean' ? body.requiresCertification : false,
      sortOrder: typeof body.sortOrder === 'number' ? body.sortOrder : Number(body.sortOrder ?? 100),
      isActive: typeof body.isActive === 'boolean' ? body.isActive : true,
    })

    return NextResponse.json({ item })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okant fel.'
    if (message === 'UNAUTHORIZED') return jsonError('Inte inloggad.', 401)
    if (message === 'ADMIN_REQUIRED') return jsonError('Endast admin har atkomst.', 403)
    if (message === 'PARTICIPANT_ROLE_KEY_REQUIRED') return jsonError('Ange intern nyckel.', 400)
    if (message === 'PARTICIPANT_ROLE_LABEL_REQUIRED') return jsonError('Ange visningsnamn.', 400)
    return jsonError(message || 'Kunde inte spara medverkandetyp.', 500)
  }
}

export async function DELETE(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const id = typeof body.id === 'string' ? body.id : ''

    if (!id) {
      return jsonError('Ange vilken medverkandetyp som ska raderas.', 400)
    }

    await deleteRenoAppAdminParticipantRole(id)
    return NextResponse.json({ ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okant fel.'
    if (message === 'UNAUTHORIZED') return jsonError('Inte inloggad.', 401)
    if (message === 'ADMIN_REQUIRED') return jsonError('Endast admin har atkomst.', 403)
    return jsonError(message || 'Kunde inte radera medverkandetyp.', 500)
  }
}
