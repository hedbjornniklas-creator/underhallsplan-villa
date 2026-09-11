'use client'

import { useEffect, useEffectEvent, useRef, type RefObject } from 'react'
import { createRoundBackHistory } from '@/lib/ob/roundBackHistory'

export function useObRoundBack({ inspectionId, ready, canGoBack, root, onBack }: {
  inspectionId: string
  ready: boolean
  canGoBack: boolean
  root: RefObject<HTMLDivElement | null>
  onBack: () => void
}) {
  const current = useRef<{
    inspectionId: string
    history: ReturnType<typeof createRoundBackHistory>
    disposal?: ReturnType<typeof setTimeout>
  } | null>(null)
  const closeTop = useEffectEvent(() => {
    const dialogs = root.current?.querySelectorAll<HTMLDialogElement>('dialog[open]')
    const dialog = dialogs?.[dialogs.length - 1]
    if (dialog) {
      // Use the same guarded close path as the arrow/Escape, including autosave.
      dialog.dispatchEvent(new Event('cancel', { cancelable: true }))
    } else onBack()
  })

  useEffect(() => {
    if (!ready) return
    let entry = current.current
    if (!entry || entry.inspectionId !== inspectionId) {
      entry = { inspectionId, history: createRoundBackHistory(inspectionId, () => closeTop()) }
      current.current = entry
    }
    if (entry.disposal) clearTimeout(entry.disposal)
    const active = entry
    return () => {
      // Strict Mode's immediate effect remount reuses the same boundary.
      active.disposal = setTimeout(() => {
        active.history.dispose()
        if (current.current === active) current.current = null
      }, 0)
    }
  }, [inspectionId, ready])

  useEffect(() => {
    if (ready) current.current?.history.sync(canGoBack)
  }, [inspectionId, ready, canGoBack])
}
