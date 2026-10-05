'use client'

import { useEffect, useRef, useState } from 'react'
import { useAutosaveQueue } from '@/hooks/useAutosaveQueue'
import { scopeDraftFingerprint, type ActionScopeDraft, type ActionScopeSaveResult } from '@/lib/action-cases/scopeDraft'

export type ScopeSaveState = {
  draft: ActionScopeDraft
  expectedUpdatedAt: string
  status: 'pending' | 'saving' | 'saved' | 'error'
  error?: string
}

// Owned by the project workspace, not the drawer: closing a drawer keeps its saves alive.
export function useActionScopeAutosave({ onSaved, onError }: {
  onSaved: (result: ActionScopeSaveResult) => void
  onError: (message: string) => void
}) {
  const entries = useRef<Record<string, ScopeSaveState>>({})
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const [states, setStates] = useState<Record<string, ScopeSaveState>>({})
  const publish = () => setStates({ ...entries.current })
  const queue = useAutosaveQueue<Record<string, true>, void>({
    mergePayload: (previous, next) => ({ ...previous, ...next }),
    save: async (ids) => {
      for (const id of Object.keys(ids)) {
        const submitted = entries.current[id]
        if (!submitted || submitted.status !== 'pending' || !submitted.draft.title.trim()) continue
        clearTimeout(timers.current.get(id)); timers.current.delete(id)
        entries.current[id] = { ...submitted, status: 'saving' }; publish()
        try {
          const response = await fetch('/api/action-cases', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'save_item_scope', payload: { itemId: id, expectedUpdatedAt: submitted.expectedUpdatedAt, ...submitted.draft } }),
          })
          const result = await response.json()
          if (!response.ok) throw new Error(result.error || 'Kunde inte spara omfattningen.')
          if (result.item?.id !== id || !result.item?.updatedAt) throw new Error('Kunde inte bekräfta sparningen.')
          onSaved(result)
          const current = entries.current[id]
          entries.current[id] = {
            ...current, expectedUpdatedAt: result.item.updatedAt,
            status: scopeDraftFingerprint(current.draft) === scopeDraftFingerprint(submitted.draft) ? 'saved' : 'pending',
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Kunde inte spara omfattningen.'
          entries.current[id] = { ...entries.current[id], status: 'error', error: message }
          onError(message)
        }
        publish()
      }
    },
  })
  const enqueueRef = useRef(queue.enqueue)
  enqueueRef.current = queue.enqueue
  const flush = (id: string) => {
    clearTimeout(timers.current.get(id)); timers.current.delete(id)
    if (entries.current[id]?.status === 'pending') void enqueueRef.current({ [id]: true }).catch(() => undefined)
  }
  const change = (id: string, expectedUpdatedAt: string, draft: ActionScopeDraft) => {
    const previous = entries.current[id]
    entries.current[id] = { draft, expectedUpdatedAt: previous?.expectedUpdatedAt ?? expectedUpdatedAt, status: 'pending' }
    publish()
    clearTimeout(timers.current.get(id))
    timers.current.set(id, setTimeout(() => flush(id), 700))
  }
  const retry = (id: string) => {
    const current = entries.current[id]
    if (!current || current.status !== 'error') return
    entries.current[id] = { ...current, status: 'pending', error: undefined }; publish(); flush(id)
  }
  const forgetSaved = () => {
    for (const [id, state] of Object.entries(entries.current)) if (state.status === 'saved') delete entries.current[id]
    publish()
  }
  useEffect(() => {
    const pendingTimers = timers.current
    return () => { pendingTimers.forEach(clearTimeout); pendingTimers.clear() }
  }, [])
  const hasUnsaved = Object.values(states).some((state) => state.status !== 'saved')
  const isSaving = Object.values(states).some((state) => state.status === 'pending' || state.status === 'saving')
  return { states, change, flush, retry, forgetSaved, hasUnsaved, isSaving }
}
