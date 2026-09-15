'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'

export function useComponentCatalogueAccess() {
  const [access, setAccess] = useState({ canEdit: false, loading: true, failed: false })

  useEffect(() => {
    let active = true
    let revision = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    const refresh = () => {
      const current = ++revision
      setAccess({ canEdit: false, loading: true, failed: false })
      // Defer work outside the Supabase auth callback to avoid its session lock.
      clearTimeout(timer)
      timer = setTimeout(async () => {
        try {
          const { data, error } = await supabase.rpc('is_hushub_besiktapp_admin')
          if (active && current === revision) {
            setAccess({ canEdit: !error && data === true, loading: false, failed: Boolean(error) })
          }
        } catch {
          if (active && current === revision) setAccess({ canEdit: false, loading: false, failed: true })
        }
      }, 0)
    }
    refresh()
    const { data: listener } = supabase.auth.onAuthStateChange(refresh)
    window.addEventListener('focus', refresh)
    return () => {
      active = false
      clearTimeout(timer)
      listener.subscription.unsubscribe()
      window.removeEventListener('focus', refresh)
    }
  }, [])

  // Presentation only. PostgreSQL enforces the same predicate on every mutation.
  return access
}
