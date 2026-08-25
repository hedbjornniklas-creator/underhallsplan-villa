'use client'

import { useEffect, useMemo, useState } from 'react'

type Props = {
  startedAt: string
  dueAt: string
}

const DAY_MS = 24 * 60 * 60 * 1000

function localDay(value: string | number) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

function formatDate(value: number) {
  return new Intl.DateTimeFormat('sv-SE', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(value))
}

function formatShortDate(value: number) {
  return new Intl.DateTimeFormat('sv-SE', {
    day: 'numeric',
    month: 'short',
  }).format(new Date(value))
}

export default function TaskTimeProgress({ startedAt, dueAt }: Props) {
  const [now, setNow] = useState<number | null>(null)

  useEffect(() => {
    const update = () => setNow(Date.now())
    update()
    const timer = window.setInterval(update, 60 * 60 * 1000)
    return () => window.clearInterval(timer)
  }, [])

  const timeline = useMemo(() => {
    if (now === null) return null
    const start = localDay(startedAt)
    const due = localDay(dueAt)
    const today = localDay(now)
    if (start === null || due === null || today === null) return null

    const duration = Math.max(0, due - start)
    const elapsed = Math.max(0, today - start)
    const percent = duration === 0
      ? today >= due ? 100 : 0
      : Math.min(100, Math.max(0, Math.round((elapsed / duration) * 100)))
    const daysToDue = Math.round((due - today) / DAY_MS)

    return { start, due, today, percent, daysToDue }
  }, [dueAt, now, startedAt])

  if (!timeline) {
    return <div className="mt-4 h-40 animate-pulse rounded-3xl border border-slate-200 bg-white" aria-hidden="true" />
  }

  const overdue = timeline.daysToDue < 0
  const remainingLabel = overdue
    ? `${Math.abs(timeline.daysToDue)} ${Math.abs(timeline.daysToDue) === 1 ? 'dag' : 'dagar'} försenad`
    : timeline.daysToDue === 0
      ? 'Deadline idag'
      : `${timeline.daysToDue} ${timeline.daysToDue === 1 ? 'dag' : 'dagar'} kvar`
  const markerLabelStyle = timeline.percent <= 8
    ? { left: '0%' }
    : timeline.percent >= 92
      ? { right: '0%' }
      : { left: `${timeline.percent}%`, transform: 'translateX(-50%)' }

  return (
    <section className="mt-4 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6" aria-labelledby="task-time-progress-heading">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="task-time-progress-heading" className="text-sm font-semibold text-slate-800">
          {timeline.percent} % av uppdragstiden har gått
        </h2>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${
          overdue ? 'bg-rose-100 text-rose-800' : 'bg-blue-50 text-blue-700'
        }`}>
          {remainingLabel}
        </span>
      </div>

      <div className="mt-8 px-1">
        <div
          className="relative h-2.5 rounded-full bg-slate-200"
          role="progressbar"
          aria-label="Förbrukad uppdragstid"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={timeline.percent}
        >
          <div
            className={`absolute inset-y-0 left-0 rounded-full ${overdue ? 'bg-rose-500' : 'bg-blue-500'}`}
            style={{ width: `${timeline.percent}%` }}
          />
          <span className="absolute left-0 top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-blue-500 bg-white" />
          <span className="absolute right-0 top-1/2 h-3.5 w-3.5 translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-slate-300 bg-white" />
          <span
            className={`absolute top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-4 bg-white shadow-sm ${
              overdue ? 'border-rose-500' : 'border-blue-500'
            }`}
            style={{ left: `${timeline.percent}%` }}
          />
          <span
            className="absolute bottom-4 whitespace-nowrap text-xs font-semibold text-slate-700"
            style={markerLabelStyle}
          >
            {overdue ? 'Deadline passerad' : `Idag · ${formatShortDate(timeline.today)}`}
          </span>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
        <div>
          <p className="text-xs text-slate-500">Start</p>
          <p className="mt-1 font-semibold text-slate-800">{formatDate(timeline.start)}</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-slate-500">Mål</p>
          <p className="mt-1 font-semibold text-slate-800">{formatDate(timeline.due)}</p>
        </div>
      </div>
    </section>
  )
}
