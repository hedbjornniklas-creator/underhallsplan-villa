import { NextResponse } from 'next/server'
import { getBoardConsultantReview, orderConsultantReview } from '@/lib/renoapp/consultantReviewServer'
import { CONSULTANT_REVIEW_ERRORS } from '@/lib/renoapp/consultantReview'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
type Context = { params: Promise<{ id: string }> }
const headers = { 'Cache-Control': 'private, no-store' }
function failure(error: unknown) {
  const known = CONSULTANT_REVIEW_ERRORS[error instanceof Error ? error.message : '']
  return NextResponse.json({ error: known?.message ?? 'Kunde inte läsa eller skicka beställningen. Försök igen.' }, { status: known?.status ?? 500, headers })
}
export async function GET(_request: Request, context: Context) {
  try { return NextResponse.json({ order: await getBoardConsultantReview((await context.params).id) }, { headers }) }
  catch (error) { return failure(error) }
}
export async function POST(request: Request, context: Context) {
  // Paid actions must originate from the portal, not a cross-site form submission.
  if (request.headers.get('origin') && request.headers.get('origin') !== new URL(request.url).origin) {
    return NextResponse.json({ error: 'Otillåten begäran.' }, { status: 403, headers })
  }
  try {
    const body: unknown = await request.json()
    if (!body || typeof body !== 'object' || Array.isArray(body)) return NextResponse.json({ error: 'Ogiltig beställning.' }, { status: 400, headers })
    return NextResponse.json({ order: await orderConsultantReview((await context.params).id, body) }, { headers })
  } catch (error) { return failure(error) }
}
