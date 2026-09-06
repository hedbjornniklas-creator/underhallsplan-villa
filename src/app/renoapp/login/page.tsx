'use client'

import { useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { AuthChangeEvent, Session } from '@supabase/supabase-js'
import PublicFrame from '@/components/public/PublicFrame'
import { supabase } from '@/lib/supabaseClient'
import PasswordAuthPanel from '@/components/auth/PasswordAuthPanel'
import { getRenoAppReturnPath } from '@/lib/renoapp/brfLifecycle'

function isRecoveryContext() {
  if (typeof window === 'undefined') return false

  const search = new URLSearchParams(window.location.search)
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))

  return (
    search.get('type') === 'recovery' ||
    hash.get('type') === 'recovery' ||
    search.has('code') ||
    hash.has('access_token')
  )
}

function getSafeReturnPath() {
  if (typeof window === 'undefined') return '/renoapp/app'

  const value = new URLSearchParams(window.location.search).get('next')
  return getRenoAppReturnPath(value)
}

export default function RenoAppLoginPage() {
  const router = useRouter()
  const authRedirectTo =
    typeof window === 'undefined' ? undefined : `${window.location.origin}/auth/reset-password`

  useEffect(() => {
    if (isRecoveryContext()) {
      const query = window.location.search ?? ''
      const hash = window.location.hash ?? ''
      router.replace(`/auth/reset-password${query}${hash}`)
      return
    }

    supabase.auth.getSession().then(({ data }: { data: { session: Session | null } }) => {
      if (data.session) router.replace(getSafeReturnPath())
    })

    const { data } = supabase.auth.onAuthStateChange((event: AuthChangeEvent, session: Session | null) => {
      if (event === 'PASSWORD_RECOVERY') {
        router.replace('/auth/reset-password')
        return
      }

      if (session) {
        router.replace(getSafeReturnPath())
      }
    })

    return () => data.subscription.unsubscribe()
  }, [router])

  return (
    <PublicFrame activeProduct="renoapp">
      <section className="public-auth">
        <span className="public-eyebrow">RenoApp · För styrelsen</span>
        <h1>Logga in till RenoApp</h1>
        <p className="public-auth-intro">Använd kontot du fått via din förening.</p>
        <PasswordAuthPanel redirectTo={authRedirectTo} accent="emerald" />
        <div className="public-auth-help">
          <h2>Saknar du tillgång?</h2>
          <p>Be den som administrerar föreningen i RenoApp att bjuda in dig. Vill er förening börja använda tjänsten? <Link href="/renoapp/request-access">Anmäl föreningens intresse.</Link></p>
          <p>Vill du renovera din lägenhet? <Link href="/renoapp/apply">Gå till ansökan utan att logga in.</Link></p>
        </div>
      </section>
    </PublicFrame>
  )
}
