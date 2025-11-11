'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Home, Building2, Layers, DoorOpen, ClipboardCheck, CalendarClock, FileDown, Settings } from 'lucide-react'

const nav = [
  { href: '/', label: 'MENU', icon: Home },
  { href: '/properties', label: 'Fastigheter', icon: Building2 },
  { href: '/admin?tab=comps', label: 'Settings', icon: Layers },
  ]

export default function Sidebar() {
  const pathname = usePathname()
  return (
    <aside className="hidden md:flex md:w-64 shrink-0 border-r bg-white">
      <div className="w-64 p-3">
        <nav className="space-y-1">
          {nav.map(({ href, label, icon: Icon }) => {
            const active = pathname === href
            return (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm
                  ${active ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 'hover:bg-gray-50'}`}
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
