import { timingSafeEqual } from 'node:crypto'

import { NextResponse } from 'next/server'

import {
  runTaskFollowupBatch,
} from '@/lib/tasks/automation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const CRON_JOB_START_BUDGET_MS = 10_000
const CRON_MAX_JOBS_PER_INVOCATION = 100

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
    const startedAt = Date.now()
    const totals = {
      claimed: 0,
      completed: 0,
      stale: 0,
      failed: 0,
    }
    let batches = 0
    let mayHaveMore = false

    // Claim exactly one job at a time and never start another after the short
    // start budget. Cheap evaluations can drain quickly, while a provider call
    // that uses its full timeout still has ample room inside maxDuration.
    while (
      batches < CRON_MAX_JOBS_PER_INVOCATION
      && Date.now() - startedAt < CRON_JOB_START_BUDGET_MS
    ) {
      const result = await runTaskFollowupBatch({ limit: 1 })
      batches += 1
      totals.claimed += result.claimed
      totals.completed += result.completed
      totals.stale += result.stale
      totals.failed += result.failed
      mayHaveMore = result.claimed === 1
      if (!mayHaveMore) break
    }

    return NextResponse.json({
      ok: true,
      ...totals,
      batches,
      mayHaveMore,
      durationMs: Date.now() - startedAt,
    }, {
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
