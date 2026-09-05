import { NextResponse } from 'next/server'
import { resendBrfRequestDecision, reviewBrfRequest } from '@/lib/renoapp/onboarding'
import { brfApiError } from '@/lib/renoapp/brfApiError'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

type RouteContext = {
  params: Promise<{
    id: string
  }>
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const origin = new URL(request.url).origin
    if (body.action === 'resend_decision') return NextResponse.json(await resendBrfRequestDecision(id, origin))
    if (body.action !== 'approve' && body.action !== 'reject') return jsonError('Välj godkänn eller avslå.', 400)
    const result = await reviewBrfRequest(
      id,
      {
        action: body.action,
        reviewNote: typeof body.reviewNote === 'string' ? body.reviewNote : null,
        externalMessage: typeof body.externalMessage === 'string' ? body.externalMessage : null,
      },
      origin
    )

    return NextResponse.json(result)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Okänt fel.'
    if (message === 'UNAUTHORIZED') return jsonError('Inte inloggad.', 401)
    if (message === 'PROFILE_NOT_FOUND') return jsonError('Ingen profil hittades för användaren.', 403)
    if (message === 'ADMIN_REQUIRED') return jsonError('Adminbehörighet krävs.', 403)
    if (message === 'BRF_REQUEST_NOT_FOUND') return jsonError('Intresseanmälan hittades inte.', 404)
    if (message === 'BRF_REQUEST_ALREADY_REVIEWED') return jsonError('Intresseanmälan är redan hanterad.', 409)
    return brfApiError(error)
  }
}
