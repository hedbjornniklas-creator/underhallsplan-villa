'use client'

import Image from 'next/image'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
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
      <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-4 px-6 py-3.5 md:px-10 lg:px-12">
        <Link href="/renoapp" className="flex items-center gap-3">
          <Image
            src="/landing/Renoapp.png"
            alt="RenoApp"
            width={220}
            height={56}
            className="h-10 w-auto object-contain md:h-11"
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
              className="rounded-full border border-rose-300 bg-white/80 px-4 py-2 text-sm font-semibold text-rose-700 transition hover:bg-rose-50"
            >
              Logga ut
            </button>
          </div>
        ) : null}
      </div>
    </header>
  )
}
