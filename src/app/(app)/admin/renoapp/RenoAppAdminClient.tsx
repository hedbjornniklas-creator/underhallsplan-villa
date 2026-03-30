'use client'

import Link from 'next/link'
import Protected from '@/components/Protected'
import { useProfile } from '@/hooks/useProfile'

const CONFIG_SECTIONS = [
  {
    title: 'BRF-onboarding',
    description: 'Adminskapad BRF, publika intresseanmälningar och invite-styrd styrelseaktivering.',
    links: [
      { href: '/admin/renoapp/brf/create', label: 'Skapa BRF' },
      { href: '/admin/renoapp/brf-requests', label: 'Hantera intresseanmälningar' },
    ],
  },
  {
    title: 'BRF-inställningar',
    description: 'Slug, publik ansökningsstatus, kontaktuppgifter och introtext för godkända BRF:er.',
    links: [{ href: '/admin/renoapp/brf/create', label: 'Skapa ny BRF' }],
  },
  {
    title: 'Ansökningsguide',
    description: 'Styr vilka renoveringstyper som visas för boende och vilka dokument som krävs för varje val.',
    links: [
      { href: '/admin/renoapp/action-types', label: 'Renoveringstyper' },
      { href: '/admin/renoapp/document-types', label: 'Dokumenttyper' },
      { href: '/admin/renoapp/requirements', label: 'Dokumentkrav' },
    ],
  },
  {
    title: 'Drift och handläggning',
    description: 'Översikt för invites, access links och vidare konfiguration av RenoApp-flöden.',
    links: [{ href: '/renoapp/app', label: 'Öppna styrelseportalen' }],
  },
]

export default function RenoAppAdminClient() {
  const { isAdmin, loading } = useProfile()

  return (
    <Protected>
      <main className="mx-auto w-full max-w-6xl px-4 py-8 md:px-6 md:py-10">
        <section className="rounded-[32px] border border-stone-200/80 bg-white/90 p-8 shadow-[0_24px_70px_-40px_rgba(41,37,36,0.48)]">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-stone-500">Intern RenoApp-admin</p>
          <h1 className="mt-4 text-4xl font-semibold tracking-tight text-stone-900">
            Kontrollerad BRF-onboarding för MVP
          </h1>
          <p className="mt-4 max-w-3xl text-base leading-8 text-stone-700">
            RenoApp använder i MVP ingen fri BRF-signup. Härifrån skapar admin BRF:er, granskar
            intresseanmälningar och styr hur den publika ansökan fungerar för boende.
          </p>
        </section>

        {loading ? (
          <div className="mt-6 rounded-3xl border border-stone-200 bg-white/85 p-6 text-sm text-stone-600">
            Laddar behörighet...
          </div>
        ) : !isAdmin ? (
          <div className="mt-6 rounded-3xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-800">
            Den här sidan är bara avsedd för administratörer.
          </div>
        ) : (
          <>
            <section className="mt-6 grid gap-5 lg:grid-cols-2">
              {CONFIG_SECTIONS.map((section) => (
                <article
                  key={section.title}
                  className="rounded-[28px] border border-stone-200/80 bg-white/90 p-6 shadow-[0_24px_70px_-40px_rgba(41,37,36,0.48)]"
                >
                  <h2 className="text-xl font-semibold text-stone-900">{section.title}</h2>
                  <p className="mt-3 text-sm leading-7 text-stone-700">{section.description}</p>
                  <div className="mt-5 flex flex-wrap gap-3">
                    {section.links.map((link) => (
                      <Link
                        key={link.href}
                        href={link.href}
                        className="rounded-full border border-stone-300 px-4 py-2 text-sm font-semibold text-stone-800 transition hover:bg-stone-100"
                      >
                        {link.label}
                      </Link>
                    ))}
                  </div>
                </article>
              ))}
            </section>

            <section className="mt-6 rounded-[32px] border border-stone-200/80 bg-[linear-gradient(145deg,rgba(255,251,245,0.96),rgba(247,242,235,0.9))] p-8 shadow-[0_24px_70px_-40px_rgba(41,37,36,0.48)]">
              <h2 className="text-2xl font-semibold text-stone-900">Aktiva nästa steg</h2>
              <div className="mt-5 grid gap-3 text-sm leading-7 text-stone-700 md:grid-cols-2">
                <div className="rounded-2xl border border-stone-200 bg-white/80 p-4">
                  1. Skapa BRF manuellt och skicka första styrelse-inviten.
                </div>
                <div className="rounded-2xl border border-stone-200 bg-white/80 p-4">
                  2. Granska publika BRF-intresseanmälningar och godkänn vid behov.
                </div>
                <div className="rounded-2xl border border-stone-200 bg-white/80 p-4">
                  3. Styr vilka renoveringstyper boende kan välja och vilka dokument som krävs.
                </div>
                <div className="rounded-2xl border border-stone-200 bg-white/80 p-4">
                  4. Följ vidare onboarding via invite-länk och styrelselogin.
                </div>
              </div>
            </section>
          </>
        )}
      </main>
    </Protected>
  )
}
