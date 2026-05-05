'use client'

import { useEffect, useRef, useState } from 'react'
import type { TextareaHTMLAttributes } from 'react'

type DebouncedTextareaProps = Omit<
  TextareaHTMLAttributes<HTMLTextAreaElement>,
  'onChange' | 'value'
> & {
  value: string
  debounceMs?: number
  onValueChange?: (value: string) => void
  onSave: (value: string) => void | Promise<void>
}

export default function DebouncedTextarea({
  value,
  debounceMs = 700,
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
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const draftRef = useRef(value)

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  const clearTimer = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }

  const commit = (nextValue: string) => {
    clearTimer()
    if (disabled || readOnly || nextValue === value) return
    void onSave(nextValue)
  }

  const scheduleSave = (nextValue: string) => {
    clearTimer()
    if (disabled || readOnly || nextValue === value) return
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      void onSave(nextValue)
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
        commit(draftRef.current)
        onBlur?.(event)
      }}
      onFocus={event => {
        setIsFocused(true)
        setIsDirty(false)
        setDraft(value)
        draftRef.current = value
        props.onFocus?.(event)
      }}
      onChange={event => {
        const nextValue = event.target.value
        draftRef.current = nextValue
        setIsDirty(true)
        setDraft(nextValue)
        onValueChange?.(nextValue)
        scheduleSave(nextValue)
      }}
    />
  )
}
