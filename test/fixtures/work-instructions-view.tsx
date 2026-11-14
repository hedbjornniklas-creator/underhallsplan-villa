import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import ActionCaseItemSheet from '@/components/tasks/ActionCaseItemSheet'
import UppdragScope from '@/components/tasks/UppdragScope'
import UppdragBrand from '@/components/tasks/UppdragBrand'
import type { ActionCaseItemView } from '@/lib/action-cases/contracts'

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const item: ActionCaseItemView = {
  id: id(2), title: 'Golvläggning · Fiktivt dansprojekt', scope: 'Avtalad golvläggning enligt godkänd omfattning.',
  scopeConditions: 'Oförändrade förutsättningar.', scopeExclusions: 'Oförändrade undantag.', scopeAdvice: '', scopeNotesAvailable: true, scopeConditionsAvailable: true,
  status: 'ready_for_quote', sortOrder: 100, ownLaborReady: true, materialPriceReady: true, subcontractorPriceReady: false, wasteSolutionReady: true, requiresSubcontractor: false,
  estimatedCost: 19000, customerPrice: 25000, updatedAt: '2026-11-14T08:00:00Z', costSuggestion: null,
  costLines: [{ id: id(3), category: 'material', description: 'Fiktivt golvmaterial', quantity: 10, unit: 'm2', unitCost: 1900, markupPercent: 20, vatRate: 25, priceSource: 'manual', sourceUrl: null, sourceCheckedAt: null, verified: true, sortOrder: 100, quantityBasis: 'provided', notes: null, updatedAt: '2026-11-14T08:00:00Z' }],
  contractWork: { locked: true, version: 1, revision: 1, documentId: id(4), differences: [], price: { editable: false, split: 'combined', amountOre: 2500000, labourOre: null, materialOre: null } },
}
function App() {
  const [open, setOpen] = useState(true), [dirty, setDirty] = useState(false), [mutations, setMutations] = useState(0)
  return <UppdragScope><main style={{ padding: 24 }}><UppdragBrand /><h1>Fiktivt testprojekt</h1><p>Inga riktiga projektuppgifter eller utskick.</p><button onClick={() => setOpen(true)}>Öppna moment</button><output data-testid="protected-state">{JSON.stringify({ item, mutations })}</output><output data-testid="instruction-dirty">{String(dirty)}</output>
    {open && <ActionCaseItemSheet item={item} caseId={id(1)} attachments={[]} busy={false} onClose={() => setOpen(false)} onSave={async () => { setMutations(n => n + 1); return false }} onCostAction={async () => { setMutations(n => n + 1); return false }} scopeBlocked={false} onScopeChange={() => setMutations(n => n + 1)} onScopeFlush={() => undefined} onScopeRetry={() => undefined} onDirtyChange={setDirty} initialTab={new URLSearchParams(location.search).has('instructions') ? 'instructions' : 'scope'} />}
  </main></UppdragScope>
}
createRoot(document.getElementById('root')!).render(<App />)
