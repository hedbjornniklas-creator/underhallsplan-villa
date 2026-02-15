'use client'

import Link from 'next/link'
import Protected from '@/components/Protected'
import { ArrowRight, ClipboardCheck, ListChecks } from 'lucide-react'

type ModuleCardData = {
  id: string
  title: string
  description: string
  href: string
  primaryActionLabel: string
  secondaryLinkLabel: string
  secondaryHref: string
}

const MODULES: ModuleCardData[] = [
  {
    id: 'ob',
    title: 'Överlåtelsebesiktning',
    description:
      'Skapa och hantera överlåtelsebesiktningar med fokus på ett enkelt operativt flöde.',
    href: '/inspections',
    primaryActionLabel: 'Öppna modul',
    secondaryLinkLabel: 'Visa alla besiktningar',
    secondaryHref: '/ob',
  },
]

function ModuleCard({ module }: { module: ModuleCardData }) {
  return (
    <article className="group relative aspect-square h-full overflow-hidden rounded-2xl border border-white/40 bg-white/90 p-5 shadow-2xl ring-1 ring-black/5 backdrop-blur-md transition-all duration-300 ease-out hover:-translate-y-1 hover:shadow-[0_30px_70px_-26px_rgba(15,23,42,0.65)] md:p-6">
      <div className="pointer-events-none absolute inset-y-0 left-0 w-1.5 bg-gradient-to-b from-indigo-500 to-sky-400" />
      <div className="pointer-events-none absolute left-4 right-4 top-0 h-px bg-white/60" />
      <div className="relative flex h-full flex-col">
        <div className="space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-100 text-indigo-700 ring-1 ring-indigo-200/70">
                <ClipboardCheck size={20} aria-hidden />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-gray-900 md:text-xl">{module.title}</h2>
                <p className="mt-1 text-sm leading-relaxed text-gray-700">{module.description}</p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <span className="inline-flex shrink-0 items-center rounded-full border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700">
              Aktiv modul
            </span>
          </div>
        </div>

        <div className="mt-auto flex flex-col gap-3 pt-4">
          <Link
            href={module.href}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-lg transition-all duration-300 ease-out hover:-translate-y-0.5 hover:bg-indigo-700 hover:shadow-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
          >
            {module.primaryActionLabel}
            <ArrowRight size={16} aria-hidden />
          </Link>
          <Link
            href={module.secondaryHref}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-gray-200 bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 shadow-sm transition-all duration-300 ease-out hover:-translate-y-0.5 hover:bg-gray-200 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
          >
            <ListChecks size={16} aria-hidden />
            {module.secondaryLinkLabel}
          </Link>
        </div>
      </div>
    </article>
  )
}

export default function DashboardV1Page() {
  return (
    <Protected>
      <main className="relative min-h-full overflow-hidden">
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              'radial-gradient(120% 88% at 52% 6%, rgba(140,171,255,0.45) 0%, rgba(140,171,255,0) 58%), radial-gradient(92% 72% at 24% 44%, rgba(160,235,255,0.48) 0%, rgba(160,235,255,0) 64%), radial-gradient(88% 70% at 74% 82%, rgba(181,156,255,0.24) 0%, rgba(181,156,255,0) 66%), linear-gradient(145deg, #f4f7ff 0%, #eef4ff 42%, #f6f8ff 100%)',
          }}
        />
        <div className="pointer-events-none absolute inset-0 bg-white/20 backdrop-blur-[2px]" />

        <div className="relative mx-auto w-full max-w-6xl px-4 py-8 md:px-6 md:py-12">
          <header className="mx-auto max-w-4xl text-center">
            <h1 className="text-xs font-semibold uppercase tracking-[0.26em] text-indigo-900/70">
              Dashboard v1
            </h1>
          </header>

          <section className="mx-auto mt-10 grid w-full max-w-6xl grid-cols-1 gap-5 place-items-center sm:grid-cols-2 sm:place-items-stretch lg:grid-cols-3">
            {MODULES.map((module, index) => {
              const centerSingleCard = MODULES.length === 1 && index === 0
              return (
                <div
                  key={module.id}
                  className={`w-full max-w-md sm:max-w-none ${centerSingleCard ? 'lg:col-start-2' : ''}`}
                >
                  <ModuleCard module={module} />
                </div>
              )
            })}
          </section>
        </div>
      </main>
    </Protected>
  )
}
