'use client'

import { useEffect, useRef, useState } from 'react'
import type { TextareaHTMLAttributes } from 'react'
import { getObTextDraftStorageKey } from '@/lib/ob/localTextDrafts'

type DebouncedTextareaProps = Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  'onChange' | 'value'
> & {
  value: string
  debounceMs?: number
  draftKey?: string
  onValueChange?: (value: string) => void
  onSave: (value: string) => void | Promise<void>
}

const readStoredDraft = (draftKey?: string) => {
  const storageKey = getObTextDraftStorageKey(draftKey)
  if (!storageKey || typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(storageKey)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { value?: unknown }
    return typeof parsed.value === 'string' ? parsed.value : null
  } catch {
    return null
  }
}

const writeStoredDraft = (draftKey: string | undefined, value: string) => {
  const storageKey = getObTextDraftStorageKey(draftKey)
  if (!storageKey || typeof window === 'undefined') return
  try {
    window.localStorage.setItem(
      storageKey,
      JSON.stringify({ value, updatedAt: new Date().toISOString() })
    )
  } catch {
    // local draft storage is best-effort; server save still handles the source of truth.
  }
}

const clearStoredDraft = (draftKey?: string) => {
  const storageKey = getObTextDraftStorageKey(draftKey)
  if (!storageKey || typeof window === 'undefined') return
  try {
    window.localStorage.removeItem(storageKey)
  } catch {
    // best-effort cleanup
  }
}

export default function DebouncedTextarea({
  value,
  debounceMs = 700,
  draftKey,
  disabled,
  readOnly,
  onValueChange,
  onSave,
  onBlur,
  ...props
}: DebouncedTextareaProps) {
  const [draft, setDraft] = useState(value)
  const [isFocused, setIsFocused] = useState(false)
  const [isDirty, setIsDirty] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const draftRef = useRef(value)
  const isDirtyRef = useRef(false)
  const draftVersionRef = useRef(0)
  const inFlightDraftVersionsRef = useRef(new Set<number>())
  const saveVersionRef = useRef(0)
  const latestValueRef = useRef(value)

  const markDirty = (next: boolean) => {
    isDirtyRef.current = next
    setIsDirty(next)
  }

  useEffect(() => {
    latestValueRef.current = value
    if (!isFocused && !isDirty) {
      setDraft(value)
      draftRef.current = value
    }
  }, [isDirty, isFocused, value])

  useEffect(() => {
    const storedDraft = readStoredDraft(draftKey)
    if (storedDraft === null || storedDraft === value) {
      if (storedDraft === value && !isDirty && !isSaving) {
        clearStoredDraft(draftKey)
      }
      return
    }
    draftRef.current = storedDraft
    setDraft(storedDraft)
    markDirty(true)
    onValueChange?.(storedDraft)
  }, [draftKey, isDirty, isSaving, onValueChange, value])

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
      if (draftKey && draftRef.current !== latestValueRef.current) {
        writeStoredDraft(draftKey, draftRef.current)
      }
    }
  }, [draftKey])

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!draftKey || (!isDirty && !isSaving)) return

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => window.removeEventListener('beforeunload', handleBeforeUnload)
  }, [draftKey, isDirty, isSaving])

  const clearTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  const saveNow = async (
    nextValue: string,
    draftVersion = draftVersionRef.current
  ) => {
    clearTimer()
    if (disabled || readOnly) return
    if (!isDirtyRef.current && nextValue === latestValueRef.current) {
      clearStoredDraft(draftKey)
      markDirty(false)
      return
    }
    if (inFlightDraftVersionsRef.current.has(draftVersion)) return

    writeStoredDraft(draftKey, nextValue)
    inFlightDraftVersionsRef.current.add(draftVersion)
    const version = saveVersionRef.current + 1
    saveVersionRef.current = version
    setIsSaving(true)

    try {
      await onSave(nextValue)
      if (saveVersionRef.current !== version || draftRef.current !== nextValue) return
      clearStoredDraft(draftKey)
      markDirty(false)
    } catch {
      writeStoredDraft(draftKey, nextValue)
      markDirty(true)
    } finally {
      inFlightDraftVersionsRef.current.delete(draftVersion)
      if (saveVersionRef.current === version) setIsSaving(false)
    }
  }

  const scheduleSave = (nextValue: string) => {
    clearTimer()
    if (disabled || readOnly) return
    if (!isDirtyRef.current && nextValue === latestValueRef.current) return
    const draftVersion = draftVersionRef.current
    writeStoredDraft(draftKey, nextValue)
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      void saveNow(nextValue, draftVersion)
    }, debounceMs)
  }

  return (
    <textarea
      {...props}
      value={isFocused || isDirty ? draft : value}
      disabled={disabled}
      readOnly={readOnly}
      onBlur={event => {
        setIsFocused(false)
        void saveNow(draftRef.current)
        onBlur?.(event)
      }}
      onFocus={event => {
        setIsFocused(true)
        const storedDraft = readStoredDraft(draftKey)
        const nextDraft = storedDraft ?? value
        markDirty(storedDraft !== null && storedDraft !== value)
        setDraft(nextDraft)
        draftRef.current = nextDraft
        props.onFocus?.(event)
      }}
      onChange={event => {
        const nextValue = event.target.value
        draftVersionRef.current += 1
        draftRef.current = nextValue
        markDirty(true)
        setDraft(nextValue)
        onValueChange?.(nextValue)
        writeStoredDraft(draftKey, nextValue)
        scheduleSave(nextValue)
      }}
    />
  )
}
