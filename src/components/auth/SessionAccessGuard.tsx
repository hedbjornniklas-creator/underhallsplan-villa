'use client'

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { AuthChangeEvent, Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabaseClient'
import DashboardAccessRecovery from './DashboardAccessRecovery'

const SessionBoundary = createContext(false)

export default function SessionAccessGuard(props: { children: ReactNode; productLabel?: string }) {
  const covered = useContext(SessionBoundary)
  return covered ? props.children : <SessionAccessBoundary {...props} />
}

function SessionAccessBoundary({ children, productLabel }: { children: ReactNode; productLabel?: string }) {
  const [state, setState] = useState<'checking' | 'ready' | 'unavailable'>('checking')

  useEffect(() => {
    let active = true
    let revision = 0
    let identity: string | undefined
    let needsReload = false
    const accept = (session: Session | null, failed = false) => {
      if (!active) return
      const userId = session?.user.id
      if (failed || !userId || (identity && identity !== userId)) needsReload = true
      // Once signed out (or changed account), never re-show the old server
      // snapshot. Retry/login must load fresh authorized children first.
      if (needsReload) setState('unavailable')
      else {
        identity = userId
        setState('ready')
      }
    }
    const check = async () => {
      const current = ++revision
      try {
        const { data, error } = await supabase.auth.getSession()
        if (active && current === revision) accept(data.session, Boolean(error))
      } catch {
        if (active && current === revision) accept(null, true)
      }
    }
    void check()
    const { data } = supabase.auth.onAuthStateChange((_event: AuthChangeEvent, session: Session | null) => {
      ++revision
      accept(session)
    })
    const visible = () => { if (document.visibilityState === 'visible') void check() }
    const restored = (event: PageTransitionEvent) => { if (event.persisted) void check() }
    window.addEventListener('pageshow', restored)
    document.addEventListener('visibilitychange', visible)
    return () => {
      active = false
      ++revision
      data.subscription.unsubscribe()
      window.removeEventListener('pageshow', restored)
      document.removeEventListener('visibilitychange', visible)
    }
  }, [])

  if (state === 'checking') return <div className="flex min-h-[50vh] items-center justify-center p-6 text-sm text-slate-600" role="status">Kontrollerar inloggningen…</div>
  if (state === 'unavailable') return <DashboardAccessRecovery reason="unavailable" productLabel={productLabel} embedded />
  return <SessionBoundary.Provider value={true}>{children}</SessionBoundary.Provider>
}
