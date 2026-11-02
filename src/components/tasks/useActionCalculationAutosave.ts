'use client'

import { useEffect, useRef, useState } from 'react'
import { useAutosaveQueue } from '@/hooks/useAutosaveQueue'
import { calculationData, sameCalculationVersion, type CalculationEdit, type CalculationSaveResult } from '@/lib/action-cases/calculationSave'

export type CalculationEntry = { edit: CalculationEdit; expectedUpdatedAt: string; status: 'pending' | 'saving' | 'saved' | 'invalid' | 'error'; error?: string; valid: boolean; fresh: boolean; inFlight?: boolean }
type Request = { requestId: string; itemId: string; expectedUpdatedAt: string; operation: CalculationEdit['operation']; data: Record<string, unknown> }

export function useActionCalculationAutosave({ caseId, coordinate, onSaved }: {
  caseId?: string; coordinate: <T>(work: () => Promise<T>) => Promise<T>
  onSaved: (result: CalculationSaveResult) => void
}) {
  const entries = useRef<Record<string, CalculationEntry>>({}), requests = useRef(new Map<string, Request>())
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>()), mounted = useRef(true)
  const [states, setStates] = useState<Record<string, CalculationEntry>>({})
  const publish = () => { if (mounted.current) setStates({ ...entries.current }) }
  function rebase(itemId: string, before: string, after: string) {
    for (const entry of Object.values(entries.current)) if (entry.edit.itemId === itemId && sameCalculationVersion(entry.expectedUpdatedAt, before) && entry.status !== 'error') entry.expectedUpdatedAt = after
  }
  const queue = useAutosaveQueue<Record<string, true>, void>({
    mergePayload: (previous, next) => ({ ...previous, ...next }),
    save: async keys => {
      for (const key of Object.keys(keys)) await coordinate(async () => {
        const entry = entries.current[key]
        if (!mounted.current || !entry || entry.status !== 'pending' || (!entry.valid && !requests.current.has(key))) return
        clearTimeout(timers.current.get(key)); timers.current.delete(key)
        let request = requests.current.get(key)
        if (!request) {
          request = { requestId: crypto.randomUUID(), itemId: entry.edit.itemId, expectedUpdatedAt: entry.expectedUpdatedAt, operation: entry.edit.operation,
            data: calculationData(entry.edit, caseId!, entry.expectedUpdatedAt) }
          requests.current.set(key, request)
        }
        const submitted = request
        entries.current[key] = { ...entry, status: 'saving', inFlight: true }; publish()
        try {
          const response = await fetch('/api/action-cases', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(45000),
            body: JSON.stringify({ action: 'save_calculation', payload: { ...submitted, caseId } }) })
          const result = await response.json() as CalculationSaveResult & { error?: string }
          if (!response.ok) throw new Error(result.error || 'Kalkylen kunde inte sparas. Dina ändringar är kvar.')
          if (result.requestId !== submitted.requestId || result.item?.id !== submitted.itemId || !sameCalculationVersion(result.expectedUpdatedAt ?? '', submitted.expectedUpdatedAt) || !sameCalculationVersion(result.updatedAt ?? '', result.item.updatedAt)) throw new Error('Sparningen kunde inte bekräftas. Dina ändringar är kvar.')
          if (mounted.current) onSaved(result)
          requests.current.delete(key)
          rebase(submitted.itemId, submitted.expectedUpdatedAt, result.updatedAt)
          const current = entries.current[key]
          let unchanged = false
          try { unchanged = current.edit.operation === submitted.operation && JSON.stringify(calculationData(current.edit, caseId!, current.expectedUpdatedAt)) === JSON.stringify(submitted.data) } catch { /* Preserve incomplete newer input. */ }
          const edit = submitted.operation === 'line' ? { ...current.edit, data: { ...current.edit.data, create: false } }
            : submitted.operation === 'work_part' && result.partId && current.edit.data.partId == null ? { ...current.edit, data: { ...current.edit.data, partId: result.partId } } : current.edit
          entries.current[key] = { ...current, edit, fresh: false, inFlight: false, expectedUpdatedAt: result.updatedAt, status: unchanged ? 'saved' : current.valid ? 'pending' : 'invalid', error: undefined }
        } catch (error) {
          entries.current[key] = { ...entries.current[key], inFlight: false, status: 'error', error: error instanceof Error ? error.message : 'Kalkylen kunde inte sparas.' }
        }
        publish()
      })
    },
  })
  const enqueue = useRef(queue.enqueue); enqueue.current = queue.enqueue
  async function flushAll() {
    timers.current.forEach(clearTimeout); timers.current.clear()
    while (mounted.current) {
      const pending = Object.entries(entries.current).filter(([, entry]) => entry.inFlight || entry.status === 'pending' || entry.status === 'saving')
      if (!pending.length) return !Object.values(entries.current).some(entry => entry.status === 'invalid' || entry.status === 'error')
      await enqueue.current(Object.fromEntries(pending.map(([key]) => [key, true as const])))
    }
    return false
  }
  const flushRef = useRef(flushAll); flushRef.current = flushAll
  function change(edit: CalculationEdit, expectedUpdatedAt: string, immediate = false) {
    if (!caseId) return
    const previous = entries.current[edit.key]
    let valid = true
    try { calculationData(edit, caseId, expectedUpdatedAt) } catch { valid = false }
    entries.current[edit.key] = { edit, expectedUpdatedAt: previous?.expectedUpdatedAt ?? expectedUpdatedAt, valid,
      fresh: previous?.fresh ?? edit.data.create === true, inFlight: previous?.inFlight, status: previous?.status === 'error' ? 'error' : valid ? 'pending' : 'invalid', error: previous?.error }
    publish(); clearTimeout(timers.current.get(edit.key))
    if (valid && previous?.status !== 'error') {
      if (immediate) void enqueue.current({ [edit.key]: true }).catch(() => undefined)
      else timers.current.set(edit.key, setTimeout(() => { void flushRef.current() }, 700))
    }
  }
  function removeLine(itemId: string, id: string, expectedUpdatedAt: string) {
    const key = `line:${id}`, previous = entries.current[key]
    if (previous?.fresh && !requests.current.has(key)) { clearTimeout(timers.current.get(key)); timers.current.delete(key); delete entries.current[key]; publish(); return }
    change({ key, itemId, operation: 'delete_line', data: { id } }, expectedUpdatedAt, true)
  }
  function retry(key: string) {
    const entry = entries.current[key]
    if (!entry || entry.status !== 'error') return
    entries.current[key] = { ...entry, status: entry.valid || requests.current.has(key) ? 'pending' : 'invalid', error: undefined }; publish()
    void flushRef.current()
  }
  function discardNewPart(key: string) {
    const entry = entries.current[key]
    if (!entry || entry.edit.operation !== 'work_part' || entry.edit.data.partId != null || requests.current.has(key)) return false
    clearTimeout(timers.current.get(key)); timers.current.delete(key); delete entries.current[key]; publish(); return true
  }
  function forgetSaved() { for (const [key, entry] of Object.entries(entries.current)) if (entry.status === 'saved') delete entries.current[key]; publish() }
  function discardItem(itemId: string) {
    if (Object.values(entries.current).some(entry => entry.edit.itemId === itemId && entry.inFlight)) return false
    for (const [key, entry] of Object.entries(entries.current)) if (entry.edit.itemId === itemId) { clearTimeout(timers.current.get(key)); timers.current.delete(key); requests.current.delete(key); delete entries.current[key] }
    publish(); return true
  }
  useEffect(() => { mounted.current = true; const pendingTimers = timers.current; return () => { mounted.current = false; pendingTimers.forEach(clearTimeout); pendingTimers.clear() } }, [])
  return { states, change, removeLine, retry, rebase, forgetSaved, discardItem, discardNewPart, flushAll,
    hasUnsaved: Object.values(states).some(entry => entry.status !== 'saved'),
    isSaving: Object.values(states).some(entry => entry.inFlight || entry.status === 'pending' || entry.status === 'saving') }
}
