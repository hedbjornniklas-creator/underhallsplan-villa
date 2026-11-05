import { createRoot } from 'react-dom/client'
import { AppToastProvider } from '@/components/ui/AppToastProvider'
import SupplierInvoiceWorkspace from '@/components/tasks/SupplierInvoiceWorkspace'
import type { SupplierInvoice } from '@/lib/supplier-invoices/contracts'
import type { ActionCaseView } from '@/lib/action-cases/contracts'
import { normalizeSupplierInvoiceDraft } from '@/lib/supplier-invoices/domain'

// Synthetic local UI fixture. Every request is intercepted in memory; no service or account is used.
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const item = (n: number, title: string, estimatedCost: number) => ({ id: id(n), title, estimatedCost, scope: 'Syntetiskt testarbete', status: 'in_progress', sortOrder: n, ownLaborReady: true, materialPriceReady: true, subcontractorPriceReady: true, wasteSolutionReady: true, requiresSubcontractor: false, customerPrice: estimatedCost * 1.2, costLines: [], updatedAt: '2026-11-01T12:00:00Z', costSuggestion: null })
const baseCase = { customerName: 'Testkund', customerEmail: null, customerPhone: null, propertyAddress: 'Exempelvägen 1', sourceKind: 'manual', sourceReference: null, description: 'Syntetiskt projekt', status: 'in_progress', siteVisitAt: null, createdAt: '2026-11-01T12:00:00Z', updatedAt: '2026-11-01T12:00:00Z', participants: [], attachments: [] }
const cases = [
  { ...baseCase, id: id(1), title: 'Renovering · Exempelvillan', items: [item(2, 'Kök och snickerier', 10000), item(3, 'Elinstallation', 5000)] },
  { ...baseCase, id: id(4), title: 'Garage · Testprojekt', items: [item(5, 'Tak', 4000)] },
] as ActionCaseView[]
const base = { supplierName: 'Exempelmaterial AB', supplierOrgNumber: '556123-4567', invoiceNumber: 'F-100', invoiceDate: '2026-11-01', dueDate: '2026-11-02', documentKind: 'invoice', creditReferenceInvoiceId: null, currency: 'SEK', netAmountOre: 100000, vatAmountOre: 25000, approvalStatus: 'registered', paymentStatus: 'unpaid', paidOn: null, notes: '', sourceText: '', allocations: [{ caseId: id(1), itemId: id(2), category: 'material', description: 'Skivmaterial', amountOre: 60000 }, { caseId: id(4), itemId: null, category: 'material', description: 'Virke', amountOre: 20000 }], revision: 1, source: 'manual', externalId: null, createdAt: '2026-11-01T12:00:00Z', updatedAt: '2026-11-01T12:00:00Z', attachments: [] }
const state = new URLSearchParams(location.search).get('state')
let invoices = (state === 'empty' ? [] : [
  { ...base, id: id(10) },
  { ...base, id: id(11), invoiceNumber: 'K-101', documentKind: 'credit', creditReferenceInvoiceId: id(10), netAmountOre: 10000, vatAmountOre: 2500, allocations: [{ caseId: id(1), itemId: id(2), category: 'material', description: 'Retur', amountOre: 10000 }] },
  { ...base, id: id(12), invoiceNumber: 'F-102', supplierName: 'Exempel UE AB', netAmountOre: 200000, vatAmountOre: 50000, approvalStatus: 'approved', paymentStatus: 'paid', paidOn: '2026-11-03', allocations: [{ caseId: id(1), itemId: id(3), category: 'subcontractor', description: '', amountOre: 200000 }] },
  { ...base, id: id(13), invoiceNumber: 'F-VOID', approvalStatus: 'void' },
]) as SupplierInvoice[]
if (state === 'many') invoices = Array.from({ length: 250 }, (_, index) => ({
  ...base, id: id(1000 + index), invoiceNumber: `SERIE-${String(index + 1).padStart(4, '0')}`,
  supplierName: index % 3 === 0 ? 'Exempelleverantör med ett långt företagsnamn AB' : `Leverantör ${index + 1} AB`,
  approvalStatus: index % 9 === 0 ? 'disputed' : index % 2 === 0 ? 'approved' : 'registered',
  documentKind: index % 7 === 0 ? 'credit' : 'invoice',
  paymentStatus: index % 4 === 0 ? 'paid' : 'unpaid', paidOn: index % 4 === 0 ? '2026-11-03' : null,
})) as SupplierInvoice[]

const fixture = { requests: [] as string[], saves: [] as unknown[], attempts: [] as unknown[], concurrentAfterSave: false, failSave: false, failUpload: false, failLoad: state === 'error', delay: 0, uploaded: 0 }
Object.assign(window, { __invoiceTest: fixture })
window.fetch = async (input, init) => {
  const path = new URL(String(input), location.href).pathname, method = init?.method ?? 'GET'
  fixture.requests.push(`${method} ${path}`)
  await new Promise((resolve) => setTimeout(resolve, fixture.delay))
  if (path === '/api/action-cases' && method === 'GET') return Response.json({ workspace: { cases } })
  if (path === '/api/supplier-invoices' && method === 'GET') return fixture.failLoad ? Response.json({ error: 'Fakturor kunde inte hämtas · syntetiskt testfel' }, { status: 503 }) : Response.json({ invoices })
  if (path === '/api/supplier-invoices' && method === 'POST') {
    if (fixture.failSave) return Response.json({ error: 'En faktura med samma leverantör och fakturanummer finns redan.' }, { status: 409 })
    const payload = JSON.parse(String(init?.body)), body = normalizeSupplierInvoiceDraft(payload.invoice)
    fixture.attempts.push(payload)
    const existing = invoices.find((invoice) => invoice.id === payload.id)
    if (existing && existing.revision !== payload.expectedRevision) return Response.json({ error: 'Fakturan har ändrats sedan du öppnade den.' }, { status: 409 })
    fixture.saves.push(payload)
    const saved = { ...body, id: payload.id, revision: (existing?.revision ?? 0) + 1, source: 'manual' as const, externalId: null, createdAt: existing?.createdAt ?? new Date().toISOString(), updatedAt: new Date().toISOString(), attachments: existing?.attachments ?? [] }
    invoices = [...invoices.filter((invoice) => invoice.id !== payload.id), saved]
    if (fixture.concurrentAfterSave) {
      fixture.concurrentAfterSave = false
      invoices = invoices.map((invoice) => invoice.id === saved.id ? { ...invoice, revision: invoice.revision + 1, notes: 'En annan användares ändring' } : invoice)
    }
    return Response.json({ invoices, saved: { id: saved.id, revision: saved.revision } })
  }
  if (/^\/api\/supplier-invoices\/[\w-]+\/attachments$/.test(path) && method === 'POST') {
    if (fixture.failUpload) return Response.json({ error: 'Bilagan kunde inte laddas upp · syntetiskt testfel' }, { status: 502 })
    fixture.uploaded++
    const file = (init?.body as FormData).get('file') as File
    invoices = invoices.map((invoice) => invoice.id === path.split('/')[3] ? { ...invoice, attachments: [...invoice.attachments, { id: id(100 + fixture.uploaded), fileName: file.name, contentType: file.type, fileSizeBytes: file.size, createdAt: new Date().toISOString() }] } : invoice)
    return Response.json({ invoices })
  }
  throw Error(`Blocked synthetic preview request: ${method} ${path}`)
}

createRoot(document.getElementById('root')!).render(<AppToastProvider><div className="uppdrag-scope uppdrag-page"><main className="mx-auto max-w-7xl px-4 py-5 sm:px-7"><p className="text-xs text-slate-500">HusHub · Lokal förhandsvisning med syntetiska fakturor</p><SupplierInvoiceWorkspace cases={cases} caseId={state === 'project' ? id(1) : undefined} /></main></div></AppToastProvider>)
