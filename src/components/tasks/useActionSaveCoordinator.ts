'use client'
import { useCallback, useRef } from 'react'

// Scope and calculation share the item's version. Only our own acknowledged writes may rebase it.
export function useActionSaveCoordinator() {
  const tail = useRef<Promise<void>>(Promise.resolve())
  return useCallback(<T,>(work: () => Promise<T>): Promise<T> => {
    const next = tail.current.then(work)
    tail.current = next.then(() => undefined, () => undefined)
    return next
  }, [])
}
