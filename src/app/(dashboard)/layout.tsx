'use client'

import type { ReactNode } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { useProfile } from '@/hooks/useProfile'

export default function DashboardLayout({ children }: { children: ReactNode }) {
  const router = useRouter()
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
              href="/dashboard-v1"
              className="inline-flex max-w-full items-center gap-2 text-sm font-medium text-gray-800 transition hover:text-gray-900"
            >
              <Image
                src="/report-assets/BesiktApp.png"
                alt="Underhållsplan Villa"
                width={156}
                height={36}
                className="h-8 w-auto object-contain"
              />
              <span className="sr-only">Underhållsplan Villa</span>
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
              className="cursor-pointer text-sm text-gray-500 transition hover:text-gray-900"
              type="button"
            >
              Logga ut
            </button>
          </div>
        </div>
      </header>
      <main className="flex-1 min-h-0 overflow-auto">{children}</main>
    </div>
  )
}

