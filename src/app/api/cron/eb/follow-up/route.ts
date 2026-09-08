import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { processEbFollowUpEmails } from '@/lib/eb/followUpDelivery'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET?.trim()
  const authorization = request.headers.get('authorization') ?? ''
  const supplied = Buffer.from(authorization)
  const expected = Buffer.from(`Bearer ${secret ?? ''}`)
  const headers = { 'Cache-Control': 'no-store' }
  // Unlike an interactive preview, this endpoint sends actual queued emails.
  // Never run it unauthenticated, including in development.
  if (!secret) return NextResponse.json({ error: 'CRON_UNAVAILABLE' }, { status: 503, headers })
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
    return NextResponse.json({ error: 'UNAUTHORIZED' }, { status: 401, headers })
  }
  try {
    const result = await processEbFollowUpEmails(3)
    return NextResponse.json({ ok: true, ...result, mayHaveMore: result.claimed === 3 }, { headers })
  } catch {
    // Never log recipient addresses, verification codes or private portal links.
    console.error('[eb.follow-up] email dispatcher unavailable')
    return NextResponse.json({ error: 'EB_FOLLOW_UP_DELIVERY_UNAVAILABLE' }, { status: 503, headers })
  }
}
