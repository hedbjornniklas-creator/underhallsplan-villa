import React, { useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import ActionCaseItemSheet from '@/components/tasks/ActionCaseItemSheet'
import { AppToastProvider, useToast } from '@/components/ui/AppToastProvider'
import RequestApp, { requestFixture, savedPackageFixture } from './action-case-requests'
import { normalizeCostLine } from '@/lib/action-cases/costing'
import { normalizeQuote } from '@/lib/action-cases/quotes'
import type { ActionCaseCostLineView, ActionCaseItemView, ActionCaseQuote, ActionCaseView } from '@/lib/action-cases/contracts'

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const version = '2026-09-09T08:00:00.000Z'

const initial: ActionCaseItemView = {
  id: id(11), title: 'Byta skadad träpanel', scope: 'Byt 4 skadade panelbrädor vid entrén. Måla och ta hand om avfallet.',
  status: 'pricing_needed', sortOrder: 100, ownLaborReady: false, materialPriceReady: false,
  subcontractorPriceReady: false, wasteSolutionReady: false, requiresSubcontractor: true,
  estimatedCost: null, customerPrice: null, updatedAt: version, costSuggestion: null,
  costLines: [{ id: 'existing', category: 'material', description: 'Grundmålad panel, 22 × 145 mm', quantity: 4, unit: 'st',
    unitCost: 175, markupPercent: 20, vatRate: 25, priceSource: 'manual', sourceUrl: null,
    sourceCheckedAt: null, verified: true, sortOrder: 100, quantityBasis: 'provided', notes: null, updatedAt: version }],
}
function App() {
  const params = new URLSearchParams(location.search)
  const [item, setItem] = useState<ActionCaseItemView>(() => params.has('savedPackage') ? savedPackageFixture(params.has('expired')).items[0] : params.has('work') ? {
    ...initial, workParts: [], scopeAttachmentIds: [id(8), id(9)],
    costLines: [
      { ...initial.costLines[0], id: id(6), workPartId: null },
      ...['Montering', 'Målning', 'Efterkontroll'].map((description, n): ActionCaseCostLineView => ({
        ...initial.costLines[0], id: id(51 + n), category: 'own_labor', description,
        quantity: 4 + n, unit: 'tim', unitCost: 500 + n * 50, pricingMethod: 'direct',
        workPartId: null, quotes: [], updatedAt: version,
      })),
    ],
  } : params.has('quotes') ? {
    ...initial, costLines: [
      { ...initial.costLines[0], id: '00000000-0000-4000-8000-000000000006' },
      { ...initial.costLines[0], id: '00000000-0000-4000-8000-000000000005', category: 'own_labor' as const, description: 'Montering', quantity: 4, unit: 'tim', unitCost: 500, pricingMethod: 'direct' as const, quotes: [] },
    ],
  } : initial)
  const [direct, setDirect] = useState<ActionCaseCostLineView | null>(null)
  const [open, setOpen] = useState(true)
  const [busy, setBusy] = useState(false)
  const [actions, setActions] = useState<string[]>([])
  const [payloads, setPayloads] = useState<Array<{ name: string; payload: Record<string, unknown>; itemUpdatedAt: string }>>([])
  const [requestLineIds, setRequestLineIds] = useState<string[] | null>(null)
  const [openedRequestId, setOpenedRequestId] = useState<string | null>(null)
  const bulkFailure = useRef(params.has('bulkFail'))
  const toast = useToast()
  const update = (value: Partial<ActionCaseItemView>) => setItem((current) => ({ ...current, ...value, updatedAt: new Date().toISOString() }))
  const attachments: ActionCaseView['attachments'] = [
      { id: '00000000-0000-4000-8000-000000000008', actionCaseItemId: null, type: 'image', title: 'Entré', fileName: 'entre.jpg', contentType: 'image/jpeg', fileSizeBytes: 100, grantedParticipantIds: [], createdAt: 'v1' },
      ...(params.has('scope') || params.has('work') ? [{ id: '00000000-0000-4000-8000-000000000009', actionCaseItemId: null, type: 'document' as const, title: 'Arbetsbeskrivning', fileName: 'arbetsbeskrivning.pdf', contentType: 'application/pdf', fileSizeBytes: 100, grantedParticipantIds: [], createdAt: 'v1' }] : []),
  ]
  return <main><h1>Test av åtgärdskalkyl</h1><button onClick={() => setOpen(true)}>Öppna åtgärd</button><output hidden data-testid="actions">{JSON.stringify(actions)}</output><output hidden data-testid="item">{JSON.stringify(item)}</output>
    <output hidden data-testid="cost-payloads">{JSON.stringify(payloads)}</output>
    <output hidden data-testid="request-line-ids">{JSON.stringify(requestLineIds)}</output>
    <output hidden data-testid="opened-request-id">{JSON.stringify(openedRequestId)}</output>
    {openedRequestId ? <RequestApp initialCase={{ ...savedPackageFixture(params.has('expired')), items: [item] }} initialRequestId={openedRequestId} onClose={() => { setOpenedRequestId(null); setOpen(true) }} /> : null}
    {requestLineIds ? <RequestApp initialCase={{ ...requestFixture, items: [item], attachments }} preselectedLineIds={requestLineIds} onClose={() => { setRequestLineIds(null); setOpen(true) }} /> : null}
    {open ? <ActionCaseItemSheet item={item} busy={busy} caseId="test-case" attachments={attachments}
    initialCostLineId={params.has('savedPackage') ? id(params.has('covered') ? 23 : 21) : undefined}
    onOpenRequest={params.has('savedPackage') ? (requestId) => { setOpenedRequestId(requestId); setOpen(false) } : undefined}
    onRequest={params.has('work') ? (lineIds: string[]) => { setRequestLineIds(lineIds); setOpen(false) } : undefined}
    onClose={() => setOpen(false)} onSave={async (payload) => {
      setBusy(true); await new Promise((resolve) => setTimeout(resolve, 150)); setBusy(false)
      if (new URLSearchParams(location.search).has('saveFail')) { toast.error('Filvalet kunde inte sparas.'); return false }
      update(payload); toast.success('Åtgärden sparades.'); return true
    }} onCostAction={async (name, payload) => {
      setActions((current) => [...current, name]); setBusy(true)
      setPayloads((current) => [...current, { name, payload, itemUpdatedAt: item.updatedAt }])
      await new Promise((resolve) => setTimeout(resolve, 500))
      if (new URLSearchParams(location.search).has('fail')) { setBusy(false); toast.error('Kalkylförslaget kunde inte skapas. Försök igen.'); return false }
      if (name === 'work_part') {
        if (payload.expectedUpdatedAt !== item.updatedAt) { setBusy(false); toast.error('Arbetsdelen har ändrats.'); return false }
        if (payload.operation === 'bulk_update' && (payload.costLineIds as string[]).length > 1 && bulkFailure.current) {
          bulkFailure.current = false; setBusy(false); toast.error('Timpriserna kunde inte sparas. Försök igen.'); return false
        }
        if (payload.operation === 'save') {
          const partId = String(payload.partId ?? crypto.randomUUID())
          const part = { id: partId, title: String(payload.title), scope: String(payload.scope ?? '') || null, sortOrder: 100, updatedAt: new Date().toISOString() }
          update({ workParts: [...(item.workParts ?? []).filter((p) => p.id !== partId), part] })
        } else if (payload.operation === 'delete') update({
          workParts: item.workParts?.filter((p) => p.id !== payload.partId),
          costLines: item.costLines.map((line) => line.workPartId === payload.partId ? { ...line, workPartId: null } : line),
        })
        else if (payload.operation === 'move_lines') update({ costLines: item.costLines.map((line) =>
          (payload.costLineIds as string[]).includes(line.id) ? { ...line, workPartId: payload.partId as string | null } : line,
        ) })
        else if (payload.operation === 'bulk_update') update({ costLines: item.costLines.map((line) =>
          (payload.costLineIds as string[]).includes(line.id) ? { ...line,
            ...('quantity' in payload ? { quantity: payload.quantity as number | null, quantityBasis: payload.quantity === null ? 'unknown' as const : 'provided' as const } : {}),
            ...('unitCost' in payload ? { unitCost: payload.unitCost as number | null } : {}),
            ...('unit' in payload ? { unit: String(payload.unit) } : {}),
            ...('markupPercent' in payload ? { markupPercent: Number(payload.markupPercent) } : {}),
            verified: false, priceSource: 'manual', updatedAt: new Date().toISOString(),
          } : line,
        ) })
        else throw new Error(`Unsupported synthetic work-part operation: ${String(payload.operation)}`)
      } else if (name === 'work_quote' || name === 'send_quote_request') {
        const current = item.costLines.find((l) => l.id === payload.costLineId)!
        let next = { ...current }
        if (payload.operation === 'method') {
          if (payload.method === 'quotes') { setDirect(current); next = { ...next, pricingMethod: 'quotes', category: 'subcontractor', quantity: 1, unit: 'uppdrag', unitCost: null, verified: false } }
          else next = { ...direct!, quotes: current.quotes, selectedQuoteId: null }
        } else if (payload.operation === 'save') {
          const q = normalizeQuote(payload)
          const saved: ActionCaseQuote = { ...q, scopeSnapshot: item.scope ?? '', descriptionSnapshot: current.description, deliveryStatus: 'draft', sentAt: null, updatedAt: new Date().toISOString() }
          next.quotes = [...(current.quotes ?? []).filter((p) => p.id !== q.id), saved]
          if (next.selectedQuoteId === saved.id) { next.selectedQuoteId = null; next.unitCost = null; next.verified = false }
        } else if (payload.operation === 'select') {
          const q = current.quotes!.find((q) => q.id === payload.quoteId)!
          if (current.pricingMethod !== 'quotes') setDirect(current)
          next = { ...next, pricingMethod: 'quotes', category: 'subcontractor', quantity: 1, unit: 'uppdrag', selectedQuoteId: q.id, unitCost: q.amount, verified: true }
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
        const previous = item.costLines.find((line) => line.id === payload.costLineId)
        const line = { ...previous, ...normalizeCostLine(payload), id: String(payload.costLineId ?? crypto.randomUUID()), sourceCheckedAt: null, vatRate: 25, sortOrder: previous?.sortOrder ?? 300,
          ...(payload.workPartId !== undefined ? { workPartId: payload.workPartId as string | null } : {}), updatedAt: new Date().toISOString() }
        update({ costLines: name === 'update_cost_line' ? item.costLines.map((current) => current.id === line.id ? line : current) : [...item.costLines, line] })
      }
      setBusy(false); toast.success('Kalkylen uppdaterades.'); return true
    }} /> : null}
  </main>
}
createRoot(document.getElementById('root')!).render(<AppToastProvider>{new URLSearchParams(location.search).has('requests') ? <RequestApp /> : <App />}</AppToastProvider>)
