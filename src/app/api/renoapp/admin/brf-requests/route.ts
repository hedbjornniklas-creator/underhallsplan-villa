import { NextResponse } from 'next/server'
import { listBrfRequests } from '@/lib/renoapp/onboarding'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

export async function GET() {
  try {
    const items = await listBrfRequests()
    return NextResponse.json({ items })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okänt fel.'
    if (message === 'UNAUTHORIZED') return jsonError('Inte inloggad.', 401)
    if (message === 'PROFILE_NOT_FOUND') return jsonError('Ingen profil hittades för användaren.', 403)
    if (message === 'ADMIN_REQUIRED') return jsonError('Adminbehörighet krävs.', 403)
    return jsonError(message || 'Kunde inte läsa BRF-intresseanmälningar.', 500)
  }
}
