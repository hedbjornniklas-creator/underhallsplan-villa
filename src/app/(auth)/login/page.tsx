'use client'

import { FormEvent, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import type { AuthChangeEvent, Session } from '@supabase/supabase-js'
import { Auth } from '@supabase/auth-ui-react'
import { ThemeSupa } from '@supabase/auth-ui-shared'

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

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

  const [resetEmail, setResetEmail] = useState('')
  const [resetLoading, setResetLoading] = useState(false)
  const [resetError, setResetError] = useState<string | null>(null)
  const [resetInfo, setResetInfo] = useState<string | null>(null)
  const [resetSuccess, setResetSuccess] = useState(false)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    setResetSuccess(params.get('reset') === 'success')

    if (isRecoveryContext()) {
      const query = window.location.search ?? ''
      const hash = window.location.hash ?? ''
      router.replace(`/auth/reset-password${query}${hash}`)
      return
    }

    supabase.auth.getSession().then(({ data }: { data: { session: Session | null } }) => {
      if (data.session) router.replace('/dashboard-v1')
    })

    const { data } = supabase.auth.onAuthStateChange((event: AuthChangeEvent, session: Session | null) => {
      if (event === 'PASSWORD_RECOVERY') {
        router.replace('/auth/reset-password')
        return
      }
      if (session) router.replace('/dashboard-v1')
    })

    return () => data.subscription.unsubscribe()
  }, [router])

  const handleResetPassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const normalized = resetEmail.trim().toLowerCase()

    if (!EMAIL_REGEX.test(normalized)) {
      setResetError('Ange en giltig e-postadress.')
      setResetInfo(null)
      return
    }

    try {
      setResetLoading(true)
      setResetError(null)
      setResetInfo(null)

      const response = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: normalized }),
      })

      const body = (await response.json().catch(() => ({}))) as { error?: string }
      if (!response.ok) {
        throw new Error(body.error ?? 'Kunde inte skicka aterstallningsmejl.')
      }

      setResetEmail('')
      setResetInfo('Om adressen finns registrerad har ett aterstallningsmejl skickats.')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Kunde inte skicka aterstallningsmejl.'
      setResetError(message)
    } finally {
      setResetLoading(false)
    }
  }

  return (
    <div style={{ maxWidth: 420, margin: '60px auto' }}>
      <h1 style={{ marginBottom: 16 }}>Logga in</h1>

      {resetSuccess ? (
        <p style={{ marginBottom: 12, color: '#065f46', background: '#ecfdf5', padding: 10, borderRadius: 8 }}>
          Losenordet ar uppdaterat. Logga in med ditt nya losenord.
        </p>
      ) : null}

      <Auth supabaseClient={supabase} appearance={{ theme: ThemeSupa }} providers={[]} />

      <form onSubmit={handleResetPassword} style={{ marginTop: 20 }}>
        <label htmlFor="resetEmail" style={{ display: 'block', marginBottom: 8 }}>
          Glomt losenord? Ange e-post
        </label>
        <input
          id="resetEmail"
          type="email"
          value={resetEmail}
          onChange={(event) => setResetEmail(event.target.value)}
          placeholder="namn@hushub.se"
          style={{ width: '100%', marginBottom: 10, padding: 10 }}
        />
        <button type="submit" disabled={resetLoading} style={{ width: '100%', padding: 10 }}>
          {resetLoading ? 'Skickar...' : 'Skicka aterstallningslank'}
        </button>
      </form>

      {resetError ? (
        <p style={{ marginTop: 10, color: '#b91c1c', background: '#fef2f2', padding: 10, borderRadius: 8 }}>
          {resetError}
        </p>
      ) : null}
      {resetInfo ? (
        <p style={{ marginTop: 10, color: '#065f46', background: '#ecfdf5', padding: 10, borderRadius: 8 }}>
          {resetInfo}
        </p>
      ) : null}
    </div>
  )
}
