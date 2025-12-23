'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Home,
  Building2,
  Settings as SettingsIcon,
  ClipboardList,     // 👈 ny ikon för besiktningar
} from 'lucide-react'
import { useProfile } from '@/hooks/useProfile'

export default function Sidebar() {
  const pathname = usePathname()
  const { isAdmin } = useProfile()

  // Navigation (global)
  const nav = [
    { href: '/', label: 'MENU', icon: Home },
    { href: '/properties', label: 'Fastigheter', icon: Building2 },
    { href: '/inspections', label: 'Besiktningar', icon: ClipboardList }, // 👈 NY LÄNK
    // Settings visas bara för admin
    ...(isAdmin
      ? [{ href: '/settings', label: 'Settings', icon: SettingsIcon }]
      : []
    ),
  ]

  return (
    <aside className="hidden md:flex md:w-64 shrink-0 border-r bg-white">
      <div className="w-64 p-3">
        <nav className="space-y-1">
          {nav.map(({ href, label, icon: Icon }) => {
            const active =
              pathname === href || pathname.startsWith(href + '/')

            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm
                  ${
                    active
                      ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
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
