import { NextResponse } from 'next/server'
import { sendMissingActionTypeFeedback } from '@/lib/renoapp/actionTypeFeedback'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_MESSAGE_LENGTH = 1000
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000
const RATE_LIMIT_MAX_REQUESTS = 3
const rateLimitByClient = new Map<string, { count: number; resetAt: number }>()

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

function getClientKey(request: Request) {
  const forwardedFor = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  return forwardedFor || request.headers.get('x-real-ip')?.trim() || 'unknown'
}

function isRateLimited(clientKey: string) {
  const now = Date.now()
  const current = rateLimitByClient.get(clientKey)
  if (!current || current.resetAt <= now) {
    rateLimitByClient.set(clientKey, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS })
    return false
  }

  if (current.count >= RATE_LIMIT_MAX_REQUESTS) return true
  current.count += 1
  return false
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const website = typeof body.website === 'string' ? body.website.trim() : ''
    if (website) {
      return NextResponse.json({ ok: true }, { status: 201 })
    }

    const message = typeof body.message === 'string' ? body.message.trim() : ''
    const brfSlug = typeof body.brfSlug === 'string' ? body.brfSlug.trim() : ''
    if (message.length < 5) return jsonError('Beskriv vilken renoveringstyp du saknar.', 400)
    if (message.length > MAX_MESSAGE_LENGTH) {
      return jsonError(`Beskrivningen får vara högst ${MAX_MESSAGE_LENGTH} tecken.`, 400)
    }
    if (!brfSlug) return jsonError('BRF saknas.', 400)
    if (isRateLimited(getClientKey(request))) {
      return jsonError('För många förslag har skickats. Försök igen senare.', 429)
    }

    await sendMissingActionTypeFeedback({
      brfSlug,
      message,
      reporterName: typeof body.reporterName === 'string' ? body.reporterName.slice(0, 200) : null,
      reporterEmail: typeof body.reporterEmail === 'string' ? body.reporterEmail.slice(0, 320) : null,
      origin: new URL(request.url).origin,
    })

    return NextResponse.json({ ok: true }, { status: 201 })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'ACTION_TYPE_FEEDBACK_FAILED'
    if (message === 'ACTION_TYPE_FEEDBACK_BRF_NOT_FOUND') {
      return jsonError('BRF hittades inte eller saknar publik ansökan.', 404)
    }
    if (message === 'ACTION_TYPE_FEEDBACK_RECIPIENT_MISSING') {
      return jsonError('Ingen systemadministratör med e-postadress hittades.', 503)
    }
    if (message === 'ACTION_TYPE_FEEDBACK_EMAIL_NOT_CONFIGURED') {
      return jsonError('Mejlutskick är inte konfigurerat.', 503)
    }

    console.error('[renoapp.action-type-feedback] failed', { error })
    return jsonError('Förslaget kunde inte skickas just nu. Försök igen senare.', 500)
  }
}
