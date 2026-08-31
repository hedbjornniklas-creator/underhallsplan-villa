import { timingSafeEqual } from 'node:crypto'

import { NextResponse } from 'next/server'

import {
  runTaskFollowupBatch,
  runTaskReminderDigestBatch,
} from '@/lib/tasks/automation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const CRON_JOB_START_BUDGET_MS = 10_000
const CRON_TASK_JOB_START_BUDGET_MS = 7_000
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
    const digestTotals = {
      claimed: 0,
      sent: 0,
      cancelled: 0,
      ambiguous: 0,
      failed: 0,
      deadLetter: 0,
    }
    let taskBatches = 0
    let digestBatches = 0
    let taskMayHaveMore = false
    let digestMayHaveMore = false

    // Claim exactly one job at a time and never start another after the short
    // start budget. Cheap evaluations can drain quickly, while a provider call
    // that uses its full timeout still has ample room inside maxDuration.
    while (
      taskBatches < CRON_MAX_JOBS_PER_INVOCATION
      && Date.now() - startedAt < CRON_TASK_JOB_START_BUDGET_MS
    ) {
      const result = await runTaskFollowupBatch({ limit: 1 })
      taskBatches += 1
      totals.claimed += result.claimed
      totals.completed += result.completed
      totals.stale += result.stale
      totals.failed += result.failed
      taskMayHaveMore = result.claimed === 1
      if (!taskMayHaveMore) break
    }

    // Drain cheap evaluations first so every task due for the same recipient
    // can join the same scheduled batch before it is claimed. Always make one
    // digest claim attempt, then apply the shared start budget to any further
    // batches so a large task queue cannot starve scheduled summaries.
    while (
      digestBatches < CRON_MAX_JOBS_PER_INVOCATION
      && (
        digestBatches === 0
        || Date.now() - startedAt < CRON_JOB_START_BUDGET_MS
      )
    ) {
      const digestResult = await runTaskReminderDigestBatch({ limit: 1 })
      digestBatches += 1
      digestTotals.claimed += digestResult.claimed
      digestTotals.sent += digestResult.sent
      digestTotals.cancelled += digestResult.cancelled
      digestTotals.ambiguous += digestResult.ambiguous
      digestTotals.failed += digestResult.failed
      digestTotals.deadLetter += digestResult.deadLetter
      digestMayHaveMore = digestResult.claimed === 1
      if (!digestMayHaveMore) break
    }

    return NextResponse.json({
      ok: true,
      ...totals,
      digests: digestTotals,
      batches: taskBatches + digestBatches,
      taskBatches,
      digestBatches,
      mayHaveMore: taskMayHaveMore || digestMayHaveMore,
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
