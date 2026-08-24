'use client'

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from 'lucide-react'

export type AppToastTone = 'success' | 'error' | 'warning' | 'info'

export type AppToastOptions = {
  tone?: AppToastTone
  fallback?: string
  durationMs?: number | null
  dedupeKey?: string | null
}

export type AppToastMethodOptions = Omit<AppToastOptions, 'tone' | 'fallback'>

type AppToast = {
  id: string
  dedupeKey: string | null
  message: string
  tone: AppToastTone
}

type AppToastContextValue = {
  show: (message: unknown, options?: AppToastOptions) => string
  success: (message: unknown, options?: AppToastMethodOptions) => string
  error: (
    error: unknown,
    fallbackOrOptions?: string | AppToastMethodOptions,
    options?: AppToastMethodOptions
  ) => string
  warning: (message: unknown, options?: AppToastMethodOptions) => string
  info: (message: unknown, options?: AppToastMethodOptions) => string
  dismiss: (id: string) => void
  dismissAll: () => void
}

const AppToastContext = createContext<AppToastContextValue | null>(null)

const MAX_VISIBLE_TOASTS = 5
const DEFAULT_DURATION_MS: Record<AppToastTone, number> = {
  success: 4000,
  error: 6500,
  warning: 6000,
  info: 4500,
}
const DEFAULT_MESSAGE: Record<AppToastTone, string> = {
  success: 'Åtgärden slutfördes.',
  error: 'Ett oväntat fel inträffade.',
  warning: 'Något behöver din uppmärksamhet.',
  info: 'Informationen har uppdaterats.',
}

const TONE_STYLES: Record<
  AppToastTone,
  {
    border: string
    icon: string
    label: string
  }
> = {
  success: {
    border: 'border-emerald-500',
    icon: 'text-emerald-600',
    label: 'Bekräftelse',
  },
  error: {
    border: 'border-rose-500',
    icon: 'text-rose-600',
    label: 'Felmeddelande',
  },
  warning: {
    border: 'border-amber-500',
    icon: 'text-amber-600',
    label: 'Varning',
  },
  info: {
    border: 'border-sky-500',
    icon: 'text-sky-600',
    label: 'Information',
  },
}

function messageFrom(value: unknown, fallback: string) {
  if (value instanceof Error && value.message.trim()) return value.message.trim()
  if (typeof value === 'string' && value.trim()) return value.trim()

  if (value && typeof value === 'object' && 'message' in value) {
    const message = (value as { message?: unknown }).message
    if (typeof message === 'string' && message.trim()) return message.trim()
  }

  return fallback
}

function toastId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function ToastIcon({ tone }: { tone: AppToastTone }) {
  const props = { size: 20, strokeWidth: 2.25, 'aria-hidden': true as const }

  if (tone === 'success') return <CircleCheck {...props} />
  if (tone === 'error') return <CircleAlert {...props} />
  if (tone === 'warning') return <TriangleAlert {...props} />
  return <Info {...props} />
}

/**
 * The provider is deliberately idempotent. Feature-specific compatibility
 * providers may render it without creating another toast queue or timer set.
 */
export function AppToastProvider({ children }: { children: ReactNode }) {
  const parentContext = useContext(AppToastContext)

  if (parentContext) return <>{children}</>
  return <AppToastProviderRoot>{children}</AppToastProviderRoot>
}

function AppToastProviderRoot({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<AppToast[]>([])
  const toastsByIdRef = useRef(new Map<string, AppToast>())
  const orderedIdsRef = useRef<string[]>([])
  const idsByDedupeKeyRef = useRef(new Map<string, string>())
  const timersRef = useRef(new Map<string, number>())

  const publish = useCallback(() => {
    setToasts(
      orderedIdsRef.current.flatMap((id) => {
        const toast = toastsByIdRef.current.get(id)
        return toast ? [toast] : []
      })
    )
  }, [])

  const dismiss = useCallback(
    (id: string) => {
      const toast = toastsByIdRef.current.get(id)
      const timer = timersRef.current.get(id)
      if (timer) window.clearTimeout(timer)

      timersRef.current.delete(id)
      toastsByIdRef.current.delete(id)
      orderedIdsRef.current = orderedIdsRef.current.filter((toastIdValue) => toastIdValue !== id)

      if (toast?.dedupeKey && idsByDedupeKeyRef.current.get(toast.dedupeKey) === id) {
        idsByDedupeKeyRef.current.delete(toast.dedupeKey)
      }

      publish()
    },
    [publish]
  )

  const dismissAll = useCallback(() => {
    timersRef.current.forEach((timer) => window.clearTimeout(timer))
    timersRef.current.clear()
    toastsByIdRef.current.clear()
    orderedIdsRef.current = []
    idsByDedupeKeyRef.current.clear()
    publish()
  }, [publish])

  const show = useCallback(
    (value: unknown, options: AppToastOptions = {}) => {
      const tone = options.tone ?? 'info'
      const message = messageFrom(value, options.fallback ?? DEFAULT_MESSAGE[tone])
      const dedupeKey =
        options.dedupeKey === null ? null : (options.dedupeKey?.trim() || `${tone}:${message}`)
      const existingId = dedupeKey ? idsByDedupeKeyRef.current.get(dedupeKey) : undefined
      const id = existingId ?? toastId()
      const toast: AppToast = { id, dedupeKey, message, tone }

      if (existingId) {
        const timer = timersRef.current.get(existingId)
        if (timer) window.clearTimeout(timer)
        timersRef.current.delete(existingId)
        orderedIdsRef.current = orderedIdsRef.current.filter(
          (toastIdValue) => toastIdValue !== existingId
        )
      }

      toastsByIdRef.current.set(id, toast)
      orderedIdsRef.current.unshift(id)
      if (dedupeKey) idsByDedupeKeyRef.current.set(dedupeKey, id)

      const overflowIds = orderedIdsRef.current.splice(MAX_VISIBLE_TOASTS)
      overflowIds.forEach((overflowId) => {
        const overflowToast = toastsByIdRef.current.get(overflowId)
        const overflowTimer = timersRef.current.get(overflowId)
        if (overflowTimer) window.clearTimeout(overflowTimer)
        timersRef.current.delete(overflowId)
        toastsByIdRef.current.delete(overflowId)

        if (
          overflowToast?.dedupeKey &&
          idsByDedupeKeyRef.current.get(overflowToast.dedupeKey) === overflowId
        ) {
          idsByDedupeKeyRef.current.delete(overflowToast.dedupeKey)
        }
      })

      publish()

      const durationMs =
        options.durationMs === undefined ? DEFAULT_DURATION_MS[tone] : options.durationMs
      if (durationMs !== null && durationMs > 0) {
        timersRef.current.set(id, window.setTimeout(() => dismiss(id), durationMs))
      }

      return id
    },
    [dismiss, publish]
  )

  const success = useCallback(
    (message: unknown, options?: AppToastMethodOptions) =>
      show(message, { ...options, tone: 'success' }),
    [show]
  )
  const error = useCallback(
    (
      errorValue: unknown,
      fallbackOrOptions?: string | AppToastMethodOptions,
      options?: AppToastMethodOptions
    ) => {
      const fallback =
        typeof fallbackOrOptions === 'string' ? fallbackOrOptions : DEFAULT_MESSAGE.error
      const resolvedOptions = typeof fallbackOrOptions === 'string' ? options : fallbackOrOptions
      return show(errorValue, { ...resolvedOptions, tone: 'error', fallback })
    },
    [show]
  )
  const warning = useCallback(
    (message: unknown, options?: AppToastMethodOptions) =>
      show(message, { ...options, tone: 'warning' }),
    [show]
  )
  const info = useCallback(
    (message: unknown, options?: AppToastMethodOptions) =>
      show(message, { ...options, tone: 'info' }),
    [show]
  )

  useEffect(() => {
    const timers = timersRef.current
    const toastsById = toastsByIdRef.current
    const idsByDedupeKey = idsByDedupeKeyRef.current

    return () => {
      timers.forEach((timer) => window.clearTimeout(timer))
      timers.clear()
      toastsById.clear()
      idsByDedupeKey.clear()
      orderedIdsRef.current = []
    }
  }, [])

  const value = useMemo(
    () => ({ show, success, error, warning, info, dismiss, dismissAll }),
    [dismiss, dismissAll, error, info, show, success, warning]
  )

  return (
    <AppToastContext.Provider value={value}>
      {children}
      {toasts.length > 0 ? (
        <section
          aria-label="Meddelanden"
          className="pointer-events-none fixed inset-x-0 top-0 z-[500] flex flex-col gap-2 px-3 pt-[calc(env(safe-area-inset-top)+0.75rem)] print:hidden sm:left-auto sm:right-4 sm:top-4 sm:w-[min(380px,calc(100vw-2rem))] sm:p-0"
        >
          {toasts.map((toast) => {
            const style = TONE_STYLES[toast.tone]
            const assertive = toast.tone === 'error' || toast.tone === 'warning'

            return (
              <div
                key={toast.id}
                role={assertive ? 'alert' : 'status'}
                className={`pointer-events-auto animate-in slide-in-from-top-2 fade-in rounded-xl border border-slate-200 border-l-4 ${style.border} bg-white px-3 py-3 text-sm text-slate-800 shadow-2xl shadow-slate-950/15`}
              >
                <div className="flex items-start gap-3">
                  <span className={`mt-0.5 shrink-0 ${style.icon}`}>
                    <ToastIcon tone={toast.tone} />
                  </span>
                  <p className="min-w-0 flex-1 break-words font-medium leading-5">
                    <span className="sr-only">{style.label}: </span>
                    {toast.message}
                  </p>
                  <button
                    type="button"
                    onClick={() => dismiss(toast.id)}
                    className="-mr-1 -mt-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 focus-visible:ring-offset-2"
                    aria-label={`Stäng ${style.label.toLocaleLowerCase('sv-SE')}`}
                    title="Stäng"
                  >
                    <X size={16} aria-hidden="true" />
                  </button>
                </div>
              </div>
            )
          })}
        </section>
      ) : null}
    </AppToastContext.Provider>
  )
}

export function useToast() {
  const context = useContext(AppToastContext)
  if (!context) throw new Error('useToast måste användas inom AppToastProvider.')
  return context
}
