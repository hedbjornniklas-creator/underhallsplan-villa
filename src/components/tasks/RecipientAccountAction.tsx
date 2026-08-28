'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { CheckCircle2, KeyRound, Loader2, Mail, ShieldCheck, X } from 'lucide-react'
import ActionButton from '@/components/ui/ActionButton'
import { supabase } from '@/lib/supabaseClient'
import type { ExternalTaskWorkspace } from '@/lib/tasks/external'
import { safeRecipientReturnTo } from '@/lib/tasks/recipientAuthPaths'

type RecipientAccountActionState = ExternalTaskWorkspace['recipientAccount']
type FirstLoginStep = 'idle' | 'request' | 'code' | 'password' | 'account_created'

type FirstLoginApiResult = {
  status?: 'ready' | 'code_sent' | 'code_verified' | 'account_created'
  phase?: 'none' | 'code' | 'password'
  emailHint?: string
  expiresInSeconds?: number
  maxAttempts?: number
  resendAfterSeconds?: number | null
  signInEmail?: string
  destination?: string
  error?: string
  code?: string
  retryAfterSeconds?: number
  attemptsRemaining?: number
  loginUrl?: string
}

function firstLoginErrorMessage(result: FirstLoginApiResult, fallback: string) {
  if (result.code === 'CODE_INVALID') {
    return typeof result.attemptsRemaining === 'number'
      ? `Koden stämmer inte. Du har ${Math.max(0, result.attemptsRemaining)} försök kvar.`
      : 'Koden stämmer inte. Kontrollera koden och försök igen.'
  }
  if (result.code === 'CODE_EXPIRED') return 'Koden har gått ut. Skicka en ny kod.'
  if (result.code === 'CODE_LOCKED') return 'För många felaktiga försök. Skicka en ny kod när spärrtiden har gått ut.'
  if (result.code === 'COOKIE_REQUIRED') return 'Verifieringen kunde inte fortsätta. Skicka en ny kod.'
  if (result.code === 'SETUP_EXPIRED') return 'Verifieringen har gått ut. Skicka en ny kod.'
  if (result.code === 'SETUP_PENDING') return 'Första inloggningen förbereds fortfarande. Vänta en kort stund och försök igen.'
  if (result.code === 'RATE_LIMITED') {
    return typeof result.retryAfterSeconds === 'number'
      ? `För många försök. Vänta ${Math.max(1, Math.ceil(result.retryAfterSeconds))} sekunder och försök igen.`
      : 'För många försök. Vänta en stund och försök igen.'
  }
  if (result.code === 'ACCOUNT_LOGIN_REQUIRED') return 'Kontot är redan skapat. Logga in med ditt lösenord.'
  if (result.code === 'FIRST_LOGIN_UNAVAILABLE') return 'Första inloggningen kan inte startas från den här länken.'
  if (result.code === 'PASSWORD_TOO_SHORT') return 'Lösenordet måste vara minst 8 tecken.'
  if (result.code === 'PASSWORD_TOO_LONG') return 'Lösenordet får vara högst 128 tecken.'
  if (result.code === 'ACCOUNT_CREATE_FAILED') return 'Kontot kunde inte skapas just nu. Försök igen om en stund.'
  if (result.code === 'FIRST_LOGIN_TEMPORARILY_UNAVAILABLE') {
    return 'Första inloggningen är tillfälligt otillgänglig. Försök igen om en stund.'
  }
  return fallback
}

export default function RecipientAccountAction({
  account,
  endpoint,
  recipientName,
}: {
  account: RecipientAccountActionState
  endpoint: string
  recipientName: string
}) {
  const router = useRouter()
  const titleId = useId()
  const descriptionId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  const scrollAreaRef = useRef<HTMLDivElement>(null)
  const codeInputRef = useRef<HTMLInputElement>(null)
  const passwordInputRef = useRef<HTMLInputElement>(null)
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<FirstLoginStep>('idle')
  const [busyAction, setBusyAction] = useState<'status' | 'request' | 'verify' | 'complete' | null>(null)
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [emailHint, setEmailHint] = useState(account.emailHint)
  const [expiresInSeconds, setExpiresInSeconds] = useState(600)
  const [maxAttempts, setMaxAttempts] = useState(5)
  const [attemptsRemaining, setAttemptsRemaining] = useState<number | null>(5)
  const [resendAvailableAt, setResendAvailableAt] = useState(0)
  const [resendSeconds, setResendSeconds] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [loginUrl, setLoginUrl] = useState<string | null>(null)

  useEffect(() => {
    setEmailHint(account.emailHint)
  }, [account.emailHint])

  useEffect(() => {
    if (!open || resendAvailableAt <= 0) return
    const updateCountdown = () => {
      setResendSeconds(Math.max(0, Math.ceil((resendAvailableAt - Date.now()) / 1000)))
    }
    updateCountdown()
    const timer = window.setInterval(updateCountdown, 1000)
    return () => window.clearInterval(timer)
  }, [open, resendAvailableAt])

  useEffect(() => {
    if (!open) return

    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setOpen(false)
        return
      }
      if (event.key !== 'Tab') return

      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), a[href], input:not([disabled]), [tabindex]:not([tabindex="-1"])'
        ) ?? []
      ).filter((element) => !element.hasAttribute('hidden'))
      if (focusable.length === 0) return

      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = previousOverflow
      previouslyFocused?.focus()
    }
  }, [open])

  useEffect(() => {
    if (!open) return

    let secondFrame = 0
    const firstFrame = window.requestAnimationFrame(() => {
      scrollAreaRef.current?.scrollTo({ top: 0, behavior: 'auto' })

      secondFrame = window.requestAnimationFrame(() => {
        const shouldFocusFormField = window.matchMedia(
          '(min-width: 640px) and (pointer: fine)'
        ).matches

        if (step === 'code' && shouldFocusFormField) {
          codeInputRef.current?.focus({ preventScroll: true })
        } else if (step === 'password' && shouldFocusFormField) {
          passwordInputRef.current?.focus({ preventScroll: true })
        } else {
          closeRef.current?.focus({ preventScroll: true })
        }
      })
    })

    return () => {
      window.cancelAnimationFrame(firstFrame)
      window.cancelAnimationFrame(secondFrame)
    }
  }, [open, step])

  const rememberLoginUrl = (result: FirstLoginApiResult) => {
    if (result.loginUrl) {
      setLoginUrl(safeRecipientReturnTo(result.loginUrl, '/mina-uppdrag/logga-in'))
    } else if (result.code === 'ACCOUNT_LOGIN_REQUIRED') {
      setLoginUrl('/mina-uppdrag/logga-in')
    }
  }

  const applyResendWait = (seconds: number | null | undefined) => {
    const waitSeconds = typeof seconds === 'number' ? Math.max(0, Math.ceil(seconds)) : 0
    setResendAvailableAt(waitSeconds > 0 ? Date.now() + waitSeconds * 1000 : 0)
    setResendSeconds(waitSeconds)
  }

  const requestCode = async (isResend: boolean) => {
    setBusyAction('request')
    setError(null)
    setNotice(null)
    setLoginUrl(null)
    if (!isResend) setStep('request')

    try {
      const response = await fetch(`${endpoint}/first-login/request-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({}),
      })
      const result = (await response.json().catch(() => ({}))) as FirstLoginApiResult
      if (!response.ok || result.status !== 'code_sent') {
        rememberLoginUrl(result)
        if (result.code === 'ACCOUNT_LOGIN_REQUIRED') setStep('account_created')
        if (result.code === 'RATE_LIMITED' && typeof result.retryAfterSeconds === 'number') {
          applyResendWait(result.retryAfterSeconds)
        }
        setError(firstLoginErrorMessage(result, 'Koden kunde inte skickas. Försök igen om en stund.'))
        return
      }

      setEmailHint(result.emailHint?.trim() || account.emailHint)
      setExpiresInSeconds(
        typeof result.expiresInSeconds === 'number' && result.expiresInSeconds > 0
          ? result.expiresInSeconds
          : 600
      )
      setMaxAttempts(
        typeof result.maxAttempts === 'number' && result.maxAttempts > 0
          ? result.maxAttempts
          : 5
      )
      setAttemptsRemaining(
        typeof result.maxAttempts === 'number' && result.maxAttempts > 0
          ? result.maxAttempts
          : 5
      )
      setCode('')
      setStep('code')
      applyResendWait(60)
      setNotice(isResend ? 'En ny kod har skickats.' : 'Koden är skickad.')
    } catch {
      setError('Koden kunde inte skickas. Kontrollera anslutningen och försök igen.')
    } finally {
      setBusyAction(null)
    }
  }

  const resumeFirstLogin = async () => {
    setStep('request')
    setBusyAction('status')
    setError(null)
    setNotice(null)
    setLoginUrl(null)

    try {
      const response = await fetch(`${endpoint}/first-login/status`, {
        method: 'GET',
        cache: 'no-store',
        credentials: 'same-origin',
      })
      const result = (await response.json().catch(() => ({}))) as FirstLoginApiResult
      if (!response.ok || result.status !== 'ready' || !result.phase) {
        rememberLoginUrl(result)
        if (result.code === 'ACCOUNT_LOGIN_REQUIRED') setStep('account_created')
        setError(firstLoginErrorMessage(result, 'Första inloggningen kunde inte kontrolleras. Försök igen.'))
        return
      }

      if (result.phase === 'none') {
        setEmailHint(account.emailHint)
        setAttemptsRemaining(null)
        applyResendWait(0)
        await requestCode(false)
        return
      }

      setEmailHint(result.emailHint?.trim() || account.emailHint)
      setExpiresInSeconds(
        typeof result.expiresInSeconds === 'number' && result.expiresInSeconds > 0
          ? result.expiresInSeconds
          : 600
      )
      setMaxAttempts(
        typeof result.maxAttempts === 'number' && result.maxAttempts > 0
          ? result.maxAttempts
          : 5
      )

      if (result.phase === 'code') {
        setAttemptsRemaining(
          typeof result.attemptsRemaining === 'number'
            ? Math.max(0, result.attemptsRemaining)
            : null
        )
        applyResendWait(result.resendAfterSeconds)
        setStep('code')
        return
      }

      setAttemptsRemaining(null)
      applyResendWait(0)
      setStep('password')
      setNotice('E-postadressen är redan verifierad. Välj ditt lösenord för att fortsätta.')
    } catch {
      setError('Första inloggningen kunde inte kontrolleras. Kontrollera anslutningen och försök igen.')
    } finally {
      setBusyAction(null)
    }
  }

  const openFirstLogin = () => {
    setOpen(true)
    if (busyAction === null) void resumeFirstLogin()
  }

  const verifyCode = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!/^\d{6}$/.test(code)) {
      setError('Ange den sexsiffriga koden från mejlet.')
      return
    }

    setBusyAction('verify')
    setError(null)
    setNotice(null)
    setLoginUrl(null)
    try {
      const response = await fetch(`${endpoint}/first-login/verify-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ code }),
      })
      const result = (await response.json().catch(() => ({}))) as FirstLoginApiResult
      if (!response.ok || result.status !== 'code_verified') {
        rememberLoginUrl(result)
        if (result.code === 'ACCOUNT_LOGIN_REQUIRED') setStep('account_created')
        if (typeof result.attemptsRemaining === 'number') {
          setAttemptsRemaining(Math.max(0, result.attemptsRemaining))
        }
        setError(firstLoginErrorMessage(result, 'Koden kunde inte verifieras. Försök igen.'))
        return
      }

      setStep('password')
      setNotice('E-postadressen är verifierad. Välj nu ditt lösenord.')
    } catch {
      setError('Koden kunde inte verifieras. Kontrollera anslutningen och försök igen.')
    } finally {
      setBusyAction(null)
    }
  }

  const completeFirstLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    setNotice(null)
    setLoginUrl(null)

    if (password.length < 8) {
      setError('Lösenordet måste vara minst 8 tecken.')
      return
    }
    if (password.length > 128) {
      setError('Lösenordet får vara högst 128 tecken.')
      return
    }
    if (password !== confirmPassword) {
      setError('Lösenorden matchar inte.')
      return
    }

    setBusyAction('complete')
    try {
      const response = await fetch(`${endpoint}/first-login/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({
          password,
          displayName: recipientName.trim() || undefined,
        }),
      })
      const result = (await response.json().catch(() => ({}))) as FirstLoginApiResult
      if (
        !response.ok ||
        result.status !== 'account_created' ||
        !result.signInEmail ||
        !result.destination
      ) {
        rememberLoginUrl(result)
        if (result.code === 'ACCOUNT_LOGIN_REQUIRED') {
          setStep('account_created')
        } else if (result.code === 'SETUP_EXPIRED' || result.code === 'COOKIE_REQUIRED') {
          setPassword('')
          setConfirmPassword('')
          setStep('request')
        }
        setError(firstLoginErrorMessage(result, 'Kontot kunde inte skapas just nu. Försök igen om en stund.'))
        return
      }

      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: result.signInEmail,
        password,
      })
      if (signInError) {
        setStep('account_created')
        setLoginUrl('/mina-uppdrag/logga-in')
        setError('Kontot är skapat, men den automatiska inloggningen misslyckades. Logga in med lösenordet du nyss valde.')
        return
      }

      router.replace(safeRecipientReturnTo(result.destination))
      router.refresh()
    } catch {
      setError('Kontot kunde inte skapas. Kontrollera anslutningen och försök igen.')
    } finally {
      setBusyAction(null)
    }
  }

  if (account.state === 'unavailable') return null

  if (account.state === 'password_login') {
    return (
      <Link
        href="/mina-uppdrag/logga-in"
        prefetch={false}
        className="ml-auto inline-flex min-h-11 shrink-0 items-center rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600 focus-visible:ring-offset-2"
      >
        Mina uppdrag
      </Link>
    )
  }

  const codeLifetimeMinutes = Math.max(1, Math.ceil(expiresInSeconds / 60))
  const codeLifetimeLabel = expiresInSeconds < 60
    ? 'mindre än en minut'
    : `cirka ${codeLifetimeMinutes} minuter`
  const accountHintLabel = step === 'password'
    ? 'Verifierad e-post'
    : step === 'code'
      ? 'Pågående kod för'
      : 'E-post för verifiering'

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={openFirstLogin}
        className="ml-auto inline-flex min-h-11 shrink-0 items-center rounded-xl border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600 focus-visible:ring-offset-2"
        aria-haspopup="dialog"
      >
        Mina uppdrag
      </button>

      {open && typeof document !== 'undefined' ? createPortal(
        <div
          className="fixed inset-0 z-[80] flex min-h-0 items-stretch justify-center overflow-hidden bg-slate-950/55 backdrop-blur-[2px] sm:items-center sm:p-5"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setOpen(false)
          }}
        >
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-describedby={descriptionId}
            className="relative flex h-dvh min-h-0 w-full flex-col overflow-hidden bg-white shadow-2xl sm:h-auto sm:max-h-[calc(100dvh-2.5rem)] sm:max-w-lg sm:rounded-[28px] sm:border sm:border-white/70"
          >
            <div className="z-10 flex shrink-0 items-start gap-4 border-b border-slate-200 bg-white/95 px-5 pb-4 pt-[calc(1rem+env(safe-area-inset-top))] backdrop-blur sm:px-6 sm:pt-4">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-bold uppercase tracking-[0.18em] text-amber-700">Mina uppdrag</p>
                <h2 id={titleId} className="mt-1 text-xl font-semibold tracking-tight text-slate-950 sm:text-2xl">
                  Skapa ditt konto
                </h2>
              </div>
              <button
                ref={closeRef}
                type="button"
                onClick={() => setOpen(false)}
                className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600"
                aria-label="Stäng kontoregistreringen"
              >
                <X size={21} aria-hidden="true" />
              </button>
            </div>

            <div
              ref={scrollAreaRef}
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-5 sm:px-6 sm:py-6"
            >
              <p id={descriptionId} className="text-sm leading-6 text-slate-600">
                Verifiera din e-post och välj ett lösenord. Uppdraget du tittar på går att använda även om du stänger den här rutan.
              </p>

              <div className="mt-5 flex gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-950">
                <Mail className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
                <div className="min-w-0">
                  <p className="text-sm font-semibold">{accountHintLabel}</p>
                  <p className="mt-0.5 break-words text-sm">{emailHint || 'din registrerade e-postadress'}</p>
                </div>
              </div>

              {notice ? (
                <div role="status" aria-live="polite" className="mt-4 flex gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-900">
                  <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
                  <p className="text-sm leading-6">{notice}</p>
                </div>
              ) : null}

              {error ? (
                <div role="alert" className="mt-4 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm leading-6 text-rose-900">
                  <p>{error}</p>
                  {loginUrl ? (
                    <Link
                      href={loginUrl}
                      className="mt-3 inline-flex font-semibold underline decoration-2 underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-700"
                    >
                      Gå till inloggningen
                    </Link>
                  ) : null}
                </div>
              ) : null}

              {step === 'request' ? (
                <div className="mt-6">
                  {busyAction === 'request' || busyAction === 'status' ? (
                    <div role="status" className="flex items-center gap-3 text-sm font-medium text-slate-700">
                      <Loader2 className="h-5 w-5 animate-spin text-amber-700" aria-hidden="true" />
                      {busyAction === 'status' ? 'Kontrollerar din pågående inloggning …' : 'Skickar en engångskod …'}
                    </div>
                  ) : (
                    <ActionButton
                      onClick={() => void resumeFirstLogin()}
                      disabled={resendSeconds > 0}
                      icon={<Mail size={17} aria-hidden="true" />}
                      tone="amber"
                      className="min-h-12 w-full rounded-2xl px-5 text-sm font-semibold"
                    >
                      {resendSeconds > 0 ? `Försök igen om ${resendSeconds} s` : 'Försök skicka koden igen'}
                    </ActionButton>
                  )}
                </div>
              ) : null}

              {step === 'code' ? (
                <form onSubmit={verifyCode} className="mt-6 space-y-5">
                  <label htmlFor={`${titleId}-code`} className="block">
                    <span className="mb-2 block text-sm font-semibold text-slate-800">Sexsiffrig kod</span>
                    <input
                      ref={codeInputRef}
                      id={`${titleId}-code`}
                      type="text"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      pattern="[0-9]{6}"
                      maxLength={6}
                      value={code}
                      onChange={(event) => {
                        setCode(event.target.value.replace(/\D/g, '').slice(0, 6))
                        setError(null)
                      }}
                      aria-describedby={`${titleId}-code-help`}
                      required
                      className="h-14 w-full rounded-2xl border border-slate-300 bg-white px-4 text-center font-mono text-2xl tracking-[0.3em] text-slate-950 outline-none transition focus:border-amber-600 focus:ring-4 focus:ring-amber-100"
                    />
                    <span id={`${titleId}-code-help`} className="mt-2 block text-xs leading-5 text-slate-500">
                      Koden är giltig i {codeLifetimeLabel} till.{' '}
                      {attemptsRemaining === null
                        ? `Den kan provas högst ${maxAttempts} gånger.`
                        : `Du har ${attemptsRemaining} av ${maxAttempts} försök kvar.`}
                    </span>
                  </label>

                  <ActionButton
                    type="submit"
                    disabled={busyAction !== null}
                    busy={busyAction === 'verify'}
                    busyLabel="Kontrollerar …"
                    icon={<ShieldCheck size={17} aria-hidden="true" />}
                    tone="amber"
                    className="min-h-12 w-full rounded-2xl px-5 text-sm font-semibold"
                  >
                    Kontrollera kod
                  </ActionButton>
                  <ActionButton
                    onClick={() => void requestCode(true)}
                    disabled={busyAction !== null || resendSeconds > 0}
                    busy={busyAction === 'request'}
                    busyLabel="Skickar …"
                    icon={<Mail size={17} aria-hidden="true" />}
                    tone="secondary"
                    className="min-h-12 w-full rounded-2xl px-5 text-sm font-semibold"
                  >
                    {resendSeconds > 0 ? `Skicka ny kod om ${resendSeconds} s` : 'Skicka en ny kod'}
                  </ActionButton>
                </form>
              ) : null}

              {step === 'password' ? (
                <form onSubmit={completeFirstLogin} className="mt-6 space-y-5">
                  <div className="flex gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-900">
                    <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
                    <p className="text-sm leading-6">Din e-post är verifierad. Lösenordet ska vara minst 8 tecken.</p>
                  </div>
                  <label htmlFor={`${titleId}-password`} className="block">
                    <span className="mb-2 block text-sm font-semibold text-slate-800">Välj lösenord</span>
                    <input
                      ref={passwordInputRef}
                      id={`${titleId}-password`}
                      type="password"
                      autoComplete="new-password"
                      minLength={8}
                      maxLength={128}
                      value={password}
                      onChange={(event) => {
                        setPassword(event.target.value)
                        setError(null)
                      }}
                      required
                      className="h-12 w-full rounded-2xl border border-slate-300 bg-white px-4 text-base text-slate-950 outline-none transition focus:border-amber-600 focus:ring-4 focus:ring-amber-100"
                    />
                  </label>
                  <label htmlFor={`${titleId}-password-confirm`} className="block">
                    <span className="mb-2 block text-sm font-semibold text-slate-800">Bekräfta lösenord</span>
                    <input
                      id={`${titleId}-password-confirm`}
                      type="password"
                      autoComplete="new-password"
                      minLength={8}
                      maxLength={128}
                      value={confirmPassword}
                      onChange={(event) => {
                        setConfirmPassword(event.target.value)
                        setError(null)
                      }}
                      required
                      className="h-12 w-full rounded-2xl border border-slate-300 bg-white px-4 text-base text-slate-950 outline-none transition focus:border-amber-600 focus:ring-4 focus:ring-amber-100"
                    />
                  </label>
                  <ActionButton
                    type="submit"
                    disabled={busyAction !== null}
                    busy={busyAction === 'complete'}
                    busyLabel="Skapar konto …"
                    icon={<KeyRound size={17} aria-hidden="true" />}
                    tone="amber"
                    className="min-h-12 w-full rounded-2xl px-5 text-sm font-semibold"
                  >
                    Skapa konto och öppna Mina uppdrag
                  </ActionButton>
                </form>
              ) : null}

              {step === 'account_created' && !error ? (
                <div className="mt-6 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm leading-6 text-emerald-900">
                  Kontot är skapat. Du kan nu logga in med ditt nya lösenord.
                </div>
              ) : null}
            </div>
          </div>
        </div>,
        document.body
      ) : null}
    </>
  )
}
