'use client'

import { useEffect, useMemo, useState } from 'react'
import {
  formatTaskDateTime,
  normalizeTaskTimeZone,
} from '@/lib/tasks/dateTime'

type Props = {
  startedAt: string
  dueAt: string
  timeZone?: string | null
}

const DAY_MS = 24 * 60 * 60 * 1000
const HOUR_MS = 60 * 60 * 1000
const MINUTE_MS = 60 * 1000

function durationLabel(milliseconds: number, overdue: boolean) {
  const absolute = Math.abs(milliseconds)
  if (absolute < HOUR_MS) {
    const minutes = Math.max(1, Math.ceil(absolute / MINUTE_MS))
    return `${minutes} ${minutes === 1 ? 'minut' : 'minuter'} ${overdue ? 'försenad' : 'kvar'}`
  }
  if (absolute < DAY_MS) {
    const hours = Math.max(1, Math.ceil(absolute / HOUR_MS))
    return `${hours} ${hours === 1 ? 'timme' : 'timmar'} ${overdue ? 'försenad' : 'kvar'}`
  }
  const days = Math.max(1, Math.ceil(absolute / DAY_MS))
  return `${days} ${days === 1 ? 'dag' : 'dagar'} ${overdue ? 'försenad' : 'kvar'}`
}

function progressTone(percent: number, overdue: boolean) {
  if (overdue) {
    return {
      label: 'Försenad',
      fill: 'bg-red-700',
      marker: 'border-red-700',
      badge: 'border-red-300 bg-red-100 text-red-900',
    }
  }
  if (percent >= 90) {
    return {
      label: 'Deadline nära',
      fill: 'bg-red-600',
      marker: 'border-red-600',
      badge: 'border-red-200 bg-red-50 text-red-800',
    }
  }
  if (percent >= 75) {
    return {
      label: 'Snart deadline',
      fill: 'bg-orange-500',
      marker: 'border-orange-500',
      badge: 'border-orange-200 bg-orange-50 text-orange-900',
    }
  }
  if (percent >= 50) {
    return {
      label: 'Tiden går',
      fill: 'bg-amber-400',
      marker: 'border-amber-500',
      badge: 'border-amber-200 bg-amber-50 text-amber-900',
    }
  }
  return {
    label: 'Gott om tid',
    fill: 'bg-emerald-500',
    marker: 'border-emerald-600',
    badge: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  }
}

export default function TaskTimeProgress({ startedAt, dueAt, timeZone }: Props) {
  const [now, setNow] = useState<number | null>(null)
  const effectiveTimeZone = normalizeTaskTimeZone(timeZone)

  useEffect(() => {
    const update = () => setNow(Date.now())
    update()
    const timer = window.setInterval(update, MINUTE_MS)
    return () => window.clearInterval(timer)
  }, [])

  const timeline = useMemo(() => {
    if (now === null) return null
    const start = Date.parse(startedAt)
    const due = Date.parse(dueAt)
    if (!Number.isFinite(start) || !Number.isFinite(due)) return null

    const duration = Math.max(0, due - start)
    const elapsed = Math.max(0, now - start)
    const percent = duration === 0
      ? now >= due ? 100 : 0
      : Math.min(100, Math.max(0, Math.round((elapsed / duration) * 100)))

    return { start, due, now, percent, remaining: due - now }
  }, [dueAt, now, startedAt])

  if (!timeline) {
    return <div className="h-24 animate-pulse rounded-2xl border border-slate-200 bg-white" aria-hidden="true" />
  }

  const overdue = timeline.remaining < 0
  const tone = progressTone(timeline.percent, overdue)
  const remainingLabel = timeline.remaining === 0
    ? 'Sluttiden är nu'
    : durationLabel(timeline.remaining, overdue)

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:p-4" aria-labelledby="task-time-progress-heading">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 id="task-time-progress-heading" className="text-[11px] font-bold uppercase tracking-wide text-slate-500">
            Uppdragstid
          </h2>
          <p className="mt-0.5 text-sm font-semibold text-slate-900">
            {timeline.percent} % har gått <span className="font-normal text-slate-500">· {tone.label}</span>
          </p>
        </div>
        <span className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-semibold ${tone.badge}`}>
          {remainingLabel}
        </span>
      </div>

      <div className="mt-3 px-1">
        <div
          className="relative h-2 rounded-full bg-slate-200"
          role="progressbar"
          aria-label="Förbrukad uppdragstid"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={timeline.percent}
          aria-valuetext={`${timeline.percent} procent. ${tone.label}. ${remainingLabel}.`}
        >
          <div
            className={`absolute inset-y-0 left-0 rounded-full transition-[width] duration-500 ${tone.fill}`}
            style={{ width: `${timeline.percent}%` }}
          />
          <span
            className={`absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-[3px] bg-white shadow-sm ${tone.marker}`}
            style={{ left: `${timeline.percent}%` }}
          />
        </div>
      </div>

      <div className="mt-2 flex items-center justify-between gap-3 text-[11px] leading-4 text-slate-500">
        <p className="min-w-0 truncate">
          Start · <span className="font-semibold text-slate-700">{formatTaskDateTime(timeline.start, effectiveTimeZone, 'compact')}</span>
        </p>
        <p className="min-w-0 truncate text-right">
          Mål · <span className="font-semibold text-slate-700">{formatTaskDateTime(timeline.due, effectiveTimeZone, 'compact')}</span>
        </p>
      </div>
    </section>
  )
}
