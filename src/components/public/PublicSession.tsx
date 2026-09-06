'use client'

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { AuthChangeEvent, Session } from '@supabase/supabase-js'
import Link from 'next/link'
import { supabase } from '@/lib/supabaseClient'
import { getPublicProductHref, type PublicProductId } from '@/lib/publicNavigation'

const PublicSessionContext = createContext(false)

export function PublicSessionProvider({ children }: { children: ReactNode }) {
  const [authenticated, setAuthenticated] = useState(false)
  useEffect(() => {
    let active = true
    void supabase.auth.getSession().then(({ data }: { data: { session: Session | null } }) => {
      if (active) setAuthenticated(Boolean(data.session))
    }).catch(() => { if (active) setAuthenticated(false) })
    const { data } = supabase.auth.onAuthStateChange((_event: AuthChangeEvent, session: Session | null) => {
      if (active) setAuthenticated(Boolean(session))
    })
    return () => { active = false; data.subscription.unsubscribe() }
  }, [])
  return <PublicSessionContext.Provider value={authenticated}>{children}</PublicSessionContext.Provider>
}

export function usePublicSession() { return useContext(PublicSessionContext) }

export function PublicProductLink({ product, children, className, ariaLabel }: {
  product: PublicProductId; children: ReactNode; className?: string; ariaLabel?: string
}) {
  const authenticated = usePublicSession()
  return <Link href={getPublicProductHref(product, authenticated)} prefetch={false} className={className} aria-label={ariaLabel}>{children}</Link>
}
