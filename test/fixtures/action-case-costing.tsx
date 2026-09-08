import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import ActionCaseItemSheet from '@/components/tasks/ActionCaseItemSheet'
import { AppToastProvider, useToast } from '@/components/ui/AppToastProvider'
import { normalizeCostLine } from '@/lib/action-cases/costing'
import type { ActionCaseItemView } from '@/lib/action-cases/contracts'

const initial: ActionCaseItemView = {
  id: 'test-item', title: 'Byta skadad träpanel', scope: 'Byt 4 skadade panelbrädor vid entrén. Måla och ta hand om avfallet.',
  status: 'pricing_needed', sortOrder: 100, ownLaborReady: false, materialPriceReady: false,
  subcontractorPriceReady: false, wasteSolutionReady: false, requiresSubcontractor: true,
  estimatedCost: null, customerPrice: null, updatedAt: 'v1', costSuggestion: null,
  costLines: [{ id: 'existing', category: 'material', description: 'Grundmålad panel, 22 × 145 mm', quantity: 4, unit: 'st',
    unitCost: 175, markupPercent: 20, vatRate: 25, priceSource: 'manual', sourceUrl: null,
    sourceCheckedAt: null, verified: true, sortOrder: 100, quantityBasis: 'provided', notes: null }],
}
function App() {
  const [item, setItem] = useState(initial)
  const [open, setOpen] = useState(true)
  const [busy, setBusy] = useState(false)
  const [actions, setActions] = useState<string[]>([])
  const toast = useToast()
  const update = (value: Partial<ActionCaseItemView>) => setItem((current) => ({ ...current, ...value, updatedAt: crypto.randomUUID() }))
  return <main><h1>Test av åtgärdskalkyl</h1><button onClick={() => setOpen(true)}>Öppna åtgärd</button><output hidden data-testid="actions">{JSON.stringify(actions)}</output>
    {open ? <ActionCaseItemSheet item={item} busy={busy} onClose={() => setOpen(false)} onSave={async (payload) => {
      setBusy(true); await new Promise((resolve) => setTimeout(resolve, 150)); update(payload); setBusy(false); toast.success('Åtgärden sparades.'); return true
    }} onCostAction={async (name, payload) => {
      setActions((current) => [...current, name]); setBusy(true)
      await new Promise((resolve) => setTimeout(resolve, 500))
      if (new URLSearchParams(location.search).has('fail')) { setBusy(false); toast.error('Kalkylförslaget kunde inte skapas. Försök igen.'); return false }
      if (name === 'generate_cost_suggestions') setItem((current) => ({ ...current, costSuggestion: {
        id: 'proposal', sourceUpdatedAt: current.updatedAt, createdAt: new Date().toISOString(), warnings: ['UE-arbetets omfattning behöver avgränsas.'],
        lines: [
          { id: 'work', category: 'own_labor', description: 'Demontera och montera panel', quantity: 3, unit: 'tim', quantityBasis: 'estimated', notes: 'Preliminär arbetstid vid normal åtkomst.' },
          { id: 'waste', category: 'waste', description: 'Bortforsling av byggavfall', quantity: null, unit: 'kg', quantityBasis: 'unknown', notes: 'Väg eller uppskatta mängden inför prisinhämtning.' },
        ],
      } }))
      else if (name === 'apply_cost_suggestions') update({ costSuggestion: null, costLines: [...item.costLines, ...item.costSuggestion!.lines.filter((line) => (payload.lineIds as string[]).includes(line.id)).map((line) => ({ ...line, unitCost: null, markupPercent: 0, vatRate: 25, verified: false, priceSource: 'ai_suggestion' as const, sourceUrl: null, sourceCheckedAt: null, sortOrder: 200 }))] })
      else if (name === 'delete_cost_line') update({ costLines: item.costLines.filter((line) => line.id !== payload.costLineId) })
      else {
        const line = { ...normalizeCostLine(payload), id: String(payload.costLineId ?? crypto.randomUUID()), sourceCheckedAt: null, vatRate: 25, sortOrder: 300 }
        update({ costLines: name === 'update_cost_line' ? item.costLines.map((current) => current.id === line.id ? line : current) : [...item.costLines, line] })
      }
      setBusy(false); toast.success('Kalkylen uppdaterades.'); return true
    }} /> : null}
  </main>
}
createRoot(document.getElementById('root')!).render(<AppToastProvider><App /></AppToastProvider>)
