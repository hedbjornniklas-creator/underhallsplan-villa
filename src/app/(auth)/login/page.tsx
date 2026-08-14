'use client'

import { useEffect, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import type { AuthChangeEvent, Session } from '@supabase/supabase-js'
import { ArrowLeft, CheckCircle2, ClipboardCheck, Layers3 } from 'lucide-react'
import PasswordAuthPanel from '@/components/auth/PasswordAuthPanel'

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
  const authRedirectTo =
    typeof window === 'undefined' ? undefined : `${window.location.origin}/auth/reset-password`

  useEffect(() => {
    if (isRecoveryContext()) {
      const query = window.location.search ?? ''
      const hash = window.location.hash ?? ''
      router.replace(`/auth/reset-password${query}${hash}`)
      return
    }

    const params = new URLSearchParams(window.location.search)
    const resetSuccessTimer = window.setTimeout(
      () => setResetSuccess(params.get('reset') === 'success'),
      0,
    )

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

    return () => {
      window.clearTimeout(resetSuccessTimer)
      data.subscription.unsubscribe()
    }
  }, [router])

  return (
    <main className="relative min-h-dvh overflow-hidden bg-[#f3f1ec] text-stone-950">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_12%_18%,rgba(59,130,246,0.14),transparent_30%),radial-gradient(circle_at_84%_86%,rgba(16,185,129,0.1),transparent_28%)]" />

      <div className="relative mx-auto grid min-h-dvh w-full max-w-[1500px] lg:grid-cols-[1.05fr_0.95fr]">
        <section className="flex flex-col justify-between px-6 py-7 sm:px-10 lg:px-14 lg:py-10 xl:px-20">
          <div className="flex items-center justify-between gap-4">
            <Link href="/" className="flex items-center gap-3" aria-label="Till HusHubs startsida">
              <Image
                src="/landing/Hushub-check2.png"
                alt=""
                width={40}
                height={40}
                className="h-9 w-9 object-contain"
                priority
              />
              <span className="text-xs font-semibold uppercase tracking-[0.34em] text-stone-900">HusHub</span>
            </Link>
            <Link
              href="/"
              className="inline-flex items-center gap-2 text-sm font-semibold text-stone-600 transition hover:text-stone-950"
            >
              <ArrowLeft size={16} aria-hidden="true" />
              Startsidan
            </Link>
          </div>

          <div className="py-14 lg:py-10">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-blue-800">Gemensamt HusHub-konto</p>
            <h1 className="mt-5 max-w-[12ch] text-4xl font-semibold tracking-[-0.04em] text-stone-950 sm:text-5xl lg:text-6xl">
              Logga in till dina arbetsytor.
            </h1>
            <p className="mt-6 max-w-xl text-base leading-8 text-stone-700 sm:text-lg">
              Ett konto tar dig till de verktyg och organisationer som du har fått behörighet till.
            </p>

            <div className="mt-10 grid max-w-2xl gap-3 sm:grid-cols-2">
              <div className="rounded-3xl border border-blue-200/80 bg-white/70 p-5 shadow-[0_22px_60px_-42px_rgba(30,64,175,0.5)]">
                <ClipboardCheck className="text-blue-700" size={22} aria-hidden="true" />
                <h2 className="mt-4 text-lg font-semibold">BesiktApp</h2>
                <p className="mt-2 text-sm leading-6 text-stone-600">Besiktningar, utredningar och utlåtanden.</p>
              </div>
              <div className="rounded-3xl border border-emerald-200/80 bg-white/70 p-5 shadow-[0_22px_60px_-42px_rgba(6,95,70,0.4)]">
                <Layers3 className="text-emerald-700" size={22} aria-hidden="true" />
                <h2 className="mt-4 text-lg font-semibold">RenoApp</h2>
                <p className="mt-2 text-sm leading-6 text-stone-600">Renoveringsärenden för BRF och styrelse.</p>
              </div>
            </div>
          </div>

          <p className="text-xs leading-6 text-stone-500">HusHub samlar specialiserade verktyg för tydligare fastighetsarbete.</p>
        </section>

        <section className="flex items-center border-t border-stone-200/80 bg-white/75 px-6 py-12 backdrop-blur-sm sm:px-10 lg:border-l lg:border-t-0 lg:px-14 xl:px-20">
          <div className="mx-auto w-full max-w-md">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-stone-500">Inloggning</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-stone-950">Välkommen tillbaka</h2>
            <p className="mt-3 text-sm leading-7 text-stone-600">Använd kontot du fått via din organisation eller BRF.</p>

            {resetSuccess ? (
              <div className="mt-6 flex gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-900">
                <CheckCircle2 className="mt-0.5 shrink-0" size={20} aria-hidden="true" />
                <p className="text-sm leading-6">Lösenordet är uppdaterat. Logga in med ditt nya lösenord.</p>
              </div>
            ) : null}

            <div className="mt-7">
              <PasswordAuthPanel redirectTo={authRedirectTo} />
            </div>

            <div className="mt-8 border-t border-stone-200 pt-6">
              <p className="text-sm leading-6 text-stone-600">
                Har du inget konto? Konton skapas via din organisation eller genom en personlig inbjudan.
              </p>
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}
