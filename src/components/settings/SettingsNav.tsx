'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Settings, UsersRound } from 'lucide-react'

const ITEMS = [
  { href: '/settings', label: 'Profil och integrationer', icon: Settings },
  { href: '/settings/kunder', label: 'Kunder', icon: UsersRound },
] as const

export default function SettingsNav() {
  const pathname = usePathname()

  return (
    <nav
      aria-label="Inställningar"
      className="flex flex-wrap gap-2 rounded-2xl border border-white/30 bg-white/90 p-2 shadow-sm backdrop-blur-sm"
    >
      {ITEMS.map((item) => {
        const active =
          pathname === item.href || (item.href === '/settings' && pathname === '/ob/settings')
        const Icon = item.icon
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={`inline-flex min-h-10 items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 ${
              active
                ? 'bg-indigo-600 text-white shadow-sm'
                : 'text-gray-700 hover:bg-indigo-50 hover:text-indigo-800'
            }`}
          >
            <Icon size={16} aria-hidden="true" />
            {item.label}
          </Link>
        )
      })}
    </nav>
  )
}
