'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { LogOut } from 'lucide-react'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabaseClient'
import { isPublicRenoPage } from '@/lib/publicNavigation'
import RenoAppBrand from './RenoAppBrand'
import RenoAppMenu from './RenoAppMenu'

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

  if (isPublicRenoPage(pathname)) return null

  const portalControls = (
          <div className="reno-portal-controls">
            {brfContext?.accessibleBrfs.length ? (
              brfContext.accessibleBrfs.length > 1 ? (
                <label className="reno-brf-switcher">
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
                <div className="reno-brf-switcher">
                  <span className="font-semibold text-stone-800">Förening:</span>{' '}
                  <span className="font-medium text-stone-900">{activeBrf?.name ?? activeBrf?.slug ?? '-'}</span>
                </div>
              )
            ) : loadingBrfContext ? (
              <div className="reno-brf-switcher">
                Laddar förening...
              </div>
            ) : null}

            <nav className="reno-nav" aria-label="Styrelseportalen">
              {appNavItems.map((item) => {
                const isActive =
                  pathname === item.href || (item.href !== '/renoapp/app' && pathname.startsWith(`${item.href}/`))

                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={isActive ? 'page' : undefined}
                  >
                    {item.label}
                  </Link>
                )
              })}
            </nav>
            <button
              type="button"
              onClick={() => void handleLogout()}
              className="reno-icon-button"
              data-reno-close-menu
              aria-label="Logga ut"
              title="Logga ut"
            >
              <LogOut size={20} aria-hidden="true" />
            </button>
          </div>
  )

  return (
    <header className="reno-header">
      <div className="reno-header-inner">
        <RenoAppBrand href={isAppPortal ? '/renoapp/app' : 'https://renoapp.se/'} />
        {isAppPortal ? (
          <>
            <div className="reno-desktop-nav">{portalControls}</div>
            <RenoAppMenu key={pathname}>{portalControls}</RenoAppMenu>
          </>
        ) : null}
      </div>
    </header>
  )
}
