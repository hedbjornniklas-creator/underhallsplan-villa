import { timingSafeEqual } from 'node:crypto'

import { NextResponse } from 'next/server'

import {
  getTaskAutomationBatchLimit,
  runTaskFollowupBatch,
} from '@/lib/tasks/automation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

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

export async function GET(request: Request) {
  const authorization = cronAuthorization(request)
  if (authorization === 'denied') {
    return NextResponse.json({ ok: false, error: 'UNAUTHORIZED' }, { status: 401 })
  }
  if (authorization === 'misconfigured') {
    return NextResponse.json({ ok: false, error: 'CRON_UNAVAILABLE' }, { status: 503 })
  }
  try {
    const result = await runTaskFollowupBatch({ limit: getTaskAutomationBatchLimit() })
    return NextResponse.json({ ok: true, ...result }, {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch {
    console.error('[tasks.automation] cron batch failed', {
      code: 'TASK_AUTOMATION_BATCH_FAILED',
    })
    return NextResponse.json(
      { ok: false, error: 'TASK_AUTOMATION_UNAVAILABLE' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } }
    )
  }
}
