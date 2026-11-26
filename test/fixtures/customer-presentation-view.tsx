import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import UppdragScope from '@/components/tasks/UppdragScope'
import { CustomerPriceDisplay } from '@/components/tasks/CustomerPriceDisplay'
import ProjectCustomerPresentation from '@/components/tasks/ProjectCustomerPresentation'
import ActionCaseCustomerPricing from '@/components/tasks/ActionCaseCustomerPricing'
import CustomerOfferDocument from '@/components/tasks/CustomerOfferDocument'
import CustomerChoicePriceTime from '@/components/tasks/CustomerChoicePriceTime'
import { PaymentPlanDocument } from '@/components/tasks/CustomerPaymentPlan'
import type { CustomerOfferWorkspace } from '@/lib/action-cases/customerOffers'
import type { ActionCaseItemView } from '@/lib/action-cases/contracts'
import { choiceOfferForEditing } from '@/lib/action-cases/choiceOffer'

function Fixture() {
  const [workspace, setWorkspace] = useState<CustomerOfferWorkspace | null>(null), [view, setView] = useState('Översikt')
  const locked = new URLSearchParams(location.search).has('locked')
  const load = async () => { setWorkspace(await (await fetch('/fixture')).json()); return true }
  useEffect(() => { void fetch('/fixture').then(response => response.json()).then(setWorkspace) }, [])
  if (!workspace) return null
  const draft = workspace.draft, settings = workspace.customerPresentation?.value
  const item = { id: '00000000-0000-4000-8000-000000000002', title: 'Fiktivt byggarbete', costLines: [], contractWork: { locked,
    customerPricing: { revision: 1, terms: { version: 1, split: 'combined', combined: { mode: 'fixed', fixedOre: draft.baseAmountOre, budgetOre: null, hourlyOre: null, markupPercent: null },
      labour: { mode: 'fixed', fixedOre: null, budgetOre: null, hourlyOre: null, markupPercent: null }, material: { mode: 'fixed', fixedOre: null, budgetOre: null, hourlyOre: null, markupPercent: null }, assumptions: '', reviewTerms: '' }, candidates: [] } } } as unknown as ActionCaseItemView
  const document = (historical = false) => <CustomerOfferDocument purpose={view === 'Avtal' ? 'contract' : 'offer'} readOnly selected={[]} fileUrl={() => '#'} offer={{
    id: 'test', version: 1, status: 'published', publishedAt: '2026-11-26T09:00:00Z', sentAt: null, acceptedAt: null, acceptedBy: null, acceptedOptionIds: [], acceptedTotalOre: null, files: [],
    snapshot: { ...draft, customerPresentation: historical ? undefined : draft.customerPresentation, projectTitle: 'Fiktivt projekt', propertyAddress: 'Testgatan 1', customerName: 'Testkund', customerEmail: 'test@example.test', issuerName: 'Testbygg AB', replyEmail: 'test@example.test' },
  }} />
  return <UppdragScope><CustomerPriceDisplay value={settings}><main className="mx-auto max-w-6xl p-4 sm:p-8">
    <p className="gizmo-eyebrow">Gizmo · Fiktivt testprojekt</p><h1 className="mb-6 text-2xl font-semibold">Beställare och momsvisning</h1>
    <nav className="gizmo-register-tabs gizmo-project-tabs mb-5" role="tablist" aria-label="Testvyer">{['Översikt', 'Kundpris', 'Offert', 'Avtal', 'ÄTA', 'Betalningsplan', 'Historiskt dokument'].map(tab => <button key={tab} role="tab" className="gizmo-register-tab" aria-selected={tab === view} onClick={() => setView(tab)}>{tab}</button>)}</nav>
    {view === 'Översikt' && <ProjectCustomerPresentation key={workspace.revision} caseId="00000000-0000-4000-8000-000000000001" workspace={workspace} locked={locked} blocked={false} active onPending={() => {}} onDirty={() => {}} onApplied={setWorkspace} onReload={load} />}
    {view === 'Kundpris' && <ActionCaseCustomerPricing item={item} blocked={false} onChange={() => { throw new Error('Unexpected price write') }} onDraftDirty={() => {}} onRetry={() => {}} onReload={() => {}} />}
    {(view === 'Offert' || view === 'Avtal') && document()}
    {view === 'Historiskt dokument' && document(true)}
    {view === 'ÄTA' && <CustomerChoicePriceTime value={choiceOfferForEditing({ budgetOre: draft.baseAmountOre })} onChange={() => { throw new Error('Unexpected choice write') }} />}
    {view === 'Betalningsplan' && <PaymentPlanDocument plan={draft.paymentPlan} paymentTerms={draft.paymentTerms} />}
  </main></CustomerPriceDisplay></UppdragScope>
}
createRoot(document.getElementById('root')!).render(<Fixture />)
