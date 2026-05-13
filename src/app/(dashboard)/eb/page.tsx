'use client'

import Link from 'next/link'
import { ArrowLeft, ClipboardCheck, FileText, Mail, Settings } from 'lucide-react'
import Protected from '@/components/Protected'

type EbCard = {
  title: string
  subtitle: string
  href: string
  icon: typeof ClipboardCheck
  state: 'active' | 'planned'
}

const CARDS: EbCard[] = [
  {
    title: 'Slutbesiktning',
    subtitle: 'SB',
    href: '/eb/sb',
    icon: ClipboardCheck,
    state: 'planned',
  },
  {
    title: 'Kallelser',
    subtitle: 'Utskick',
    href: '/eb/invitations',
    icon: Mail,
    state: 'planned',
  },
  {
    title: 'Utlåtanden',
    subtitle: 'PDF',
    href: '/eb/reports',
    icon: FileText,
    state: 'planned',
  },
  {
    title: 'Inställningar',
    subtitle: 'Profil',
    href: '/settings',
    icon: Settings,
    state: 'active',
  },
]

function ModuleCard({ card }: { card: EbCard }) {
  const Icon = card.icon
  const isActive = card.state === 'active'
  const content = (
    <article className="group relative flex aspect-square h-full flex-col overflow-hidden rounded-lg border border-emerald-100 bg-white/92 p-4 shadow-xl ring-1 ring-black/5 backdrop-blur-md transition hover:-translate-y-1 hover:shadow-[0_26px_60px_-32px_rgba(20,83,45,0.8)]">
      <div className="pointer-events-none absolute inset-y-0 left-0 w-1.5 bg-gradient-to-b from-emerald-500 to-lime-400" />
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-emerald-700">
            {card.subtitle}
          </p>
          <h2 className="mt-2 text-xl font-semibold tracking-tight text-gray-950">{card.title}</h2>
        </div>
        <span className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-emerald-200 bg-emerald-50 text-emerald-700">
          <Icon size={20} strokeWidth={2.2} />
        </span>
      </div>
      <div className="mt-auto">
        <span
          className={`inline-flex rounded-full px-3 py-1 text-xs font-semibold ${
            isActive ? 'bg-emerald-600 text-white' : 'bg-emerald-50 text-emerald-700'
          }`}
        >
          {isActive ? 'Öppna' : 'Kommer'}
        </span>
      </div>
    </article>
  )

  if (!isActive) {
    return <div className="cursor-not-allowed opacity-75">{content}</div>
  }

  return (
    <Link href={card.href} aria-label={`Öppna ${card.title}`} className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2">
      {content}
    </Link>
  )
}

export default function EntreprenadbesiktningPage() {
  return (
    <Protected>
      <main className="relative min-h-full overflow-hidden">
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            backgroundImage:
              'radial-gradient(100% 72% at 50% 0%, rgba(220,252,231,0.78) 0%, rgba(220,252,231,0) 62%), linear-gradient(135deg, #ecfdf3 0%, #dcfce7 48%, #bbf7d0 100%)',
          }}
        />
        <div className="pointer-events-none absolute inset-0 bg-white/20 backdrop-blur-[1px]" />

        <div className="relative mx-auto w-full max-w-7xl p-4 md:p-6">
          <header className="mx-auto w-full max-w-7xl rounded-lg border border-white/70 bg-white/75 p-4 shadow-sm backdrop-blur-sm md:p-5">
            <div className="flex items-center gap-3">
              <Link
                href="/dashboard-v1"
                aria-label="Tillbaka"
                title="Tillbaka"
                className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-emerald-200 bg-white text-emerald-800 transition hover:bg-emerald-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
              >
                <ArrowLeft size={16} strokeWidth={2} />
              </Link>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700">EB</p>
                <h1 className="text-2xl font-semibold text-gray-950">Entreprenadbesiktning</h1>
              </div>
            </div>
          </header>

          <section className="mx-auto mt-4 grid w-full max-w-7xl grid-cols-1 gap-5 place-items-center sm:grid-cols-2 sm:place-items-stretch lg:grid-cols-4">
            {CARDS.map((card) => (
              <div key={card.title} className="w-full max-w-[260px] sm:max-w-[300px]">
                <ModuleCard card={card} />
              </div>
            ))}
          </section>
        </div>
      </main>
    </Protected>
  )
}
