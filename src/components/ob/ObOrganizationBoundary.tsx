'use client'

import Link from 'next/link'
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { obOrganizationEntityForPath } from '@/lib/organizations/navigation'

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
  const searchParams = useSearchParams()
  const router = useRouter()
  const search = searchParams.toString()
  const selections = searchParams.getAll('orgId')
  const requestedOrgId = searchParams.get('orgId')
  const invalid = selections.length > 1
  const entity = obOrganizationEntityForPath(pathname)
  const entityId = entity.inspectionId ?? entity.assignmentId ?? ''
  const entityKind = entity.inspectionId ? 'inspectionId' : entity.assignmentId ? 'assignmentId' : ''
  const key = `${pathname}:${requestedOrgId ?? ''}:${invalid}`
  const [resolved, setResolved] = useState<{ key: string; organization?: ObOrganization; error?: string } | null>(null)

  useEffect(() => {
    if (invalid) return
    const controller = new AbortController()
    const query = new URLSearchParams({ surface: 'ob' })
    if (requestedOrgId !== null) query.set('orgId', requestedOrgId)
    if (entityKind) query.set(entityKind, entityId)
    void fetch(`/api/organizations/context?${query}`, { cache: 'no-store', signal: controller.signal })
      .then(async response => {
        const body = await response.json()
        if (!response.ok || !body.organization?.id || !Array.isArray(body.organizations) ||
          (requestedOrgId !== null && body.organization.id !== requestedOrgId.trim().toLowerCase()) ||
          !body.organizations.some((item: ObOrganization) => item.id === body.organization.id)) {
          throw new Error(body.error || 'Organisationen kunde inte verifieras.')
        }
        if (controller.signal.aborted) return
        setResolved({ key, organization: body.organization })
        if (requestedOrgId === null) router.replace(withObOrganization(`${pathname}${search ? `?${search}` : ''}`, body.organization.id), { scroll: false })
      })
      .catch(error => {
        if (!controller.signal.aborted) setResolved({ key, error: error instanceof Error ? error.message : 'Organisationen kunde inte verifieras.' })
      })
    return () => controller.abort()
  }, [entityId, entityKind, invalid, key, pathname, requestedOrgId, router, search])

  const current = resolved?.key === key ? resolved : null
  if (invalid || current?.error) return <main className="mx-auto max-w-3xl p-6">
    <section role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-6 text-rose-900">
      <h1 className="text-xl font-semibold">Organisationen behöver kontrolleras</h1>
      <p className="mt-2">{invalid ? 'Flera organisationer har angetts i adressen.' : current?.error}</p>
      <Link href="/ob" className="mt-4 inline-block underline">Till ÖB och välj arbetsorganisation</Link>
    </section>
  </main>
  if (!current?.organization) return <p role="status" className="mx-auto max-w-3xl p-6">Kontrollerar arbetsorganisation…</p>
  return <Context.Provider key={`${pathname}:${current.organization.id}`} value={current.organization}>{children}</Context.Provider>
}
