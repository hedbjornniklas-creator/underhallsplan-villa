import { NextResponse } from 'next/server'
import {
  deleteRenoAppAdminActionType,
  listRenoAppAdminActionTypes,
  saveRenoAppAdminActionType,
} from '@/lib/renoapp/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

export async function GET() {
  try {
    const items = await listRenoAppAdminActionTypes()
    return NextResponse.json({ items })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okänt fel.'
    if (message === 'UNAUTHORIZED') return jsonError('Inte inloggad.', 401)
    if (message === 'ADMIN_REQUIRED') return jsonError('Endast admin har åtkomst.', 403)
    if (message === 'PROFILE_NOT_FOUND') return jsonError('Ingen profil hittades för användaren.', 403)
    return jsonError(message || 'Kunde inte läsa renoveringstyper.', 500)
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const item = await saveRenoAppAdminActionType({
      id: typeof body.id === 'string' ? body.id : null,
      key: typeof body.key === 'string' ? body.key : '',
      label: typeof body.label === 'string' ? body.label : '',
      description: typeof body.description === 'string' ? body.description : null,
      sortOrder: typeof body.sortOrder === 'number' ? body.sortOrder : Number(body.sortOrder ?? 100),
      isActive: typeof body.isActive === 'boolean' ? body.isActive : true,
    })
    return NextResponse.json({ item })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okänt fel.'
    if (message === 'UNAUTHORIZED') return jsonError('Inte inloggad.', 401)
    if (message === 'ADMIN_REQUIRED') return jsonError('Endast admin har åtkomst.', 403)
    if (message === 'ACTION_TYPE_KEY_REQUIRED') return jsonError('Ange intern nyckel.', 400)
    if (message === 'ACTION_TYPE_LABEL_REQUIRED') return jsonError('Ange visningsnamn.', 400)
    return jsonError(message || 'Kunde inte spara renoveringstyp.', 500)
  }
}

export async function DELETE(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const id = typeof body.id === 'string' ? body.id : ''

    if (!id) {
      return jsonError('Ange vilken renoveringstyp som ska raderas.', 400)
    }

    await deleteRenoAppAdminActionType(id)
    return NextResponse.json({ ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'OkÃ¤nt fel.'
    if (message === 'UNAUTHORIZED') return jsonError('Inte inloggad.', 401)
    if (message === 'ADMIN_REQUIRED') return jsonError('Endast admin har Ã¥tkomst.', 403)
    return jsonError(message || 'Kunde inte radera renoveringstyp.', 500)
  }
}
