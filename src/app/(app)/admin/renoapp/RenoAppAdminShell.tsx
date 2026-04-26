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
          <div className="flex items-center gap-3">
            <div className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.22em] text-stone-500">
              RenoApp admin
            </div>

            <nav className="min-w-0 flex-1 overflow-x-auto" aria-label="RenoApp admin navigation">
              <div className="flex w-max items-center gap-4 whitespace-nowrap pr-2">
                {RENOAPP_ADMIN_TABS.map((tab) => {
                  const active = tab.href === activeTab.href
                  return (
                    <Link
                      key={tab.href}
                      href={tab.href}
                      className={`border-b-2 px-1 py-1 text-xs font-semibold transition ${
                        active
                          ? 'border-stone-900 text-stone-900'
                          : 'border-transparent text-stone-600 hover:border-stone-300 hover:text-stone-900'
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
