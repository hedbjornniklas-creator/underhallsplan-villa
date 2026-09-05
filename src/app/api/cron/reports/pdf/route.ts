import { timingSafeEqual } from 'node:crypto'

import { NextResponse } from 'next/server'

import { runInspectionReportPdfBatch } from '@/lib/report/pdfJobs'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer)
}
function cronAuthorization(request: Request) {
  const secret = process.env.CRON_SECRET?.trim()
  if (!secret) return process.env.NODE_ENV === 'production' ? 'misconfigured' : 'allowed'
  const authorization = request.headers.get('authorization') ?? ''
  return safeEqual(authorization, `Bearer ${secret}`) ? 'allowed' : 'denied'
}

function requestOrigin(request: Request) {
  const url = new URL(request.url)
  const forwardedProto = request.headers.get('x-forwarded-proto')
  const forwardedHost = request.headers.get('x-forwarded-host')
  const host = forwardedHost ?? request.headers.get('host') ?? url.host
  const protocol = forwardedProto ?? url.protocol.replace(':', '')
  return `${protocol}://${host}`
}

export async function GET(request: Request) {
  const authorization = cronAuthorization(request)
  if (authorization === 'denied') {
    return NextResponse.json({ ok: false, error: 'UNAUTHORIZED' }, { status: 401 })
  }
  if (authorization === 'misconfigured') {
    return NextResponse.json({ ok: false, error: 'CRON_UNAVAILABLE' }, { status: 503 })
  }

  try {
    // One render per invocation keeps the HTTP dispatcher comfortably within
    // its timeout. The minute-by-minute schedule drains additional work.
    const result = await runInspectionReportPdfBatch({
      origin: requestOrigin(request),
      limit: 1,
    })
    return NextResponse.json(
      {
        ok: true,
        claimed: result.claimed,
        ready: result.ready,
        retryScheduled: result.retryScheduled,
        failed: result.failed,
        claimLost: result.claimLost,
        mayHaveMore: result.claimed === 1,
      },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  } catch (error) {
    console.error('[report.pdf-jobs] cron batch failed', {
      error: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json(
      { ok: false, error: 'REPORT_PDF_QUEUE_UNAVAILABLE' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } }
    )
  }
}
