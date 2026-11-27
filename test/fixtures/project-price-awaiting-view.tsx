import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import UppdragScope from '@/components/tasks/UppdragScope'
import { CustomerPriceDisplay } from '@/components/tasks/CustomerPriceDisplay'
import ActionCaseCustomerPricing from '@/components/tasks/ActionCaseCustomerPricing'
import { ContractPriceDocument } from '@/components/tasks/CustomerContractPricing'
import CustomerOfferPricingSummary from '@/components/tasks/CustomerOfferPricingSummary'
import { customerPricedParts, emptyProjectCustomerPricing, normalizeProjectCustomerPricing, type ProjectCustomerPricing } from '@/lib/action-cases/projectCustomerPricing'
import { normalizeContractPricing } from '@/lib/action-cases/contractPricing'
import { emptyCustomerOffer } from '@/lib/action-cases/customerOffers'
import type { ActionCaseItemView } from '@/lib/action-cases/contracts'

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const initial: ProjectCustomerPricing = { ...emptyProjectCustomerPricing(), split: 'separate', labour: { ...emptyProjectCustomerPricing().labour, fixedOre: 3000000 } }
function Fixture() {
  const [value, setValue] = useState<ProjectCustomerPricing>(() => JSON.parse(localStorage.getItem('price-awaiting-test') || 'null') || initial)
  const [view, setView] = useState('Kundpris')
  const locked = new URLSearchParams(location.search).has('locked')
  const item = { id: id(2), title: 'Fiktiva innerdörrar D02–D06', costLines: [{ id: id(3), category: 'own_labor', quantity: 40, unitCost: 400, markupPercent: 50, reservePercent: 0, vatRate: 25 }], contractWork: {
    locked, customerPricing: { revision: 1, terms: value, candidates: [], documentRevisions: { offer: 1, contract: 1 } },
  } } as unknown as ActionCaseItemView
  const kinds = customerPricedParts(value).map(part => part.charge.mode === 'fixed' ? 'fixed' : 'running')
  const mode = kinds.includes('fixed') ? kinds.includes('running') ? 'mixed' : 'fixed' : 'running'
  const price = normalizeContractPricing({ version: 1, mode, display: 'priced', split: 'combined', basis: 'rows', totalOre: null, labourOre: null, materialOre: null,
    rows: [{ id: id(4), sourceItemId: item.id, title: item.title, kind: 'fixed', amountOre: null, labourOre: null, materialOre: null, projectPricing: { revision: 1, terms: value } }],
    running: { hourlyOre: null, markupPercent: null, managementOre: null, approximateOre: null } })
  const draft = { ...emptyCustomerOffer('Fiktivt testprojekt'), contractForm: 'ab04' as const, contractPricing: price }
  return <UppdragScope><CustomerPriceDisplay value={{ version: 1, customerType: 'business', vatBasis: 'excl' }}><main className="mx-auto max-w-5xl p-4 sm:p-8">
    <p className="gizmo-eyebrow">Gizmo · Fiktivt testprojekt</p><h1 className="mb-5 text-2xl font-semibold">Fiktiva innerdörrar D02–D06</h1>
    <nav className="gizmo-register-tabs gizmo-project-tabs mb-5" role="tablist" aria-label="Testvyer">{['Kundpris', 'Avtal', 'Offert'].map(tab => <button key={tab} role="tab" className="gizmo-register-tab" aria-selected={tab === view} onClick={() => setView(tab)}>{tab}</button>)}</nav>
    {view === 'Kundpris' && <ActionCaseCustomerPricing item={item} blocked={false} onChange={terms => { const next = normalizeProjectCustomerPricing(terms); localStorage.setItem('price-awaiting-test', JSON.stringify(next)); setValue(next) }} onRetry={() => {}} onReload={() => {}} onDraftDirty={() => {}} />}
    {view === 'Avtal' && <ContractPriceDocument value={price} />}
    {view === 'Offert' && <CustomerOfferPricingSummary draft={draft} sources={[item]} blocked={locked} onDisplayChange={() => {}} />}
  </main></CustomerPriceDisplay></UppdragScope>
}
createRoot(document.getElementById('root')!).render(<Fixture />)
