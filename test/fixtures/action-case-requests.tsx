import React, { useRef, useState } from 'react'
import ActionCaseRequestSheet, { ActionCaseRequestsPanel } from '@/components/tasks/ActionCaseQuoteRequests'
import ActionCaseImageBank from '@/components/tasks/ActionCaseImageBank'
import { useToast } from '@/components/ui/AppToastProvider'
import { groupRequestLines, normalizeQuoteRequest, requestSources } from '@/lib/action-cases/quoteRequests'
import { normalizeQuotePackageAction } from '@/lib/action-cases/quotePackages'
import { normalizeQuote } from '@/lib/action-cases/quotes'
import type { ActionCaseCostLineView, ActionCaseView, ActionCaseQuote, ActionCaseQuoteRequest } from '@/lib/action-cases/contracts'

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const version = '2026-09-09T08:00:00.000Z'
export const requestFixture: ActionCaseView = {
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
    sortOrder: n, ownLaborReady: false, materialPriceReady: false, subcontractorPriceReady: false, wasteSolutionReady: false, requiresSubcontractor: false, estimatedCost: null, customerPrice: null, updatedAt: version, costSuggestion: null,
    costLines: [{ id: id(n + 20), category: 'own_labor', description: n === 1 ? 'Demontera och montera panel' : 'Justera och täta fönsterbleck', quantity: 4, unit: 'tim', unitCost: 500, markupPercent: 20, vatRate: 25, priceSource: 'manual', sourceUrl: null, sourceCheckedAt: null, verified: false, sortOrder: 100, quantityBasis: 'estimated', notes: null, updatedAt: version }],
  })),
}

export function savedPackageFixture(expired: boolean): ActionCaseView {
  const groupKey = `${id(11)}:${id(41)}`
  const item = { ...requestFixture.items[0], workParts: [{ id: id(41), title: 'Panel och målning', scope: 'Montera panel och måla två gånger.', sortOrder: 100, updatedAt: version }],
    costLines: [
      { ...requestFixture.items[0].costLines[0], workPartId: id(41), verified: true },
      { ...requestFixture.items[0].costLines[0], id: id(23), description: 'Måla den nya panelen', workPartId: id(41), verified: true },
    ],
  }
  const actionCase = { ...requestFixture, items: [item] }
  const normalized = normalizeQuoteRequest({ requestId: id(61), supplierName: 'Syntetiska Grupppriser AB', supplierEmail: 'terms@example.test',
    subject: 'Sparad offert med prisvillkor', message: 'Syntetiskt offertunderlag.', lines: requestSources(actionCase), pricePresentation: 'grouped', requirementKeys: [], attachmentIds: [],
  })
  const request: ActionCaseQuoteRequest = { ...normalized, responseMode: 'package', responseNotes: '', responseDocumentId: null, packageAmount: 4200,
    deliveryStatus: 'sent', firstAttemptAt: version, sentAt: version, updatedAt: version,
  }
  const quote: ActionCaseQuote = { ...normalizeQuote({ quoteId: id(71), supplierName: request.supplierName, supplierEmail: request.supplierEmail,
    amount: 4200, offeredScope: 'Leverantörens sparade omfattning: panelbyte och två strykningar.', exclusions: 'Ställning och dolda rötskador ingår inte.',
    validUntil: expired ? '2000-01-01' : '2099-12-31', checked: true, coveredLineIds: [id(23)],
  }), requestId: request.id, packageGroupKey: groupKey, separatePricesConfirmed: true,
    scopeSnapshot: item.scope ?? '', descriptionSnapshot: item.costLines[0].description, deliveryStatus: 'sent', sentAt: version, updatedAt: version,
  }
  return { ...actionCase, quoteRequests: [request], quotePackages: [{ requestId: request.id, groupKey, quoteId: quote.id, anchorLineId: id(21),
    itemId: item.id, workPartId: id(41), amount: 4200, coveredLineIds: [id(23)], state: 'active', updatedAt: version,
  }], items: [{ ...item, status: expired ? 'waiting_subcontractor' : 'ready_for_quote', subcontractorPriceReady: !expired,
    estimatedCost: expired ? null : 4200, customerPrice: expired ? null : 5040,
    costLines: item.costLines.map((line) => line.id === id(21)
      ? { ...line, category: 'subcontractor', pricingMethod: 'quotes', quantity: 1, unit: 'uppdrag', unitCost: expired ? null : 4200, verified: !expired, selectedQuoteId: quote.id, quotes: [quote] }
      : { ...line, coveredByQuoteId: quote.id }),
  }] }
}

export default function RequestApp({ initialCase, initialRequestId, preselectedLineIds, onClose }: {
  initialCase?: ActionCaseView; initialRequestId?: string; preselectedLineIds?: string[]; onClose?: () => void
} = {}) {
  const [actionCase, setCase] = useState<ActionCaseView>(() => {
    const params = new URLSearchParams(location.search)
    const initial = initialCase ?? (params.has('savedPackage') ? savedPackageFixture(params.has('expired')) : requestFixture)
    return { ...initial, items: initial.items.map((item, n) => ({ ...item,
      ...(params.has('scope') && !initialCase ? { scopeAttachmentIds: [id(n === 0 ? 31 : 32), id(34)] } : {}),
      ...(params.has('parts') && !initialCase ? {
        workParts: [{ id: id(41 + n), title: n === 0 ? 'Panel och målning' : 'Bleckarbete', scope: n === 0 ? 'Montera panel och måla två gånger.' : 'Täta bleckets anslutningar.', sortOrder: 100, updatedAt: version }],
        costLines: [
          { ...item.costLines[0], workPartId: id(41 + n) },
          ...(n === 0 ? [
            { ...item.costLines[0], id: id(23), description: 'Måla den nya panelen', workPartId: id(41) },
            { ...item.costLines[0], id: id(24), description: 'Kontrollera anslutningar', workPartId: null },
          ] : []),
          ...(n === 0 && params.has('packages') ? [{ ...item.costLines[0], id: id(25), category: 'material' as const, description: 'Grundmålad panel', quantity: 4, unit: 'st', unitCost: 150, workPartId: id(41) }] : []),
        ],
      } : {}),
    })) }
  })
  const [editor, setEditor] = useState<{ requestId: string | null; supplementId?: string; preselectedLineIds?: string[] } | null>(
    initialRequestId || new URLSearchParams(location.search).has('savedPackage') ? { requestId: initialRequestId ?? id(61) }
      : preselectedLineIds ? { requestId: null, preselectedLineIds } : null,
  )
  const [busy, setBusy] = useState(false)
  const [actions, setActions] = useState<string[]>([])
  const [payloads, setPayloads] = useState<Array<{ action: string; data: Record<string, unknown> }>>([])
  const originalPackageLines = useRef(new Map<string, ActionCaseCostLineView[]>())
  const packageFailure = useRef(new URLSearchParams(location.search).has('packageFail'))
  const toast = useToast()
  return <main className="mx-auto max-w-5xl p-4"><h1 className="mb-5 text-xl font-semibold">{actionCase.title}</h1>
    <output hidden data-testid="actions">{JSON.stringify(actions)}</output>
    <output hidden data-testid="request-payloads">{JSON.stringify(payloads)}</output>
    <output hidden data-testid="requests">{JSON.stringify(actionCase.quoteRequests)}</output>
    <output hidden data-testid="request-case">{JSON.stringify(actionCase)}</output>
    <ActionCaseRequestsPanel actionCase={actionCase} busy={busy} onOpen={(requestId) => setEditor({ requestId })} />
    {new URLSearchParams(location.search).has('bank') ? <ActionCaseImageBank actionCase={actionCase} busy={busy} onAccess={() => undefined} onDelete={() => undefined} /> : null}
    {editor ? <ActionCaseRequestSheet key={`${editor.requestId}:${editor.supplementId}`} {...editor} actionCase={actionCase} busy={busy} onClose={() => { setEditor(null); onClose?.() }} onSupplement={(r) => setEditor({ requestId: null, supplementId: r.id })} onOpenWork={() => { toast.success('Kalkyl öppnad.'); setEditor(null) }} onAction={async (action, data) => {
      setBusy(true); setActions((a) => [...a, `${action}:${data.operation ?? ''}`])
      setPayloads((current) => [...current, { action, data }])
      await new Promise((resolve) => setTimeout(resolve, 350))
      if (new URLSearchParams(location.search).has('fail')) { setBusy(false); toast.error('Förfrågan kunde inte sparas. Försök igen.'); return false }
      if (action === 'quote_package') {
        const payload = normalizeQuotePackageAction(data)
        const request = actionCase.quoteRequests!.find((request) => request.id === payload.requestId)!
        const group = groupRequestLines(request.lines).find((group) => group.key === payload.groupKey)!
        const key = `${request.id}:${group.key}`
        if (payload.expectedUpdatedAt !== request.updatedAt) { setBusy(false); toast.error('Förfrågan har ändrats.'); return false }
        if (payload.operation === 'accept' && packageFailure.current) {
          packageFailure.current = false; setBusy(false); toast.error('Grupppriset kunde inte sparas. Försök igen.'); return false
        }
        const updatedAt = new Date().toISOString()
        if (payload.operation === 'accept') {
          const lineIds = [...group.lines.map((line) => line.costLineId), ...(payload.coveredLineIds ?? [])]
          const originals = actionCase.items.find((item) => item.id === group.itemId)!.costLines.filter((line) => lineIds.includes(line.id))
          if (payload.expectedLines.some((expected) => !originals.some((line) => line.id === expected.costLineId && line.updatedAt === expected.updatedAt))) throw new Error('Synthetic package line version mismatch')
          originalPackageLines.current.set(key, originals)
          const quoteId = crypto.randomUUID(), anchorLineId = group.lines[0].costLineId
          const quote: ActionCaseQuote = { ...normalizeQuote({ ...payload, quoteId, supplierName: request.supplierName, supplierEmail: request.supplierEmail,
            coveredLineIds: lineIds.filter((id) => id !== anchorLineId),
          }), requestId: request.id, packageGroupKey: group.key, separatePricesConfirmed: true,
            scopeSnapshot: actionCase.items.find((item) => item.id === group.itemId)!.scope ?? '', descriptionSnapshot: originals.find((line) => line.id === anchorLineId)!.description,
            deliveryStatus: 'sent', sentAt: request.sentAt, updatedAt,
          }
          setCase((current) => ({ ...current,
            quotePackages: [...(current.quotePackages ?? []).filter((price) => price.requestId !== request.id || price.groupKey !== group.key), {
              requestId: request.id, groupKey: group.key, quoteId, anchorLineId, itemId: group.itemId,
              workPartId: group.workPartId, amount: payload.amount, coveredLineIds: lineIds.filter((id) => id !== anchorLineId), state: 'active', updatedAt,
            }],
            items: current.items.map((item) => item.id !== group.itemId ? item : { ...item, updatedAt, costLines: item.costLines.map((line) =>
              line.id === anchorLineId ? { ...line, category: 'subcontractor', pricingMethod: 'quotes', quantity: 1, unit: 'uppdrag', unitCost: payload.amount, verified: true, selectedQuoteId: quoteId, quotes: [...(line.quotes ?? []), quote], updatedAt }
                : lineIds.includes(line.id) ? { ...line, coveredByQuoteId: quoteId, updatedAt } : line,
            ) }),
            quoteRequests: current.quoteRequests!.map((row) => row.id === request.id ? { ...row, updatedAt } : row),
          }))
        } else {
          const originals = originalPackageLines.current.get(key)
          if (!originals) throw new Error('Synthetic package restoration basis missing')
          setCase((current) => ({ ...current,
            quotePackages: current.quotePackages?.map((price) => price.requestId === request.id && price.groupKey === group.key ? { ...price, state: 'removed', updatedAt } : price),
            items: current.items.map((item) => item.id !== group.itemId ? item : { ...item, updatedAt, costLines: item.costLines.map((line) => originals.find((original) => original.id === line.id) ?? line) }),
            quoteRequests: current.quoteRequests!.map((row) => row.id === request.id ? { ...row, updatedAt } : row),
          }))
        }
      } else if (action === 'quote_request' && data.operation === 'save') {
        const normalized = normalizeQuoteRequest(data)
        const row: ActionCaseQuoteRequest = { ...normalized, responseMode: 'pending', responseNotes: '', responseDocumentId: null, packageAmount: null, firstAttemptAt: null, deliveryStatus: 'draft', sentAt: null, updatedAt: new Date().toISOString() }
        setCase((c) => ({ ...c, quoteRequests: [...c.quoteRequests!.filter((r) => r.id !== row.id), row] }))
      } else if (action === 'quote_request' && data.operation === 'delete') setCase((c) => ({ ...c, quoteRequests: c.quoteRequests!.filter((r) => r.id !== data.requestId) }))
      else if ((action === 'quote_request' && data.operation === 'response') || action === 'send_grouped_quote_request') setCase((c) => ({ ...c, quoteRequests: c.quoteRequests!.map((r) => r.id !== data.requestId ? r : {
        ...r, ...(data.operation === 'response' ? { responseMode: data.responseMode as ActionCaseQuoteRequest['responseMode'], packageAmount: data.packageAmount === '' ? null : Number(data.packageAmount), responseNotes: String(data.responseNotes), responseDocumentId: String(data.responseDocumentId || '') || null } : { sentAt: new Date().toISOString(), firstAttemptAt: new Date().toISOString(), deliveryStatus: 'sent' as const }), updatedAt: new Date().toISOString(),
      }) }))
      else throw new Error(`Unsupported synthetic request action: ${action}:${String(data.operation)}`)
      setBusy(false); toast.success('Förfrågan uppdaterades.'); return true
    }} /> : null}
  </main>
}
