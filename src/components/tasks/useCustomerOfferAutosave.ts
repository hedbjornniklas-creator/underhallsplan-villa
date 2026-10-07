'use client'

import { useEffect, useRef, useState } from 'react'
import { useAutosaveQueue } from '@/hooks/useAutosaveQueue'
import type { CustomerOfferDraft, CustomerOfferWorkspace } from '@/lib/action-cases/customerOffers'
import type { CustomerOfferCosting } from '@/lib/action-cases/customerOfferCosting'

export type CustomerOfferSaveSnapshot = { draft: CustomerOfferDraft; costing: CustomerOfferCosting }
type SaveState = {
  snapshot: CustomerOfferSaveSnapshot
  status: 'pending' | 'saving' | 'saved' | 'error'
}

// The editor stays mounted across project sections, so its existing queue can finish in the background.
export function useCustomerOfferAutosave({ initialRevision, save, onSaved, onError }: {
  initialRevision: number
  save: (snapshot: CustomerOfferSaveSnapshot, revision: number) => Promise<CustomerOfferWorkspace>
  onSaved: (result: CustomerOfferWorkspace, snapshot: CustomerOfferSaveSnapshot) => void
  onError: (error: unknown) => void
}) {
  const revision = useRef(initialRevision)
  const entry = useRef<SaveState | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const pendingPromise = useRef<Promise<unknown> | null>(null)
  const mounted = useRef(true)
  const [state, setState] = useState<SaveState | null>(null)
  const publish = () => { if (mounted.current) setState(entry.current ? { ...entry.current } : null) }
  const queue = useAutosaveQueue<true, void>({
    save: async () => {
      const submitted = entry.current
      if (submitted?.status !== 'pending') return
      clearTimeout(timer.current)
      entry.current = { ...submitted, status: 'saving' }; publish()
      try {
        const result = await save(submitted.snapshot, revision.current)
        if (!Number.isSafeInteger(result.revision) || result.revision !== revision.current + 1)
          throw new Error('Sparningen kunde inte bekräftas. Dina ändringar är kvar.')
        // Acknowledge every request before the shared queue starts the next one.
        revision.current = result.revision
        if (mounted.current) onSaved(result, submitted.snapshot)
        const current = entry.current!
        entry.current = { ...current, status: JSON.stringify(current.snapshot) === JSON.stringify(submitted.snapshot) ? 'saved' : 'pending' }
      } catch (error) {
        entry.current = { ...entry.current!, status: 'error' }
        if (mounted.current) onError(error)
      }
      publish()
    },
  })
  const enqueueRef = useRef(queue.enqueue)
  enqueueRef.current = queue.enqueue
  const start = () => {
    pendingPromise.current = enqueueRef.current(true)
    return pendingPromise.current
  }
  async function flush() {
    clearTimeout(timer.current)
    while (mounted.current && (entry.current?.status === 'pending' || entry.current?.status === 'saving')) {
      if (entry.current.status === 'pending') await start()
      else await pendingPromise.current
      clearTimeout(timer.current)
    }
    return mounted.current && entry.current?.status !== 'error'
  }
  const flushRef = useRef(flush)
  flushRef.current = flush
  const change = (snapshot: CustomerOfferSaveSnapshot) => {
    const failed = entry.current?.status === 'error'
    entry.current = { snapshot, status: failed ? 'error' : 'pending' }; publish()
    clearTimeout(timer.current)
    if (!failed) timer.current = setTimeout(() => { void flushRef.current() }, 700)
  }
  const retry = () => {
    if (entry.current?.status === 'error') { entry.current = { ...entry.current, status: 'pending' }; publish() }
    return flush()
  }
  const reset = (savedRevision: number) => {
    clearTimeout(timer.current)
    revision.current = savedRevision
    entry.current = null; publish()
  }
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; clearTimeout(timer.current) }
  }, [])
  return {
    state, change, flush, retry, reset,
    isSaving: state?.status === 'pending' || state?.status === 'saving',
    isPending: () => entry.current?.status === 'pending' || entry.current?.status === 'saving',
  }
}
