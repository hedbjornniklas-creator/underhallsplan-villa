'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Home, Building2, Settings as SettingsIcon, ClipboardList, Shield } from 'lucide-react'
import { usePlatformAccess } from '@/hooks/usePlatformAccess'

export default function Sidebar() {
  const pathname = usePathname()
  const { hasDashboardAdmin, hasHushubAdmin } = usePlatformAccess()

  const nav = [
    { href: '/', label: 'MENU', icon: Home },
    { href: '/properties', label: 'Fastigheter', icon: Building2 },
    { href: '/inspections', label: 'Besiktningar', icon: ClipboardList },
    ...(hasHushubAdmin ? [{ href: '/admin', label: 'Admin', icon: Shield }] : []),
    ...(hasDashboardAdmin ? [{ href: '/settings', label: 'Settings', icon: SettingsIcon }] : []),
  ]

  return (
    <aside className="hidden shrink-0 border-r bg-white md:flex md:w-64">
      <div className="w-64 p-3">
        <nav className="space-y-1">
          {nav.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || pathname.startsWith(href + '/')

            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm ${
                  active
                    ? 'border border-emerald-200 bg-emerald-50 text-emerald-700'
                    : 'hover:bg-gray-50'
                }`}
              >
                <Icon size={18} />
                <span>{label}</span>
              </Link>
            )
          })}
        </nav>
      </div>
    </aside>
  )
}
