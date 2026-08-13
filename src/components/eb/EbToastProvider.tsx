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
import { X } from 'lucide-react'

const AUTO_DISMISS_MS = 4000
const MAX_VISIBLE_TOASTS = 5

type EbErrorToast = {
  id: string
  message: string
}

type EbToastContextValue = {
  showError: (error: unknown, fallback?: string) => void
}

const EbToastContext = createContext<EbToastContextValue | null>(null)

function errorMessage(error: unknown, fallback = 'Ett oväntat fel inträffade.') {
  if (error instanceof Error && error.message.trim()) return error.message.trim()
  if (typeof error === 'string' && error.trim()) return error.trim()
  return fallback
}

function toastId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export function EbToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<EbErrorToast[]>([])
  const timersRef = useRef(new Map<string, number>())

  const dismiss = useCallback((id: string) => {
    const timer = timersRef.current.get(id)
    if (timer) window.clearTimeout(timer)
    timersRef.current.delete(id)
    setToasts((current) => current.filter((toast) => toast.id !== id))
  }, [])

  const showError = useCallback(
    (error: unknown, fallback?: string) => {
      const message = errorMessage(error, fallback)
      const id = toastId()

      setToasts((current) => [{ id, message }, ...current].slice(0, MAX_VISIBLE_TOASTS))
      const timer = window.setTimeout(() => dismiss(id), AUTO_DISMISS_MS)
      timersRef.current.set(id, timer)
    },
    [dismiss]
  )

  useEffect(() => {
    const timers = timersRef.current
    return () => {
      timers.forEach((timer) => window.clearTimeout(timer))
      timers.clear()
    }
  }, [])

  const value = useMemo(() => ({ showError }), [showError])

  return (
    <EbToastContext.Provider value={value}>
      {children}
      {toasts.length > 0 ? (
        <div
          className="fixed right-4 top-4 z-[300] flex w-[min(360px,calc(100vw-2rem))] flex-col gap-2 print:hidden"
          aria-live="assertive"
          aria-relevant="additions"
        >
          {toasts.map((toast) => (
            <div
              key={toast.id}
              role="alert"
              className="animate-in slide-in-from-top-2 fade-in rounded-md bg-black px-3 py-2 text-sm font-medium leading-5 text-white shadow-2xl"
            >
              <div className="flex items-start gap-3">
                <p className="min-w-0 flex-1">{toast.message}</p>
                <button
                  type="button"
                  onClick={() => dismiss(toast.id)}
                  className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-white/80 transition hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
                  aria-label="Stäng felmeddelande"
                  title="Stäng"
                >
                  <X size={13} aria-hidden="true" />
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </EbToastContext.Provider>
  )
}

export function useEbToast() {
  const context = useContext(EbToastContext)
  if (!context) throw new Error('useEbToast måste användas inom EbToastProvider.')
  return context
}
