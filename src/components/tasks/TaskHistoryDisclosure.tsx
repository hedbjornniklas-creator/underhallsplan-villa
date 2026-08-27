'use client'

import { ArrowRight, ChevronDown, History } from 'lucide-react'
import type { TaskStatus } from '@/lib/tasks/contracts'
import { taskStatusLabel } from './TaskStatusBadge'

export type TaskHistoryEvent = {
  id: string
  type: string
  actorName: string
  message: string | null
  fromStatus: TaskStatus | null
  toStatus: TaskStatus | null
  createdAt: string
}

type Props = {
  events: TaskHistoryEvent[]
  heading?: string
}

function formatHistoryDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('sv-SE', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

export default function TaskHistoryDisclosure({ events, heading = 'Historik' }: Props) {
  const historyEvents = events.filter((event) => event.type !== 'comment')

  return (
    <details className="group rounded-2xl border border-slate-200 bg-white shadow-sm">
      <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 rounded-2xl px-4 py-3 text-sm font-semibold text-slate-800 outline-none transition hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 [&::-webkit-details-marker]:hidden">
        <History className="shrink-0 text-slate-500" size={18} aria-hidden="true" />
        <span className="min-w-0 flex-1">{heading}</span>
        <span className="text-xs font-medium text-slate-500">{historyEvents.length}</span>
        <ChevronDown className="shrink-0 text-slate-400 transition group-open:rotate-180" size={18} aria-hidden="true" />
      </summary>
      <div className="border-t border-slate-100 px-4 py-4">
        {historyEvents.length > 0 ? (
          <ol className="space-y-4">
            {historyEvents.map((event) => (
              <li key={event.id} className="relative pl-7">
                <span className="absolute left-1.5 top-1.5 h-2.5 w-2.5 rounded-full bg-slate-300 ring-4 ring-slate-100" />
                <p className="text-xs font-semibold text-slate-700">
                  {event.actorName} · {formatHistoryDate(event.createdAt)}
                </p>
                {event.fromStatus && event.toStatus ? (
                  <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                    {taskStatusLabel(event.fromStatus)} <ArrowRight size={12} aria-hidden="true" /> {taskStatusLabel(event.toStatus)}
                  </p>
                ) : null}
                {event.message ? (
                  <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6 text-slate-700">
                    {event.message}
                  </p>
                ) : null}
              </li>
            ))}
          </ol>
        ) : (
          <p className="py-2 text-sm text-slate-500">Ingen historik ännu.</p>
        )}
      </div>
    </details>
  )
}
