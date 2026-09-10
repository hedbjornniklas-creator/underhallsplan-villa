'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Check, ChevronRight, Settings, UsersRound } from 'lucide-react'

const ITEMS = [
  {
    href: '/settings',
    label: 'Profil och integrationer',
    description: 'Person-, företags- och Fortnoxuppgifter',
    icon: Settings,
  },
  {
    href: '/settings/kunder',
    label: 'Kundregister',
    description: 'Kunder och faktureringsuppgifter',
    icon: UsersRound,
  },
] as const

export default function SettingsNav() {
  const pathname = usePathname()

  return (
    <nav
      aria-label="Inställningsmeny"
      className="rounded-2xl border border-white/30 bg-white/90 p-3 shadow-sm backdrop-blur-sm sm:p-4"
    >
      <div className="px-1 pb-3">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-500">
          Inställningsmeny
        </p>
        <p className="mt-1 text-sm text-gray-600">Välj vad du vill hantera.</p>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {ITEMS.map((item) => {
          const active =
            pathname === item.href || (item.href === '/settings' && pathname === '/ob/settings')
          const Icon = item.icon
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={`group flex min-h-20 items-center gap-3 rounded-xl border px-4 py-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 ${
                active
                  ? 'border-indigo-600 bg-indigo-600 text-white shadow-sm'
                  : 'border-gray-200 bg-white text-gray-900 hover:border-indigo-300 hover:bg-indigo-50'
              }`}
            >
              <span
                className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${
                  active
                    ? 'bg-white/15 text-white'
                    : 'bg-indigo-50 text-indigo-700 group-hover:bg-white'
                }`}
              >
                <Icon size={19} aria-hidden="true" />
              </span>

              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                  {item.label}
                  {active ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                      <Check size={11} aria-hidden="true" />
                      Vald
                    </span>
                  ) : null}
                </span>
                <span
                  className={`mt-1 block text-xs leading-5 ${
                    active ? 'text-indigo-100' : 'text-gray-600'
                  }`}
                >
                  {item.description}
                </span>
              </span>

              <ChevronRight
                size={18}
                aria-hidden="true"
                className={active ? 'text-indigo-100' : 'text-gray-400 group-hover:text-indigo-700'}
              />
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
