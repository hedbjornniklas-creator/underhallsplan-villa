'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { EMPTY_RECIPIENT_DRAFT, readRecipientDraft, recipientDraftKey, writeRecipientDraft, type TaskRecipientDraft } from '@/lib/tasks/recipientDraft'

export default function useTaskRecipientDraft(scope: string | undefined) {
  const key = scope ? recipientDraftKey(scope) : null
  const [state, setState] = useState({ key, draft: { ...EMPTY_RECIPIENT_DRAFT } })
  const [storageAvailable, setStorageAvailable] = useState(Boolean(key))
  const current = useRef(state)
  useEffect(() => {
    let draft = { ...EMPTY_RECIPIENT_DRAFT }, available = Boolean(key)
    try { if (key) draft = readRecipientDraft(window.sessionStorage, key) } catch { available = false }
    current.current = { key, draft }
    setState(current.current)
    setStorageAvailable(available)
  }, [key])

  const update = useCallback((field: keyof TaskRecipientDraft, value: string) => {
    const previous = current.current.key === key ? current.current.draft : EMPTY_RECIPIENT_DRAFT
    const draft = { ...previous, [field]: value }
    current.current = { key, draft }
    setState(current.current)
    try {
      if (key) writeRecipientDraft(window.sessionStorage, key, draft)
      setStorageAvailable(Boolean(key))
    } catch { setStorageAvailable(false) }
  }, [key])
  const draft = state.key === key ? state.draft : EMPTY_RECIPIENT_DRAFT
  const hasDraft = Boolean(draft.comment || draft.evidenceText)
  useEffect(() => {
    if (!hasDraft) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [hasDraft])
  return { ...draft, hasDraft, storageAvailable,
    setComment: (value: string) => update('comment', value),
    setEvidenceText: (value: string) => update('evidenceText', value) }
}
