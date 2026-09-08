import React, { useState } from 'react'
import ActionCaseRequestSheet, { ActionCaseRequestsPanel } from '@/components/tasks/ActionCaseQuoteRequests'
import ActionCaseImageBank from '@/components/tasks/ActionCaseImageBank'
import { useToast } from '@/components/ui/AppToastProvider'
import { normalizeQuoteRequest } from '@/lib/action-cases/quoteRequests'
import type { ActionCaseView, ActionCaseQuoteRequest } from '@/lib/action-cases/contracts'

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const initial: ActionCaseView = {
  id: id(1), title: 'Mindre arbeten efter besiktning', propertyAddress: 'Exempelgatan 12', participants: [], quoteRequests: [],
  attachments: [
    { id: id(31), fileName: 'entre.png', title: 'Entrén', type: 'image' },
    { id: id(32), fileName: 'fonster.png', title: 'Fönsterbleck på gårdssidan', type: 'image' },
    { id: id(33), fileName: 'saknad-bild.png', title: null, type: 'image' },
    { id: id(34), fileName: 'arbetsbeskrivning.pdf', title: 'Arbetsbeskrivning', type: 'document' },
  ].map((f) => ({ ...f, type: f.type as 'image' | 'document', actionCaseItemId: null, contentType: f.type === 'image' ? 'image/png' : 'application/pdf', fileSizeBytes: 100, grantedParticipantIds: [], createdAt: 'v1' })),
  customerName: 'Testkund', customerEmail: null, customerPhone: null, sourceKind: 'manual', sourceReference: null, description: null, status: 'pricing', siteVisitAt: null, createdAt: 'v1', updatedAt: 'v1',
  items: [1, 2].map((n) => ({
    id: id(n + 10), title: n === 1 ? 'Träpanel vid entrén' : 'Fönsterbleck på gårdssidan', scope: n === 1 ? 'Byt skadade brädor.' : 'Justera anslutningen vid blecket.', status: 'pricing_needed',
    sortOrder: n, ownLaborReady: false, materialPriceReady: false, subcontractorPriceReady: false, wasteSolutionReady: false, requiresSubcontractor: false, estimatedCost: null, customerPrice: null, updatedAt: 'v1', costSuggestion: null,
    costLines: [{ id: id(n + 20), category: 'own_labor', description: n === 1 ? 'Demontera och montera panel' : 'Justera och täta fönsterbleck', quantity: 4, unit: 'tim', unitCost: 500, markupPercent: 20, vatRate: 25, priceSource: 'manual', sourceUrl: null, sourceCheckedAt: null, verified: false, sortOrder: 100, quantityBasis: 'estimated', notes: null }],
  })),
}

export default function RequestApp() {
  const [actionCase, setCase] = useState(initial)
  const [editor, setEditor] = useState<{ requestId: string | null; supplementId?: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [actions, setActions] = useState<string[]>([])
  const toast = useToast()
  return <main className="mx-auto max-w-5xl p-4"><h1 className="mb-5 text-xl font-semibold">{actionCase.title}</h1>
    <output hidden data-testid="actions">{JSON.stringify(actions)}</output>
    <output hidden data-testid="requests">{JSON.stringify(actionCase.quoteRequests)}</output>
    <ActionCaseRequestsPanel actionCase={actionCase} busy={busy} onOpen={(requestId) => setEditor({ requestId })} />
    {new URLSearchParams(location.search).has('bank') ? <ActionCaseImageBank actionCase={actionCase} busy={busy} onAccess={() => undefined} onDelete={() => undefined} /> : null}
    {editor ? <ActionCaseRequestSheet key={`${editor.requestId}:${editor.supplementId}`} {...editor} actionCase={actionCase} busy={busy} onClose={() => setEditor(null)} onSupplement={(r) => setEditor({ requestId: null, supplementId: r.id })} onOpenWork={() => { toast.success('Kalkyl öppnad.'); setEditor(null) }} onAction={async (action, data) => {
      setBusy(true); setActions((a) => [...a, `${action}:${data.operation ?? ''}`])
      await new Promise((resolve) => setTimeout(resolve, 350))
      if (new URLSearchParams(location.search).has('fail')) { setBusy(false); toast.error('Förfrågan kunde inte sparas. Försök igen.'); return false }
      if (action === 'quote_request' && data.operation === 'save') {
        const normalized = normalizeQuoteRequest(data)
        const row: ActionCaseQuoteRequest = { ...normalized, responseMode: 'pending', responseNotes: '', responseDocumentId: null, packageAmount: null, firstAttemptAt: null, deliveryStatus: 'draft', sentAt: null, updatedAt: crypto.randomUUID() }
        setCase((c) => ({ ...c, quoteRequests: [...c.quoteRequests!.filter((r) => r.id !== row.id), row] }))
      } else if (data.operation === 'delete') setCase((c) => ({ ...c, quoteRequests: c.quoteRequests!.filter((r) => r.id !== data.requestId) }))
      else setCase((c) => ({ ...c, quoteRequests: c.quoteRequests!.map((r) => r.id !== data.requestId ? r : {
        ...r, ...(data.operation === 'response' ? { responseMode: data.responseMode as ActionCaseQuoteRequest['responseMode'], packageAmount: data.packageAmount === '' ? null : Number(data.packageAmount), responseNotes: String(data.responseNotes) } : { sentAt: new Date().toISOString(), firstAttemptAt: new Date().toISOString(), deliveryStatus: 'sent' as const }), updatedAt: crypto.randomUUID(),
      }) }))
      setBusy(false); toast.success('Förfrågan uppdaterades.'); return true
    }} /> : null}
  </main>
}
