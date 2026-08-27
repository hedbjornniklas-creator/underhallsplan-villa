'use client'

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type RefObject,
} from 'react'
import { Loader2, MessageSquareText, Send } from 'lucide-react'

export type TaskConversationEvent = {
  id: string
  type: string
  actorName: string
  authorSide: 'self' | 'other' | 'system'
  message: string | null
  createdAt: string
}

type Props = {
  headingId: string
  messages: TaskConversationEvent[]
  value: string
  onChange: (value: string) => void
  onSubmit: (event: FormEvent<HTMLFormElement>) => void | Promise<void>
  submitting: boolean
  canSend?: boolean
  disabledReason?: string | null
  recipientLabel: string
  placeholder?: string
  unreadCount: number
  latestIncomingMessageEventId: string | null
  onMarkRead?: (throughEventId: string) => void | Promise<void>
  composerRef?: RefObject<HTMLTextAreaElement | null>
}

function formatMessageDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('sv-SE', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date)
}

export default function TaskConversationCard({
  headingId,
  messages,
  value,
  onChange,
  onSubmit,
  submitting,
  canSend = true,
  disabledReason,
  recipientLabel,
  placeholder = 'Skriv ett meddelande…',
  unreadCount,
  latestIncomingMessageEventId,
  onMarkRead,
  composerRef,
}: Props) {
  const threadRef = useRef<HTMLDivElement>(null)
  const latestIncomingRef = useRef<HTMLLIElement>(null)
  const reportedReadIdRef = useRef<string | null>(null)
  const [locallyReadId, setLocallyReadId] = useState<string | null>(null)
  const comments = useMemo(
    () =>
      messages
        .filter((event) => event.type === 'comment' && Boolean(event.message?.trim()))
        .slice()
        .sort((left, right) => {
          const timeDifference = new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime()
          return timeDifference || left.id.localeCompare(right.id)
        }),
    [messages]
  )
  const lastCommentId = comments.at(-1)?.id ?? null
  const visibleUnreadCount =
    latestIncomingMessageEventId && locallyReadId === latestIncomingMessageEventId
      ? 0
      : unreadCount

  useEffect(() => {
    if (!lastCommentId) return
    const frame = window.requestAnimationFrame(() => {
      const thread = threadRef.current
      if (thread) thread.scrollTop = thread.scrollHeight
    })
    return () => window.cancelAnimationFrame(frame)
  }, [lastCommentId])

  useEffect(() => {
    const throughEventId = latestIncomingMessageEventId
    const root = threadRef.current
    const target = latestIncomingRef.current
    if (!throughEventId || !root || !target || !onMarkRead || visibleUnreadCount <= 0) return
    if (reportedReadIdRef.current === throughEventId) return

    let targetVisible = false
    let delayTimer: number | null = null

    const clearDelay = () => {
      if (delayTimer !== null) window.clearTimeout(delayTimer)
      delayTimer = null
    }
    const environmentAllowsRead = () =>
      document.visibilityState === 'visible' && document.hasFocus()
    const scheduleRead = () => {
      clearDelay()
      if (!targetVisible || !environmentAllowsRead()) return
      delayTimer = window.setTimeout(() => {
        if (!targetVisible || !environmentAllowsRead()) return
        reportedReadIdRef.current = throughEventId
        Promise.resolve(onMarkRead(throughEventId))
          .then(() => setLocallyReadId(throughEventId))
          .catch(() => {
            if (reportedReadIdRef.current === throughEventId) reportedReadIdRef.current = null
          })
      }, 650)
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        targetVisible = Boolean(entry?.isIntersecting && entry.intersectionRatio >= 0.6)
        scheduleRead()
      },
      { root, threshold: [0.6] }
    )
    const handleEnvironmentChange = () => scheduleRead()

    observer.observe(target)
    document.addEventListener('visibilitychange', handleEnvironmentChange)
    window.addEventListener('focus', handleEnvironmentChange)
    window.addEventListener('blur', handleEnvironmentChange)
    return () => {
      clearDelay()
      observer.disconnect()
      document.removeEventListener('visibilitychange', handleEnvironmentChange)
      window.removeEventListener('focus', handleEnvironmentChange)
      window.removeEventListener('blur', handleEnvironmentChange)
    }
  }, [latestIncomingMessageEventId, onMarkRead, visibleUnreadCount])

  return (
    <section
      className="rounded-3xl border border-slate-200 bg-slate-50/80 p-4 shadow-sm sm:p-5"
      aria-labelledby={headingId}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <MessageSquareText className="shrink-0 text-indigo-700" size={19} aria-hidden="true" />
            <h3 id={headingId} className="text-base font-semibold text-slate-950 sm:text-lg">
              Meddelanden
            </h3>
          </div>
          <p className="mt-1 text-xs leading-5 text-slate-500">Dialog med {recipientLabel}.</p>
        </div>
        {visibleUnreadCount > 0 ? (
          <span className="shrink-0 rounded-full bg-indigo-700 px-2.5 py-1 text-xs font-bold text-white">
            {visibleUnreadCount} {visibleUnreadCount === 1 ? 'nytt' : 'nya'}
          </span>
        ) : null}
      </div>

      <div
        ref={threadRef}
        className="mt-4 max-h-80 overflow-y-auto overscroll-contain rounded-2xl border border-slate-200 bg-white px-3 py-4"
        aria-label="Meddelandetråd"
      >
        {comments.length > 0 ? (
          <ol className="space-y-3" aria-live="polite">
            {comments.map((event) => {
              const own = event.authorSide === 'self'
              const system = event.authorSide === 'system'
              return (
                <li
                  key={event.id}
                  ref={event.id === latestIncomingMessageEventId ? latestIncomingRef : undefined}
                  className={system ? 'flex justify-center' : own ? 'flex justify-end' : 'flex justify-start'}
                >
                  <article
                    className={
                      system
                        ? 'max-w-[92%] rounded-xl bg-slate-100 px-3 py-2 text-center text-slate-600'
                        : own
                          ? 'max-w-[88%] rounded-2xl rounded-br-md bg-indigo-700 px-3.5 py-3 text-white shadow-sm'
                          : 'max-w-[88%] rounded-2xl rounded-bl-md border border-slate-200 bg-white px-3.5 py-3 text-slate-800 shadow-sm'
                    }
                  >
                    <p className={`text-[11px] font-semibold ${own ? 'text-indigo-100' : 'text-slate-500'}`}>
                      {event.actorName} · {formatMessageDate(event.createdAt)}
                    </p>
                    <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-6">{event.message}</p>
                  </article>
                </li>
              )
            })}
          </ol>
        ) : (
          <p className="px-2 py-5 text-center text-sm leading-6 text-slate-500">
            Inga meddelanden ännu. Skriv det första meddelandet nedan.
          </p>
        )}
      </div>

      <form onSubmit={onSubmit} className="mt-3">
        <label htmlFor={`${headingId}-composer`} className="sr-only">
          Skriv till {recipientLabel}
        </label>
        <textarea
          ref={composerRef}
          id={`${headingId}-composer`}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          rows={3}
          disabled={!canSend || submitting}
          placeholder={canSend ? placeholder : undefined}
          className="min-h-24 w-full resize-y rounded-2xl border border-slate-200 bg-white px-4 py-3 text-base text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-indigo-400 focus:ring-4 focus:ring-indigo-100 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
        />
        {disabledReason && !canSend ? (
          <p className="mt-2 text-xs leading-5 text-slate-500">{disabledReason}</p>
        ) : null}
        <button
          type="submit"
          disabled={!canSend || submitting || !value.trim()}
          className="mt-2 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-slate-900 px-4 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? <Loader2 className="animate-spin" size={18} aria-hidden="true" /> : <Send size={18} aria-hidden="true" />}
          Skicka meddelande
        </button>
      </form>
    </section>
  )
}
