'use client'

import Link from 'next/link'
import { createContext, useContext, useEffect, type ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { useOrganizationContext } from '@/components/organizations/OrganizationContextProvider'

export type ObOrganization = { id: string; name: string | null; isDefault: boolean }
const Context = createContext<ObOrganization | null>(null)

export function withObOrganization(path: string, orgId: string) {
  const [withoutHash, hash] = path.split('#', 2)
  const [pathname, search] = withoutHash.split('?', 2)
  const query = new URLSearchParams(search)
  query.set('orgId', orgId)
  return `${pathname}?${query.toString()}${hash ? `#${hash}` : ''}`
}

export function useObOrganization() {
  const organization = useContext(Context)
  if (!organization) throw new Error('OB organization must be resolved before rendering work.')
  return organization
}

export function useObOrganizationSwitchGuard(dirty: boolean, busy = false) {
  useEffect(() => {
    const beforeSwitch = (event: Event) => {
      if (busy || (dirty && !window.confirm('Du har osparade uppgifter. Vill du lämna dem och byta organisation?'))) event.preventDefault()
    }
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (!dirty && !busy) return
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('hushub:before-organization-switch', beforeSwitch)
    window.addEventListener('beforeunload', beforeUnload)
    return () => {
      window.removeEventListener('hushub:before-organization-switch', beforeSwitch)
      window.removeEventListener('beforeunload', beforeUnload)
    }
  }, [dirty, busy])
}

/** No forms or legacy client reads mount before the server validates their organization. */
export default function ObOrganizationBoundary({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const { organization, error } = useOrganizationContext()
  if (error) return <main className="mx-auto max-w-3xl p-6">
    <section role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-6 text-rose-900">
      <h1 className="text-xl font-semibold">Organisationen behöver kontrolleras</h1>
      <p className="mt-2">{error}</p>
      <Link href="/ob" className="mt-4 inline-block underline">Till ÖB och välj arbetsorganisation</Link>
    </section>
  </main>
  if (!organization) return <p role="status" className="mx-auto max-w-3xl p-6">Kontrollerar arbetsorganisation…</p>
  return <Context.Provider key={`${pathname}:${organization.id}`} value={organization}>{children}</Context.Provider>
}
