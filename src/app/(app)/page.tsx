'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'

function hasRecoveryContext() {
  const search = new URLSearchParams(window.location.search)
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))

  return (
    search.get('type') === 'recovery' ||
    hash.get('type') === 'recovery' ||
    search.has('code') ||
    hash.has('access_token')
  )
}

export default function HomePage() {
  const router = useRouter()

  useEffect(() => {
    if (!hasRecoveryContext()) return

    const query = window.location.search ?? ''
    const hash = window.location.hash ?? ''
    router.replace(`/auth/reset-password${query}${hash}`)
  }, [router])

  const handleLogin = async () => {
    const { data } = await supabase.auth.getSession()
    router.push(data.session ? '/dashboard-v1' : '/login')
  }

  return (
    <main className="min-h-screen bg-slate-100 text-slate-900">
      <div className="mx-auto flex min-h-screen max-w-3xl flex-col items-center justify-center px-6 text-center">
        <h1 className="text-5xl font-semibold tracking-tight sm:text-6xl">Hushub</h1>
        <p className="mt-5 text-xl text-slate-600 sm:text-2xl">{'V\u00E4lkommen.'}</p>
        <button
          type="button"
          onClick={() => void handleLogin()}
          className="mt-10 inline-flex h-12 items-center justify-center rounded-lg bg-slate-900 px-8 text-base font-medium text-white transition hover:bg-slate-700"
        >
          Logga in
        </button>
      </div>
    </main>
  )
}
