'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowRight,
  Check,
  CheckCircle2,
  ClipboardCheck,
  FileCheck2,
  Files,
  House,
  Layers3,
  Search,
  ShieldCheck,
} from 'lucide-react'
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

const focusRing =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1769a7] focus-visible:ring-offset-2 focus-visible:ring-offset-[#f7f5f0]'

export default function HomePage() {
  const router = useRouter()

  useEffect(() => {
    if (!hasRecoveryContext()) return

    const query = window.location.search ?? ''
    const hash = window.location.hash ?? ''
    router.replace(`/auth/reset-password${query}${hash}`)
  }, [router])

  const handleDashboardEntry = async (destination: '/dashboard-v1' | '/renoapp/app' | null = null) => {
    const { data } = await supabase.auth.getSession()
    if (data.session) {
      router.push(destination ?? '/app')
      return
    }

    router.push(destination ? `/login?next=${encodeURIComponent(destination)}` : '/login')
  }

  return (
    <main className="min-h-screen overflow-hidden bg-[#f7f5f0] text-[#172033]">
      <header className="sticky top-0 z-50 border-b border-stone-900/10 bg-[#f7f5f0]/95 backdrop-blur-md">
        <div className="mx-auto max-w-7xl px-5 sm:px-8 lg:px-10">
          <div className="flex h-[4.5rem] items-center justify-between gap-5">
            <Link
              href="#toppen"
              aria-label="HusHub, till sidans början"
              className={`flex shrink-0 items-center gap-2.5 rounded-md ${focusRing}`}
            >
              <Image
                src="/landing/Hushub-check2.png"
                alt=""
                width={40}
                height={40}
                className="h-8 w-8 object-contain"
                priority
              />
              <span className="text-sm font-bold uppercase tracking-[0.28em] text-[#173357]">
                HusHub
              </span>
            </Link>

            <nav aria-label="Huvudnavigation" className="hidden items-center gap-7 lg:flex">
              <Link
                href="/renoapp/apply"
                className={`rounded text-sm font-semibold text-[#3e7c24] transition hover:text-[#2f651a] ${focusRing}`}
              >
                Skapa ansökan
              </Link>
              <a
                href="#produkter"
                className={`rounded text-sm font-medium text-stone-600 transition hover:text-[#173357] ${focusRing}`}
              >
                Produkter
              </a>
              <a
                href="#sa-fungerar-det"
                className={`rounded text-sm font-medium text-stone-600 transition hover:text-[#173357] ${focusRing}`}
              >
                Så fungerar det
              </a>
              <a
                href="#om-hushub"
                className={`rounded text-sm font-medium text-stone-600 transition hover:text-[#173357] ${focusRing}`}
              >
                Om HusHub
              </a>
              <a
                href="#fragor"
                className={`rounded text-sm font-medium text-stone-600 transition hover:text-[#173357] ${focusRing}`}
              >
                Vanliga frågor
              </a>
            </nav>

            <button
              type="button"
              onClick={() => void handleDashboardEntry()}
              className={`inline-flex min-h-11 shrink-0 cursor-pointer items-center justify-center rounded-full border border-[#173357]/20 bg-white px-5 text-sm font-semibold text-[#173357] shadow-sm transition hover:border-[#173357]/40 hover:bg-[#173357] hover:text-white ${focusRing}`}
            >
              Logga in
            </button>
          </div>

          <nav
            aria-label="Mobilnavigation"
            className="-mx-5 flex gap-6 overflow-x-auto border-t border-stone-900/10 px-5 py-3 text-sm font-medium text-stone-600 sm:-mx-8 sm:px-8 lg:hidden"
          >
            <Link
              href="/renoapp/apply"
              className={`shrink-0 rounded font-semibold text-[#3e7c24] ${focusRing}`}
            >
              Skapa ansökan
            </Link>
            <a href="#produkter" className={`shrink-0 rounded ${focusRing}`}>
              Produkter
            </a>
            <a href="#sa-fungerar-det" className={`shrink-0 rounded ${focusRing}`}>
              Så fungerar det
            </a>
            <a href="#om-hushub" className={`shrink-0 rounded ${focusRing}`}>
              Om HusHub
            </a>
            <a href="#fragor" className={`shrink-0 rounded ${focusRing}`}>
              Vanliga frågor
            </a>
          </nav>
        </div>
      </header>

      <section id="toppen" className="relative isolate scroll-mt-32 border-b border-stone-900/10">
        <div
          aria-hidden="true"
          className="absolute -right-32 top-4 -z-10 h-96 w-96 rounded-full bg-[#62b339]/10 blur-3xl"
        />
        <div
          aria-hidden="true"
          className="absolute -left-40 bottom-0 -z-10 h-96 w-96 rounded-full bg-[#1899d2]/10 blur-3xl"
        />

        <div className="mx-auto grid max-w-7xl items-center gap-14 px-5 py-20 sm:px-8 sm:py-24 lg:grid-cols-[1.08fr_0.92fr] lg:px-10 lg:py-32">
          <div>
            <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-[#173357]/15 bg-white/70 px-4 py-2 text-xs font-bold uppercase tracking-[0.18em] text-[#173357] shadow-sm">
              <Layers3 aria-hidden="true" className="h-4 w-4 text-[#2099d0]" />
              En plattform · två specialiserade verktyg
            </div>
            <h1 className="max-w-[13ch] text-5xl font-semibold leading-[1.02] tracking-[-0.045em] text-[#172033] sm:text-6xl lg:text-7xl">
              Tydligare besiktningar. Smidigare renoveringsärenden.
            </h1>
            <p className="mt-7 max-w-2xl text-lg leading-8 text-stone-600 sm:text-xl sm:leading-9">
              HusHub samlar digitala verktyg för fastighetsnära arbete. BesiktApp hjälper
              besiktningsföretag från uppdrag till utlåtande. RenoApp hjälper bostadsrättsföreningar
              från ansökan till beslut.
            </p>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <Link
                href="/renoapp/apply"
                className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-[#4d962c] px-6 text-sm font-semibold text-white shadow-[0_14px_30px_-16px_rgba(77,150,44,0.65)] transition hover:bg-[#3e7c24] ${focusRing}`}
              >
                Skapa renoveringsansökan
                <FileCheck2 aria-hidden="true" className="h-4 w-4" />
              </Link>
              <button
                type="button"
                onClick={() => void handleDashboardEntry()}
                className={`inline-flex min-h-12 cursor-pointer items-center justify-center rounded-full border border-stone-900/15 bg-white/70 px-6 text-sm font-semibold text-[#173357] transition hover:border-stone-900/30 hover:bg-white ${focusRing}`}
              >
                Logga in till arbetsyta
              </button>
              <a
                href="#produkter"
                className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-full px-3 text-sm font-semibold text-[#173357] transition hover:text-[#0f2948] ${focusRing}`}
              >
                Utforska produkterna
                <ArrowRight aria-hidden="true" className="h-4 w-4" />
              </a>
            </div>
            <p className="mt-4 text-sm leading-6 text-stone-600">
              Är du boende? Börja med ansökan – du behöver inget konto.
            </p>
          </div>

          <div className="relative mx-auto w-full max-w-xl lg:ml-auto">
            <div className="rounded-[2rem] border border-stone-900/10 bg-white/80 p-4 shadow-[0_32px_80px_-42px_rgba(23,32,51,0.35)] backdrop-blur sm:p-6">
              <div className="flex items-center justify-between border-b border-stone-900/10 px-2 pb-5">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.2em] text-stone-500">
                    HusHub
                  </p>
                  <p className="mt-1 font-semibold text-[#172033]">Välj rätt arbetsflöde</p>
                </div>
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#173357] text-white">
                  <House aria-hidden="true" className="h-5 w-5" />
                </div>
              </div>

              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <div className="rounded-2xl bg-[#eef7fb] p-5 ring-1 ring-[#1899d2]/15">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#1769a7] text-white">
                    <ClipboardCheck aria-hidden="true" className="h-5 w-5" />
                  </div>
                  <p className="mt-5 text-xs font-bold uppercase tracking-[0.18em] text-[#1769a7]">
                    BesiktApp
                  </p>
                  <p className="mt-2 text-lg font-semibold leading-6 text-[#173357]">
                    Uppdrag till färdigt utlåtande
                  </p>
                  <div className="mt-5 flex flex-wrap gap-2 text-xs font-semibold text-[#173357]">
                    <span className="rounded-full bg-white px-3 py-1.5">ÖB</span>
                    <span className="rounded-full bg-white px-3 py-1.5">EB</span>
                    <span className="rounded-full bg-white px-3 py-1.5">TU</span>
                  </div>
                </div>

                <div className="rounded-2xl bg-[#f2f7ed] p-5 ring-1 ring-[#62b339]/20">
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#4d962c] text-white">
                    <Files aria-hidden="true" className="h-5 w-5" />
                  </div>
                  <p className="mt-5 text-xs font-bold uppercase tracking-[0.18em] text-[#3e7c24]">
                    RenoApp
                  </p>
                  <p className="mt-2 text-lg font-semibold leading-6 text-[#173357]">
                    Ansökan till tydligt beslut
                  </p>
                  <div className="mt-5 space-y-2 text-xs font-medium text-stone-600">
                    <p className="flex items-center gap-2">
                      <Check aria-hidden="true" className="h-3.5 w-3.5 text-[#4d962c]" /> Rätt underlag
                    </p>
                    <p className="flex items-center gap-2">
                      <Check aria-hidden="true" className="h-3.5 w-3.5 text-[#4d962c]" /> Samlat ärende
                    </p>
                    <p className="flex items-center gap-2">
                      <Check aria-hidden="true" className="h-3.5 w-3.5 text-[#4d962c]" /> Spårbart beslut
                    </p>
                  </div>
                </div>
              </div>

              <div className="mt-4 flex items-start gap-3 rounded-2xl border border-stone-900/10 bg-[#faf9f6] p-4">
                <ShieldCheck aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-[#1769a7]" />
                <p className="text-sm leading-6 text-stone-600">
                  En gemensam grund för inloggning och behörighet – med tydliga arbetsytor för varje
                  uppgift.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="produkter" className="scroll-mt-32 bg-white py-20 sm:py-24">
        <div className="mx-auto max-w-7xl px-5 sm:px-8 lg:px-10">
          <div className="max-w-3xl">
            <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#1769a7]">Produkterna</p>
            <h2 className="mt-4 text-4xl font-semibold tracking-[-0.035em] text-[#172033] sm:text-5xl">
              Börja med det du ska göra
            </h2>
            <p className="mt-5 text-lg leading-8 text-stone-600">
              Du behöver inte förstå hela plattformen. Välj verktyg utifrån din roll och uppgiften
              framför dig.
            </p>
          </div>

          <div className="mt-12 grid gap-6 lg:grid-cols-2">
            <article className="group flex flex-col rounded-[2rem] border border-[#1769a7]/15 bg-[#f3f9fc] p-6 shadow-[0_18px_45px_-32px_rgba(23,105,167,0.4)] sm:p-9">
              <div className="flex min-h-16 items-center rounded-2xl bg-white px-5 py-3 ring-1 ring-[#1769a7]/10">
                <Image
                  src="/landing/BesiktApp.png"
                  alt="BesiktApp"
                  width={220}
                  height={58}
                  className="h-auto w-44 object-contain sm:w-52"
                />
              </div>
              <p className="mt-7 text-xs font-bold uppercase tracking-[0.18em] text-[#1769a7]">
                För besiktningsmän och besiktningsföretag
              </p>
              <h3 className="mt-3 text-3xl font-semibold tracking-[-0.025em] text-[#173357]">
                Från uppdrag till färdigt utlåtande
              </h3>
              <p className="mt-4 text-base leading-7 text-stone-600">
                Håll ihop kunduppgifter, fältarbete, bilder, bedömningar och leverans i samma
                arbetsflöde.
              </p>
              <ul className="mt-7 space-y-3 text-sm font-medium text-stone-700">
                <li className="flex gap-3">
                  <CheckCircle2 aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-[#1769a7]" />
                  Överlåtelsebesiktning (ÖB)
                </li>
                <li className="flex gap-3">
                  <CheckCircle2 aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-[#1769a7]" />
                  Entreprenadbesiktning (EB)
                </li>
                <li className="flex gap-3">
                  <CheckCircle2 aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-[#1769a7]" />
                  Teknisk utredning (TU)
                </li>
              </ul>
              <div className="mt-auto pt-9">
                <button
                  type="button"
                  onClick={() => void handleDashboardEntry('/dashboard-v1')}
                  className={`inline-flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-full bg-[#1769a7] px-6 text-sm font-semibold text-white transition hover:bg-[#125886] ${focusRing}`}
                >
                  Öppna BesiktApp
                  <ArrowRight aria-hidden="true" className="h-4 w-4 transition group-hover:translate-x-0.5" />
                </button>
              </div>
            </article>

            <article className="group flex flex-col rounded-[2rem] border border-[#62b339]/20 bg-[#f5f9f1] p-6 shadow-[0_18px_45px_-32px_rgba(77,150,44,0.35)] sm:p-9">
              <div className="flex min-h-16 items-center rounded-2xl bg-white px-5 py-3 ring-1 ring-[#62b339]/15">
                <Image
                  src="/landing/Renoapp.png"
                  alt="RenoApp"
                  width={220}
                  height={71}
                  className="h-auto w-44 object-contain sm:w-52"
                />
              </div>
              <p className="mt-7 text-xs font-bold uppercase tracking-[0.18em] text-[#3e7c24]">
                För BRF-styrelser och boende
              </p>
              <h3 className="mt-3 text-3xl font-semibold tracking-[-0.025em] text-[#173357]">
                Från renoveringsansökan till beslut
              </h3>
              <p className="mt-4 text-base leading-7 text-stone-600">
                Den boende lämnar rätt uppgifter. Styrelsen granskar, begär komplettering och fattar
                beslut i ett samlat ärende.
              </p>
              <ul className="mt-7 space-y-3 text-sm font-medium text-stone-700">
                <li className="flex gap-3">
                  <CheckCircle2 aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-[#4d962c]" />
                  Guidad ansökan för den boende
                </li>
                <li className="flex gap-3">
                  <CheckCircle2 aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-[#4d962c]" />
                  Underlag och kompletteringar på samma plats
                </li>
                <li className="flex gap-3">
                  <CheckCircle2 aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-[#4d962c]" />
                  Tydlig granskning och dokumenterat beslut
                </li>
              </ul>
              <div className="mt-auto flex flex-col gap-3 pt-9 sm:flex-row sm:flex-wrap">
                <Link
                  href="/renoapp/apply"
                  className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-[#4d962c] px-6 text-sm font-semibold text-white transition hover:bg-[#3e7c24] ${focusRing}`}
                >
                  Skapa ansökan
                  <ArrowRight aria-hidden="true" className="h-4 w-4 transition group-hover:translate-x-0.5" />
                </Link>
                <Link
                  href="/renoapp"
                  className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-full border border-[#4d962c]/35 bg-white px-6 text-sm font-semibold text-[#3e7c24] transition hover:border-[#4d962c]/60 hover:bg-[#f5f9f1] ${focusRing}`}
                >
                  För styrelse och BRF
                  <ArrowRight aria-hidden="true" className="h-4 w-4 transition group-hover:translate-x-0.5" />
                </Link>
              </div>
            </article>
          </div>
        </div>
      </section>

      <section id="sa-fungerar-det" className="scroll-mt-32 border-y border-stone-900/10 py-20 sm:py-24">
        <div className="mx-auto max-w-7xl px-5 sm:px-8 lg:px-10">
          <div className="grid gap-12 lg:grid-cols-[0.72fr_1.28fr] lg:gap-20">
            <div className="lg:sticky lg:top-36 lg:self-start">
              <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#1769a7]">
                Så fungerar det
              </p>
              <h2 className="mt-4 text-4xl font-semibold tracking-[-0.035em] text-[#172033] sm:text-5xl">
                Samma tydliga princip. Olika arbetsflöden.
              </h2>
              <p className="mt-5 text-lg leading-8 text-stone-600">
                Varje verktyg följer hur arbetet faktiskt går till, med nästa steg och rätt underlag
                nära till hands.
              </p>
            </div>

            <div className="space-y-8">
              <article className="rounded-[2rem] border border-stone-900/10 bg-white p-6 shadow-[0_20px_55px_-40px_rgba(23,32,51,0.35)] sm:p-9">
                <div className="flex flex-col justify-between gap-5 border-b border-stone-900/10 pb-7 sm:flex-row sm:items-end">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#1769a7]">
                      BesiktApp
                    </p>
                    <h3 className="mt-2 text-2xl font-semibold text-[#173357]">
                      Tre uppdragstyper, en sammanhållen arbetsyta
                    </h3>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleDashboardEntry('/dashboard-v1')}
                    className={`inline-flex cursor-pointer items-center gap-2 rounded text-sm font-semibold text-[#1769a7] hover:text-[#125886] ${focusRing}`}
                  >
                    Till BesiktApp <ArrowRight aria-hidden="true" className="h-4 w-4" />
                  </button>
                </div>

                <div className="mt-7 grid gap-4 md:grid-cols-3">
                  <div className="rounded-2xl bg-[#eef7fb] p-5">
                    <ClipboardCheck aria-hidden="true" className="h-6 w-6 text-[#1769a7]" />
                    <p className="mt-4 text-xs font-bold uppercase tracking-[0.18em] text-[#1769a7]">ÖB</p>
                    <h4 className="mt-1 font-semibold text-[#173357]">Överlåtelsebesiktning</h4>
                    <p className="mt-3 text-sm leading-6 text-stone-600">
                      Förbered uppdraget, dokumentera byggnaden och sammanställ utlåtandet.
                    </p>
                  </div>
                  <div className="rounded-2xl bg-[#eef7fb] p-5">
                    <FileCheck2 aria-hidden="true" className="h-6 w-6 text-[#1769a7]" />
                    <p className="mt-4 text-xs font-bold uppercase tracking-[0.18em] text-[#1769a7]">EB</p>
                    <h4 className="mt-1 font-semibold text-[#173357]">Entreprenadbesiktning</h4>
                    <p className="mt-3 text-sm leading-6 text-stone-600">
                      Samla handlingar, registrera iakttagelser och leverera ett tydligt resultat.
                    </p>
                  </div>
                  <div className="rounded-2xl bg-[#eef7fb] p-5">
                    <Search aria-hidden="true" className="h-6 w-6 text-[#1769a7]" />
                    <p className="mt-4 text-xs font-bold uppercase tracking-[0.18em] text-[#1769a7]">TU</p>
                    <h4 className="mt-1 font-semibold text-[#173357]">Teknisk utredning</h4>
                    <p className="mt-3 text-sm leading-6 text-stone-600">
                      Följ frågeställningen från undersökning och analys till slutsats.
                    </p>
                  </div>
                </div>
              </article>

              <article className="rounded-[2rem] border border-stone-900/10 bg-white p-6 shadow-[0_20px_55px_-40px_rgba(23,32,51,0.35)] sm:p-9">
                <div className="flex flex-col justify-between gap-5 border-b border-stone-900/10 pb-7 sm:flex-row sm:items-end">
                  <div>
                    <p className="text-xs font-bold uppercase tracking-[0.2em] text-[#3e7c24]">RenoApp</p>
                    <h3 className="mt-2 text-2xl font-semibold text-[#173357]">
                      Ett ärende från ansökan till beslut
                    </h3>
                  </div>
                  <Link
                    href="/renoapp"
                    className={`inline-flex items-center gap-2 rounded text-sm font-semibold text-[#3e7c24] hover:text-[#2f651a] ${focusRing}`}
                  >
                    Till RenoApp <ArrowRight aria-hidden="true" className="h-4 w-4" />
                  </Link>
                </div>

                <ol className="mt-7 grid gap-4 md:grid-cols-3">
                  <li className="relative rounded-2xl bg-[#f2f7ed] p-5">
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#4d962c] text-sm font-bold text-white">
                      1
                    </span>
                    <h4 className="mt-4 font-semibold text-[#173357]">Ansökan</h4>
                    <p className="mt-2 text-sm leading-6 text-stone-600">
                      Den boende beskriver åtgärden i ett guidat flöde.
                    </p>
                  </li>
                  <li className="relative rounded-2xl bg-[#f2f7ed] p-5">
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#4d962c] text-sm font-bold text-white">
                      2
                    </span>
                    <h4 className="mt-4 font-semibold text-[#173357]">Underlag</h4>
                    <p className="mt-2 text-sm leading-6 text-stone-600">
                      Dokument och kompletteringar samlas i samma ärende.
                    </p>
                  </li>
                  <li className="relative rounded-2xl bg-[#f2f7ed] p-5">
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#4d962c] text-sm font-bold text-white">
                      3
                    </span>
                    <h4 className="mt-4 font-semibold text-[#173357]">Beslut</h4>
                    <p className="mt-2 text-sm leading-6 text-stone-600">
                      Styrelsen granskar och dokumenterar ett tydligt beslut.
                    </p>
                  </li>
                </ol>
              </article>
            </div>
          </div>
        </div>
      </section>

      <section id="om-hushub" className="scroll-mt-32 bg-[#173357] py-20 text-white sm:py-24">
        <div className="mx-auto grid max-w-7xl gap-12 px-5 sm:px-8 lg:grid-cols-[1fr_0.9fr] lg:items-center lg:px-10">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#71c8ee]">
              Utvecklas inför lansering
            </p>
            <h2 className="mt-4 max-w-[15ch] text-4xl font-semibold tracking-[-0.035em] sm:text-5xl">
              Byggt nära det verkliga arbetet
            </h2>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-white/75">
              HusHub används i dag i det dagliga arbetet och vidareutvecklas steg för steg inför en
              bredare lansering. Fokus ligger på tydlighet, spårbarhet och mindre dubbelarbete i
              varje ärende.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
            <div className="flex items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.06] p-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#2099d0]">
                <ClipboardCheck aria-hidden="true" className="h-5 w-5" />
              </div>
              <p className="font-medium">Utgår från verkliga arbetsflöden</p>
            </div>
            <div className="flex items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.06] p-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#4d962c]">
                <ShieldCheck aria-hidden="true" className="h-5 w-5" />
              </div>
              <p className="font-medium">Tydliga roller och behörigheter</p>
            </div>
            <div className="flex items-center gap-4 rounded-2xl border border-white/10 bg-white/[0.06] p-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/15">
                <Layers3 aria-hidden="true" className="h-5 w-5" />
              </div>
              <p className="font-medium">En gemensam plattform som kan växa</p>
            </div>
          </div>
        </div>
      </section>

      <section id="fragor" className="scroll-mt-32 bg-white py-20 sm:py-24">
        <div className="mx-auto grid max-w-7xl gap-12 px-5 sm:px-8 lg:grid-cols-[0.72fr_1.28fr] lg:gap-20 lg:px-10">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.22em] text-[#1769a7]">
              Vanliga frågor
            </p>
            <h2 className="mt-4 text-4xl font-semibold tracking-[-0.035em] text-[#172033] sm:text-5xl">
              Rätt väg in
            </h2>
            <p className="mt-5 text-lg leading-8 text-stone-600">
              HusHub är den gemensamma plattformen. Produkterna är anpassade efter olika roller och
              uppgifter.
            </p>
          </div>

          <div className="divide-y divide-stone-900/10 border-y border-stone-900/10">
            <details className="group py-6">
              <summary className={`flex cursor-pointer list-none items-center justify-between gap-5 rounded font-semibold text-[#173357] ${focusRing}`}>
                Är HusHub samma sak som BesiktApp och RenoApp?
                <span className="text-2xl font-light text-[#1769a7] transition group-open:rotate-45" aria-hidden="true">
                  +
                </span>
              </summary>
              <p className="max-w-2xl pt-4 text-base leading-7 text-stone-600">
                HusHub är den gemensamma plattformen och avsändaren. BesiktApp och RenoApp är två
                specialiserade verktyg för olika arbetsflöden.
              </p>
            </details>
            <details className="group py-6">
              <summary className={`flex cursor-pointer list-none items-center justify-between gap-5 rounded font-semibold text-[#173357] ${focusRing}`}>
                Vem ska använda BesiktApp?
                <span className="text-2xl font-light text-[#1769a7] transition group-open:rotate-45" aria-hidden="true">
                  +
                </span>
              </summary>
              <p className="max-w-2xl pt-4 text-base leading-7 text-stone-600">
                BesiktApp är arbetsytan för besiktningsmän och besiktningsföretag som arbetar med
                överlåtelsebesiktning, entreprenadbesiktning eller teknisk utredning.
              </p>
            </details>
            <details className="group py-6">
              <summary className={`flex cursor-pointer list-none items-center justify-between gap-5 rounded font-semibold text-[#173357] ${focusRing}`}>
                Behöver en boende ett konto för att använda RenoApp?
                <span className="text-2xl font-light text-[#1769a7] transition group-open:rotate-45" aria-hidden="true">
                  +
                </span>
              </summary>
              <p className="max-w-2xl pt-4 text-base leading-7 text-stone-600">
                Den boende följer föreningens väg till ansökan och lämnar sina uppgifter där.
                Styrelsen arbetar vidare med granskning och beslut i sin egen arbetsyta.
              </p>
            </details>
            <details className="group py-6">
              <summary className={`flex cursor-pointer list-none items-center justify-between gap-5 rounded font-semibold text-[#173357] ${focusRing}`}>
                Kan jag använda tjänsterna redan nu?
                <span className="text-2xl font-light text-[#1769a7] transition group-open:rotate-45" aria-hidden="true">
                  +
                </span>
              </summary>
              <p className="max-w-2xl pt-4 text-base leading-7 text-stone-600">
                Plattformen används och utvecklas i begränsad omfattning inför en bredare lansering.
                Har du redan fått tillgång kan du logga in via knappen högst upp.
              </p>
            </details>
          </div>
        </div>
      </section>

      <footer className="border-t border-stone-900/10 bg-[#f7f5f0]">
        <div className="mx-auto flex max-w-7xl flex-col gap-7 px-5 py-9 sm:px-8 md:flex-row md:items-center md:justify-between lg:px-10">
          <div className="flex items-center gap-3">
            <Image
              src="/landing/Hushub-check2.png"
              alt=""
              width={36}
              height={36}
              className="h-8 w-8 object-contain"
            />
            <div>
              <p className="text-sm font-bold uppercase tracking-[0.22em] text-[#173357]">HusHub</p>
              <p className="mt-1 text-xs text-stone-500">BesiktApp och RenoApp på en gemensam grund.</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-6 gap-y-3 text-sm font-medium text-stone-600">
            <a href="#produkter" className={`rounded transition hover:text-[#173357] ${focusRing}`}>
              Produkter
            </a>
            <a href="#fragor" className={`rounded transition hover:text-[#173357] ${focusRing}`}>
              Vanliga frågor
            </a>
            <button
              type="button"
              onClick={() => void handleDashboardEntry()}
              className={`cursor-pointer rounded font-semibold text-[#173357] transition hover:text-[#1769a7] ${focusRing}`}
            >
              Logga in
            </button>
          </div>
        </div>
      </footer>
    </main>
  )
}
