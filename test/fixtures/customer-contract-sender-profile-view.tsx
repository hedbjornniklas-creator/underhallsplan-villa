import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import CustomerContractSenderProfile from '@/components/tasks/CustomerContractSenderProfile'
import { ContractContractorEditor } from '@/components/tasks/CustomerContractPartiesEditor'
import { emptyContractParties } from '@/lib/action-cases/customerContractParties'
import type { CustomerOfferWorkspace } from '@/lib/action-cases/customerOffers'
import { contractSenderFixture } from './contract-sender-profile'

const params = new URLSearchParams(location.search), snapshot = contractSenderFixture()
const caseId = '00000000-0000-4000-8000-000000000001'
const org = { id: snapshot.organizationId, name: 'Tidigare visningsnamn', legalName: snapshot.legalName,
  organizationNumber: snapshot.organizationNumber, legalNameVersion: snapshot.legalNameVersion }
const profile = { id: snapshot.profileId, orgId: org.id, version: snapshot.profileVersion, name: snapshot.name, address: snapshot.address,
  postalCode: snapshot.postalCode, city: snapshot.city, email: snapshot.email, phone: snapshot.phone, website: snapshot.website,
  logoPath: null, reportFooterText: snapshot.reportFooterText, isActive: true }
const parties = emptyContractParties('Anna Exempel', 'anna@example.test', '0701234567', { companyName: 'Tidigare företagsuppgifter',
  organizationNumber: snapshot.organizationNumber, contactName: 'Erik Exempel', mobile: '0709876543', street: 'Tidigare gatan 1',
  postalCode: '11122', city: 'Stockholm', email: 'tidigare@example.test', fTax: 'yes' })
const server: CustomerOfferWorkspace = { revision: 7, offers: [], draft: { title: 'Tillbyggnad vid Exempelvägen 12', introduction: 'Ursprunglig inledning behålls.',
  baseAmountOre: 12000000, validUntil: '2027-12-01', contractForm: 'custom', terms: 'Ursprungliga villkor', paymentTerms: '30 dagar', schedule: 'Enligt överenskommelse',
  attachmentIds: [], termsAttachmentId: null, items: [], contractParties: parties,
  ...(params.has('selected') ? { senderProfile: snapshot } : {}) } }
function applyProfile() {
  server.draft.senderProfile = snapshot
  server.draft.contractParties!.contractor = { ...server.draft.contractParties!.contractor, companyName: snapshot.name,
    organizationNumber: snapshot.organizationNumber, street: snapshot.address ?? '', postalCode: snapshot.postalCode ?? '', city: snapshot.city ?? '',
    email: snapshot.email ?? '', phone: snapshot.phone ?? '' }
}
if (params.has('selected')) applyProfile()
const receipts = new Map<string, string>()
let attempts = 0
window.fetch = async (url, init) => {
  if (String(url) !== `/api/action-cases/${caseId}/sender-profile`) throw new Error('Only the local fixture endpoint is available')
  if (init?.method === 'POST') {
    attempts++
    const body = JSON.parse(String(init.body)), exact = JSON.stringify(body)
    if (receipts.has(body.requestId) && receipts.get(body.requestId) !== exact) throw new Error('Retry payload changed')
    if (!receipts.has(body.requestId)) { receipts.set(body.requestId, exact); applyProfile(); server.revision++ }
    if (params.has('retry') && attempts === 1) throw new Error('Synthetic lost response after commit')
    return Response.json({ saved: true, workspace: server })
  }
  return Response.json({ available: !params.has('migration'), organization: org, profiles: [profile], selected: server.draft.senderProfile ?? null })
}
function Preview() {
  const [workspace, setWorkspace] = useState(() => structuredClone(server))
  const [pending, setPending] = useState(false)
  const [dirty, setDirty] = useState(params.has('dirty'))
  const contractor = workspace.draft.contractParties!.contractor
  return <div style={{ maxWidth: params.has('mobile') ? 390 : 1056, margin: '0 auto' }}>
    <p className="rounded-lg bg-slate-900 px-4 py-3 text-sm text-white">Lokal förhandsvisning · fiktivt uppdrag · inget sparas i HusHub</p>
    <header className="py-6"><p className="text-sm text-slate-500">Uppdrag · Exempelvägen 12</p><h1 className="mt-2 text-2xl font-semibold">Avtal</h1></header>
    <CustomerContractSenderProfile caseId={caseId} organizationId={org.id} selected={workspace.draft.senderProfile ?? null}
      revision={workspace.revision} currentCompanyName={contractor.companyName}
      blockedReason={pending ? 'Ett arbete pågår.' : params.has('locked') ? 'Avtalet är låst. Skapa ett nytt avtalsutkast först.' : dirty ? 'Spara avtalsutkastet innan du väljer avsändarprofil.' : null}
      onPendingChange={setPending} onApplied={setWorkspace} onReload={async () => { setWorkspace(structuredClone(server)); return true }} />
    <section className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5"><h2 className="mb-4 text-lg font-semibold">Entreprenör</h2>
      <fieldset disabled={pending || params.has('locked')}><ContractContractorEditor value={contractor} source={{ companyName: 'Tidigare företagsuppgifter' }}
        companyFieldsReadonly={Boolean(workspace.draft.senderProfile)} onChange={value => {
          setWorkspace(current => ({ ...current, draft: { ...current.draft, contractParties: { ...current.draft.contractParties!, contractor: value } } })); setDirty(true)
        }} /></fieldset>
      {dirty && <button className="mt-4 min-h-11 rounded-md border border-slate-300 bg-white px-4 py-2 text-sm" onClick={() => setDirty(false)}>Spara lokalt testutkast</button>}
    </section>
    <section className="mt-5 rounded-xl border border-slate-200 bg-white p-4 text-sm"><h2 className="font-semibold">Övrigt avtalsinnehåll</h2>
      <p className="mt-2">{workspace.draft.title} · 120 000 kr</p><p>{workspace.draft.introduction}</p></section>
  </div>
}
createRoot(document.getElementById('root')!).render(<Preview />)
