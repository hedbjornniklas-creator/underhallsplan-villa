'use client'

import { FormEvent, useEffect, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, KeyRound, LoaderCircle } from 'lucide-react'
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
    return 'Återställningslänken har gått ut. Begär en ny länk från inloggningssidan.'
  }

  if (
    normalized.includes('both auth code and code verifier should be non-empty') ||
    normalized.includes('invalid request')
  ) {
    return 'Återställningslänken är ogiltig. Begär en ny länk från inloggningssidan.'
  }

  if (normalized.includes('access_denied')) {
    return 'Återställningslänken är ogiltig eller har gått ut.'
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
          setError('Återställningssession saknas. Begär en ny länk från inloggningssidan.')
          setLinkInvalid(true)
        } else {
          setError(null)
          setLinkInvalid(false)
        }
      } catch (initError) {
        const rawMessage =
          initError instanceof Error ? initError.message : 'Kunde inte verifiera återställningslänken.'
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
      setError(`Lösenordet måste vara minst ${MIN_PASSWORD_LENGTH} tecken.`)
      return
    }

    if (newPassword !== confirmPassword) {
      setError('Lösenorden matchar inte.')
      return
    }

    try {
      setSaving(true)
      setError(null)

      const {
        data: { session },
      } = await supabase.auth.getSession()

      if (!session) {
        throw new Error('Återställningssession saknas. Öppna återställningslänken igen.')
      }

      const { error: updateError } = await supabase.auth.updateUser({
        password: newPassword,
      })

      if (updateError) throw updateError

      await supabase.auth.signOut()
      router.replace('/login?reset=success')
    } catch (submitError) {
      const rawMessage =
        submitError instanceof Error ? submitError.message : 'Kunde inte uppdatera lösenordet.'
      setError(toFriendlyRecoveryError(rawMessage))
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <ResetPasswordShell>
        <div className="flex items-center gap-3 rounded-2xl border border-blue-100 bg-blue-50 p-4 text-blue-950">
          <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden="true" />
          <p className="text-sm font-medium">Verifierar återställningslänken …</p>
        </div>
      </ResetPasswordShell>
    )
  }

  return (
    <ResetPasswordShell>
      <div className="mb-7 flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-100 text-blue-800">
        <KeyRound size={22} aria-hidden="true" />
      </div>
      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-blue-800">HusHub-konto</p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight text-stone-950">Sätt nytt lösenord</h1>
      <p className="mt-3 text-sm leading-7 text-stone-600">
        Välj ett nytt lösenord med minst {MIN_PASSWORD_LENGTH} tecken. När det är sparat får du
        logga in på nytt.
      </p>

      {error ? (
        <p
          role="alert"
          className="mt-6 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm leading-6 text-rose-800"
        >
          {error}
        </p>
      ) : null}

      {linkInvalid ? (
        <Link
          href="/login"
          className="mt-7 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-stone-950 px-5 text-sm font-semibold text-white transition hover:bg-stone-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2"
        >
          <ArrowLeft size={16} aria-hidden="true" />
          Till inloggningen
        </Link>
      ) : (
        <form onSubmit={handleSubmit} className="mt-7 space-y-5">
          <div>
            <label htmlFor="newPassword" className="mb-2 block text-sm font-semibold text-stone-800">
              Nytt lösenord
            </label>
            <input
              id="newPassword"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              minLength={MIN_PASSWORD_LENGTH}
              required
              className="h-12 w-full rounded-2xl border border-stone-300 bg-white px-4 text-sm text-stone-950 outline-none transition placeholder:text-stone-400 focus:border-blue-700 focus:ring-2 focus:ring-blue-700/20"
            />
          </div>

          <div>
            <label htmlFor="confirmPassword" className="mb-2 block text-sm font-semibold text-stone-800">
              Bekräfta nytt lösenord
            </label>
            <input
              id="confirmPassword"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              minLength={MIN_PASSWORD_LENGTH}
              required
              className="h-12 w-full rounded-2xl border border-stone-300 bg-white px-4 text-sm text-stone-950 outline-none transition placeholder:text-stone-400 focus:border-blue-700 focus:ring-2 focus:ring-blue-700/20"
            />
          </div>

          <button
            type="submit"
            disabled={saving}
            className="inline-flex min-h-12 w-full items-center justify-center rounded-2xl bg-blue-800 px-5 text-sm font-semibold text-white transition hover:bg-blue-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-60"
          >
            {saving ? 'Sparar …' : 'Spara nytt lösenord'}
          </button>
        </form>
      )}
    </ResetPasswordShell>
  )
}

function ResetPasswordShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="relative flex min-h-dvh items-center overflow-hidden bg-[#f3f1ec] px-5 py-12 text-stone-950">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_16%_18%,rgba(59,130,246,0.15),transparent_30%),radial-gradient(circle_at_85%_82%,rgba(16,185,129,0.09),transparent_26%)]"
      />
      <div className="relative mx-auto w-full max-w-md">
        <Link
          href="/"
          className="mb-7 inline-flex items-center gap-3 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-700 focus-visible:ring-offset-4 focus-visible:ring-offset-[#f3f1ec]"
          aria-label="Till HusHubs startsida"
        >
          <Image
            src="/landing/Hushub-check2.png"
            alt=""
            width={38}
            height={38}
            className="h-9 w-9 object-contain"
            priority
          />
          <span className="text-xs font-semibold uppercase tracking-[0.32em] text-stone-900">HusHub</span>
        </Link>
        <section className="rounded-[30px] border border-stone-200/80 bg-white/90 p-6 shadow-[0_28px_80px_-42px_rgba(30,41,59,0.45)] backdrop-blur-sm sm:p-8">
          {children}
        </section>
      </div>
    </main>
  )
}
