import { NextResponse } from 'next/server'
import {
  deleteRenoAppAdminReviewFlag,
  listRenoAppAdminReviewFlags,
  saveRenoAppAdminReviewFlag,
} from '@/lib/renoapp/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

export async function GET() {
  try {
    const items = await listRenoAppAdminReviewFlags()
    return NextResponse.json({ items })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okant fel.'
    if (message === 'UNAUTHORIZED') return jsonError('Inte inloggad.', 401)
    if (message === 'ADMIN_REQUIRED') return jsonError('Endast admin har atkomst.', 403)
    if (message === 'PROFILE_NOT_FOUND') return jsonError('Ingen profil hittades for anvandaren.', 403)
    return jsonError(message || 'Kunde inte lasa granskningsflaggor.', 500)
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>

    const item = await saveRenoAppAdminReviewFlag({
      id: typeof body.id === 'string' ? body.id : null,
      key: typeof body.key === 'string' ? body.key : '',
      label: typeof body.label === 'string' ? body.label : '',
      description: typeof body.description === 'string' ? body.description : null,
      severity:
        body.severity === 'info' || body.severity === 'high' || body.severity === 'warning'
          ? body.severity
          : 'warning',
      category: typeof body.category === 'string' ? body.category : null,
      sortOrder: typeof body.sortOrder === 'number' ? body.sortOrder : Number(body.sortOrder ?? 100),
      isActive: typeof body.isActive === 'boolean' ? body.isActive : true,
    })

    return NextResponse.json({ item })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okant fel.'
    if (message === 'UNAUTHORIZED') return jsonError('Inte inloggad.', 401)
    if (message === 'ADMIN_REQUIRED') return jsonError('Endast admin har atkomst.', 403)
    if (message === 'REVIEW_FLAG_KEY_REQUIRED') return jsonError('Ange intern nyckel.', 400)
    if (message === 'REVIEW_FLAG_LABEL_REQUIRED') return jsonError('Ange visningsnamn.', 400)
    return jsonError(message || 'Kunde inte spara granskningsflagga.', 500)
  }
}

export async function DELETE(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const id = typeof body.id === 'string' ? body.id : ''

    if (!id) {
      return jsonError('Ange vilken granskningsflagga som ska raderas.', 400)
    }

    await deleteRenoAppAdminReviewFlag(id)
    return NextResponse.json({ ok: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okant fel.'
    if (message === 'UNAUTHORIZED') return jsonError('Inte inloggad.', 401)
    if (message === 'ADMIN_REQUIRED') return jsonError('Endast admin har atkomst.', 403)
    return jsonError(message || 'Kunde inte radera granskningsflagga.', 500)
  }
}
