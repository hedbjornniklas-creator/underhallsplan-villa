import React from 'react'
import { createRoot } from 'react-dom/client'
import OrganizationSenderProfiles, { senderProfileValues } from '@/components/organizations/OrganizationSenderProfiles'
import type { OrganizationSenderWorkspace } from '@/lib/organizations/senderProfileTypes'

const params = new URLSearchParams(location.search)
const orgId = '00000000-0000-4000-8000-000000000001'
const profileId = '00000000-0000-4000-8000-000000000002'
const workspace: OrganizationSenderWorkspace = {
  organization: { id: orgId, name: 'Besiktningsbolaget Stockholm', organizationNumber: '559281-0823', legalName: params.has('setup') ? null : 'Styr Projekt Stockholm AB', legalNameVersion: params.has('setup') ? 0 : 1 },
  canEdit: !params.has('member'), migrationRequired: params.has('migration'),
  profiles: params.has('setup') || params.has('migration') ? [] : [
    { ...senderProfileValues(), id: profileId, orgId, version: 1, name: 'Besiktningsbolaget Stockholm', email: 'besiktning@example.test', phone: '08-000 00 00' },
    { ...senderProfileValues(), id: '00000000-0000-4000-8000-000000000003', orgId, version: 1, name: 'Styr Projekt Stockholm AB', email: 'projekt@example.test' },
  ],
}
let writes = 0
window.confirm = message => {
  document.getElementById('preview-confirmation')!.textContent = message ?? ''
  return true
}
window.fetch = async (url, options) => {
  if (String(url) !== `/api/organizations/sender-profiles?orgId=${orgId}`) throw new Error('No external requests are permitted in this fixture')
  if (options?.method === 'PUT') {
    writes++
    const body = JSON.parse(String(options.body))
    document.getElementById('preview-request')!.textContent = JSON.stringify(body)
    if (body.action === 'legalName') {
      workspace.organization.legalName = body.legalName.trim()
      workspace.organization.legalNameVersion++
    } else if (body.action === 'saveProfile') {
      const existing = workspace.profiles.find(profile => profile.id === body.id)
      if (existing) Object.assign(existing, body.values, { version: existing.version + 1 })
      else workspace.profiles.push({ ...body.values, id: body.id, orgId, version: 1 })
    }
    if (params.has('retry') && writes === 1) throw new Error('Synthetic lost response')
  }
  return Response.json({ saved: true, workspace })
}
createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <div style={{ maxWidth: params.has('mobile') ? 390 : 1152, margin: '0 auto' }} className="space-y-5">
      <p className="rounded-xl bg-slate-900 px-4 py-3 text-sm text-white">Lokal förhandsvisning · exempelprofiler · inget sparas i HusHub</p>
      <header className="rounded-2xl bg-white p-5"><p className="text-xs uppercase tracking-widest text-slate-500">Organisation</p><h1 className="mt-2 text-2xl font-semibold">Besiktningsbolaget Stockholm</h1><p className="mt-3 font-semibold text-indigo-700">Avsändarprofiler</p></header>
      <OrganizationSenderProfiles orgId={orgId} />
      <details><summary>Testbegäran och bekräftelse</summary><pre id="preview-confirmation" className="whitespace-pre-wrap text-xs" /><pre id="preview-request" className="whitespace-pre-wrap break-all text-xs" /></details>
    </div>
  </React.StrictMode>,
)
