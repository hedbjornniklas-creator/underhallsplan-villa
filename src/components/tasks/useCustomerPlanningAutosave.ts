'use client'

import { useEffect, useRef, useState } from 'react'
import { useAutosaveQueue } from '@/hooks/useAutosaveQueue'
import type { CustomerPlanning, CustomerChoiceCategory, CustomerChoiceFileRef, CustomerPlannedItem } from '@/lib/action-cases/customerPlanning'
import type { CustomerChoiceCosting } from '@/lib/action-cases/customerChoiceCosting'

export type CustomerPlanningSnapshot = { items: CustomerPlannedItem[]; categories: CustomerChoiceCategory[]; costing: CustomerChoiceCosting; optionFiles: CustomerChoiceFileRef[] }
type SaveEntry = { snapshot: CustomerPlanningSnapshot; status: 'pending' | 'saving' | 'saved' | 'error' }

// Independent queue: never invoke the offer/contract autosave or publication APIs.
export function useCustomerPlanningAutosave({ initialRevision, save, onSaved, onError }: {
  initialRevision: number
  save: (snapshot: CustomerPlanningSnapshot, revision: number) => Promise<CustomerPlanning>
  onSaved: (result: CustomerPlanning, snapshot: CustomerPlanningSnapshot) => void
  onError: (error: unknown) => void
}) {
  const revision = useRef(initialRevision), entry = useRef<SaveEntry | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const pending = useRef<Promise<unknown> | null>(null), mounted = useRef(true)
  const [state, setState] = useState<SaveEntry | null>(null)
  const publish = () => { if (mounted.current) setState(entry.current ? { ...entry.current } : null) }
  const queue = useAutosaveQueue<true, void>({ save: async () => {
    const submitted = entry.current
    if (submitted?.status !== 'pending') return
    clearTimeout(timer.current)
    entry.current = { ...submitted, status: 'saving' }; publish()
    try {
      const result = await save(submitted.snapshot, revision.current)
      if (!Number.isSafeInteger(result.revision) || result.revision !== revision.current + 1) throw new Error('Sparningen kunde inte bekräftas. Dina ändringar är kvar.')
      revision.current = result.revision
      if (mounted.current) onSaved(result, submitted.snapshot)
      const current = entry.current!
      entry.current = { ...current, status: JSON.stringify(current.snapshot) === JSON.stringify(submitted.snapshot) ? 'saved' : 'pending' }
    } catch (error) {
      entry.current = { ...entry.current!, status: 'error' }
      if (mounted.current) onError(error)
    }
    publish()
  } })
  const enqueue = useRef(queue.enqueue); enqueue.current = queue.enqueue
  async function flush() {
    clearTimeout(timer.current)
    while (mounted.current && (entry.current?.status === 'pending' || entry.current?.status === 'saving')) {
      if (entry.current.status === 'pending') pending.current = enqueue.current(true)
      await pending.current
      clearTimeout(timer.current)
    }
    return mounted.current && entry.current?.status !== 'error'
  }
  const flushRef = useRef(flush); flushRef.current = flush
  const change = (snapshot: CustomerPlanningSnapshot) => {
    const failed = entry.current?.status === 'error'
    entry.current = { snapshot, status: failed ? 'error' : 'pending' }; publish()
    clearTimeout(timer.current)
    if (!failed) timer.current = setTimeout(() => { void flushRef.current() }, 700)
  }
  const retry = () => {
    if (entry.current?.status === 'error') { entry.current = { ...entry.current, status: 'pending' }; publish() }
    return flush()
  }
  const reset = (savedRevision: number) => { clearTimeout(timer.current); revision.current = savedRevision; entry.current = null; publish() }
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; clearTimeout(timer.current) }
  }, [])
  return { state, change, flush, retry, reset, getRevision: () => revision.current,
    isPending: () => entry.current?.status === 'pending' || entry.current?.status === 'saving' }
}
