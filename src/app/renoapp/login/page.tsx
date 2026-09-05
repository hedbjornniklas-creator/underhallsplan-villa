'use client'

import { useEffect } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { AuthChangeEvent, Session } from '@supabase/supabase-js'
import { ArrowLeft, FileCheck2, MessagesSquare, ShieldCheck } from 'lucide-react'
import { supabase } from '@/lib/supabaseClient'
import PasswordAuthPanel from '@/components/auth/PasswordAuthPanel'
import { getRenoAppReturnPath } from '@/lib/renoapp/brfLifecycle'

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

function getSafeReturnPath() {
  if (typeof window === 'undefined') return '/renoapp/app'

  const value = new URLSearchParams(window.location.search).get('next')
  return getRenoAppReturnPath(value)
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
      if (data.session) router.replace(getSafeReturnPath())
    })

    const { data } = supabase.auth.onAuthStateChange((event: AuthChangeEvent, session: Session | null) => {
      if (event === 'PASSWORD_RECOVERY') {
        router.replace('/auth/reset-password')
        return
      }

      if (session) {
        router.replace(getSafeReturnPath())
      }
    })

    return () => data.subscription.unsubscribe()
  }, [router])

  return (
    <main className="relative overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_15%_20%,rgba(16,185,129,0.12),transparent_28%),radial-gradient(circle_at_88%_76%,rgba(245,158,11,0.1),transparent_25%)]" />

      <section className="relative mx-auto grid min-h-[calc(100vh-73px)] w-full max-w-7xl items-stretch lg:grid-cols-[1.05fr_0.95fr]">
        <div className="flex flex-col justify-between px-6 py-10 sm:px-10 lg:px-14 lg:py-14">
          <Link
            href="/renoapp"
            className="inline-flex w-fit items-center gap-2 text-sm font-semibold text-stone-600 transition hover:text-stone-950"
          >
            <ArrowLeft size={16} aria-hidden="true" />
            Till RenoApp
          </Link>

          <div className="py-14 lg:py-10">
            <Image
              src="/landing/Renoapp.png"
              alt="RenoApp"
              width={190}
              height={56}
              className="h-11 w-auto object-contain"
              priority
            />
            <p className="mt-8 text-xs font-semibold uppercase tracking-[0.24em] text-emerald-800">För styrelse och BRF-användare</p>
            <h1 className="mt-5 max-w-[12ch] text-4xl font-semibold tracking-[-0.04em] text-stone-950 sm:text-5xl lg:text-6xl">
              Fortsätt handläggningen i styrelseportalen.
            </h1>
            <p className="mt-6 max-w-xl text-base leading-8 text-stone-700 sm:text-lg">
              Öppna renoveringsärenden, följ underlag och hantera kompletteringar och beslut i ett sammanhållet flöde.
            </p>

            <div className="mt-9 grid max-w-2xl gap-3 sm:grid-cols-3">
              {[
                { icon: FileCheck2, label: 'Samlat underlag' },
                { icon: MessagesSquare, label: 'Kompletteringar' },
                { icon: ShieldCheck, label: 'Tydliga beslut' },
              ].map((item) => (
                <div key={item.label} className="rounded-2xl border border-emerald-200/70 bg-white/65 p-4">
                  <item.icon className="text-emerald-700" size={20} aria-hidden="true" />
                  <p className="mt-3 text-sm font-semibold text-stone-800">{item.label}</p>
                </div>
              ))}
            </div>
          </div>

          <p className="text-xs leading-6 text-stone-500">RenoApp är en del av HusHub.</p>
        </div>

        <div className="flex items-center border-t border-stone-200/80 bg-white/75 px-6 py-12 backdrop-blur-sm sm:px-10 lg:border-l lg:border-t-0 lg:px-14">
          <div className="mx-auto w-full max-w-md">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-800">Styrelseportal</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-stone-950">Logga in till RenoApp</h2>
            <p className="mt-3 text-sm leading-7 text-stone-600">Använd kontot du fått från din förening eller administratör.</p>

            <div className="mt-7">
              <PasswordAuthPanel redirectTo={authRedirectTo} accent="emerald" />
            </div>

            <div className="mt-8 border-t border-stone-200 pt-6">
              <p className="text-sm leading-6 text-stone-600">
                Boende behöver normalt inget konto. Använd i stället länken till föreningens ansökningssida.
              </p>
              <Link href="/renoapp/apply" className="mt-3 inline-flex text-sm font-semibold text-emerald-800 hover:text-emerald-950">
                Gå till boendeansökan
              </Link>
            </div>
          </div>
        </div>
      </section>
    </main>
  )
}
