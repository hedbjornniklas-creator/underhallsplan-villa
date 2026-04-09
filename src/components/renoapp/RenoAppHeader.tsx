'use client'

import Image from 'next/image'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { Power } from 'lucide-react'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'

type RenoAppHeaderContext = {
  accessibleBrfs: Array<{
    id: string
    name: string | null
    slug: string | null
    role: 'board' | 'admin'
  }>
  activeBrfId: string | null
}

export default function RenoAppHeader() {
  const pathname = usePathname()
  const router = useRouter()
  const isAppPortal = pathname === '/renoapp/app' || pathname.startsWith('/renoapp/app/')
  const [brfContext, setBrfContext] = useState<RenoAppHeaderContext | null>(null)
  const [loadingBrfContext, setLoadingBrfContext] = useState(false)

  const appNavItems = [
    { href: '/renoapp/app', label: 'Översikt' },
    { href: '/renoapp/app/cases', label: 'Ärenden' },
    { href: '/renoapp/app/users', label: 'Användare' },
    { href: '/renoapp/app/brf', label: 'BRF' },
  ]

  useEffect(() => {
    let active = true

    const loadContext = async () => {
      if (!isAppPortal) {
        setBrfContext(null)
        return
      }

      setLoadingBrfContext(true)
      try {
        const response = await fetch('/api/renoapp/app/context', { cache: 'no-store' })
        const payload = (await response.json().catch(() => ({}))) as RenoAppHeaderContext & { error?: string }

        if (!response.ok) {
          throw new Error(payload.error ?? 'Kunde inte läsa RenoApp-kontext.')
        }

        if (active) {
          setBrfContext({
            accessibleBrfs: payload.accessibleBrfs ?? [],
            activeBrfId: payload.activeBrfId ?? null,
          })
        }
      } catch {
        if (active) {
          setBrfContext(null)
        }
      } finally {
        if (active) {
          setLoadingBrfContext(false)
        }
      }
    }

    void loadContext()

    return () => {
      active = false
    }
  }, [isAppPortal, pathname])

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.replace('/renoapp/login')
    router.refresh()
  }

  const handleBrfChange = async (value: string) => {
    try {
      await fetch('/api/renoapp/app/active-brf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brfId: value }),
      })
    } finally {
      setBrfContext((current) => (current ? { ...current, activeBrfId: value } : current))
      window.location.reload()
    }
  }

  const activeBrf =
    brfContext?.accessibleBrfs.find((item) => item.id === brfContext.activeBrfId) ??
    brfContext?.accessibleBrfs[0] ??
    null

  return (
    <header className="border-b border-stone-200/80 bg-white/75 backdrop-blur">
      <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center justify-between gap-4 px-6 py-2 md:px-10 lg:px-12">
        <Link href="https://hushub.se" className="flex items-center gap-2">
          <Image
            src="/landing/Renoapp.png"
            alt="RenoApp"
            width={156}
            height={36}
            className="h-8 w-auto object-contain"
            priority
          />
        </Link>

        {isAppPortal ? (
          <div className="flex flex-wrap items-center justify-end gap-2">
            {brfContext?.accessibleBrfs.length ? (
              brfContext.accessibleBrfs.length > 1 ? (
                <label className="flex items-center gap-2 rounded-full border border-stone-300 bg-white/85 px-3 py-2 text-sm text-stone-700">
                  <span className="font-semibold text-stone-800">Förening</span>
                  <select
                    value={brfContext.activeBrfId ?? brfContext.accessibleBrfs[0]?.id ?? ''}
                    onChange={(event) => void handleBrfChange(event.target.value)}
                    className="bg-transparent pr-6 font-medium text-stone-900 outline-none"
                  >
                    {brfContext.accessibleBrfs.map((brf) => (
                      <option key={brf.id} value={brf.id}>
                        {brf.name ?? brf.slug ?? 'Namnlös BRF'}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <div className="rounded-full border border-stone-300 bg-white/85 px-4 py-2 text-sm text-stone-700">
                  <span className="font-semibold text-stone-800">Förening:</span>{' '}
                  <span className="font-medium text-stone-900">{activeBrf?.name ?? activeBrf?.slug ?? '-'}</span>
                </div>
              )
            ) : loadingBrfContext ? (
              <div className="rounded-full border border-stone-300 bg-white/85 px-4 py-2 text-sm text-stone-600">
                Laddar förening...
              </div>
            ) : null}

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
