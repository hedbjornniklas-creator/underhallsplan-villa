import React from 'react'
import type { PlatformOrganizationDirectory } from '@/lib/organizations/platformAdministrationTypes'
import { createRoot } from 'react-dom/client'
import OrganizationAdministrationClient from '@/app/(app)/admin/access/organisations/OrganizationAdministrationClient'

const params = new URLSearchParams(location.search)
const TU = 'technical_investigations'
const calls: { url: string; method: string; body: Record<string, unknown> }[] = []
Object.assign(window, { platformOrganizationUiCalls: calls })
type Member = { profileId: string; displayName: string; email: string; role: 'admin' | 'inspector'; isActive: boolean; modules: string[] }
const members: Member[] = [
  { profileId: 'user-a', displayName: 'Anna Admin', email: 'anna@example.test', role: 'admin', isActive: true, modules: [TU] },
  { profileId: 'user-b', displayName: 'Bertil Besiktningsman', email: 'bertil@example.test', role: 'inspector', isActive: true, modules: [] },
]
const users = members.map((member) => ({ id: member.profileId, fullName: member.displayName, email: member.email })).concat([{ id: 'user-c', fullName: 'Cecilia Kollega', email: 'cecilia@example.test' }])
const organizations: PlatformOrganizationDirectory['organizations'] = [
  { id: 'org-a', name: 'BBSAB Test', organizationNumber: '559281-0823', modules: params.has('legacy') ? [] : [TU], tuManaged: !params.has('legacy'), activeMemberCount: 2, activeAdminCount: 1 },
  { id: 'org-b', name: 'SVEA Test', organizationNumber: null, modules: [], tuManaged: true, activeMemberCount: 0, activeAdminCount: 0 },
]
let changed = false
let refreshFailure = false
let createTries = 0
window.fetch = async (url, options) => {
  const path = String(url)
  const method = options?.method || 'GET'
  const body = typeof options?.body === 'string' ? JSON.parse(options.body) as Record<string, unknown> : {}
  calls.push({ url: path, method, body })
  const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })
  if (path === '/api/admin/organizations' && method === 'GET') return json({ organizations, users })
  if (path === '/api/admin/organizations' && method === 'POST') {
    ++createTries
    if (params.has('retry-create') && createTries === 1) throw new Error('Simulerat avbrott efter skapandeförfrågan')
    if (!organizations.some((org) => org.id === 'org-created')) organizations.push({ id: 'org-created', name: String(body.name), organizationNumber: null, modules: body.modules as string[], tuManaged: true, activeMemberCount: 1, activeAdminCount: 1 })
    return json({ saved: true, organizationId: 'org-created' })
  }
  const match = path.match(/^\/api\/admin\/organizations\/([^/]+)(\/members)?$/)
  if (!match) throw new Error(`Unexpected path: ${path}`)
  const org = organizations.find((org) => org.id === match[1])!
  if (method === 'GET') {
    if (params.has('stale') && org.id === 'org-a') await new Promise((resolve) => setTimeout(resolve, 400))
    if (params.has('refresh-error') && changed && !refreshFailure) { refreshFailure = true; return json({ code: 'READ_FAILED', error: 'Simulerat läsfel efter sparande' }, 500) }
    return json({ organization: org, members: org.id === 'org-a' ? members : [] })
  }
  if (params.has('conflict')) return json({ code: 'ORG_MEMBER_CONFLICT', error: 'Medlemskapet har ändrats av någon annan. Hämta aktuella uppgifter.' }, 409)
  changed = true
  if (match[2]) {
    const target = members.find((member) => member.profileId === body.profileId)
    if (target) Object.assign(target, { role: body.role, isActive: body.isActive, modules: body.modules })
    else members.push({ profileId: String(body.profileId), displayName: 'Cecilia Kollega', email: 'cecilia@example.test', role: body.role as 'admin' | 'inspector', isActive: Boolean(body.isActive), modules: body.modules as string[] })
    if (params.has('concurrent') && body.profileId === 'user-a') members[1].role = 'admin'
  } else {
    org.modules = body.modules as string[]
    org.tuManaged = true
    if (!org.modules.includes(TU)) members.forEach((member) => { member.modules = [] })
  }
  return json({ saved: true })
}
createRoot(document.getElementById('root')!).render(<OrganizationAdministrationClient />)
