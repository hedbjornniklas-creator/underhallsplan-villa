import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import ActionCaseItemSheet from '@/components/tasks/ActionCaseItemSheet'
import { useActionCalculationAutosave } from '@/components/tasks/useActionCalculationAutosave'
import { useActionSaveCoordinator } from '@/components/tasks/useActionSaveCoordinator'
import { overlayCalculation } from '@/lib/action-cases/calculationSave'
import type { ActionCaseItemView } from '@/lib/action-cases/contracts'
import '@/components/tasks/uppdrag-theme.css'

function App() {
  const [item, setItem] = useState<ActionCaseItemView | null>(null)
  const [open, setOpen] = useState(true)
  const coordinate = useActionSaveCoordinator()
  const calculation = useActionCalculationAutosave({ caseId: '00000000-0000-4000-8000-000000000001', coordinate, onSaved: result => setItem(result.item) })
  useEffect(() => { void fetch('/test/item').then(response => response.json()).then(setItem) }, [])
  if (!item) return <p>Laddar testkalkyl</p>
  const displayed = overlayCalculation(item, Object.values(calculation.states).filter(entry => entry.status !== 'saved').map(entry => entry.edit))
  const current: ActionCaseItemView = new URLSearchParams(location.search).has('locked') ? { ...displayed, contractWork: { locked: true, differences: [], version: 1, revision: 1, documentId: null, price: { editable: false, split: 'combined', amountOre: null, labourOre: null, materialOre: null } } } : displayed
  return <main><h1>Fiktiv kalkyl</h1><button onClick={() => setOpen(true)}>Öppna kalkylen</button>
    <output hidden data-testid="saved-item">{JSON.stringify(item)}</output>
    {open && <ActionCaseItemSheet item={current} caseId="00000000-0000-4000-8000-000000000001" initialTab="cost" busy={false} scopeBlocked={false} calculation={calculation}
      onClose={() => setOpen(false)} onSave={async () => false} onScopeChange={() => undefined} onScopeFlush={() => undefined} onScopeRetry={() => undefined}
      onCostAction={async (name, payload) => {
        const response = await fetch('/test/action', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, payload }) })
        if (!response.ok) return false
        setItem(await response.json()); return true
      }} />}
  </main>
}
createRoot(document.getElementById('root')!).render(<App />)
