'use client'

import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

export default function RenoAppHeader() {
  const pathname = usePathname()
  const hideActions = pathname.startsWith('/renoapp/invite/')

  return (
    <header className="border-b border-stone-200/80 bg-white/75 backdrop-blur">
      <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-4 px-6 py-4 md:px-10 lg:px-12">
        <Link href="/renoapp" className="flex items-center gap-3">
          <Image
            src="/landing/Renoapp.png"
            alt="RenoApp"
            width={160}
            height={48}
            className="h-10 w-auto"
            priority
          />
        </Link>

        {hideActions ? null : (
          <nav className="flex flex-wrap items-center gap-2">
            <Link
              href="/renoapp/request-access"
              className="rounded-full border border-stone-300 bg-white/80 px-4 py-2 text-sm font-semibold text-stone-800 transition hover:bg-stone-100"
            >
              Anslut BRF
            </Link>
            <Link
              href="/renoapp/login"
              className="rounded-full bg-stone-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-stone-700"
            >
              BRF-login
            </Link>
          </nav>
        )}
      </div>
    </header>
  )
}
