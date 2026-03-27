'use client'

import Link from 'next/link'
import Protected from '@/components/Protected'
import { useProfile } from '@/hooks/useProfile'

const CONFIG_SECTIONS = [
  {
    title: 'BRF-inställningar',
    description: 'Slug, publik ansökningsstatus, kontaktuppgifter och introtext.',
    tables: ['brf_associations', 'brf_members'],
  },
  {
    title: 'Dokumentkonfiguration',
    description: 'Åtgärdstyper, dokumenttyper och BRF-specifika krav per åtgärd.',
    tables: ['renovation_action_types', 'renovation_document_types', 'renovation_action_document_requirements'],
  },
  {
    title: 'Öppen ärendeåtkomst',
    description: 'Översikt för access links, spärrning och manuell uppföljning.',
    tables: ['renovation_cases', 'case_access_links'],
  },
]

export default function RenoAppAdminClient() {
  const { isAdmin, loading } = useProfile()

  return (
    <Protected>
      <main className="mx-auto w-full max-w-6xl px-4 py-8 md:px-6 md:py-10">
        <section className="rounded-[32px] border border-stone-200/80 bg-white/90 p-8 shadow-[0_24px_70px_-40px_rgba(41,37,36,0.48)]">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-stone-500">Intern RenoApp-admin</p>
          <h1 className="mt-4 text-4xl font-semibold tracking-tight text-stone-900">Konfiguration utan påverkan på befintliga moduler</h1>
          <p className="mt-4 max-w-3xl text-base leading-8 text-stone-700">
            Den här sidan är ett separat administrativt startläge för RenoApp. Allt som visas här bygger på nya, additiva tabeller och påverkar inte existerande OB- eller dashboardlogik.
          </p>
        </section>

        {loading ? (
          <div className="mt-6 rounded-3xl border border-stone-200 bg-white/85 p-6 text-sm text-stone-600">Laddar behörighet...</div>
        ) : !isAdmin ? (
          <div className="mt-6 rounded-3xl border border-rose-200 bg-rose-50 p-6 text-sm text-rose-800">
            Den här sidan är bara avsedd för administratörer.
          </div>
        ) : (
          <>
            <section className="mt-6 grid gap-5 lg:grid-cols-3">
              {CONFIG_SECTIONS.map((section) => (
                <article key={section.title} className="rounded-[28px] border border-stone-200/80 bg-white/90 p-6 shadow-[0_24px_70px_-40px_rgba(41,37,36,0.48)]">
                  <h2 className="text-xl font-semibold text-stone-900">{section.title}</h2>
                  <p className="mt-3 text-sm leading-7 text-stone-700">{section.description}</p>
                  <ul className="mt-4 list-disc space-y-1 pl-5 text-xs uppercase tracking-[0.12em] text-stone-500">
                    {section.tables.map((tableName) => (
                      <li key={tableName}>{tableName}</li>
                    ))}
                  </ul>
                </article>
              ))}
            </section>

            <section className="mt-6 rounded-[32px] border border-stone-200/80 bg-[linear-gradient(145deg,rgba(255,251,245,0.96),rgba(247,242,235,0.9))] p-8 shadow-[0_24px_70px_-40px_rgba(41,37,36,0.48)]">
              <h2 className="text-2xl font-semibold text-stone-900">Nästa adminsteg</h2>
              <div className="mt-5 grid gap-3 text-sm leading-7 text-stone-700 md:grid-cols-2">
                <div className="rounded-2xl border border-stone-200 bg-white/80 p-4">
                  1. CRUD för BRF-poster och publik ansökningsstatus.
                </div>
                <div className="rounded-2xl border border-stone-200 bg-white/80 p-4">
                  2. CRUD för åtgärdstyper, dokumenttyper och krav per BRF.
                </div>
                <div className="rounded-2xl border border-stone-200 bg-white/80 p-4">
                  3. Översikt för `case_access_links` med återkallelse och spärr.
                </div>
                <div className="rounded-2xl border border-stone-200 bg-white/80 p-4">
                  4. Koppling till RenoApps styrelsevy när runtime-logiken byggs på.
                </div>
              </div>

              <div className="mt-8 flex flex-wrap gap-3">
                <Link href="/renoapp" className="rounded-full border border-stone-300 px-4 py-2 text-sm font-semibold text-stone-800 transition hover:bg-stone-100">
                  Till RenoApp-start
                </Link>
                <Link href="/renoapp/app" className="rounded-full bg-stone-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-stone-700">
                  Till styrelseportalen
                </Link>
              </div>
            </section>
          </>
        )}
      </main>
    </Protected>
  )
}
