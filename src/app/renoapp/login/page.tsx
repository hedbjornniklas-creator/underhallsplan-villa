'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import type { AuthChangeEvent, Session } from '@supabase/supabase-js'
import { Auth } from '@supabase/auth-ui-react'
import { ThemeSupa } from '@supabase/auth-ui-shared'
import { supabase } from '@/lib/supabaseClient'

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
      if (data.session) router.replace('/app')
    })

    const { data } = supabase.auth.onAuthStateChange((event: AuthChangeEvent, session: Session | null) => {
      if (event === 'PASSWORD_RECOVERY') {
        router.replace('/auth/reset-password')
        return
      }

      if (session) {
        router.replace('/app')
      }
    })

    return () => data.subscription.unsubscribe()
  }, [router])

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-6xl items-center px-6 py-14 md:px-10">
      <section className="grid w-full gap-8 lg:grid-cols-[1.2fr_0.8fr]">
        <div className="rounded-[32px] border border-stone-200/80 bg-[linear-gradient(145deg,rgba(255,251,245,0.96),rgba(247,242,235,0.9))] p-8 shadow-[0_24px_80px_-42px_rgba(41,37,36,0.5)]">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-stone-500">RenoApp</p>
          <h1 className="mt-4 text-4xl font-semibold tracking-tight text-stone-900">Styrelselogin</h1>
        </div>

        <div className="rounded-[32px] border border-stone-200/80 bg-white/90 p-6 shadow-[0_24px_80px_-42px_rgba(41,37,36,0.5)]">
          <h2 className="text-lg font-semibold text-stone-900">Logga in</h2>
          <div className="mt-5">
            <Auth
              supabaseClient={supabase}
              appearance={{ theme: ThemeSupa }}
              providers={[]}
              redirectTo={authRedirectTo}
              view="sign_in"
            />
          </div>
        </div>
      </section>
    </main>
  )
}
