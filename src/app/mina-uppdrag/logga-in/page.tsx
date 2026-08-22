'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useEffect, useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowLeft, CheckCircle2, KeyRound, ListChecks, LoaderCircle, Mail } from 'lucide-react'
import { supabase } from '@/lib/supabaseClient'
import {
  RECIPIENT_PORTAL_HOME,
  safeRecipientReturnTo,
} from '@/lib/tasks/recipientAuthPaths'

const MIN_PASSWORD_LENGTH = 8

type View = 'login' | 'forgot' | 'recovery'

function readAuthParam(key: string) {
  if (typeof window === 'undefined') return ''
  const search = new URLSearchParams(window.location.search)
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  return search.get(key) ?? hash.get(key) ?? ''
}

function requestedReturnTo() {
  if (typeof window === 'undefined') return RECIPIENT_PORTAL_HOME
  return safeRecipientReturnTo(new URLSearchParams(window.location.search).get('next'))
}

function hasRecoveryContext() {
  return (
    readAuthParam('type') === 'recovery' ||
    Boolean(readAuthParam('code')) ||
    Boolean(readAuthParam('access_token')) ||
    Boolean(readAuthParam('token_hash')) ||
    Boolean(readAuthParam('error'))
  )
}

function friendlyAuthError(error: unknown, fallback: string) {
  const raw = error instanceof Error ? error.message : ''
  const normalized = raw.toLocaleLowerCase('sv-SE')

  if (normalized.includes('invalid login credentials')) {
    return 'E-postadressen eller lösenordet är fel.'
  }
  if (normalized.includes('email not confirmed')) {
    return 'E-postadressen är ännu inte verifierad. Öppna den senaste länken från HusHub.'
  }
  if (normalized.includes('expired') || normalized.includes('otp_expired')) {
    return 'Länken har gått ut. Begär en ny återställningslänk.'
  }
  return raw || fallback
}

export default function RecipientLoginPage() {
  const router = useRouter()
  const [view, setView] = useState<View>('login')
  const [initializing, setInitializing] = useState(true)
  const [busy, setBusy] = useState(false)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    let active = true

    const initialize = async () => {
      try {
        if (hasRecoveryContext()) {
          const errorDescription = readAuthParam('error_description') || readAuthParam('error')
          if (errorDescription) throw new Error(errorDescription)

          const code = readAuthParam('code').trim()
          if (code) {
            const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)
            if (exchangeError) throw exchangeError
          }

          const tokenHash = readAuthParam('token_hash').trim()
          if (tokenHash && readAuthParam('type') === 'recovery') {
            const { error: verifyError } = await supabase.auth.verifyOtp({
              type: 'recovery',
              token_hash: tokenHash,
            })
            if (verifyError) throw verifyError
          }

          const accessToken = readAuthParam('access_token').trim()
          const refreshToken = readAuthParam('refresh_token').trim()
          if (accessToken && refreshToken) {
            const { error: sessionError } = await supabase.auth.setSession({
              access_token: accessToken,
              refresh_token: refreshToken,
            })
            if (sessionError) throw sessionError
          }

          const { data } = await supabase.auth.getSession()
          if (!data.session) throw new Error('Återställningssession saknas.')
          if (active) setView('recovery')
          return
        }

        const search = new URLSearchParams(window.location.search)
        if (search.get('reset') === 'success' && active) {
          setNotice('Lösenordet är uppdaterat. Du kan nu logga in.')
        }

        const { data } = await supabase.auth.getSession()
        if (data.session && active) {
          router.replace(requestedReturnTo())
        }
      } catch (initializationError) {
        if (active) {
          setView('forgot')
          setError(friendlyAuthError(initializationError, 'Kunde inte verifiera återställningslänken.'))
        }
      } finally {
        if (active) setInitializing(false)
      }
    }

    void initialize()
    return () => {
      active = false
    }
  }, [router])

  const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    setNotice(null)

    try {
      const normalizedEmail = email.trim().toLocaleLowerCase('sv-SE')
      if (!normalizedEmail || !password) throw new Error('Ange e-post och lösenord.')

      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password,
      })
      if (signInError) throw signInError
      router.replace(requestedReturnTo())
      router.refresh()
    } catch (loginError) {
      setError(friendlyAuthError(loginError, 'Kunde inte logga in.'))
    } finally {
      setBusy(false)
    }
  }

  const handleForgotPassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setBusy(true)
    setError(null)
    setNotice(null)

    try {
      const response = await fetch('/api/mina-uppdrag/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, next: requestedReturnTo() }),
      })
      const result = (await response.json().catch(() => ({}))) as { error?: string }
      if (!response.ok) throw new Error(result.error ?? 'Kunde inte skicka återställningslänken.')
      setNotice('Om adressen har ett konto skickas nu en återställningslänk via e-post.')
    } catch (resetError) {
      setError(friendlyAuthError(resetError, 'Kunde inte skicka återställningslänken.'))
    } finally {
      setBusy(false)
    }
  }

  const handleNewPassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    setNotice(null)

    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setError(`Lösenordet måste vara minst ${MIN_PASSWORD_LENGTH} tecken.`)
      return
    }
    if (newPassword !== confirmPassword) {
      setError('Lösenorden matchar inte.')
      return
    }

    setBusy(true)
    try {
      const { data } = await supabase.auth.getSession()
      if (!data.session) throw new Error('Återställningssession saknas. Begär en ny länk.')
      const { error: updateError } = await supabase.auth.updateUser({ password: newPassword })
      if (updateError) throw updateError
      router.replace(requestedReturnTo())
      router.refresh()
    } catch (updateError) {
      setError(friendlyAuthError(updateError, 'Kunde inte spara det nya lösenordet.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="relative min-h-dvh overflow-hidden bg-[#f5f3ee] text-stone-950">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_12%_15%,rgba(245,158,11,0.16),transparent_30%),radial-gradient(circle_at_88%_85%,rgba(59,130,246,0.1),transparent_28%)]"
      />

      <div className="relative mx-auto grid min-h-dvh w-full max-w-[1400px] lg:grid-cols-[1.05fr_0.95fr]">
        <section className="flex flex-col justify-between px-6 py-8 sm:px-10 lg:px-16 lg:py-12">
          <Link href="/" className="flex w-fit items-center gap-3" aria-label="Till HusHubs startsida">
            <Image
              src="/landing/Hushub-check2.png"
              alt=""
              width={40}
              height={40}
              className="h-9 w-9 object-contain"
              priority
            />
            <span className="text-xs font-semibold uppercase tracking-[0.32em] text-stone-900">HusHub</span>
          </Link>

          <div className="py-14 lg:py-10">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-100 text-amber-800">
              <ListChecks size={24} aria-hidden="true" />
            </div>
            <p className="mt-7 text-xs font-semibold uppercase tracking-[0.24em] text-amber-800">Mina uppdrag</p>
            <h1 className="mt-5 max-w-[12ch] text-4xl font-semibold tracking-[-0.04em] sm:text-5xl lg:text-6xl">
              Allt du ansvarar för på ett ställe.
            </h1>
            <p className="mt-6 max-w-xl text-base leading-8 text-stone-700 sm:text-lg">
              Öppna nya uppdrag, lämna underlag och se vad som väntar på dig utan att leta efter gamla mejl.
            </p>
          </div>

          <p className="text-xs leading-6 text-stone-500">Mina uppdrag är en del av HusHub.</p>
        </section>

        <section className="flex items-center border-t border-stone-200/80 bg-white/80 px-6 py-12 backdrop-blur-sm sm:px-10 lg:border-l lg:border-t-0 lg:px-16">
          <div className="mx-auto w-full max-w-md">
            {initializing ? (
              <div className="flex items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-950">
                <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden="true" />
                <p className="text-sm font-medium">Förbereder inloggningen …</p>
              </div>
            ) : (
              <>
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-amber-800">
                  {view === 'recovery' ? 'Nytt lösenord' : view === 'forgot' ? 'Återställ lösenord' : 'Inloggning'}
                </p>
                <h2 className="mt-3 text-3xl font-semibold tracking-tight">
                  {view === 'recovery'
                    ? 'Välj ett nytt lösenord'
                    : view === 'forgot'
                      ? 'Få en återställningslänk'
                      : 'Logga in till Mina uppdrag'}
                </h2>
                <p className="mt-3 text-sm leading-7 text-stone-600">
                  {view === 'recovery'
                    ? `Lösenordet ska vara minst ${MIN_PASSWORD_LENGTH} tecken.`
                    : view === 'forgot'
                      ? 'Ange e-postadressen som är kopplad till ditt mottagarkonto.'
                      : 'Använd e-postadressen och lösenordet som du valde när kontot aktiverades.'}
                </p>

                {notice ? (
                  <div className="mt-6 flex gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-900">
                    <CheckCircle2 className="mt-0.5 shrink-0" size={19} aria-hidden="true" />
                    <p className="text-sm leading-6">{notice}</p>
                  </div>
                ) : null}

                {error ? (
                  <p role="alert" className="mt-6 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm leading-6 text-rose-800">
                    {error}
                  </p>
                ) : null}

                {view === 'login' ? (
                  <form onSubmit={handleLogin} className="mt-7 space-y-5">
                    <AuthInput
                      id="recipient-email"
                      label="E-post"
                      type="email"
                      autoComplete="email"
                      value={email}
                      onChange={setEmail}
                    />
                    <AuthInput
                      id="recipient-password"
                      label="Lösenord"
                      type="password"
                      autoComplete="current-password"
                      value={password}
                      onChange={setPassword}
                    />
                    <PrimaryButton busy={busy} idleLabel="Logga in" busyLabel="Loggar in …" />
                    <button
                      type="button"
                      onClick={() => {
                        setView('forgot')
                        setError(null)
                        setNotice(null)
                      }}
                      className="text-sm font-semibold text-amber-800 transition hover:text-amber-950"
                    >
                      Glömt lösenordet?
                    </button>
                  </form>
                ) : view === 'forgot' ? (
                  <form onSubmit={handleForgotPassword} className="mt-7 space-y-5">
                    <AuthInput
                      id="reset-email"
                      label="E-post"
                      type="email"
                      autoComplete="email"
                      value={email}
                      onChange={setEmail}
                    />
                    <PrimaryButton busy={busy} idleLabel="Skicka återställningslänk" busyLabel="Skickar …" />
                    <button
                      type="button"
                      onClick={() => {
                        setView('login')
                        setError(null)
                        setNotice(null)
                      }}
                      className="inline-flex items-center gap-2 text-sm font-semibold text-stone-600 transition hover:text-stone-950"
                    >
                      <ArrowLeft size={16} aria-hidden="true" />
                      Tillbaka till inloggningen
                    </button>
                  </form>
                ) : (
                  <form onSubmit={handleNewPassword} className="mt-7 space-y-5">
                    <AuthInput
                      id="new-password"
                      label="Nytt lösenord"
                      type="password"
                      autoComplete="new-password"
                      value={newPassword}
                      onChange={setNewPassword}
                    />
                    <AuthInput
                      id="confirm-password"
                      label="Bekräfta nytt lösenord"
                      type="password"
                      autoComplete="new-password"
                      value={confirmPassword}
                      onChange={setConfirmPassword}
                    />
                    <PrimaryButton busy={busy} idleLabel="Spara och fortsätt" busyLabel="Sparar …" />
                  </form>
                )}

                <div className="mt-8 border-t border-stone-200 pt-6">
                  <p className="flex gap-3 text-sm leading-6 text-stone-600">
                    <Mail className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" aria-hidden="true" />
                    Första gången aktiverar du kontot via den personliga länken i meddelandet från HusHub.
                  </p>
                </div>
              </>
            )}
          </div>
        </section>
      </div>
    </main>
  )
}

function AuthInput(props: {
  id: string
  label: string
  type: 'email' | 'password'
  autoComplete: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <label htmlFor={props.id} className="block">
      <span className="mb-2 block text-sm font-semibold text-stone-800">{props.label}</span>
      <input
        id={props.id}
        type={props.type}
        autoComplete={props.autoComplete}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        required
        className="h-12 w-full rounded-2xl border border-stone-300 bg-white px-4 text-sm text-stone-950 outline-none transition placeholder:text-stone-400 focus:border-amber-700 focus:ring-2 focus:ring-amber-700/20"
      />
    </label>
  )
}

function PrimaryButton(props: { busy: boolean; idleLabel: string; busyLabel: string }) {
  return (
    <button
      type="submit"
      disabled={props.busy}
      className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-amber-700 px-5 text-sm font-semibold text-white transition hover:bg-amber-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-700 focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-60"
    >
      {props.busy ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : <KeyRound size={17} aria-hidden="true" />}
      {props.busy ? props.busyLabel : props.idleLabel}
    </button>
  )
}
