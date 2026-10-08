import React from 'react'
import { createRoot } from 'react-dom/client'
import OrganizationSettingsClient from '@/components/organizations/OrganizationSettingsClient'
import OrganizationInvitationAccept from '@/components/organizations/OrganizationInvitationAccept'
import type { OrganizationAdministrationWorkspace } from '@/lib/organizations/administrationTypes'

const orgId = '00000000-0000-4000-8000-000000000001'
const params = new URLSearchParams(location.search)
const enabledModules = params.has('no-modules') ? [] : params.has('ob-only') ? ['inspections'] : params.has('both') ? ['inspections', 'technical_investigations'] : ['technical_investigations']
const calls: { url: string; body: Record<string, unknown> }[] = []
Object.assign(window, { organizationUiCalls: calls })
const workspace: OrganizationAdministrationWorkspace = {
  profileId: 'viewer', role: params.has('member') ? 'inspector' : 'admin', modules: enabledModules, migrationRequired: params.has('migration'),
  organization: { id: orgId, name: 'BBSAB', organizationNumber: '559281-0823', address: 'Testgatan 1', postalCode: '111 22', city: 'Stockholm', website: 'https://example.test', logoPath: null, reportFooterText: 'Gemensam rapportsidfot', configured: !params.has('unconfigured'), version: 4 },
}
window.fetch = async (url, options) => {
  const path = String(url)
  const body = typeof options?.body === 'string' ? JSON.parse(options.body) as Record<string, unknown> : {}
  calls.push({ url: path, body })
  const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })
  if (path === '/api/organizations/profile') return params.has('conflict')
    ? json({ error: 'Uppgifterna har ändrats. Ladda om sidan och försök igen.' }, 409)
    : json({ workspace: { ...workspace, organization: { ...workspace.organization, ...(body.profile as object), configured: true, version: 5 } } })
  if (path.startsWith('/api/organizations/members')) return json({
    members: [{ profileId: 'viewer', displayName: 'Niklas Test', email: 'niklas@example.test', role: 'admin', isActive: true, modules: enabledModules }],
    invitations: [{ id: 'pending', email: 'pending@example.test', fullName: 'Väntande kollega', role: 'inspector', modules: enabledModules, status: 'pending', expiresAt: '2099-01-01', revision: 1, notificationState: 'accepted' }], enabledModules,
  })
  if (path === '/api/organizations/invitations') return json({ message: 'Inbjudan skickad.', emailAccepted: true })
  if (path === '/api/organizations/invitations/accept') return body.action === 'preview'
    ? json({ invitation: { organizationName: 'BBSAB', email: 'colleague@example.test', fullName: 'Kollega Test', role: params.has('admin-only') ? 'admin' : 'inspector', modules: params.has('admin-only') ? [] : enabledModules, accepted: false }, hasSession: false, requiresSignIn: false })
    : json({ accepted: true, createdUser: false, email: 'colleague@example.test', organizationId: orgId })
  if (path === '/api/integrations/fortnox/status') return json({ configured: true, organizations: [
    { id: '00000000-0000-4000-8000-000000000002', name: 'SVEA', organizationNumber: '559281-0823', isDefault: true, canManage: true, connection: null },
    { id: orgId, name: 'BBSAB', organizationNumber: '559281-0823', isDefault: false, canManage: true, connection: null },
  ] })
  throw new Error(`Unexpected mocked endpoint: ${path}`)
}
createRoot(document.getElementById('root')!).render(params.has('invite') || params.has('invitation') ? <div className="public-site"><OrganizationInvitationAccept /></div> : <OrganizationSettingsClient key={workspace.organization.id} initialWorkspace={workspace} />)
