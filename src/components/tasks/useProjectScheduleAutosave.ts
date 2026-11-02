'use client'

import { useEffect, useRef, useState } from 'react'
import { useAutosaveQueue } from '@/hooks/useAutosaveQueue'
import type { ProjectSchedule, ProjectScheduleRow } from '@/lib/action-cases/projectSchedule'

type Entry = { rows: ProjectScheduleRow[]; status: 'pending' | 'saving' | 'saved' | 'invalid' | 'error'; valid: boolean; inFlight?: boolean }

export function useProjectScheduleAutosave({ save, onSaved, onError }: {
  save: (rows: ProjectScheduleRow[], revision: number) => Promise<ProjectSchedule>
  onSaved: (result: ProjectSchedule, submitted: ProjectScheduleRow[]) => void
  onError: (error: unknown) => void
}) {
  const revision = useRef(0), entry = useRef<Entry | null>(null), mounted = useRef(true)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const pending = useRef<Promise<unknown> | null>(null)
  const [state, setState] = useState<Entry | null>(null)
  const publish = () => { if (mounted.current) setState(entry.current ? { ...entry.current } : null) }
  const queue = useAutosaveQueue<true, void>({ save: async () => {
    const submitted = entry.current
    if (!mounted.current || submitted?.status !== 'pending' || !submitted.valid) return
    clearTimeout(timer.current)
    entry.current = { ...submitted, status: 'saving', inFlight: true }; publish()
    try {
      const result = await save(submitted.rows, revision.current)
      if (result.revision !== revision.current + 1) throw new Error('Sparningen kunde inte bekräftas. Dina ändringar är kvar.')
      revision.current = result.revision
      if (mounted.current) onSaved(result, submitted.rows)
      const current = entry.current!
      entry.current = { ...current, inFlight: false, status: !current.valid ? 'invalid' : JSON.stringify(current.rows) === JSON.stringify(submitted.rows) ? 'saved' : 'pending' }
    } catch (error) {
      entry.current = { ...entry.current!, inFlight: false, status: 'error' }
      if (mounted.current) onError(error)
    }
    publish()
  } })
  const enqueue = useRef(queue.enqueue); enqueue.current = queue.enqueue
  async function flush() {
    clearTimeout(timer.current)
    while (mounted.current && (entry.current?.inFlight || entry.current?.status === 'pending' || entry.current?.status === 'saving')) {
      if (entry.current.status === 'pending') pending.current = enqueue.current(true)
      await pending.current
      clearTimeout(timer.current)
    }
    return mounted.current && (!entry.current || entry.current.status === 'saved')
  }
  const flushRef = useRef(flush); flushRef.current = flush
  function change(rows: ProjectScheduleRow[], valid: boolean) {
    const failed = entry.current?.status === 'error'
    entry.current = { rows, valid, inFlight: entry.current?.inFlight, status: failed ? 'error' : valid ? 'pending' : 'invalid' }; publish()
    clearTimeout(timer.current)
    if (!failed && valid) timer.current = setTimeout(() => { void flushRef.current() }, 700)
  }
  function reset(nextRevision: number) { clearTimeout(timer.current); revision.current = nextRevision; entry.current = null; publish() }
  function retry() {
    if (entry.current?.status === 'error') { entry.current = { ...entry.current, status: entry.current.valid ? 'pending' : 'invalid' }; publish() }
    return flush()
  }
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; clearTimeout(timer.current) }
  }, [])
  return { state, change, flush, retry, reset, getRevision: () => revision.current,
    isPending: () => Boolean(entry.current && entry.current.status !== 'saved'),
    isSaving: state?.inFlight || state?.status === 'pending' || state?.status === 'saving' }
}
