'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useAutosaveQueue } from './useAutosaveQueue'

type SaveJob = {
  key: string
  label: string
  run: () => Promise<void>
  recover?: () => void
  resolve: () => void
  reject: (error: unknown) => void
}
type SaveFailure = { key: string; label: string; message: string; recover?: () => void }

export function useFlowBuilderSaveQueue() {
  const [pending, setPending] = useState(0)
  const [failures, setFailures] = useState<SaveFailure[]>([])
  const pendingRef = useRef(new Set<Promise<void>>())
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  const autosave = useAutosaveQueue<SaveJob[], void>({
    // These are commands, not replacement snapshots. Keep every confirmed job.
    mergePayload: (previous, next) => [...previous, ...next],
    save: async jobs => {
      for (const job of jobs) {
        try {
          await job.run()
          if (mounted.current) setFailures(current => current.filter(item => item.key !== job.key))
          job.resolve()
        } catch (error) {
          if (mounted.current) setFailures(current => [...current.filter(item => item.key !== job.key), {
            key: job.key, label: job.label,
            message: error instanceof Error ? error.message : 'Kunde inte spara.', recover: job.recover,
          }])
          job.reject(error)
        }
      }
    },
  })

  const enqueueBatch = autosave.enqueue
  const enqueue = useCallback((job: Omit<SaveJob, 'resolve' | 'reject'>) => {
    let resolve!: () => void
    let reject!: (error: unknown) => void
    const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no })
    pendingRef.current.add(promise)
    setPending(pendingRef.current.size)
    void promise.finally(() => {
      pendingRef.current.delete(promise)
      if (mounted.current) setPending(pendingRef.current.size)
    }).catch(() => undefined)
    void enqueueBatch([{ ...job, resolve, reject }]).then(result => {
      // The shared queue drops waiting work on unmount, not silently as a success.
      if (result === null) reject(new Error('Sparandet avbröts när sidan stängdes.'))
    }).catch(reject)
    return promise
  }, [enqueueBatch])

  const flush = useCallback(async () => {
    while (pendingRef.current.size) await Promise.all([...pendingRef.current])
  }, [])

  useEffect(() => {
    if (!pending && !failures.length) return
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    const beforeNavigate = (event: MouseEvent) => {
      const anchor = event.target instanceof Element ? event.target.closest('a[href]') : null
      if (!(anchor instanceof HTMLAnchorElement) || anchor.target === '_blank' || anchor.hasAttribute('download')
        || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
      const destination = new URL(anchor.href)
      if (destination.pathname === location.pathname && destination.origin === location.origin) return
      if (!window.confirm('Det finns ändringar som inte har sparats klart. Lämna sidan ändå?')) {
        event.preventDefault(); event.stopPropagation()
      }
    }
    window.addEventListener('beforeunload', beforeUnload)
    document.addEventListener('click', beforeNavigate, true)
    return () => {
      window.removeEventListener('beforeunload', beforeUnload)
      document.removeEventListener('click', beforeNavigate, true)
    }
  }, [pending, failures.length])

  return { enqueue, flush, pending, failures, isSaving: pending > 0,
    lastSavedAt: autosave.lastSavedAt,
    hasPending: () => pendingRef.current.size > 0,
    dismissFailure: (key: string) => setFailures(current => current.filter(item => item.key !== key)),
  }
}
