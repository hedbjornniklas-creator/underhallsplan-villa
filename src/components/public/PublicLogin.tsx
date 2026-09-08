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
  const destinationLabel = labels[destination] ?? 'RenoApp'
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
        <h1>Logga in till {destinationLabel}</h1>
        <p className="public-auth-intro">{destination === '/app' ? 'Använd kontot du fått via ditt företag eller din förening.' : `Efter inloggningen öppnas ${destinationLabel}.`}</p>
        {resetSuccess ? <div className="public-notice public-notice-success" role="status">Lösenordet är uppdaterat. Logga in med ditt nya lösenord.</div> : null}
        <PasswordAuthPanel redirectTo={authRedirectTo} />
        <div className="public-auth-help">
          <h2>Har du inget konto?</h2>
          {(destination === '/dashboard-v1' || destination === '/app') && <p>Vill du börja använda BesiktApp? <Link href="/besiktapp/intresse">Anmäl intresse</Link> så går vi igenom hur du kan få tillgång. Ange gärna företagets namn om ni redan använder tjänsten.</p>}
          {(destination === '/renoapp/app' || destination === '/app') && <p>För tillgång till styrelsens RenoApp, be den som administrerar föreningen om en inbjudan.</p>}
          {destination === '/mina-uppdrag' && <p>Kontakta den som skickade uppdraget om du saknar uppgifter för att logga in.</p>}
          {destination !== '/dashboard-v1' && <p>Ska du renovera din lägenhet? <Link href="/renoapp/apply">Gå till ansökan utan att logga in.</Link></p>}
        </div>
      </section>
    </PublicFrame>
  )
}
