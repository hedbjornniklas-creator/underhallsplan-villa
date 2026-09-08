import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import ActionCaseItemSheet from '@/components/tasks/ActionCaseItemSheet'
import { AppToastProvider, useToast } from '@/components/ui/AppToastProvider'
import { normalizeCostLine } from '@/lib/action-cases/costing'
import { normalizeQuote } from '@/lib/action-cases/quotes'
import type { ActionCaseCostLineView, ActionCaseItemView, ActionCaseQuote } from '@/lib/action-cases/contracts'

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
  const [item, setItem] = useState(() => new URLSearchParams(location.search).has('quotes') ? {
    ...initial, costLines: [
      { ...initial.costLines[0], id: '00000000-0000-4000-8000-000000000006' },
      { ...initial.costLines[0], id: '00000000-0000-4000-8000-000000000005', category: 'own_labor' as const, description: 'Montering', quantity: 4, unit: 'tim', unitCost: 500, pricingMethod: 'direct' as const, quotes: [] },
    ],
  } : initial)
  const [direct, setDirect] = useState<ActionCaseCostLineView | null>(null)
  const [open, setOpen] = useState(true)
  const [busy, setBusy] = useState(false)
  const [actions, setActions] = useState<string[]>([])
  const toast = useToast()
  const update = (value: Partial<ActionCaseItemView>) => setItem((current) => ({ ...current, ...value, updatedAt: crypto.randomUUID() }))
  return <main><h1>Test av åtgärdskalkyl</h1><button onClick={() => setOpen(true)}>Öppna åtgärd</button><output hidden data-testid="actions">{JSON.stringify(actions)}</output>
    {open ? <ActionCaseItemSheet item={item} busy={busy} caseId="test-case" attachments={[{ id: '00000000-0000-4000-8000-000000000008', actionCaseItemId: null, type: 'image', title: 'Entré', fileName: 'entre.jpg', contentType: 'image/jpeg', fileSizeBytes: 100, grantedParticipantIds: [], createdAt: 'v1' }]} onClose={() => setOpen(false)} onSave={async (payload) => {
      setBusy(true); await new Promise((resolve) => setTimeout(resolve, 150)); update(payload); setBusy(false); toast.success('Åtgärden sparades.'); return true
    }} onCostAction={async (name, payload) => {
      setActions((current) => [...current, name]); setBusy(true)
      await new Promise((resolve) => setTimeout(resolve, 500))
      if (new URLSearchParams(location.search).has('fail')) { setBusy(false); toast.error('Kalkylförslaget kunde inte skapas. Försök igen.'); return false }
      if (name === 'work_quote' || name === 'send_quote_request') {
        const current = item.costLines.find((l) => l.id === payload.costLineId)!
        let next = { ...current }
        if (payload.operation === 'method') {
          if (payload.method === 'quotes') { setDirect(current); next = { ...next, pricingMethod: 'quotes', category: 'subcontractor', quantity: 1, unit: 'uppdrag', unitCost: null, verified: false } }
          else next = { ...direct!, quotes: current.quotes, selectedQuoteId: null }
        } else if (payload.operation === 'save') {
          const q = normalizeQuote(payload)
          const saved: ActionCaseQuote = { ...q, scopeSnapshot: item.scope ?? '', descriptionSnapshot: current.description, deliveryStatus: 'draft', sentAt: null, updatedAt: crypto.randomUUID() }
          next.quotes = [...(current.quotes ?? []).filter((p) => p.id !== q.id), saved]
          if (next.selectedQuoteId === saved.id) { next.selectedQuoteId = null; next.unitCost = null; next.verified = false }
        } else if (payload.operation === 'select') {
          const q = current.quotes!.find((q) => q.id === payload.quoteId)!
          next = { ...next, selectedQuoteId: q.id, unitCost: q.amount, verified: true }
        } else if (payload.operation === 'unselect') next = { ...next, selectedQuoteId: null, unitCost: null, verified: false }
        else if (payload.operation === 'markup') next.markupPercent = Number(payload.markupPercent)
        else if (payload.operation === 'delete') next.quotes = current.quotes!.filter((q) => q.id !== payload.quoteId)
        else if (name === 'send_quote_request') next.quotes = current.quotes!.map((q) => q.id === payload.quoteId ? { ...q, deliveryStatus: 'sent', sentAt: new Date().toISOString() } : q)
        const selected = next.quotes?.find((q) => q.id === next.selectedQuoteId)
        update({ costLines: item.costLines.map((l) => l.id === next.id ? next : { ...l, coveredByQuoteId: selected?.coveredLineIds.includes(l.id) ? selected.id : null }) })
      } else if (name === 'generate_cost_suggestions') setItem((current) => ({ ...current, costSuggestion: {
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
