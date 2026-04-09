'use client'

import Link from 'next/link'
import Protected from '@/components/Protected'

const ADMIN_APPS = [
  {
    href: '/admin/besiktapp',
    title: 'BesiktApp admin',
    description:
      'Systeminställningar för dokument, komponenter, kontrollpunkter, certifieringar och övriga besiktningsflöden.',
  },
  {
    href: '/admin/renoapp',
    title: 'RenoApp admin',
    description: 'Onboarding för BRF, renoveringstyper, dokumenttyper och krav för ansökningsguiden.',
  },
] as const

export default function AdminLandingClient() {
  return (
    <Protected>
      <main className="mx-auto w-full max-w-6xl px-4 py-8 md:px-6 md:py-10">
        <section className="rounded-[32px] border border-stone-200/80 bg-[linear-gradient(145deg,rgba(255,251,247,0.98),rgba(245,242,238,0.94))] p-8 shadow-[0_24px_70px_-40px_rgba(41,37,36,0.45)]">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-stone-500">Intern admin</p>
          <h1 className="mt-4 text-4xl font-semibold tracking-tight text-stone-900">Välj adminområde</h1>
          <p className="mt-4 max-w-3xl text-base leading-8 text-stone-700">
            Admin är nu uppdelat per produkt. Öppna rätt modul direkt i stället för att blanda
            BesiktApp och RenoApp i samma vy.
          </p>
        </section>

        <section className="mt-6 grid gap-5 md:grid-cols-2">
          {ADMIN_APPS.map((app) => (
            <Link
              key={app.href}
              href={app.href}
              className="rounded-[28px] border border-stone-200/80 bg-white/92 p-7 shadow-[0_24px_70px_-40px_rgba(41,37,36,0.38)] transition hover:-translate-y-0.5 hover:border-stone-300 hover:bg-white"
            >
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-stone-500">Adminmodul</p>
              <h2 className="mt-4 text-2xl font-semibold text-stone-900">{app.title}</h2>
              <p className="mt-3 text-sm leading-7 text-stone-700">{app.description}</p>
              <div className="mt-6 inline-flex rounded-full border border-stone-300 px-4 py-2 text-sm font-semibold text-stone-800">
                Öppna
              </div>
            </Link>
          ))}
        </section>
      </main>
    </Protected>
  )
}
