'use client'

import Image from 'next/image'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { Power } from 'lucide-react'
import { supabase } from '@/lib/supabaseClient'

export default function RenoAppHeader() {
  const pathname = usePathname()
  const router = useRouter()
  const isAppPortal = pathname === '/renoapp/app' || pathname.startsWith('/renoapp/app/')

  const appNavItems = [
    { href: '/renoapp/app', label: 'Översikt' },
    { href: '/renoapp/app/cases', label: 'Ärenden' },
    { href: '/renoapp/app/units', label: 'Lägenheter' },
    { href: '/renoapp/app/users', label: 'Användare' },
    { href: '/renoapp/app/brf', label: 'BRF' },
  ]

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.replace('/renoapp/login')
  }

  return (
    <header className="border-b border-stone-200/80 bg-white/75 backdrop-blur">
      <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-4 px-6 py-4 md:px-10 lg:px-12">
        <Link href="/renoapp" className="flex items-center gap-3">
          <Image
            src="/landing/Renoapp.png"
            alt="RenoApp"
            width={320}
            height={84}
            className="h-12 w-auto object-contain md:h-14"
            priority
          />
        </Link>

        {isAppPortal ? (
          <div className="flex flex-wrap items-center justify-end gap-2">
            <nav className="flex flex-wrap items-center gap-2">
              {appNavItems.map((item) => {
                const isActive =
                  pathname === item.href || (item.href !== '/renoapp/app' && pathname.startsWith(`${item.href}/`))

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={`rounded-full px-4 py-2 text-sm font-semibold transition ${
                      isActive
                        ? 'bg-stone-900 text-white'
                        : 'border border-stone-300 bg-white/80 text-stone-800 hover:bg-stone-100'
                    }`}
                  >
                    {item.label}
                  </Link>
                )
              })}
            </nav>
            <button
              type="button"
              onClick={() => void handleLogout()}
              className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-b from-rose-400 to-red-600 p-[3px] shadow-[0_10px_18px_-10px_rgba(185,28,28,0.95)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_14px_20px_-10px_rgba(185,28,28,0.95)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2"
              aria-label="Logga ut"
              title="Logga ut"
            >
              <span className="flex h-full w-full items-center justify-center rounded-full bg-white ring-1 ring-red-200/70 shadow-inner">
                <Power size={18} aria-hidden className="text-red-500" strokeWidth={2.25} />
              </span>
            </button>
          </div>
        ) : null}
      </div>
    </header>
  )
}
