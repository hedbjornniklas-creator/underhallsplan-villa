'use client'

import type { ReactNode } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import Protected from '@/components/Protected'
import { RENOAPP_ADMIN_SETTINGS_TABS, RENOAPP_ADMIN_TABS } from '@/lib/admin/navigation'

export default function RenoAppAdminShell({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const activeTab = RENOAPP_ADMIN_TABS.find((tab) => tab.match(pathname))
  const activeSettingsTab = RENOAPP_ADMIN_SETTINGS_TABS.find((tab) => tab.match(pathname))

  return (
    <Protected>
      <div className="space-y-4">
        <div className="w-full border-b border-stone-200 bg-white/92 px-4 py-4 backdrop-blur-sm md:px-6">
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:gap-6">
            <div className="shrink-0 text-xs font-semibold text-stone-500">
              RenoApp admin
            </div>

            <nav className="min-w-0 flex-1" aria-label="RenoApp administration">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                {RENOAPP_ADMIN_TABS.map((tab) => {
                  const active = tab.href === activeTab?.href
                  return (
                    <Link
                      key={tab.href}
                      href={tab.href}
                      aria-current={active ? 'page' : undefined}
                      className={`whitespace-nowrap border-b-2 px-1 py-2 text-sm font-semibold transition focus-visible:outline-2 focus-visible:outline-offset-2 ${
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
          {activeSettingsTab && (
            <nav
              className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-stone-200 pt-2"
              aria-label="Systeminställningar"
            >
              {RENOAPP_ADMIN_SETTINGS_TABS.map((tab) => {
                const active = tab.href === activeSettingsTab.href
                return (
                  <Link
                    key={tab.href}
                    href={tab.href}
                    aria-current={active ? 'page' : undefined}
                    className={`whitespace-nowrap border-b-2 px-1 py-2 text-xs font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 ${
                      active
                        ? 'border-stone-900 text-stone-900'
                        : 'border-transparent text-stone-600 hover:border-stone-300 hover:text-stone-900'
                    }`}
                  >
                    {tab.label}
                  </Link>
                )
              })}
            </nav>
          )}
        </div>

        {children}
      </div>
    </Protected>
  )
}
