'use client'

import { useCallback, useMemo, type ReactNode } from 'react'
import { AppToastProvider, useToast } from '@/components/ui/AppToastProvider'

/**
 * Compatibility wrapper for existing EB screens. AppToastProvider is
 * idempotent, so this does not create a second queue when the global provider
 * is already present.
 */
export function EbToastProvider({ children }: { children: ReactNode }) {
  return <AppToastProvider>{children}</AppToastProvider>
}

export function useEbToast() {
  const toast = useToast()
  const showError = useCallback(
    (error: unknown, fallback?: string) => {
      toast.error(error, fallback)
    },
    [toast]
  )

  const showSuccess = useCallback(
    (message: unknown, options?: Parameters<typeof toast.success>[1]) => {
      toast.success(message, options)
    },
    [toast]
  )

  const showWarning = useCallback(
    (message: unknown, options?: Parameters<typeof toast.warning>[1]) => {
      toast.warning(message, options)
    },
    [toast]
  )

  return useMemo(
    () => ({ showError, showSuccess, showWarning }),
    [showError, showSuccess, showWarning]
  )
}
