'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import type { AuthChangeEvent, Session } from '@supabase/supabase-js'
import { Auth } from '@supabase/auth-ui-react'
import { ThemeSupa } from '@supabase/auth-ui-shared'

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

export default function LoginPage() {
  const router = useRouter()

  const [resetSuccess, setResetSuccess] = useState(false)
  const [authRedirectTo, setAuthRedirectTo] = useState<string | undefined>(undefined)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    setResetSuccess(params.get('reset') === 'success')
    setAuthRedirectTo(`${window.location.origin}/auth/reset-password`)

    if (isRecoveryContext()) {
      const query = window.location.search ?? ''
      const hash = window.location.hash ?? ''
      router.replace(`/auth/reset-password${query}${hash}`)
      return
    }

    supabase.auth.getSession().then(({ data }: { data: { session: Session | null } }) => {
      if (data.session) router.replace('/app')
    })

    const { data } = supabase.auth.onAuthStateChange((event: AuthChangeEvent, session: Session | null) => {
      if (event === 'PASSWORD_RECOVERY') {
        router.replace('/auth/reset-password')
        return
      }
      if (session) router.replace('/app')
    })

    return () => data.subscription.unsubscribe()
  }, [router])

  return (
    <div style={{ maxWidth: 420, margin: '60px auto' }}>
      <h1 style={{ marginBottom: 16 }}>Logga in</h1>

      {resetSuccess ? (
        <p style={{ marginBottom: 12, color: '#065f46', background: '#ecfdf5', padding: 10, borderRadius: 8 }}>
          {'L\u00F6senordet \u00E4r uppdaterat. Logga in med ditt nya l\u00F6senord.'}
        </p>
      ) : null}

      <Auth
        supabaseClient={supabase}
        appearance={{ theme: ThemeSupa }}
        providers={[]}
        redirectTo={authRedirectTo}
      />
    </div>
  )
}
