'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { ArrowRight, Building2, LayoutGrid, ShieldCheck } from 'lucide-react'
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

const ENTRY_POINTS = [
  {
    title: 'Dashboard',
    audience: 'För interna användare',
    description: 'Fastigheter, uppdrag, besiktningar och intern drift i samma arbetsyta.',
    accent: 'border-stone-300 bg-white/92',
    icon: LayoutGrid,
    primaryLabel: 'Öppna Dashboard',
    helper: 'Har du redan en session skickas du direkt vidare.',
    kind: 'dashboard' as const,
    secondaryLinks: [{ href: '/login', label: 'Separat login' }],
  },
  {
    title: 'RenoApp',
    audience: 'För BRF, styrelse och boende',
    description: 'Renoveringsärenden, BRF-onboarding och styrelseportal i ett separat flöde.',
    accent: 'border-emerald-300 bg-[linear-gradient(145deg,rgba(236,253,245,0.96),rgba(255,255,255,0.92))]',
    icon: Building2,
    primaryLabel: 'Öppna RenoApp',
    helper: 'Härifrån går du vidare till ansökan, BRF-login eller BRF-anslutning.',
    kind: 'link' as const,
    primaryHref: '/renoapp',
    secondaryLinks: [
      { href: '/renoapp/login', label: 'BRF-login' },
      { href: '/renoapp/request-access', label: 'Anslut BRF' },
    ],
  },
] as const

const QUICK_LINKS = [
  {
    title: 'Dashboard-login',
    href: '/login',
    description: 'För interna användare som vill gå direkt till inloggning.',
  },
  {
    title: 'BRF-login',
    href: '/renoapp/login',
    description: 'För styrelser och BRF-användare som redan har tillgång till RenoApp.',
  },
  {
    title: 'Anslut BRF',
    href: '/renoapp/request-access',
    description: 'Skicka intresseanmälan om en ny BRF ska in i RenoApp.',
  },
] as const

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
    <main className="min-h-screen overflow-hidden bg-[linear-gradient(180deg,#f6f0e7_0%,#f8f7f3_48%,#eef3f1_100%)] text-stone-900">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_8%_12%,rgba(180,123,70,0.15),transparent_24%),radial-gradient(circle_at_82%_14%,rgba(14,116,144,0.12),transparent_24%),linear-gradient(140deg,rgba(255,255,255,0.52),rgba(255,255,255,0))]" />

      <div className="relative mx-auto flex min-h-screen w-full max-w-7xl flex-col px-6 py-8 md:px-10 lg:px-12">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Image
              src="/landing/Hushub-check.png"
              alt="HusHub"
              width={160}
              height={52}
              className="h-10 w-auto md:h-11"
              priority
            />
            <div className="hidden h-10 w-px bg-stone-300/80 md:block" />
            <p className="max-w-md text-sm leading-6 text-stone-600">
              Två tydliga arbetsytor: intern drift i Dashboard och renoveringsflöden i RenoApp.
            </p>
          </div>

          <div className="rounded-full border border-stone-300 bg-white/80 px-4 py-2 text-sm text-stone-700">
            Första sidan ska bara hjälpa dig att välja rätt väg.
          </div>
        </header>

        <section className="grid flex-1 gap-8 py-10 lg:grid-cols-[1.05fr_0.95fr] lg:items-start lg:py-14">
          <div className="rounded-[34px] border border-stone-200/80 bg-white/78 p-8 shadow-[0_24px_80px_-44px_rgba(41,37,36,0.42)] backdrop-blur">
            <p className="text-xs font-semibold uppercase tracking-[0.26em] text-stone-500">Startpunkt</p>
            <h1 className="mt-4 max-w-4xl text-5xl font-semibold tracking-tight text-stone-900 sm:text-6xl">
              Välj rätt arbetsyta direkt.
            </h1>
            <p className="mt-5 max-w-2xl text-lg leading-8 text-stone-700">
              HusHub ska inte kräva orientering. Om du redan vet vad du söker efter ska du kunna gå vidare på en gång,
              utan dubbla budskap, upprepade knappar eller onödiga beslut.
            </p>

            <div className="mt-8 grid gap-4">
              {ENTRY_POINTS.map((entry) => {
                const Icon = entry.icon

                return (
                  <article
                    key={entry.title}
                    className={`rounded-[30px] border p-6 shadow-[0_20px_65px_-42px_rgba(41,37,36,0.45)] ${entry.accent}`}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.22em] text-stone-500">{entry.audience}</p>
                        <h2 className="mt-3 text-3xl font-semibold tracking-tight text-stone-900">{entry.title}</h2>
                      </div>
                      <div className="rounded-2xl border border-stone-300/80 bg-white/80 p-3 text-stone-700">
                        <Icon size={22} />
                      </div>
                    </div>

                    <p className="mt-4 max-w-xl text-base leading-7 text-stone-700">{entry.description}</p>
                    <p className="mt-3 text-sm leading-6 text-stone-500">{entry.helper}</p>

                    <div className="mt-6 flex flex-wrap gap-3">
                      {entry.kind === 'dashboard' ? (
                        <button
                          type="button"
                          onClick={() => void handleDashboardEntry()}
                          className="inline-flex items-center gap-2 rounded-full bg-stone-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-stone-700"
                        >
                          {entry.primaryLabel}
                          <ArrowRight size={16} />
                        </button>
                      ) : (
                        <Link
                          href={entry.primaryHref}
                          className="inline-flex items-center gap-2 rounded-full bg-stone-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-stone-700"
                        >
                          {entry.primaryLabel}
                          <ArrowRight size={16} />
                        </Link>
                      )}

                      {entry.secondaryLinks.map((link) => (
                        <Link
                          key={link.href}
                          href={link.href}
                          className="rounded-full border border-stone-300 bg-white/82 px-4 py-3 text-sm font-semibold text-stone-800 transition hover:bg-white"
                        >
                          {link.label}
                        </Link>
                      ))}
                    </div>
                  </article>
                )
              })}
            </div>
          </div>

          <div className="grid gap-6">
            <section className="rounded-[34px] border border-stone-200/80 bg-[linear-gradient(155deg,rgba(255,251,245,0.96),rgba(247,242,235,0.9))] p-8 shadow-[0_24px_80px_-44px_rgba(41,37,36,0.42)]">
              <div className="flex items-center gap-3">
                <div className="rounded-2xl border border-stone-300/80 bg-white/85 p-3 text-stone-700">
                  <ShieldCheck size={22} />
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.22em] text-stone-500">Snabbnavigering</p>
                  <h2 className="mt-1 text-2xl font-semibold tracking-tight text-stone-900">Direktvägar utan omvägar</h2>
                </div>
              </div>

              <div className="mt-6 space-y-3">
                {QUICK_LINKS.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    className="block rounded-[24px] border border-stone-200 bg-white/85 p-4 transition hover:border-stone-300 hover:bg-white"
                  >
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <h3 className="text-base font-semibold text-stone-900">{link.title}</h3>
                        <p className="mt-1 text-sm leading-6 text-stone-600">{link.description}</p>
                      </div>
                      <ArrowRight size={18} className="shrink-0 text-stone-500" />
                    </div>
                  </Link>
                ))}
              </div>
            </section>

            <section className="rounded-[34px] border border-stone-200/80 bg-white/86 p-8 shadow-[0_24px_80px_-44px_rgba(41,37,36,0.42)]">
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-stone-500">Så är sidan tänkt att fungera</p>
              <div className="mt-5 space-y-4 text-sm leading-7 text-stone-700">
                <p>
                  <strong className="text-stone-900">Dashboard</strong> är den interna arbetsytan. Där hör fastigheter,
                  uppdrag, besiktningar och administration hemma.
                </p>
                <p>
                  <strong className="text-stone-900">RenoApp</strong> är den externa produktupplevelsen för BRF,
                  styrelse, onboarding och renoveringsärenden.
                </p>
                <p>
                  Startsidan ska därför inte försöka förklara allt. Den ska bara sortera besökaren till rätt destination
                  så snabbt som möjligt.
                </p>
              </div>
            </section>
          </div>
        </section>
      </div>
    </main>
  )
}
