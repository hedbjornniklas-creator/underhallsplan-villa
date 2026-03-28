'use client'

import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

export default function RenoAppHeader() {
  const pathname = usePathname()
  const isAppPortal = pathname === '/renoapp/app' || pathname.startsWith('/renoapp/app/')
  const appNavItems = [
    { href: '/renoapp/app', label: 'Översikt' },
    { href: '/renoapp/app/cases', label: 'Ärenden' },
    { href: '/renoapp/app/units', label: 'Lägenheter' },
    { href: '/renoapp/app/users', label: 'Användare' },
  ]

  return (
    <header className="border-b border-stone-200/80 bg-white/75 backdrop-blur">
      <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-4 px-6 py-3.5 md:px-10 lg:px-12">
        <Link href="/renoapp" className="flex items-center gap-3">
          <Image
            src="/landing/Renoapp.png"
            alt="RenoApp"
            width={188}
            height={48}
            className="h-9 w-auto object-contain md:h-10"
            priority
          />
        </Link>

        {isAppPortal ? (
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
        ) : null}
      </div>
    </header>
  )
}
