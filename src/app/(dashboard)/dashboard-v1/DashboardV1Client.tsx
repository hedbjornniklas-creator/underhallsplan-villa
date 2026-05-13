'use client'

import Link from 'next/link'
import Image from 'next/image'
import Protected from '@/components/Protected'
import { Power } from 'lucide-react'

export type ModuleCardData = {
  id: string
  title: string
  description: string
  href: string
  accentClass: string
  badgeClass: string
}

function ModuleCard({ module }: { module: ModuleCardData }) {
  return (
    <article className="group relative aspect-square h-full overflow-hidden rounded-lg border border-white/40 bg-white/90 p-5 shadow-2xl ring-1 ring-black/5 backdrop-blur-md transition-all duration-300 ease-out hover:-translate-y-1 hover:shadow-[0_30px_70px_-26px_rgba(15,23,42,0.65)] md:p-6">
      <div className={`pointer-events-none absolute inset-y-0 left-0 w-1.5 bg-gradient-to-b ${module.accentClass}`} />
      <div className="pointer-events-none absolute left-4 right-4 top-0 h-px bg-white/60" />
      <div className="relative flex h-full flex-col">
        <div className="space-y-3">
          <div className="flex items-start justify-between gap-3">
            <Image
              src="/landing/BesiktApp.png"
              alt="BesiktApp"
              width={120}
              height={28}
              className="h-6 w-auto object-contain"
            />
            <span className={`mt-0.5 inline-flex shrink-0 items-center rounded-full border px-2.5 py-1 text-xs font-medium ${module.badgeClass}`}>
              Aktiv modul
            </span>
          </div>

          <h2 className="text-2xl font-semibold leading-tight tracking-tight text-gray-900 md:text-3xl">
            {module.title}
          </h2>

          <p className="text-sm leading-relaxed text-gray-700">{module.description}</p>
        </div>

        <div className="flex flex-1 items-center justify-center">
          <Link
            href={module.href}
            aria-label={`Öppna ${module.title}`}
            title={`Öppna ${module.title}`}
            className="inline-flex h-28 w-28 cursor-pointer items-center justify-center rounded-full bg-gradient-to-b from-lime-400 to-green-600 p-[9px] shadow-[0_16px_26px_-16px_rgba(22,101,52,0.85)] transition-all duration-300 ease-out hover:-translate-y-1 hover:scale-105 hover:from-cyan-400 hover:to-blue-600 hover:shadow-[0_22px_34px_-10px_rgba(14,165,233,0.98)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2"
          >
            <span className="flex h-full w-full items-center justify-center rounded-full bg-white ring-1 ring-black/10 shadow-inner transition-all duration-300 hover:bg-slate-50">
              <Power
                size={42}
                aria-hidden
                className="text-gray-500 transition-transform duration-300 ease-out group-hover:rotate-12 group-hover:scale-110"
                strokeWidth={2.25}
              />
            </span>
          </Link>
        </div>
      </div>
    </article>
  )
}

export default function DashboardV1Client({ modules }: { modules: ModuleCardData[] }) {
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
              Dashboard
            </h1>
          </header>

          {modules.length === 0 ? (
            <section className="mx-auto mt-10 max-w-xl rounded-lg border border-amber-200 bg-white/90 p-5 text-center shadow-sm">
              <h2 className="text-base font-semibold text-gray-900">Inga aktiva moduler</h2>
              <p className="mt-2 text-sm leading-6 text-gray-600">
                Din Dashboard-access är aktiv, men ingen besiktningsmodul är tilldelad.
              </p>
            </section>
          ) : (
            <section className="mx-auto mt-10 grid w-full max-w-6xl grid-cols-1 gap-5 place-items-center sm:grid-cols-2 sm:place-items-stretch lg:grid-cols-3">
              {modules.map((module, index) => {
                const centerSingleCard = modules.length === 1 && index === 0
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
          )}
        </div>
      </main>
    </Protected>
  )
}
