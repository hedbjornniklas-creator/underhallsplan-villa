'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

type DeleteConfirmOverlayProps = {
  open: boolean
  targetLabel?: string
  targetDetails?: string
  onClose: () => void
  onExecute: () => Promise<void>
  onSuccess?: () => void
  onError?: (message: string) => void
  abortLabel?: string
  executeLabel?: string
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message
  return 'Kunde inte utföra radering.'
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export default function DeleteConfirmOverlay({
  open,
  targetLabel = 'Uppdragsbekräftelse',
  targetDetails,
  onClose,
  onExecute,
  onSuccess,
  onError,
  abortLabel = 'Avbryt',
  executeLabel = 'Bekräfta radering',
}: DeleteConfirmOverlayProps) {
  const [running, setRunning] = useState(false)
  const [panelError, setPanelError] = useState<string | null>(null)
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false)
  const dialogRef = useRef<HTMLDivElement | null>(null)
  const executeButtonRef = useRef<HTMLButtonElement | null>(null)
  const previouslyFocusedRef = useRef<HTMLElement | null>(null)

  const executionDurationMs = useMemo(() => (prefersReducedMotion ? 140 : 950), [prefersReducedMotion])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    const apply = () => setPrefersReducedMotion(mediaQuery.matches)
    apply()
    mediaQuery.addEventListener('change', apply)
    return () => mediaQuery.removeEventListener('change', apply)
  }, [])

  useEffect(() => {
    if (!open) return
    previouslyFocusedRef.current = document.activeElement as HTMLElement | null
    setPanelError(null)
    setRunning(false)
    const timer = window.setTimeout(() => executeButtonRef.current?.focus(), 20)

    return () => {
      window.clearTimeout(timer)
      previouslyFocusedRef.current?.focus?.()
    }
  }, [open])

  const closeIfAllowed = useCallback(() => {
    if (running) return
    onClose()
  }, [onClose, running])

  const trapFocus = useCallback((event: KeyboardEvent) => {
    if (!dialogRef.current || event.key !== 'Tab') return
    const focusables = dialogRef.current.querySelectorAll<HTMLElement>(
      'button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])'
    )
    if (!focusables.length) return

    const first = focusables[0]
    const last = focusables[focusables.length - 1]
    const active = document.activeElement as HTMLElement | null

    if (event.shiftKey) {
      if (active === first || active === dialogRef.current) {
        event.preventDefault()
        last.focus()
      }
      return
    }

    if (active === last) {
      event.preventDefault()
      first.focus()
    }
  }, [])

  const handleExecute = useCallback(async () => {
    if (running) return
    setPanelError(null)
    setRunning(true)

    try {
      await Promise.all([onExecute(), wait(executionDurationMs)])
      onSuccess?.()
      onClose()
    } catch (error) {
      const message = getErrorMessage(error)
      setPanelError(message)
      onError?.(message)
      setRunning(false)
    }
  }, [executionDurationMs, onClose, onError, onExecute, onSuccess, running])

  useEffect(() => {
    if (!open) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeIfAllowed()
        return
      }

      if (event.key === 'Enter' && !running) {
        const activeTag = (document.activeElement as HTMLElement | null)?.tagName ?? ''
        if (activeTag !== 'TEXTAREA') {
          event.preventDefault()
          void handleExecute()
        }
      }

      trapFocus(event)
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [closeIfAllowed, handleExecute, open, running, trapFocus])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center p-4 sm:p-6" aria-modal="true" role="dialog">
      <button
        type="button"
        onClick={closeIfAllowed}
        disabled={running}
        aria-label="Stäng"
        className="absolute inset-0 cursor-default bg-slate-950/72 backdrop-blur-sm"
      />
      <div className="noise-layer absolute inset-0 pointer-events-none" />

      <div
        ref={dialogRef}
        className={`panel relative z-[91] w-full max-w-xl overflow-hidden rounded-2xl border border-cyan-300/30 bg-slate-900/95 p-5 font-mono text-slate-100 shadow-[0_32px_100px_-34px_rgba(8,145,178,0.75)] ${
          running && !prefersReducedMotion ? 'is-executing' : ''
        }`}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="scanline" aria-hidden="true" />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-cyan-400/0 via-cyan-300/80 to-cyan-400/0" />
        <div className="pointer-events-none absolute right-0 top-0 h-full w-px bg-cyan-300/20" />

        <p className="text-[11px] uppercase tracking-[0.22em] text-cyan-300/90">System: Destructive Command</p>

        <div className="mt-4 space-y-2 text-sm leading-relaxed text-slate-200">
          <p>
            <span className="text-cyan-300">Target:</span> {targetLabel}
          </p>
          <p>
            <span className="text-cyan-300">Status:</span>{' '}
            <span className="text-rose-300">Permanent removal</span>
          </p>
          {targetDetails ? (
            <p className="truncate">
              <span className="text-cyan-300">Ref:</span> {targetDetails}
            </p>
          ) : null}
          <p className="pt-1 text-slate-100">Confirm execution?</p>
        </div>

        {panelError ? (
          <div className="mt-4 rounded-md border border-rose-400/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
            {panelError}
          </div>
        ) : null}

        <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            onClick={closeIfAllowed}
            disabled={running}
            className="inline-flex h-9 items-center rounded-md border border-slate-500/70 bg-slate-800/90 px-3 text-xs font-semibold tracking-wide text-slate-200 transition hover:border-cyan-300/50 hover:text-cyan-100 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {abortLabel}
          </button>
          <button
            ref={executeButtonRef}
            type="button"
            onClick={() => void handleExecute()}
            disabled={running}
            className="inline-flex h-9 items-center rounded-md border border-rose-400/60 bg-rose-500/18 px-3 text-xs font-semibold tracking-wide text-rose-100 transition hover:border-rose-300 hover:bg-rose-500/26 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {running ? 'Executing...' : executeLabel}
          </button>
        </div>
      </div>

      <style jsx>{`
        .noise-layer {
          background-image:
            radial-gradient(circle at 25% 25%, rgba(148, 163, 184, 0.1) 1px, transparent 1px),
            radial-gradient(circle at 75% 75%, rgba(148, 163, 184, 0.08) 1px, transparent 1px),
            repeating-linear-gradient(
              0deg,
              rgba(15, 23, 42, 0.14) 0px,
              rgba(15, 23, 42, 0.14) 1px,
              transparent 1px,
              transparent 2px
            );
          background-size: 3px 3px, 4px 4px, 100% 3px;
          opacity: 0.3;
        }

        .scanline {
          position: absolute;
          left: 8px;
          right: 8px;
          top: -12%;
          height: 2px;
          border-radius: 9999px;
          background: linear-gradient(90deg, transparent, rgba(34, 211, 238, 0.95), transparent);
          box-shadow: 0 0 14px rgba(34, 211, 238, 0.7);
          opacity: 0;
        }

        .panel.is-executing {
          animation: glitchDissolve 1000ms ease-out forwards;
        }

        .panel.is-executing .scanline {
          animation: scanSweep 1000ms linear forwards;
        }

        @keyframes scanSweep {
          0% {
            transform: translateY(0%);
            opacity: 0;
          }
          10% {
            opacity: 1;
          }
          100% {
            transform: translateY(650%);
            opacity: 0;
          }
        }

        @keyframes glitchDissolve {
          0% {
            opacity: 1;
            filter: blur(0);
            transform: scale(1);
          }
          35% {
            opacity: 0.92;
            filter: blur(0.6px);
            transform: scale(0.997);
          }
          70% {
            opacity: 0.6;
            filter: blur(1.4px);
            transform: scale(0.987);
          }
          100% {
            opacity: 0.28;
            filter: blur(2.2px);
            transform: scale(0.975);
          }
        }
      `}</style>
    </div>
  )
}
