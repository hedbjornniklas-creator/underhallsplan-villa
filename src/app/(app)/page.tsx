'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRight, Building2, LayoutGrid } from 'lucide-react'
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

  const handleDashboardEntry = async () => {
    const { data } = await supabase.auth.getSession()
    router.push(data.session ? '/dashboard-v1' : '/login')
  }

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,#f6f0e7_0%,#f8f7f3_52%,#eef3f1_100%)] text-stone-900">
      <div className="mx-auto flex min-h-screen w-full max-w-7xl flex-col px-5 py-8 sm:px-6 md:px-10 lg:px-12">
        <header className="flex flex-col gap-4 border-b border-stone-200/80 pb-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <Image
              src="/landing/Hushub-check.png"
              alt="HusHub"
              width={160}
              height={52}
              className="h-10 w-auto md:h-11"
              priority
            />
            <p className="hidden max-w-md text-sm leading-6 text-stone-600 md:block">
              Välj arbetsyta och gå vidare direkt.
            </p>
          </div>

        </header>

        <section className="grid flex-1 gap-6 py-8 lg:grid-cols-[1.05fr_0.95fr] lg:gap-8 lg:py-12">
          <div className="rounded-[30px] border border-stone-200/80 bg-white/82 p-6 shadow-[0_24px_70px_-44px_rgba(41,37,36,0.42)] sm:p-8">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-stone-500">HusHub</p>
            <h1 className="mt-4 max-w-4xl text-4xl font-semibold tracking-tight text-stone-900 sm:text-5xl lg:text-6xl">
              Välj rätt arbetsyta.
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-8 text-stone-700 sm:text-lg">
              RenoApp är för BRF, styrelse och renoveringsärenden. Dashboard är för interna användare som arbetar med
              fastigheter, uppdrag och besiktningar.
            </p>
          </div>

          <div className="grid gap-4">
            <article className="rounded-[30px] border border-emerald-300 bg-[linear-gradient(145deg,rgba(236,253,245,0.96),rgba(255,255,255,0.92))] p-6 shadow-[0_24px_70px_-44px_rgba(41,37,36,0.42)] sm:p-7">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-emerald-800">För BRF och styrelse</p>
                  <h2 className="mt-3 text-3xl font-semibold tracking-tight text-stone-900">RenoApp</h2>
                </div>
                <div className="rounded-2xl border border-emerald-300/80 bg-white/80 p-3 text-emerald-900">
                  <Building2 size={22} />
                </div>
              </div>

              <p className="mt-4 text-base leading-7 text-stone-700">
                Gå till ansökan, BRF-login eller BRF-anslutning för renoveringsärenden och onboarding.
              </p>

              <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                <Link
                  href="/renoapp"
                  className="inline-flex items-center justify-center gap-2 rounded-full bg-stone-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-stone-700"
                >
                  Öppna RenoApp
                  <ArrowRight size={16} />
                </Link>
                <Link
                  href="/renoapp/login"
                  className="rounded-full border border-emerald-300 bg-white/82 px-4 py-3 text-center text-sm font-semibold text-emerald-900 transition hover:bg-white"
                >
                  BRF-login
                </Link>
                <Link
                  href="/renoapp/request-access"
                  className="rounded-full border border-emerald-300 bg-white/82 px-4 py-3 text-center text-sm font-semibold text-emerald-900 transition hover:bg-white"
                >
                  Anslut BRF
                </Link>
              </div>
            </article>

            <article className="rounded-[30px] border border-stone-300 bg-white/92 p-6 shadow-[0_24px_70px_-44px_rgba(41,37,36,0.42)] sm:p-7">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-stone-500">För interna användare</p>
                  <h2 className="mt-3 text-3xl font-semibold tracking-tight text-stone-900">Dashboard</h2>
                </div>
                <div className="rounded-2xl border border-stone-300/80 bg-stone-50 p-3 text-stone-700">
                  <LayoutGrid size={22} />
                </div>
              </div>

              <p className="mt-4 text-base leading-7 text-stone-700">
                Öppna intern arbetsyta för fastigheter, uppdrag, besiktningar och administration.
              </p>

              <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
                <button
                  type="button"
                  onClick={() => void handleDashboardEntry()}
                  className="inline-flex items-center justify-center gap-2 rounded-full bg-stone-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-stone-700"
                >
                  Öppna Dashboard
                  <ArrowRight size={16} />
                </button>
                <Link
                  href="/login"
                  className="rounded-full border border-stone-300 bg-white/82 px-4 py-3 text-center text-sm font-semibold text-stone-800 transition hover:bg-white"
                >
                  Separat login
                </Link>
              </div>
            </article>
          </div>
        </section>
      </div>
    </main>
  )
}
