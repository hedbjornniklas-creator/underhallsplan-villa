'use client'

import type { ReactNode } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import Protected from '@/components/Protected'
import { RENOAPP_ADMIN_TABS } from '@/lib/admin/navigation'

export default function RenoAppAdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const activeTab =
    RENOAPP_ADMIN_TABS.find((tab) => tab.match(pathname)) ?? RENOAPP_ADMIN_TABS[0]

  return (
    <Protected>
      <div className="space-y-6">
        <div className="mx-auto w-full max-w-7xl px-4 pt-8 md:px-6 md:pt-10">
          <section className="rounded-[32px] border border-stone-200/80 bg-[linear-gradient(145deg,rgba(255,251,247,0.98),rgba(245,242,238,0.94))] p-6 shadow-[0_24px_70px_-40px_rgba(41,37,36,0.45)]">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.24em] text-stone-500">RenoApp admin</p>
                <h1 className="mt-3 text-3xl font-semibold tracking-tight text-stone-900">Systeminställningar och onboarding</h1>
                <p className="mt-3 max-w-3xl text-sm leading-7 text-stone-700">
                  Byt mellan RenoApps olika adminytor här uppe i stället för att hoppa via separata startsidor.
                </p>
              </div>
              <div className="rounded-2xl border border-stone-200 bg-white/85 px-4 py-3 text-sm text-stone-700">
                Visar nu: <span className="font-semibold text-stone-900">{activeTab.label}</span>
              </div>
            </div>

            <nav className="mt-5 flex flex-wrap gap-2" aria-label="RenoApp admin navigation">
              {RENOAPP_ADMIN_TABS.map((tab) => {
                const active = tab.href === activeTab.href
                return (
                  <Link
                    key={tab.href}
                    href={tab.href}
                    className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                      active
                        ? 'bg-stone-900 text-white'
                        : 'border border-stone-300 bg-white text-stone-800 hover:bg-stone-100'
                    }`}
                  >
                    {tab.label}
                  </Link>
                )
              })}
            </nav>
          </section>
        </div>

        {children}
      </div>
    </Protected>
  )
}
