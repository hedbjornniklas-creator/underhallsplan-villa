'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { AuthChangeEvent, Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabaseClient'
import PasswordAuthPanel from '@/components/auth/PasswordAuthPanel'
import PublicFrame from './PublicFrame'
import type { getPublicLoginDestination } from '@/lib/publicNavigation'

type Destination = ReturnType<typeof getPublicLoginDestination>
const labels: Record<Destination, string> = {
  '/app': 'HusHub',
  '/dashboard-v1': 'BesiktApp',
  '/renoapp/app': 'RenoApp',
  '/mina-uppdrag': 'Mina uppdrag',
}

export default function PublicLogin({ destination, resetSuccess }: { destination: Destination; resetSuccess: boolean }) {
  const router = useRouter()
  const authRedirectTo = typeof window === 'undefined' ? undefined : `${window.location.origin}/auth/reset-password`

  useEffect(() => {
    let active = true
    const search = new URLSearchParams(window.location.search)
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
    if (search.get('type') === 'recovery' || hash.get('type') === 'recovery' || search.has('code') || hash.has('access_token')) {
      router.replace(`/auth/reset-password${window.location.search}${window.location.hash}`)
      return
    }
    supabase.auth.getSession().then(({ data }: { data: { session: Session | null } }) => {
      if (active && data.session) router.replace(destination)
    })
    const { data } = supabase.auth.onAuthStateChange((event: AuthChangeEvent, session: Session | null) => {
      if (event === 'PASSWORD_RECOVERY') {
        router.replace('/auth/reset-password')
        return
      }
      if (session) router.replace(destination)
    })
    return () => {
      active = false
      data.subscription.unsubscribe()
    }
  }, [router, destination])

  return (
    <PublicFrame activeProduct={destination === '/dashboard-v1' ? 'besiktapp' : destination === '/renoapp/app' ? 'renoapp' : undefined}>
      <section className="public-auth">
        <span className="public-eyebrow">{destination === '/dashboard-v1' ? 'För besiktningsföretag' : 'Ditt HusHub-konto'}</span>
        <h1>Logga in till {labels[destination]}</h1>
        <p className="public-auth-intro">{destination === '/app' ? 'Använd kontot du fått via ditt företag eller din förening.' : `Efter inloggningen öppnas ${labels[destination]}.`}</p>
        {resetSuccess ? <div className="public-notice public-notice-success" role="status">Lösenordet är uppdaterat. Logga in med ditt nya lösenord.</div> : null}
        <PasswordAuthPanel redirectTo={authRedirectTo} />
        <div className="public-auth-help">
          <h2>Har du inget konto?</h2>
          <p>Be administratören i ditt företag eller din förening om en inbjudan.</p>
          <p>Ska du renovera din lägenhet? <Link href="/renoapp/apply">Gå till ansökan utan att logga in.</Link></p>
        </div>
      </section>
    </PublicFrame>
  )
}
