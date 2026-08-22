'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useEffect, useState, type FormEvent } from 'react'
import { useParams, useRouter } from 'next/navigation'
import {
  ArrowRight,
  Building2,
  CheckCircle2,
  Clock3,
  KeyRound,
  ListChecks,
  LoaderCircle,
  LogOut,
  Mail,
  ShieldCheck,
} from 'lucide-react'
import { supabase } from '@/lib/supabaseClient'
import { recipientLoginUrl } from '@/lib/tasks/recipientAuthPaths'

const MIN_PASSWORD_LENGTH = 8

type ActivationPreview = {
  recipientIdentityId: string
  email: string
  displayName: string
  status: 'dormant' | 'invited' | 'active' | 'disabled'
  hasAccount: boolean
  expiresAt: string
  task: {
    id: string
    title: string
    organizationName: string
  }
  currentUser: {
    email: string | null
    matchesRecipient: boolean
    emailVerified: boolean
  }
}

type ActivationResult = {
  activated?: boolean
  createdUser?: boolean
  signInEmail?: string
  destination?: string
  loginUrl?: string
  error?: string
}

function formatDateTime(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('sv-SE', { dateStyle: 'long', timeStyle: 'short' })
}

export default function RecipientActivationPage() {
  const router = useRouter()
  const params = useParams<{ token: string }>()
  const token = typeof params?.token === 'string' ? params.token : ''
  const activationPath = token ? `/mina-uppdrag/aktivera/${encodeURIComponent(token)}` : '/mina-uppdrag'

  const [preview, setPreview] = useState<ActivationPreview | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [signingOut, setSigningOut] = useState(false)
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loginUrl, setLoginUrl] = useState<string | null>(null)

  useEffect(() => {
    let active = true

    const load = async () => {
      if (!token) {
        setError('Aktiveringslänken är ogiltig.')
        setLoading(false)
        return
      }

      try {
        const response = await fetch(`/api/mina-uppdrag/activation/${encodeURIComponent(token)}`, {
          cache: 'no-store',
        })
        const result = (await response.json().catch(() => ({}))) as ActivationPreview & { error?: string }
        if (!response.ok) throw new Error(result.error ?? 'Kunde inte läsa aktiveringslänken.')
        if (active) {
          setPreview(result)
          setDisplayName(result.displayName)
          setLoginUrl(null)
        }
      } catch (loadError) {
        if (active) {
          setError(loadError instanceof Error ? loadError.message : 'Kunde inte läsa aktiveringslänken.')
        }
      } finally {
        if (active) setLoading(false)
      }
    }

    void load()
    return () => {
      active = false
    }
  }, [token])

  const handleSignOut = async () => {
    setSigningOut(true)
    try {
      await supabase.auth.signOut()
      window.location.reload()
    } finally {
      setSigningOut(false)
    }
  }

  const handleActivation = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!preview) return

    const createsAccount = !preview.hasAccount && !preview.currentUser.matchesRecipient
    if (createsAccount && password.length < MIN_PASSWORD_LENGTH) {
      setError(`Lösenordet måste vara minst ${MIN_PASSWORD_LENGTH} tecken.`)
      return
    }
    if (createsAccount && password !== confirmPassword) {
      setError('Lösenorden matchar inte.')
      return
    }

    setSubmitting(true)
    setError(null)
    setLoginUrl(null)

    try {
      const response = await fetch(`/api/mina-uppdrag/activation/${encodeURIComponent(token)}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ displayName, password: createsAccount ? password : undefined }),
      })
      const result = (await response.json().catch(() => ({}))) as ActivationResult
      if (!response.ok) {
        if (result.loginUrl) setLoginUrl(result.loginUrl)
        throw new Error(result.error ?? 'Kunde inte aktivera kontot.')
      }
      if (!result.destination) throw new Error('Kontot aktiverades, men målsidan saknas.')

      if (result.createdUser) {
        if (!result.signInEmail) throw new Error('Kontot skapades, men inloggningsadressen saknas.')
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: result.signInEmail,
          password,
        })
        if (signInError) {
          setLoginUrl(recipientLoginUrl(result.destination))
          throw new Error('Kontot är aktiverat. Logga in med lösenordet du nyss valde.')
        }
      }

      router.replace(result.destination)
      router.refresh()
    } catch (activationError) {
      setError(activationError instanceof Error ? activationError.message : 'Kunde inte aktivera kontot.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="relative min-h-dvh overflow-hidden bg-[#f5f3ee] px-5 py-8 text-stone-950 sm:px-8 sm:py-12">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_14%_12%,rgba(245,158,11,0.17),transparent_29%),radial-gradient(circle_at_86%_88%,rgba(59,130,246,0.1),transparent_28%)]"
      />
      <div className="relative mx-auto w-full max-w-3xl">
        <div className="mb-7 flex flex-wrap items-center justify-between gap-4">
          <Link href="/" className="flex items-center gap-3" aria-label="Till HusHubs startsida">
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
          {preview?.currentUser.email ? (
            <button
              type="button"
              onClick={() => void handleSignOut()}
              disabled={signingOut}
              className="inline-flex min-h-11 items-center gap-2 rounded-full border border-stone-300 bg-white/80 px-4 text-sm font-semibold text-stone-700 transition hover:bg-white disabled:opacity-60"
            >
              <LogOut size={16} aria-hidden="true" />
              {signingOut ? 'Loggar ut …' : 'Logga ut'}
            </button>
          ) : null}
        </div>

        <section className="rounded-[32px] border border-stone-200/80 bg-white/92 p-5 shadow-[0_28px_90px_-48px_rgba(41,37,36,0.55)] backdrop-blur-sm sm:p-8">
          {loading ? (
            <div className="flex items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-950">
              <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden="true" />
              <p className="text-sm font-medium">Kontrollerar din personliga länk …</p>
            </div>
          ) : !preview ? (
            <InvalidActivation error={error} />
          ) : (
            <>
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-100 text-amber-800">
                <ListChecks size={24} aria-hidden="true" />
              </div>
              <p className="mt-6 text-xs font-semibold uppercase tracking-[0.22em] text-amber-800">Mina uppdrag</p>
              <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">
                {preview.hasAccount ? 'Koppla uppdraget till ditt konto' : 'Aktivera ditt mottagarkonto'}
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-7 text-stone-600 sm:text-base">
                {preview.hasAccount
                  ? 'Logga in med ditt befintliga HusHub-konto. Därefter hittar du detta och alla andra uppdrag på samma sida.'
                  : 'Välj ett lösenord en gång. Därefter kan du öppna alla dina uppdrag med e-post och lösenord.'}
              </p>

              <div className="mt-7 grid gap-3 sm:grid-cols-2">
                <Summary icon={Building2} label="Från" value={preview.task.organizationName} />
                <Summary icon={Mail} label="Ditt konto" value={preview.email} />
                <Summary icon={CheckCircle2} label="Uppdrag" value={preview.task.title} />
                <Summary icon={Clock3} label="Länken gäller till" value={formatDateTime(preview.expiresAt)} />
              </div>

              {preview.currentUser.email && !preview.currentUser.matchesRecipient ? (
                <div className="mt-7 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm leading-6 text-rose-900">
                  Du är inloggad som <strong>{preview.currentUser.email}</strong>, men uppdraget skickades till{' '}
                  <strong>{preview.email}</strong>. Logga ut och fortsätt med rätt adress.
                </div>
              ) : preview.hasAccount && !preview.currentUser.matchesRecipient ? (
                <div className="mt-7 rounded-2xl border border-amber-200 bg-amber-50 p-5">
                  <p className="text-sm leading-6 text-amber-950">
                    Det finns redan ett HusHub-konto för {preview.email}. Logga in så kopplas uppdraget efter att adressen har verifierats.
                  </p>
                  <Link
                    href={recipientLoginUrl(activationPath)}
                    className="mt-4 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-amber-700 px-5 text-sm font-semibold text-white transition hover:bg-amber-800 sm:w-auto"
                  >
                    Logga in och fortsätt
                    <ArrowRight size={17} aria-hidden="true" />
                  </Link>
                </div>
              ) : (
                <form onSubmit={handleActivation} className="mt-7 space-y-5">
                  <label htmlFor="recipient-name" className="block">
                    <span className="mb-2 block text-sm font-semibold text-stone-800">Ditt namn</span>
                    <input
                      id="recipient-name"
                      type="text"
                      autoComplete="name"
                      value={displayName}
                      onChange={(event) => setDisplayName(event.target.value)}
                      maxLength={160}
                      className="h-12 w-full rounded-2xl border border-stone-300 bg-white px-4 text-sm outline-none transition focus:border-amber-700 focus:ring-2 focus:ring-amber-700/20"
                    />
                  </label>

                  {!preview.hasAccount && !preview.currentUser.matchesRecipient ? (
                    <div className="grid gap-5 sm:grid-cols-2">
                      <PasswordInput
                        id="activation-password"
                        label="Välj lösenord"
                        value={password}
                        onChange={setPassword}
                      />
                      <PasswordInput
                        id="activation-password-confirm"
                        label="Bekräfta lösenord"
                        value={confirmPassword}
                        onChange={setConfirmPassword}
                      />
                    </div>
                  ) : (
                    <div className="flex gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-900">
                      <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
                      <p className="text-sm leading-6">
                        Du är inloggad med rätt verifierade e-postadress. Bekräfta för att lägga uppdraget i Mina uppdrag.
                      </p>
                    </div>
                  )}

                  {error ? (
                    <div role="alert" className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm leading-6 text-rose-800">
                      <p>{error}</p>
                      {loginUrl ? (
                        <Link href={loginUrl} className="mt-3 inline-flex font-semibold underline underline-offset-4">
                          Gå till inloggningen
                        </Link>
                      ) : null}
                    </div>
                  ) : null}

                  <button
                    type="submit"
                    disabled={submitting}
                    className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-amber-700 px-5 text-sm font-semibold text-white transition hover:bg-amber-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-700 focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-60 sm:w-auto"
                  >
                    {submitting ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" /> : <KeyRound size={17} aria-hidden="true" />}
                    {submitting
                      ? 'Aktiverar …'
                      : preview.currentUser.matchesRecipient
                        ? 'Koppla och öppna uppdraget'
                        : 'Skapa konto och öppna uppdraget'}
                  </button>
                </form>
              )}
            </>
          )}
        </section>
      </div>
    </main>
  )
}

function InvalidActivation({ error }: { error: string | null }) {
  return (
    <div>
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-stone-100 text-stone-700">
        <KeyRound size={22} aria-hidden="true" />
      </div>
      <h1 className="mt-6 text-3xl font-semibold tracking-tight">Länken kan inte användas</h1>
      <p className="mt-3 text-sm leading-7 text-stone-600">
        {error ?? 'Aktiveringslänken är ogiltig, redan använd eller har gått ut.'}
      </p>
      <Link
        href="/mina-uppdrag/logga-in"
        className="mt-7 inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-stone-950 px-5 text-sm font-semibold text-white transition hover:bg-stone-800"
      >
        Logga in till Mina uppdrag
        <ArrowRight size={17} aria-hidden="true" />
      </Link>
    </div>
  )
}

function Summary(props: { icon: typeof Building2; label: string; value: string }) {
  const Icon = props.icon
  return (
    <div className="rounded-2xl border border-stone-200 bg-stone-50 p-4">
      <div className="flex items-center gap-2 text-stone-500">
        <Icon size={16} aria-hidden="true" />
        <p className="text-xs font-semibold uppercase tracking-[0.16em]">{props.label}</p>
      </div>
      <p className="mt-2 break-words text-sm font-medium leading-6 text-stone-800">{props.value}</p>
    </div>
  )
}

function PasswordInput(props: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
}) {
  return (
    <label htmlFor={props.id} className="block">
      <span className="mb-2 block text-sm font-semibold text-stone-800">{props.label}</span>
      <input
        id={props.id}
        type="password"
        autoComplete="new-password"
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        minLength={MIN_PASSWORD_LENGTH}
        maxLength={128}
        required
        className="h-12 w-full rounded-2xl border border-stone-300 bg-white px-4 text-sm outline-none transition focus:border-amber-700 focus:ring-2 focus:ring-amber-700/20"
      />
    </label>
  )
}
