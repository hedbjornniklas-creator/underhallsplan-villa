'use client'

import Link from 'next/link'
import Image from 'next/image'
import { useEffect, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { LayoutGrid, Power } from 'lucide-react'
import { supabase } from '@/lib/supabaseClient'
import { useProfile } from '@/hooks/useProfile'

export default function Topbar() {
  const router = useRouter()
  const pathname = usePathname()
  const { profile } = useProfile()
  const [email, setEmail] = useState<string | null>(null)
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const [isMobileCompact, setIsMobileCompact] = useState(false)
  const [moduleMenuOpen, setModuleMenuOpen] = useState(false)
  const lastScrollYRef = useRef(0)
  const moduleMenuRef = useRef<HTMLDivElement | null>(null)

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

  useEffect(() => {
    if (typeof window === 'undefined') return

    const mobileQuery = window.matchMedia('(max-width: 767px)')
    lastScrollYRef.current = window.scrollY

    const updateCompactState = () => {
      if (!mobileQuery.matches) {
        setIsMobileCompact(false)
        return
      }

      const currentY = window.scrollY
      const previousY = lastScrollYRef.current
      const delta = currentY - previousY

      if (currentY < 24) {
        setIsMobileCompact(false)
      } else if (delta > 8) {
        setIsMobileCompact(true)
      } else if (delta < -8) {
        setIsMobileCompact(false)
      }

      lastScrollYRef.current = currentY
    }

    const handleMediaChange = () => {
      if (!mobileQuery.matches) {
        setIsMobileCompact(false)
      }
      lastScrollYRef.current = window.scrollY
    }

    window.addEventListener('scroll', updateCompactState, { passive: true })
    mobileQuery.addEventListener('change', handleMediaChange)
    updateCompactState()

    return () => {
      window.removeEventListener('scroll', updateCompactState)
      mobileQuery.removeEventListener('change', handleMediaChange)
    }
  }, [])

  useEffect(() => {
    if (!moduleMenuOpen) return

    const handlePointerDown = (event: PointerEvent) => {
      if (moduleMenuRef.current?.contains(event.target as Node)) return
      setModuleMenuOpen(false)
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setModuleMenuOpen(false)
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [moduleMenuOpen])

  const displayName = profile?.full_name?.trim() || null
  const hasUser = isLoggedIn
  const normalizedPath = (pathname || '').toLowerCase()
  const isAdminContext = normalizedPath.startsWith('/admin')
  const isDashboardLanding = normalizedPath === '/dashboard-v1'
  const isObHome = normalizedPath === '/ob'
  const isEbHome = normalizedPath === '/eb'
  const isObContext = normalizedPath.includes('/ob')
  const isEbContext = normalizedPath.includes('/eb')
  const showModuleSwitcher =
    hasUser && !isDashboardLanding && (isObContext || isEbContext || normalizedPath.startsWith('/inspections'))
  const modules = [
    {
      code: 'ÖB',
      label: 'Överlåtelsebesiktning',
      description: 'ÖB / insida och utsida',
      href: '/ob',
      active: isObContext || normalizedPath.startsWith('/inspections'),
    },
    {
      code: 'EB',
      label: 'Entreprenadbesiktning',
      description: 'EB / projekt och utlåtanden',
      href: '/eb',
      active: isEbContext,
    },
  ]
  const activeModule = modules.find((module) => module.active) ?? null

  const logoHref = isAdminContext
    ? '/admin'
    : isDashboardLanding
      ? '/'
      : isObHome || isEbHome
        ? '/dashboard-v1'
        : isEbContext
          ? '/eb'
          : isObContext
            ? '/ob'
            : '/'
  const logoSrc = isAdminContext || isDashboardLanding ? '/landing/Hushub-check2.png' : '/report-assets/BesiktApp.png'
  const logoAlt = isAdminContext || isDashboardLanding ? 'HusHub' : 'BesiktApp'
  const srLabel = isAdminContext ? 'HusHub Admin' : isDashboardLanding ? 'HusHub' : 'BesiktApp'

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.replace('/login')
    router.refresh()
  }

  return (
    <header
      data-app-topbar="true"
      className={`sticky top-0 z-50 border-b border-black/5 bg-white/90 backdrop-blur-sm transition-[transform,box-shadow] duration-200 ease-out md:translate-y-0 ${
        isMobileCompact ? '-translate-y-full shadow-none' : 'translate-y-0'
      }`}
    >
      <div
        className={`mx-auto grid w-full max-w-6xl grid-cols-3 items-center px-3 transition-[height,padding] duration-200 ease-out md:h-14 md:px-6 ${
          isMobileCompact ? 'h-11 shadow-sm' : 'h-14'
        }`}
      >
        <div className="min-w-0">
          <Link
            href={logoHref}
            className="inline-flex max-w-full items-center gap-2 text-sm font-medium text-gray-800 transition hover:text-gray-900"
          >
            <Image
              src={logoSrc}
              alt={logoAlt}
              width={148}
              height={36}
              className={`w-auto object-contain transition-[height] duration-200 ease-out md:h-8 ${
                isMobileCompact ? 'h-6' : 'h-8'
              }`}
            />
            {isAdminContext || isDashboardLanding ? (
              <span
                className={`font-semibold tracking-tight text-stone-900 transition-all duration-200 md:text-2xl ${
                  isMobileCompact ? 'text-lg' : 'text-2xl'
                }`}
              >
                HusHub
              </span>
            ) : null}
            <span className="sr-only">{srLabel}</span>
          </Link>
        </div>

        <div className="min-w-0 px-3 text-center">
          {hasUser ? (
            <>
              <div
                className={`truncate font-medium text-gray-900 transition-all duration-200 md:text-sm ${
                  isMobileCompact ? 'text-xs' : 'text-sm'
                }`}
              >
                {displayName ?? email}
              </div>
              {displayName && email ? (
                <div
                  className={`truncate text-xs text-gray-400 transition-all duration-200 md:block ${
                    isMobileCompact ? 'hidden opacity-0' : 'block opacity-100'
                  }`}
                >
                  {email}
                </div>
              ) : null}
            </>
          ) : (
            <div className="truncate text-sm text-gray-500">Inte inloggad</div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2">
          {showModuleSwitcher ? (
            <div ref={moduleMenuRef} className="relative">
              <button
                type="button"
                onClick={() => setModuleMenuOpen((current) => !current)}
                className={`inline-flex items-center justify-center gap-1.5 rounded-full border border-emerald-200 bg-white px-3 text-xs font-semibold text-emerald-800 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:bg-emerald-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 md:h-10 md:px-4 md:text-sm ${
                  isMobileCompact ? 'h-8 px-2' : 'h-10'
                }`}
                aria-label="Välj modul"
                aria-expanded={moduleMenuOpen}
                aria-haspopup="menu"
                title="Välj modul"
              >
                <LayoutGrid size={isMobileCompact ? 14 : 16} aria-hidden strokeWidth={2.25} />
                {activeModule ? (
                  <span className="inline-flex min-w-7 items-center justify-center rounded-full bg-emerald-700 px-1.5 py-0.5 text-[11px] font-bold leading-none text-white">
                    {activeModule.code}
                  </span>
                ) : null}
                <span className={isMobileCompact ? 'hidden sm:inline' : 'hidden sm:inline'}>Moduler</span>
              </button>

              {moduleMenuOpen ? (
                <div
                  role="menu"
                  className="absolute right-0 top-full mt-2 w-72 overflow-hidden rounded-lg border border-emerald-100 bg-white py-1 text-left shadow-xl ring-1 ring-black/5"
                >
                  {modules.map((module) => (
                    <Link
                      key={module.href}
                      href={module.href}
                      role="menuitem"
                      onClick={() => setModuleMenuOpen(false)}
                      className={`block px-4 py-3 transition hover:bg-emerald-50 ${
                        module.active ? 'bg-emerald-50 text-emerald-950' : 'text-gray-900'
                      }`}
                    >
                      <span className="flex items-center justify-between gap-3">
                        <span className="block text-sm font-semibold">{module.label}</span>
                        <span
                          className={`inline-flex min-w-8 items-center justify-center rounded-full px-2 py-0.5 text-xs font-bold ${
                            module.active ? 'bg-emerald-700 text-white' : 'bg-gray-100 text-gray-600'
                          }`}
                        >
                          {module.code}
                        </span>
                      </span>
                      <span className="mt-0.5 block text-xs text-gray-500">{module.description}</span>
                    </Link>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
          <button
            onClick={handleLogout}
            className={`inline-flex items-center justify-center rounded-full bg-gradient-to-b from-rose-400 to-red-600 p-[3px] shadow-[0_10px_18px_-10px_rgba(185,28,28,0.95)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_14px_20px_-10px_rgba(185,28,28,0.95)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 md:h-10 md:w-10 ${
              isMobileCompact ? 'h-8 w-8' : 'h-10 w-10'
            }`}
            type="button"
            aria-label="Logga ut"
            title="Logga ut"
          >
            <span className="flex h-full w-full items-center justify-center rounded-full bg-white ring-1 ring-red-200/70 shadow-inner">
              <Power
                size={isMobileCompact ? 15 : 18}
                aria-hidden
                className="text-red-500"
                strokeWidth={2.25}
              />
            </span>
          </button>
        </div>
      </div>
    </header>
  )
}
