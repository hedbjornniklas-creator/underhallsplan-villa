'use client'

import Link from 'next/link'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
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

const platformCards = [
  {
    eyebrow: 'Dashboard',
    title: 'Operativ överblick för teamet',
    description:
      'Samla uppdrag, fastigheter, besiktningar och rapportarbete i en gemensam arbetsyta för interna användare.',
    accentClass: 'border-stone-300 bg-white/90',
  },
  {
    eyebrow: 'RenoApp',
    title: 'Renoveringsärenden för BRF',
    description:
      'Publik ansökan för boende, handläggning för styrelse och tydlig spårbarhet genom hela renoveringsflödet.',
    accentClass: 'border-emerald-300 bg-emerald-50/90',
  },
  {
    eyebrow: 'Admin',
    title: 'Konfiguration och styrning',
    description:
      'Hantera inställningar, dokumentkrav och interna stödfunktioner utan att blanda ihop den publika upplevelsen med drift.',
    accentClass: 'border-amber-300 bg-amber-50/90',
  },
]

export default function HomePage() {
  const router = useRouter()

  useEffect(() => {
    if (!hasRecoveryContext()) return

    const query = window.location.search ?? ''
    const hash = window.location.hash ?? ''
    router.replace(`/auth/reset-password${query}${hash}`)
  }, [router])

  const handleLogin = async () => {
    const { data } = await supabase.auth.getSession()
    router.push(data.session ? '/dashboard-v1' : '/login')
  }

  return (
    <main className="min-h-screen overflow-hidden bg-[linear-gradient(180deg,#f5efe6_0%,#f7f7f5_42%,#eef3f1_100%)] text-stone-900">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[34rem] bg-[radial-gradient(circle_at_top_left,rgba(168,85,247,0.0),transparent_32%),radial-gradient(circle_at_18%_18%,rgba(180,123,70,0.16),transparent_28%),radial-gradient(circle_at_82%_14%,rgba(18,94,103,0.14),transparent_26%)]" />

      <div className="relative mx-auto flex min-h-screen w-full max-w-7xl flex-col px-6 py-10 md:px-10 lg:px-12">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-stone-500">HusHub</p>
            <p className="mt-2 text-sm text-stone-600">Plattform för fastighetsarbete, besiktning och renoveringsflöden.</p>
          </div>

          <div className="flex flex-wrap gap-3">
            <Link
              href="/renoapp"
              className="rounded-full border border-stone-300 bg-white/75 px-5 py-3 text-sm font-semibold text-stone-800 transition hover:bg-white"
            >
              Öppna RenoApp
            </Link>
            <button
              type="button"
              onClick={() => void handleLogin()}
              className="rounded-full bg-stone-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-stone-700"
            >
              Logga in till Dashboard
            </button>
          </div>
        </header>

        <section className="grid flex-1 items-center gap-10 py-14 lg:grid-cols-[1.15fr_0.85fr] lg:py-20">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.26em] text-amber-800">Publik översikt</p>
            <h1 className="mt-5 max-w-4xl text-5xl font-semibold tracking-tight text-stone-900 sm:text-6xl lg:text-7xl">
              En tydligare start för HusHub, Dashboard och RenoApp.
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-stone-700 sm:text-xl">
              HusHub ska vara enkel att förstå från första sidan. Härifrån ska det vara tydligt vad som är intern
              arbetsyta, vad som är BRF-flöde och vart användaren ska gå härnäst.
            </p>

            <div className="mt-8 flex flex-wrap gap-4">
              <button
                type="button"
                onClick={() => void handleLogin()}
                className="rounded-full bg-stone-900 px-6 py-3 text-sm font-semibold text-white transition hover:bg-stone-700"
              >
                Till Dashboard
              </button>
              <Link
                href="/renoapp"
                className="rounded-full border border-emerald-700 bg-emerald-50 px-6 py-3 text-sm font-semibold text-emerald-900 transition hover:bg-emerald-100"
              >
                Till RenoApp
              </Link>
            </div>

            <div className="mt-10 grid gap-4 sm:grid-cols-3">
              {[
                ['Intern arbetsyta', 'Fastigheter, uppdrag, besiktningar och rapportarbete för teamet.'],
                ['Publika flöden', 'Renoveringsansökningar och tydlig handläggning för BRF och boende.'],
                ['Additiv struktur', 'Nya moduler kan växa bredvid befintliga flöden utan att störa dem.'],
              ].map(([title, description]) => (
                <article key={title} className="rounded-[28px] border border-stone-200/80 bg-white/80 p-5 shadow-[0_24px_60px_-40px_rgba(41,37,36,0.42)]">
                  <h2 className="text-lg font-semibold text-stone-900">{title}</h2>
                  <p className="mt-3 text-sm leading-7 text-stone-700">{description}</p>
                </article>
              ))}
            </div>
          </div>

          <aside className="grid gap-4">
            {platformCards.map((card) => (
              <article
                key={card.title}
                className={`rounded-[30px] border p-6 shadow-[0_24px_70px_-42px_rgba(41,37,36,0.45)] ${card.accentClass}`}
              >
                <p className="text-xs font-semibold uppercase tracking-[0.22em] text-stone-500">{card.eyebrow}</p>
                <h2 className="mt-3 text-2xl font-semibold text-stone-900">{card.title}</h2>
                <p className="mt-3 text-sm leading-7 text-stone-700">{card.description}</p>
              </article>
            ))}
          </aside>
        </section>

        <section className="grid gap-6 pb-8 lg:grid-cols-2">
          <article className="rounded-[32px] border border-stone-200/80 bg-white/85 p-8 shadow-[0_24px_70px_-40px_rgba(41,37,36,0.44)]">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-stone-500">För interna användare</p>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight text-stone-900">Dashboard</h2>
            <p className="mt-4 max-w-2xl text-base leading-8 text-stone-700">
              Använd Dashboard för den dagliga driften: överblick över fastigheter, besiktningsarbete, interna processer
              och rapportleverans.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => void handleLogin()}
                className="rounded-full bg-stone-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-stone-700"
              >
                Öppna Dashboard
              </button>
              <Link
                href="/login"
                className="rounded-full border border-stone-300 px-5 py-3 text-sm font-semibold text-stone-800 transition hover:bg-stone-100"
              >
                Gå till login
              </Link>
            </div>
          </article>

          <article className="rounded-[32px] border border-emerald-200/90 bg-[linear-gradient(145deg,rgba(236,253,245,0.96),rgba(255,255,255,0.92))] p-8 shadow-[0_24px_70px_-40px_rgba(6,95,70,0.2)]">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-emerald-800">För BRF-flöden</p>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight text-stone-900">RenoApp</h2>
            <p className="mt-4 max-w-2xl text-base leading-8 text-stone-700">
              RenoApp är den separata ytan för renoveringsärenden med publik BRF-länk, magic links för boende och
              styrelseportal för handläggning.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link
                href="/renoapp"
                className="rounded-full bg-emerald-800 px-5 py-3 text-sm font-semibold text-white transition hover:bg-emerald-700"
              >
                Öppna RenoApp
              </Link>
              <Link
                href="/renoapp/login"
                className="rounded-full border border-emerald-300 px-5 py-3 text-sm font-semibold text-emerald-900 transition hover:bg-emerald-100"
              >
                Styrelselogin
              </Link>
            </div>
          </article>
        </section>
      </div>
    </main>
  )
}
