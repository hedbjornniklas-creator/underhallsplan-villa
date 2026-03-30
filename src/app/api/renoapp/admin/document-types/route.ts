import { NextResponse } from 'next/server'
import { listRenoAppAdminDocumentTypes, saveRenoAppAdminDocumentType } from '@/lib/renoapp/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

export async function GET() {
  try {
    const items = await listRenoAppAdminDocumentTypes()
    return NextResponse.json({ items })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okänt fel.'
    if (message === 'UNAUTHORIZED') return jsonError('Inte inloggad.', 401)
    if (message === 'ADMIN_REQUIRED') return jsonError('Endast admin har åtkomst.', 403)
    if (message === 'PROFILE_NOT_FOUND') return jsonError('Ingen profil hittades för användaren.', 403)
    return jsonError(message || 'Kunde inte läsa dokumenttyper.', 500)
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const item = await saveRenoAppAdminDocumentType({
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
    if (message === 'DOCUMENT_TYPE_KEY_REQUIRED') return jsonError('Ange intern nyckel.', 400)
    if (message === 'DOCUMENT_TYPE_LABEL_REQUIRED') return jsonError('Ange visningsnamn.', 400)
    return jsonError(message || 'Kunde inte spara dokumenttyp.', 500)
  }
}
