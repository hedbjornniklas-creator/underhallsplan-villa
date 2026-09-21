'use client'

import { useCallback, useEffect, useRef, useState, type SetStateAction } from 'react'

// Parent refreshes may update clean fields, never a locally edited field.
// Only the matching save acknowledges an edit (including server normalization).
export function useObFormDraft<T extends Record<string, string>>(identity: string, incoming: T) {
  const state = useRef({ identity, values: incoming, dirty: new Set<keyof T>() })
  const [values, render] = useState(incoming)
  useEffect(() => {
    const current = state.current
    if (current.identity !== identity) {
      state.current = { identity, values: incoming, dirty: new Set() }
      render(incoming)
      return
    }
    const next = { ...current.values }
    let changed = false
    for (const key of Object.keys(incoming) as (keyof T)[]) {
      if (!current.dirty.has(key) && next[key] !== incoming[key]) {
        next[key] = incoming[key]
        changed = true
      }
    }
    if (changed) { current.values = next; render(next) }
  }, [identity, incoming])

  const setValues = useCallback((update: SetStateAction<T>) => {
    const current = state.current
    const next = typeof update === 'function' ? update(current.values) : update
    for (const key of Object.keys(next) as (keyof T)[]) {
      if (next[key] !== current.values[key]) current.dirty.add(key)
    }
    current.values = next
    render(next)
  }, [])

  const acknowledge = useCallback((sent: Partial<T>, saved: Partial<T> = sent) => {
    const current = state.current
    if (current.identity !== identity) return
    const next = { ...current.values }
    for (const key of Object.keys(sent) as (keyof T)[]) {
      if (!Object.hasOwn(current.values, key)) continue
      if (next[key] === sent[key] && saved[key] !== undefined) {
        next[key] = saved[key] as T[keyof T]
        current.dirty.delete(key)
      }
    }
    current.values = next
    render(next)
  }, [identity])
  return [values, setValues, acknowledge] as const
}
