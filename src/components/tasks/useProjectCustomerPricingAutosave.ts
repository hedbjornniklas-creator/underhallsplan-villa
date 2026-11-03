'use client'

import { useEffect, useRef, useState } from 'react'
import { useAutosaveQueue } from '@/hooks/useAutosaveQueue'
import { normalizeProjectCustomerPricing, type ProjectCustomerPricing, type ProjectPricingState } from '@/lib/action-cases/projectCustomerPricing'

export type CustomerPricingEntry = {
  terms: ProjectCustomerPricing; revision: number; documentRevisions: ProjectPricingState['documentRevisions']
  status: 'pending' | 'saving' | 'saved' | 'error'; error?: string; inFlight?: boolean
}
type Request = { requestId: string; itemId: string; caseId: string; revision: number; terms: ProjectCustomerPricing; documentRevisions: ProjectPricingState['documentRevisions']; adopt: boolean }
export function useProjectCustomerPricingAutosave<T>({ caseId, coordinate, onSaved }: {
  caseId?: string; coordinate: <R>(work: () => Promise<R>) => Promise<R>; onSaved: (workspace: T) => void
}) {
  const entries = useRef<Record<string, CustomerPricingEntry>>({}), requests = useRef(new Map<string, Request>())
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>()), mounted = useRef(true)
  const [states, setStates] = useState<Record<string, CustomerPricingEntry>>({})
  const publish = () => { if (mounted.current) setStates({ ...entries.current }) }
  const queue = useAutosaveQueue<Record<string, true>, void>({ mergePayload: (a, b) => ({ ...a, ...b }), save: async keys => {
    for (const itemId of Object.keys(keys)) await coordinate(async () => {
      const entry = entries.current[itemId]
      if (!mounted.current || !entry || entry.status !== 'pending' || !caseId) return
      clearTimeout(timers.current.get(itemId)); timers.current.delete(itemId)
      let request: Request
      try { request = requests.current.get(itemId) ?? { requestId: crypto.randomUUID(), caseId, itemId,
        revision: entry.revision, terms: normalizeProjectCustomerPricing(entry.terms), documentRevisions: entry.documentRevisions, adopt: entry.revision === 0 } }
      catch { entries.current[itemId] = { ...entry, status: 'error', error: 'Kontrollera belopp och påslag. Dina ändringar är kvar.' }; publish(); return }
      requests.current.set(itemId, request)
      entries.current[itemId] = { ...entry, status: 'saving', inFlight: true }; publish()
      try {
        const response = await fetch('/api/action-cases', { method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(45000),
          body: JSON.stringify({ action: 'save_project_customer_pricing', payload: request }) })
        const result = await response.json()
        if (!response.ok) throw new Error(result.error || 'Kundpriset kunde inte sparas. Dina ändringar är kvar.')
        if (result.requestId !== request.requestId || result.itemId !== itemId || result.previousRevision !== request.revision || result.revision !== request.revision + 1 ||
          JSON.stringify(normalizeProjectCustomerPricing(result.terms)) !== JSON.stringify(request.terms) || !result.workspace) throw new Error('Sparningen kunde inte bekräftas. Dina ändringar är kvar.')
        const acknowledged = result.workspace.cases?.flatMap((project: { items: { id: string; contractWork?: { customerPricing?: ProjectPricingState } }[] }) => project.items).find((item: { id: string }) => item.id === itemId)?.contractWork?.customerPricing
        if (acknowledged?.revision !== result.revision || JSON.stringify(normalizeProjectCustomerPricing(acknowledged.terms)) !== JSON.stringify(request.terms)) throw new Error('Kundprisvillkoren har ändrats igen. Dina ändringar är kvar; hämta aktuellt underlag.')
        requests.current.delete(itemId)
        if (mounted.current) onSaved(result.workspace as T)
        const current = entries.current[itemId]
        entries.current[itemId] = { ...current, revision: result.revision, inFlight: false, error: undefined,
          status: JSON.stringify(normalizeProjectCustomerPricing(current.terms)) === JSON.stringify(request.terms) ? 'saved' : 'pending' }
      } catch (error) {
        entries.current[itemId] = { ...entries.current[itemId], inFlight: false, status: 'error', error: error instanceof Error ? error.message : 'Kundpriset kunde inte sparas.' }
      }
      publish()
    })
  } })
  const enqueue = useRef(queue.enqueue); enqueue.current = queue.enqueue
  async function flushAll() {
    timers.current.forEach(clearTimeout); timers.current.clear()
    while (mounted.current) {
      const pending = Object.keys(entries.current).filter(key => ['pending', 'saving'].includes(entries.current[key].status))
      if (!pending.length) return !Object.values(entries.current).some(entry => entry.status === 'error')
      await enqueue.current(Object.fromEntries(pending.map(id => [id, true as const])))
    }
    return false
  }
  const flush = useRef(flushAll); flush.current = flushAll
  function change(itemId: string, state: ProjectPricingState, terms: ProjectCustomerPricing, immediate = false) {
    const previous = entries.current[itemId]
    entries.current[itemId] = { terms, revision: previous?.revision ?? state.revision, documentRevisions: previous?.documentRevisions ?? state.documentRevisions,
      status: previous?.status === 'error' ? 'error' : 'pending', error: previous?.error, inFlight: previous?.inFlight }
    publish(); clearTimeout(timers.current.get(itemId))
    if (previous?.status !== 'error') {
      if (immediate) void flush.current()
      else timers.current.set(itemId, setTimeout(() => { void flush.current() }, 700))
    }
  }
  function retry(itemId: string) {
    if (entries.current[itemId]?.status !== 'error') return
    entries.current[itemId] = { ...entries.current[itemId], status: 'pending', error: undefined }; publish(); void flush.current()
  }
  function discard(itemId: string) {
    if (entries.current[itemId]?.inFlight) return false
    clearTimeout(timers.current.get(itemId)); timers.current.delete(itemId); requests.current.delete(itemId); delete entries.current[itemId]; publish(); return true
  }
  function forgetSaved() { for (const [id, entry] of Object.entries(entries.current)) if (entry.status === 'saved') delete entries.current[id]; publish() }
  useEffect(() => { mounted.current = true; const pending = timers.current; return () => { mounted.current = false; pending.forEach(clearTimeout); pending.clear() } }, [])
  return { states, change, retry, discard, forgetSaved, flushAll,
    hasUnsaved: Object.values(states).some(entry => entry.status !== 'saved'),
    isSaving: Object.values(states).some(entry => entry.status === 'pending' || entry.inFlight) }
}
