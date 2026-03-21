'use client'

import type { ReactNode } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { Power } from 'lucide-react'
import { supabase } from '@/lib/supabaseClient'
import { useProfile } from '@/hooks/useProfile'

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const { profile } = useProfile()
  const [email, setEmail] = useState<string | null>(null)
  const [isLoggedIn, setIsLoggedIn] = useState(false)

  useEffect(() => {
    let mounted = true
    const loadUser = async () => {
      const { data } = await supabase.auth.getUser()
      if (!mounted) return
      const user = data?.user ?? null
      setIsLoggedIn(!!user)
      setEmail(user?.email ?? null)
    }
    void loadUser()
    return () => {
      mounted = false
    }
  }, [])

  const displayName = profile?.full_name?.trim() || null
  const hasUser = isLoggedIn
  const normalizedPathname =
    pathname && pathname !== '/' && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname
  const isObRoot = normalizedPathname === '/ob'
  const isObModuleSubpage = Boolean(normalizedPathname?.startsWith('/ob/'))
  const isInspectionsModule = Boolean(
    normalizedPathname === '/inspections' || normalizedPathname?.startsWith('/inspections/')
  )
  const useObBranding = (isObModuleSubpage || isInspectionsModule) && !isObRoot
  const logoHref = useObBranding ? '/ob' : '/dashboard-v1'

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.replace('/login')
  }

  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <header className="sticky top-0 z-50 border-b border-black/5 bg-white/90 backdrop-blur-sm">
        <div className="mx-auto grid h-14 w-full max-w-6xl grid-cols-3 items-center px-4 md:px-6">
          <div className="min-w-0">
            <Link
              href={logoHref}
              className="inline-flex max-w-full items-center gap-1 text-sm font-medium text-gray-800 transition hover:text-gray-900"
            >
              <Image
                src={useObBranding ? '/report-assets/BesiktApp.png' : '/landing/Hushub-check.png'}
                alt={useObBranding ? 'BesiktApp' : 'HusHub'}
                width={useObBranding ? 156 : 52}
                height={useObBranding ? 36 : 32}
                className={`h-8 w-auto object-contain ${useObBranding ? 'pr-1' : ''}`}
              />
              {!useObBranding ? (
                <span className="text-xl font-semibold tracking-tight text-gray-900">HusHub</span>
              ) : null}
            </Link>
          </div>

          <div className="min-w-0 px-3 text-center">
            {hasUser ? (
              <>
                <div className="truncate text-sm font-medium text-gray-900">
                  {displayName ?? email}
                </div>
                {displayName && email ? (
                  <div className="truncate text-xs text-gray-400">{email}</div>
                ) : null}
              </>
            ) : (
              <div className="truncate text-sm text-gray-500">Inte inloggad</div>
            )}
          </div>

          <div className="flex items-center justify-end">
            <button
              onClick={handleLogout}
              className="inline-flex h-10 w-10 cursor-pointer items-center justify-center rounded-full bg-gradient-to-b from-rose-400 to-red-600 p-[3px] shadow-[0_10px_18px_-10px_rgba(185,28,28,0.95)] transition-all duration-200 hover:-translate-y-0.5 hover:scale-105 hover:shadow-[0_14px_20px_-10px_rgba(185,28,28,0.95)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2"
              type="button"
              aria-label="Logga ut"
              title="Logga ut"
            >
              <span className="flex h-full w-full items-center justify-center rounded-full bg-white ring-1 ring-red-200/70 shadow-inner">
                <Power size={18} aria-hidden className="text-red-500" strokeWidth={2.25} />
              </span>
            </button>
          </div>
        </div>
      </header>
      <main className="flex-1 min-h-0 overflow-auto">{children}</main>
    </div>
  )
}

