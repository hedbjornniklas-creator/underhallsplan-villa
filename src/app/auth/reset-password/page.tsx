'use client'

import { FormEvent, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import type { AuthChangeEvent, Session } from '@supabase/supabase-js'

const MIN_PASSWORD_LENGTH = 8

function hasRecoveryContext() {
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

export default function ResetPasswordPage() {
  const router = useRouter()

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  useEffect(() => {
    let active = true

    const initialize = async () => {
      try {
        const url = new URL(window.location.href)
        const code = url.searchParams.get('code')

        if (code) {
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)
          if (exchangeError) throw exchangeError

          url.searchParams.delete('code')
          window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`)
        }

        const {
          data: { session },
        } = await supabase.auth.getSession()

        if (!active) return

        if (session) {
          setError(null)
          return
        }

        if (!hasRecoveryContext()) {
          setError('Ogiltig eller utgangen aterstallningslank.')
        }
      } catch (initError) {
        const message =
          initError instanceof Error ? initError.message : 'Kunde inte verifiera aterstallningslanken.'
        if (active) setError(message)
      } finally {
        if (active) setLoading(false)
      }
    }

    void initialize()

    const { data: listener } = supabase.auth.onAuthStateChange(
      (event: AuthChangeEvent, session: Session | null) => {
        if (!active) return
        if (event === 'PASSWORD_RECOVERY' || (event === 'SIGNED_IN' && session)) {
          setError(null)
          setLoading(false)
        }
      }
    )

    return () => {
      active = false
      listener.subscription.unsubscribe()
    }
  }, [])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setError(`Losenordet maste vara minst ${MIN_PASSWORD_LENGTH} tecken.`)
      return
    }

    if (newPassword !== confirmPassword) {
      setError('Losenorden matchar inte.')
      return
    }

    try {
      setSaving(true)
      setError(null)

      const {
        data: { session },
      } = await supabase.auth.getSession()

      if (!session) {
        throw new Error('Aterstallningssession saknas. Oppna aterstallningslanken igen.')
      }

      const { error: updateError } = await supabase.auth.updateUser({
        password: newPassword,
      })

      if (updateError) throw updateError

      await supabase.auth.signOut()
      router.replace('/login?reset=success')
    } catch (submitError) {
      const message =
        submitError instanceof Error ? submitError.message : 'Kunde inte uppdatera losenordet.'
      setError(message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div style={{ maxWidth: 420, margin: '60px auto' }}>Verifierar aterstallningslank...</div>
  }

  return (
    <div style={{ maxWidth: 420, margin: '60px auto' }}>
      <h1 style={{ marginBottom: 16 }}>Satt nytt losenord</h1>

      {error ? (
        <p style={{ marginBottom: 12, color: '#b91c1c', background: '#fef2f2', padding: 10, borderRadius: 8 }}>
          {error}
        </p>
      ) : null}

      <form onSubmit={handleSubmit}>
        <label htmlFor="newPassword" style={{ display: 'block', marginBottom: 8 }}>
          Nytt losenord
        </label>
        <input
          id="newPassword"
          type="password"
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
          minLength={MIN_PASSWORD_LENGTH}
          required
          style={{ width: '100%', marginBottom: 12, padding: 10 }}
        />

        <label htmlFor="confirmPassword" style={{ display: 'block', marginBottom: 8 }}>
          Bekrafta nytt losenord
        </label>
        <input
          id="confirmPassword"
          type="password"
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          minLength={MIN_PASSWORD_LENGTH}
          required
          style={{ width: '100%', marginBottom: 16, padding: 10 }}
        />

        <button type="submit" disabled={saving} style={{ width: '100%', padding: 10 }}>
          {saving ? 'Sparar...' : 'Uppdatera losenord'}
        </button>
      </form>
    </div>
  )
}

