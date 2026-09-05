'use client'

import Link from 'next/link'
import { Download, LoaderCircle, TriangleAlert } from 'lucide-react'
import { useEffect, useState } from 'react'

export type PublicReportPdfStatus = 'pending' | 'processing' | 'ready' | 'failed'

type PublicReportPdfDownloadProps = {
  downloadUrl: string | null
  initialStatus?: PublicReportPdfStatus | null
  statusEndpoint?: string | null
  tone?: 'emerald' | 'violet' | 'indigo'
}

const MAX_POLL_DURATION_MS = 15 * 60 * 1000
const MAX_CONSECUTIVE_ERRORS = 5
const POLL_DELAYS_MS = [2_000, 3_000, 5_000, 8_000, 13_000, 20_000, 30_000] as const

const linkClasses = {
  emerald:
    'border-emerald-200 text-emerald-800 hover:bg-emerald-50 focus-visible:outline-emerald-600',
  violet:
    'border-violet-200 text-violet-800 hover:bg-violet-50 focus-visible:outline-violet-600',
  indigo:
    'border-indigo-200 text-indigo-800 hover:bg-indigo-50 focus-visible:outline-indigo-600',
} as const

function isPdfStatus(value: unknown): value is PublicReportPdfStatus {
  return value === 'pending' || value === 'processing' || value === 'ready' || value === 'failed'
}

function shouldPoll(status: PublicReportPdfStatus | null) {
  return status === 'pending' || status === 'processing'
}

export default function PublicReportPdfDownload({
  downloadUrl,
  initialStatus = null,
  statusEndpoint = null,
  tone = 'indigo',
}: PublicReportPdfDownloadProps) {
  const resolvedInitialStatus = initialStatus ?? (downloadUrl ? 'ready' : null)
  const [status, setStatus] = useState<PublicReportPdfStatus | null>(resolvedInitialStatus)
  const [pollingStopped, setPollingStopped] = useState(false)

  useEffect(() => {
    let currentStatus = resolvedInitialStatus
    setStatus(currentStatus)
    setPollingStopped(false)

    if (!statusEndpoint || !shouldPoll(currentStatus)) return

    let cancelled = false
    let stopped = false
    let timeoutId: ReturnType<typeof setTimeout> | null = null
    let activeRequest: AbortController | null = null
    let pollIndex = 0
    let consecutiveErrors = 0
    const startedAt = Date.now()

    const stopPolling = () => {
      if (cancelled || stopped) return
      stopped = true
      if (timeoutId) clearTimeout(timeoutId)
      setPollingStopped(true)
    }

    const schedule = (delayMs: number) => {
      if (cancelled || stopped || !shouldPoll(currentStatus)) return
      if (Date.now() - startedAt >= MAX_POLL_DURATION_MS) {
        stopPolling()
        return
      }
      if (timeoutId) clearTimeout(timeoutId)
      timeoutId = setTimeout(poll, delayMs)
    }

    const poll = async () => {
      if (cancelled || stopped || !shouldPoll(currentStatus)) return
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        schedule(10_000)
        return
      }

      try {
        const controller = new AbortController()
        activeRequest = controller
        const response = await fetch(statusEndpoint, {
          cache: 'no-store',
          headers: { Accept: 'application/json' },
          signal: controller.signal,
        })
        if (!response.ok) throw new Error(`Status request failed: ${response.status}`)

        const payload = (await response.json()) as { status?: unknown }
        if (!isPdfStatus(payload.status)) throw new Error('Invalid PDF status response')
        if (cancelled || stopped) return

        consecutiveErrors = 0
        currentStatus = payload.status
        setStatus(currentStatus)

        if (shouldPoll(currentStatus)) {
          const delay = POLL_DELAYS_MS[Math.min(pollIndex, POLL_DELAYS_MS.length - 1)]
          pollIndex += 1
          schedule(delay)
        }
      } catch (error) {
        if (cancelled || (error instanceof DOMException && error.name === 'AbortError')) return
        consecutiveErrors += 1
        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
          stopPolling()
          return
        }
        const delay = POLL_DELAYS_MS[Math.min(pollIndex, POLL_DELAYS_MS.length - 1)]
        pollIndex += 1
        schedule(delay)
      } finally {
        activeRequest = null
      }
    }

    const handleVisibilityChange = () => {
      if (stopped || document.visibilityState !== 'visible' || !shouldPoll(currentStatus)) return
      schedule(0)
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    schedule(POLL_DELAYS_MS[0])

    return () => {
      cancelled = true
      if (timeoutId) clearTimeout(timeoutId)
      activeRequest?.abort()
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [resolvedInitialStatus, statusEndpoint])

  if (status === 'ready' && downloadUrl) {
    return (
      <span
        className="inline-flex"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        <Link
          href={downloadUrl}
          target="_blank"
          rel="noreferrer"
          prefetch={false}
          className={`inline-flex h-10 items-center gap-2 rounded-lg border bg-white px-3 text-sm font-semibold shadow-sm transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${linkClasses[tone]}`}
        >
          <Download size={16} aria-hidden />
          Ladda ner PDF
        </Link>
      </span>
    )
  }

  if (status === 'failed') {
    return (
      <span
        className="inline-flex max-w-72 items-center gap-2 text-right text-xs leading-5 text-rose-700"
        role="alert"
      >
        <TriangleAlert size={15} className="shrink-0" aria-hidden />
        PDF-filen kunde inte skapas. Kontakta avsändaren om problemet kvarstår.
      </span>
    )
  }

  if (shouldPoll(status)) {
    return (
      <span
        className="inline-flex max-w-72 items-center gap-2 text-right text-xs leading-5 text-slate-600"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {!pollingStopped ? (
          <LoaderCircle size={15} className="shrink-0 animate-spin motion-reduce:animate-none" aria-hidden />
        ) : null}
        {pollingStopped
          ? 'PDF-filen förbereds fortfarande. Ladda om sidan senare.'
          : 'PDF-filen förbereds och blir snart tillgänglig.'}
      </span>
    )
  }

  return null
}
