import type { ReactNode } from 'react'
import Link from 'next/link'
import RenoAppAuthGuard from '@/components/renoapp/RenoAppAuthGuard'

const NAV_ITEMS = [
  { href: '/renoapp/app', label: 'Översikt' },
  { href: '/renoapp/app/cases', label: 'Ärenden' },
  { href: '/renoapp/app/units', label: 'Lägenheter' },
]

export default function RenoAppAppLayout({ children }: { children: ReactNode }) {
  return (
    <RenoAppAuthGuard>
      <div className="min-h-screen bg-[linear-gradient(180deg,#f5efe6_0%,#f4f1eb_52%,#fbfaf8_100%)]">
        <header className="border-b border-stone-200/80 bg-white/75 backdrop-blur">
          <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-6 py-5 md:flex-row md:items-center md:justify-between md:px-10">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.24em] text-stone-500">RenoApp</p>
              <h1 className="mt-1 text-2xl font-semibold tracking-tight text-stone-900">Styrelseportal</h1>
            </div>
            <nav className="flex flex-wrap gap-2">
              {NAV_ITEMS.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className="rounded-full border border-stone-300 bg-white/80 px-4 py-2 text-sm font-semibold text-stone-800 transition hover:bg-stone-100"
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl px-6 py-10 md:px-10">{children}</main>
      </div>
    </RenoAppAuthGuard>
  )
}
