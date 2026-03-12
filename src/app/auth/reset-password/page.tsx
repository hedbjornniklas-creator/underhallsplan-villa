'use client'

import { FormEvent, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import type { AuthChangeEvent, Session } from '@supabase/supabase-js'

const MIN_PASSWORD_LENGTH = 8

function readRecoveryParam(key: string) {
  if (typeof window === 'undefined') return ''
  const search = new URLSearchParams(window.location.search)
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  return search.get(key) ?? hash.get(key) ?? ''
}

function toFriendlyRecoveryError(message: string) {
  const normalized = message.toLowerCase()

  if (normalized.includes('otp_expired') || normalized.includes('has expired')) {
    return 'Aterstallningslanken har gatt ut. Begar en ny lank fran inloggningssidan.'
  }

  if (
    normalized.includes('both auth code and code verifier should be non-empty') ||
    normalized.includes('invalid request')
  ) {
    return 'Aterstallningslanken ar ogiltig. Begar en ny lank fran inloggningssidan.'
  }

  if (normalized.includes('access_denied')) {
    return 'Aterstallningslanken ar ogiltig eller har gatt ut.'
  }

  return message
}

export default function ResetPasswordPage() {
  const router = useRouter()

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [linkInvalid, setLinkInvalid] = useState(false)
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  useEffect(() => {
    let active = true

    const initialize = async () => {
      try {
        const queryErrorCode = readRecoveryParam('error_code')
        const queryErrorDescription = readRecoveryParam('error_description')
        const queryError = readRecoveryParam('error')

        if (queryErrorCode || queryErrorDescription || queryError) {
          const reason = toFriendlyRecoveryError(
            [queryErrorCode, queryErrorDescription, queryError].filter(Boolean).join(' ')
          )
          if (active) {
            setError(reason)
            setLinkInvalid(true)
          }
          return
        }

        const code = readRecoveryParam('code').trim()
        if (code.length > 0) {
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)
          if (exchangeError) throw exchangeError
        }

        const tokenHash = readRecoveryParam('token_hash').trim()
        const type = readRecoveryParam('type').trim()
        if (tokenHash.length > 0 && type === 'recovery') {
          const { error: verifyError } = await supabase.auth.verifyOtp({
            type: 'recovery',
            token_hash: tokenHash,
          })
          if (verifyError) throw verifyError
        }

        const accessToken = readRecoveryParam('access_token').trim()
        const refreshToken = readRecoveryParam('refresh_token').trim()
        if (accessToken.length > 0 && refreshToken.length > 0) {
          const { error: sessionError } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          })
          if (sessionError) throw sessionError
        }

        const {
          data: { session },
        } = await supabase.auth.getSession()

        if (!active) return

        if (!session) {
          setError('Aterstallningssession saknas. Begar en ny lank fran inloggningssidan.')
          setLinkInvalid(true)
        } else {
          setError(null)
          setLinkInvalid(false)
        }
      } catch (initError) {
        const rawMessage =
          initError instanceof Error ? initError.message : 'Kunde inte verifiera aterstallningslanken.'
        const message = toFriendlyRecoveryError(rawMessage)
        if (active) {
          setError(message)
          setLinkInvalid(true)
        }
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
          setLinkInvalid(false)
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

    if (linkInvalid) return

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
      const rawMessage =
        submitError instanceof Error ? submitError.message : 'Kunde inte uppdatera losenordet.'
      setError(toFriendlyRecoveryError(rawMessage))
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen bg-slate-100 px-4 py-12 text-slate-900">
        <div className="mx-auto max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          Verifierar aterstallningslank...
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-12 text-slate-900">
      <div className="mx-auto max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h1 className="mb-4 text-2xl font-semibold">{'S\u00E4tt nytt l\u00F6senord'}</h1>

        {error ? (
          <p className="mb-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {error}
          </p>
        ) : null}

        {linkInvalid ? (
          <button
            type="button"
            onClick={() => router.replace('/login')}
            className="inline-flex h-11 w-full items-center justify-center rounded-lg bg-slate-900 px-4 text-sm font-medium text-white transition hover:bg-slate-700"
          >
            Till inloggning
          </button>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="newPassword" className="mb-1 block text-sm font-medium text-slate-700">
                {'Nytt l\u00F6senord'}
              </label>
              <input
                id="newPassword"
                type="password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                minLength={MIN_PASSWORD_LENGTH}
                required
                className="h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm outline-none ring-blue-500 transition focus:ring-2"
              />
            </div>

            <div>
              <label htmlFor="confirmPassword" className="mb-1 block text-sm font-medium text-slate-700">
                {'Bekr\u00E4fta nytt l\u00F6senord'}
              </label>
              <input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                minLength={MIN_PASSWORD_LENGTH}
                required
                className="h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm outline-none ring-blue-500 transition focus:ring-2"
              />
            </div>

            <button
              type="submit"
              disabled={saving}
              className="inline-flex h-11 w-full items-center justify-center rounded-lg bg-slate-900 px-4 text-sm font-medium text-white transition hover:bg-slate-700 disabled:opacity-60"
            >
              {saving ? 'Sparar...' : 'Uppdatera losenord'}
            </button>
          </form>
        )}
      </div>
    </main>
  )
}
