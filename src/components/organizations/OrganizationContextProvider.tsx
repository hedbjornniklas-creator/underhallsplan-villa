'use client'

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { obOrganizationEntityForPath, organizationSwitcherSurfaceForPath } from '@/lib/organizations/navigation'

export type OrganizationOption = { id: string; name: string | null; isDefault: boolean }
type Identity = { userId: string }
type OrganizationContextValue = {
  selectionKey: string | null
  organization: OrganizationOption | null
  organizations: OrganizationOption[]
  error: string | null
  loading: boolean
  invalidSelection: boolean
}
type Snapshot = {
  key: string
  canonicalKey: string
  identity: Identity
  revision: number
  organization: OrganizationOption | null
  organizations: OrganizationOption[]
  error: string | null
}

const Context = createContext<OrganizationContextValue | null>(null)
const failureMessage = 'Organisationen kunde inte verifieras.'

export function useOrganizationContext() {
  const context = useContext(Context)
  if (!context) throw new Error('OrganizationContextProvider is required.')
  return context
}

function isOrganization(value: unknown): value is OrganizationOption {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<OrganizationOption>
  return typeof item.id === 'string' && item.id.length > 0 &&
    (item.name === null || typeof item.name === 'string') && typeof item.isDefault === 'boolean'
}

/** One current, tab-local UI context shared by navigation and work surfaces.
 * This is not an authorization cache: protected APIs still check every request.
 * No context survives a session change, another selection, or a layout unmount.
 */
export default function OrganizationContextProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const router = useRouter()
  const search = searchParams.toString()
  const surface = organizationSwitcherSurfaceForPath(pathname)
  const entity = surface === 'ob' ? obOrganizationEntityForPath(pathname) : {}
  const entityKind = entity.inspectionId ? 'inspectionId' : entity.assignmentId ? 'assignmentId' : ''
  const entityId = entity.inspectionId ?? entity.assignmentId ?? ''
  const requestedOrgId = searchParams.get('orgId')
  const invalidSelection = searchParams.getAll('orgId').length > 1
  const selectionKey = surface ? JSON.stringify([surface, entityKind, entityId, requestedOrgId]) : null
  const [identity, setIdentity] = useState<Identity | null | undefined>(undefined)
  const identityRef = useRef<Identity | null | undefined>(undefined)
  const [revision, setRevision] = useState(0)
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const snapshotRef = useRef<Snapshot | null>(null)
  const requestRef = useRef<AbortController | null>(null)
  const lastCheckedAt = useRef(0)

  useEffect(() => {
    // INITIAL_SESSION is local SDK state, not an extra network authentication call.
    // The context endpoint, not this callback, authorizes the session.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event: string, session: { user: { id: string } } | null) => {
        const nextUserId = session?.user.id ?? null
        if (identityRef.current !== undefined && (identityRef.current?.userId ?? null) === nextUserId) return
        // A new object distinguishes logout/login even when React batches both
        // events and the same person signs back in before the next render.
        const nextIdentity = nextUserId ? { userId: nextUserId } : null
        identityRef.current = nextIdentity
        requestRef.current?.abort()
        snapshotRef.current = null
        setSnapshot(null)
        setIdentity(nextIdentity)
      }
    )
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'hidden' || requestRef.current || Date.now() - lastCheckedAt.current < 30_000) return
      setRevision(value => value + 1)
    }
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
  }, [])

  useEffect(() => {
    const previous = snapshotRef.current
    const matches = previous !== null && previous.identity === identity &&
      (previous.key === selectionKey || previous.canonicalKey === selectionKey)
    if (!surface || !selectionKey || invalidSelection || !identity) {
      snapshotRef.current = null
      return
    }
    // Adding the already-verified orgId to the URL must not cause a second check.
    if (matches && previous.revision === revision) return
    if (!matches) {
      snapshotRef.current = null
    }
    const controller = new AbortController()
    requestRef.current = controller
    const params = new URLSearchParams({ surface })
    if (requestedOrgId !== null) params.set('orgId', requestedOrgId)
    if (entityKind) params.set(entityKind, entityId)
    const publish = (result: Snapshot) => {
      if (controller.signal.aborted || identityRef.current !== identity) return
      snapshotRef.current = result
      setSnapshot(result)
    }
    const failed = (error: string) => publish({
      key: selectionKey, canonicalKey: selectionKey, identity, revision,
      organization: null, organizations: [], error,
    })
    void fetch(`/api/organizations/context?${params}`, {
      cache: 'no-store', credentials: 'same-origin', headers: { Accept: 'application/json' }, signal: controller.signal,
    }).then(async response => {
      const body = await response.json().catch(() => null)
      // A temporary background outage must not discard an open, dirty form.
      // Denials, mismatches and invalid replies always discard the old context.
      if (response.status >= 500 && matches && previous.organization) return
      if (!response.ok || !isOrganization(body?.organization) || !Array.isArray(body?.organizations) ||
        !body.organizations.every(isOrganization) ||
        (requestedOrgId !== null && body.organization.id !== requestedOrgId.trim().toLowerCase()) ||
        !body.organizations.some((item: OrganizationOption) => item.id === body.organization.id)) {
        failed(typeof body?.error === 'string' ? body.error : failureMessage)
        return
      }
      publish({
        key: selectionKey,
        canonicalKey: requestedOrgId === null
          ? JSON.stringify([surface, entityKind, entityId, body.organization.id]) : selectionKey,
        identity, revision, organization: body.organization, organizations: body.organizations, error: null,
      })
    }).catch(() => {
      if (!(matches && previous.organization)) failed(failureMessage)
    }).finally(() => {
      if (requestRef.current === controller) {
        requestRef.current = null
        lastCheckedAt.current = Date.now()
      }
    })
    return () => {
      controller.abort()
      if (requestRef.current === controller) requestRef.current = null
    }
  }, [entityId, entityKind, identity, invalidSelection, requestedOrgId, revision, selectionKey, surface])

  const current = !invalidSelection && identity && snapshot?.identity === identity &&
    (snapshot.key === selectionKey || snapshot.canonicalKey === selectionKey) ? snapshot : null
  // Forget an old selection during render, before any children can reuse it.
  // In particular, A → B → A while B is loading must verify A afresh.
  if (snapshot && !current) setSnapshot(null)
  const organization = current?.organization ?? null
  useEffect(() => {
    if (!organization || requestedOrgId !== null) return
    const params = new URLSearchParams(search)
    params.set('orgId', organization.id)
    router.replace(`${pathname}?${params}`, { scroll: false })
  }, [organization, pathname, requestedOrgId, router, search])

  const error = invalidSelection ? 'Flera organisationer har angetts i adressen.'
    : identity === null && surface ? 'Logga in för att välja arbetsorganisation.' : current?.error ?? null
  return <Context.Provider value={{
    selectionKey, organization, organizations: current?.organizations ?? [], error,
    loading: Boolean(surface) && !organization && !error, invalidSelection,
  }}>{children}</Context.Provider>
}
