'use client'

import Link from 'next/link'
import { Building2, ChevronDown } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import {
  organizationSwitchDestination,
  organizationSwitcherRoot,
  organizationSwitcherSurfaceForPath,
} from '@/lib/organizations/navigation'
import { useOrganizationContext } from '@/components/organizations/OrganizationContextProvider'

export default function ActiveOrganizationSwitcher({
  isLoggedIn,
  displayName,
  email,
  compact,
}: {
  isLoggedIn: boolean
  displayName: string | null
  email: string | null
  compact: boolean
}) {
  const pathname = usePathname()
  const router = useRouter()
  const searchParams = useSearchParams()
  const search = searchParams.toString()
  const surface = organizationSwitcherSurfaceForPath(pathname)
  const {
    selectionKey, organization: visibleOrganization, organizations: visibleOrganizations,
    error: visibleError, loading, invalidSelection: invalidOrganizationSelection,
  } = useOrganizationContext()
  const [openSelectionKey, setOpenSelectionKey] = useState<string | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const open = selectionKey !== null && openSelectionKey === selectionKey

  useEffect(() => {
    if (!open) return

    const closeOutside = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpenSelectionKey(null)
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpenSelectionKey(null)
    }
    document.addEventListener('pointerdown', closeOutside)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeOutside)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  if (!isLoggedIn) {
    return <div className="truncate text-sm text-gray-500">Inte inloggad</div>
  }

  if (!surface) {
    return (
      <Link
        href="/settings"
        aria-label="Öppna inställningar"
        title="Inställningar"
        className="group block min-w-0 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2"
      >
        <div
          className={`truncate font-medium text-gray-900 transition-all duration-200 group-hover:text-emerald-700 md:text-sm ${
            compact ? 'text-xs' : 'text-sm'
          }`}
        >
          {displayName ?? email}
        </div>
        {displayName && email ? (
          <div
            className={`truncate text-xs text-gray-400 transition-all duration-200 md:block ${
              compact ? 'hidden opacity-0' : 'block opacity-100'
            }`}
          >
            {email}
          </div>
        ) : null}
      </Link>
    )
  }

  if (invalidOrganizationSelection) {
    const resetHref = organizationSwitcherRoot(surface)
    return (
      <Link
        href={resetHref}
        className="block truncate text-xs font-semibold text-rose-700 underline underline-offset-2"
        title="Flera organisationsval finns i adressen."
      >
        Återställ organisationsval
      </Link>
    )
  }

  if (loading) {
    return <div className="truncate text-xs font-medium text-gray-500">Laddar organisation…</div>
  }

  if (visibleError || !visibleOrganization) {
    const resetHref = organizationSwitcherRoot(surface)
    return (
      <Link
        href={resetHref}
        className="block truncate text-xs font-semibold text-rose-700 underline underline-offset-2"
        title={visibleError ?? 'Organisationen kunde inte hämtas.'}
      >
        Återställ organisationsval
      </Link>
    )
  }

  const switchOrganization = (orgId: string) => {
    if (orgId === visibleOrganization.id) {
      setOpenSelectionKey(null)
      return
    }

    const canSwitch = window.dispatchEvent(new CustomEvent('hushub:before-organization-switch', {
      cancelable: true,
      detail: { fromOrgId: visibleOrganization.id, orgId },
    }))
    if (!canSwitch) return

    setOpenSelectionKey(null)
    router.push(organizationSwitchDestination({ pathname, search, surface, orgId }))
  }

  return (
    <div ref={menuRef} className="relative mx-auto max-w-full">
      <button
        type="button"
        onClick={() =>
          visibleOrganizations.length > 1 &&
          setOpenSelectionKey((value) => (value === selectionKey ? null : selectionKey))
        }
        className="group inline-flex max-w-full items-center justify-center gap-2 rounded-lg px-2 py-1 text-gray-900 transition hover:bg-emerald-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2"
        aria-haspopup={visibleOrganizations.length > 1 ? 'menu' : undefined}
        aria-expanded={visibleOrganizations.length > 1 ? open : undefined}
        title={visibleOrganizations.length > 1 ? 'Byt arbetsorganisation' : 'Arbetsorganisation'}
      >
        <Building2 size={compact ? 15 : 17} className="shrink-0 text-emerald-700" aria-hidden />
        <span className="min-w-0 text-left">
          <span
            className={`block truncate font-semibold leading-tight ${compact ? 'text-xs' : 'text-sm'}`}
          >
            {visibleOrganization.name || 'Namnlös organisation'}
          </span>
          <span className={`block truncate text-[10px] text-gray-500 ${compact ? 'hidden' : ''}`}>
            Arbetsorganisation
          </span>
        </span>
        {visibleOrganizations.length > 1 ? (
          <ChevronDown
            size={14}
            aria-hidden
            className={`shrink-0 text-gray-500 transition-transform ${open ? 'rotate-180' : ''}`}
          />
        ) : null}
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute left-1/2 top-full z-50 mt-2 w-72 -translate-x-1/2 overflow-hidden rounded-xl border border-emerald-100 bg-white py-1 text-left shadow-xl ring-1 ring-black/5"
        >
          <div className="border-b border-gray-100 px-4 py-2">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-500">
              Byt arbetsorganisation
            </p>
            <p className="mt-0.5 text-xs text-gray-500">Valet gäller bara den här fliken.</p>
          </div>
          {visibleOrganizations.map((item) => (
            <button
              key={item.id}
              type="button"
              role="menuitemradio"
              aria-checked={item.id === visibleOrganization.id}
              onClick={() => switchOrganization(item.id)}
              className={`block w-full px-4 py-3 text-left transition hover:bg-emerald-50 ${
                item.id === visibleOrganization.id
                  ? 'bg-emerald-50 text-emerald-950'
                  : 'text-gray-900'
              }`}
            >
              <span className="block truncate text-sm font-semibold">
                {item.name || 'Namnlös organisation'}
              </span>
              <span className="mt-0.5 block text-xs text-gray-500">
                {item.id === visibleOrganization.id
                  ? 'Aktiv i den här fliken'
                  : item.isDefault
                    ? 'Standardorganisation'
                    : 'Organisation'}
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
