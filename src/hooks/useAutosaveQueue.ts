'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

export type AutosaveQueueStatus = 'idle' | 'saving' | 'saved' | 'error'

type AutosaveQueueOptions<TPayload, TResult> = {
  save: (payload: TPayload) => Promise<TResult>
  mergePayload?: (previous: TPayload, next: TPayload) => TPayload
  onSaved?: (result: TResult, payload: TPayload) => void
  onError?: (error: unknown, payload: TPayload) => void
}

type PendingSave<TPayload, TResult> = {
  payload: TPayload
  resolvers: Array<(result: TResult | null) => void>
  rejecters: Array<(error: unknown) => void>
}

export function useAutosaveQueue<TPayload, TResult>({
  save,
  mergePayload,
  onSaved,
  onError,
}: AutosaveQueueOptions<TPayload, TResult>) {
  const [status, setStatus] = useState<AutosaveQueueStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null)
  const activeRef = useRef(false)
  const pendingRef = useRef<PendingSave<TPayload, TResult> | null>(null)
  const mountedRef = useRef(true)
  const saveRef = useRef(save)
  const mergePayloadRef = useRef(mergePayload)
  const onSavedRef = useRef(onSaved)
  const onErrorRef = useRef(onError)

  useEffect(() => {
    saveRef.current = save
    mergePayloadRef.current = mergePayload
    onSavedRef.current = onSaved
    onErrorRef.current = onError
  }, [mergePayload, onError, onSaved, save])

  useEffect(() => {
    return () => {
      mountedRef.current = false
      pendingRef.current?.resolvers.forEach((resolve) => resolve(null))
      pendingRef.current = null
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined' || status !== 'saving') return

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [status])

  const drainQueue = useCallback(async () => {
    if (activeRef.current) return

    const next = pendingRef.current
    if (!next) return

    pendingRef.current = null
    activeRef.current = true
    if (mountedRef.current) {
      setStatus('saving')
      setError(null)
    }

    try {
      const result = await saveRef.current(next.payload)
      if (mountedRef.current && pendingRef.current === null) {
        onSavedRef.current?.(result, next.payload)
        setLastSavedAt(new Date())
        setStatus('saved')
      }
      next.resolvers.forEach((resolve) => resolve(result))
    } catch (saveError) {
      if (mountedRef.current) {
        setStatus('error')
        setError(saveError instanceof Error ? saveError.message : 'Kunde inte spara.')
        onErrorRef.current?.(saveError, next.payload)
      }
      next.rejecters.forEach((reject) => reject(saveError))
    } finally {
      activeRef.current = false
      if (pendingRef.current) {
        void drainQueue()
      }
    }
  }, [])

  const enqueue = useCallback(
    (payload: TPayload) => {
      const promise = new Promise<TResult | null>((resolve, reject) => {
        if (pendingRef.current) {
          pendingRef.current.payload = mergePayloadRef.current
            ? mergePayloadRef.current(pendingRef.current.payload, payload)
            : payload
          pendingRef.current.resolvers.push(resolve)
          pendingRef.current.rejecters.push(reject)
          return
        }

        pendingRef.current = {
          payload,
          resolvers: [resolve],
          rejecters: [reject],
        }
      })

      if (mountedRef.current) {
        setStatus(activeRef.current ? 'saving' : 'idle')
        setError(null)
      }

      void drainQueue()
      return promise
    },
    [drainQueue]
  )

  const resetError = useCallback(() => {
    if (!mountedRef.current) return
    setError(null)
    setStatus((current) => (current === 'error' ? 'idle' : current))
  }, [])

  return {
    status,
    error,
    lastSavedAt,
    isSaving: status === 'saving',
    enqueue,
    resetError,
  }
}
