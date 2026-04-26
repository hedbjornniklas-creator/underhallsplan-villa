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
  const primaryTabs = RENOAPP_ADMIN_TABS.slice(0, 5)
  const secondaryTabs = RENOAPP_ADMIN_TABS.slice(5)

  return (
    <Protected>
      <div className="space-y-4">
        <div className="w-full border-b border-stone-200 bg-white/92 px-4 pb-4 pt-6 backdrop-blur-sm md:px-6 md:pt-8">
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-stone-500">RenoApp admin</p>
                <h1 className="mt-1 text-xl font-semibold tracking-tight text-stone-900">Systeminställningar och onboarding</h1>
              </div>
              <div className="text-sm text-stone-700">
                Visar nu: <span className="font-semibold text-stone-900">{activeTab.label}</span>
              </div>
            </div>

            <nav className="flex flex-wrap gap-2" aria-label="RenoApp admin navigation primary">
              {primaryTabs.map((tab) => {
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

            <nav className="flex flex-wrap gap-2" aria-label="RenoApp admin navigation secondary">
              {secondaryTabs.map((tab) => {
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
          </div>
        </div>

        {children}
      </div>
    </Protected>
  )
}
