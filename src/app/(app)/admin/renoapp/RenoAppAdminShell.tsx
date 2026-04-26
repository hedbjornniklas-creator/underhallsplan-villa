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
      <div className="space-y-4">
        <div className="w-full border-b border-stone-200 bg-white/92 px-4 py-4 backdrop-blur-sm md:px-6">
          <div className="flex items-center gap-4">
            <div className="shrink-0 border-r border-stone-200 pr-4">
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-stone-500">RenoApp admin</p>
              <h1 className="mt-1 text-sm font-semibold text-stone-900">Systeminställningar och onboarding</h1>
            </div>

            <nav className="min-w-0 flex-1 overflow-x-auto" aria-label="RenoApp admin navigation">
              <div className="flex w-max items-center gap-2 whitespace-nowrap pr-2">
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
              </div>
            </nav>
          </div>
        </div>

        {children}
      </div>
    </Protected>
  )
}
