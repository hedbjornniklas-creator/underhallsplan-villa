import { NextResponse } from 'next/server'
import { createBrfWithInvite } from '@/lib/renoapp/onboarding'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const origin = new URL(request.url).origin
    const result = await createBrfWithInvite(
      {
        name: String(body.name ?? ''),
        orgNumber: typeof body.orgNumber === 'string' ? body.orgNumber : null,
        address: typeof body.address === 'string' ? body.address : null,
        boardEmail: String(body.boardEmail ?? ''),
        boardFullName: typeof body.boardFullName === 'string' ? body.boardFullName : null,
        role: body.role === 'admin' ? 'admin' : 'board',
      },
      origin
    )

    return NextResponse.json(result, { status: 201 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okänt fel.'
    if (message === 'UNAUTHORIZED') return jsonError('Inte inloggad.', 401)
    if (message === 'PROFILE_NOT_FOUND') return jsonError('Ingen profil hittades för användaren.', 403)
    if (message === 'ADMIN_REQUIRED') return jsonError('Adminbehörighet krävs.', 403)
    if (message === 'BRF_NAME_REQUIRED') return jsonError('Ange BRF-namn.', 400)
    if (message === 'BOARD_EMAIL_INVALID') return jsonError('Ange giltig styrelsemejl.', 400)
    return jsonError(message || 'Kunde inte skapa BRF.', 500)
  }
}
