import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import ProjectSupplierInvoices from '../../src/components/tasks/ProjectSupplierInvoices'
import ProjectBillingFlow from '../../src/components/tasks/ProjectBillingFlow'
import { applyBillingCommand, emptyBillingFlow, type BillingWorkspace } from '../../src/lib/action-cases/billingFlow'
import type { ProjectInvoiceWorkspace, SupplierInvoice } from '../../src/lib/supplier-invoices/contracts'
import type { ProjectCompletionWorkspace } from '../../src/lib/action-cases/projectCompletion'
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const caseId = id(1), userId = id(2), initial: ProjectInvoiceWorkspace = { userId, status: 'in_progress', targets: [
  { id: id(10), kind: 'item', title: 'Grundarbete', mode: 'budget', markupPercent: 15 },
  { id: id(11), kind: 'item', title: 'Byggarbete fast pris', mode: 'fixed', markupPercent: null },
  { id: id(12), kind: 'change', title: 'Extra vägg', mode: 'running', markupPercent: 10 },
  { id: id(13), kind: 'item', title: 'Delat arbete och material', mode: 'unknown', markupPercent: null, parts: [{ key: 'labour', mode: 'fixed', markupPercent: null }, { key: 'material', mode: 'running', markupPercent: 15 }] },
], invoices: [], links: [] }
const adminInitial: ProjectCompletionWorkspace = { available: true, userId, canManage: true, status: 'in_progress', revision: 0, workComplete: false, invoiced: false, completedAt: null, openQuestions: 0, bases: [], events: [], defaults: { issuer: 'Fiktivt Testbygg AB', recipient: 'Fiktiv testkund' } }
const data = JSON.parse(localStorage.getItem('psi-fixture') || 'null') || initial
const admin = JSON.parse(localStorage.getItem('psi-fixture-admin') || 'null') || adminInitial
const protectedProject = { contract: { locked: true, version: 1, amountOre: 2500000, scope: 'Fiktivt grundarbete' }, calculation: { rows: [{ id: id(90), quantity: 10, unitCost: 1200, markupPercent: 15 }] } }
const candidates: BillingWorkspace['candidates'] = [
  { key: `base:${id(10)}:combined`, title: 'Grundarbete', group: 'base', mode: 'budget', fixedGrossOre: null, budgetGrossOre: 1562500, markupPercent: 15, hourlyGrossOre: null, reference: 'Låst testavtal version 1', conditions: 'Avstämning vid 80 procent', fingerprint: 'budget-v1' },
  { key: `base:${id(11)}:combined`, title: 'Byggarbete fast pris', group: 'base', mode: 'fixed', fixedGrossOre: 2500000, budgetGrossOre: null, markupPercent: null, hourlyGrossOre: null, reference: 'Låst testavtal version 1', conditions: 'Efter utfört arbete', fingerprint: 'fixed-v1' },
  { key: `change:${id(12)}:running`, title: 'Extra vägg', group: 'change', mode: 'running', fixedGrossOre: null, budgetGrossOre: null, markupPercent: 10, hourlyGrossOre: null, reference: 'ÄTA F-001', conditions: 'Kundens beställning krävs', fingerprint: 'change-v1' },
]
const billing: BillingWorkspace = JSON.parse(localStorage.getItem('psi-fixture-billing') || 'null') || { available: true, userId, title: 'Fiktivt testprojekt', revision: 0, contextHash: '0123456789abcdef0123456789abcdef', canManage: true, cancelled: false, issuer: adminInitial.defaults.issuer, recipient: adminInitial.defaults.recipient, legacyCount: 0, openQuestions: 0, baseFixedGrossOre: 2500000, candidates, suppliers: [], flow: emptyBillingFlow(), history: [] }
function billingContext() {
  billing.suppliers = data.invoices.filter((i: SupplierInvoice) => i.approvalStatus !== 'void').flatMap((i: SupplierInvoice) => i.allocations.filter(a => a.caseId === caseId).map(a => ({ key: `${i.id}:${a.id}`, invoiceId: i.id, allocationId: a.id!, revision: i.revision, targetKey: a.changeId ? `change:${a.changeId}` : a.itemId ? `base:${a.itemId}` : 'base:common', title: `${i.supplierName} / ${i.invoiceNumber}`, date: i.invoiceDate, netOre: a.amountOre * (i.documentKind === 'credit' ? -1 : 1), reviewed: i.approvalStatus === 'approved', original: i.attachments.length > 0, legacy: data.links.some((l: { allocationId: string }) => l.allocationId === a.id) })))
  return billing
}
let fail = '', delay = 0
const calls: { path: string; body: unknown }[] = [], acknowledgements = new Map<string, unknown>()
const nativeFetch = window.fetch.bind(window)
const persist = () => { localStorage.setItem('psi-fixture', JSON.stringify(data)); localStorage.setItem('psi-fixture-admin', JSON.stringify(admin)); localStorage.setItem('psi-fixture-billing', JSON.stringify(billing)) }
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })
window.fetch = async (url, options) => {
  const path = String(url)
  if (new URL(path, location.href).origin === location.origin && new URL(path, location.href).pathname.startsWith('/vendor/pdfjs/')) return nativeFetch(url, options)
  if (!path.startsWith('/api/')) throw Error('Only synthetic APIs are permitted')
  if (path.includes('/attachments/') && options?.method !== 'POST') {
    if (fail === 'preview') { fail = ''; return response({ error: 'Syntetiskt visningsfel' }, 502) }
    const file = data.invoices.flatMap((i: SupplierInvoice) => i.attachments).find((a: { id: string }) => path.includes(a.id))
    return nativeFetch(file?.contentType === 'application/pdf' ? '/original.pdf' : '/original.png')
  }
  if (path.includes('/invoice-basis/') && path.includes('/pdf')) {
    const record = admin.bases.find((b: { id: string }) => path.includes(b.id))
    return nativeFetch('/preview-invoice-basis-pdf', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(record) })
  }
  if (path.includes('/billing-flow/') && path.endsWith('/pdf')) {
    const b = billing.flow.bases.find(b => path.includes(b.id))
    if (!b || b.status !== 'exported') return response({ error: 'Underlag saknas' }, 404)
    return nativeFetch('/preview-invoice-basis-pdf', { method: 'POST', body: JSON.stringify({ id: b.id, revision: b.version, updatedAt: b.exportedAt, projectTitle: b.projectTitle, frozen: true, body: { version: 1, title: b.title, date: b.date, period: '', issuer: b.issuer, recipient: b.recipient, note: b.note, lines: b.lines.map(l => ({ id: l.id, description: l.description, quantity: 1, unit: 'post', unitPriceOre: l.netOre, vatRate: l.vatRate })) } }) })
  }
  if (path.endsWith('/billing-flow') && options?.method !== 'POST') return response(billingContext())
  if (options?.method !== 'POST') {
    data.billingFlowActive = billing.revision > 0
    data.billingClaims = billing.flow.costs.filter(c => c.supplier).map(c => ({ invoiceId: c.supplier!.invoiceId, allocationId: c.supplier!.allocationId, protected: c.reviewed || billing.flow.entries.some(e => e.costId === c.id) }))
    return response(path.endsWith('/administration') ? admin : data)
  }
  if (delay) await new Promise(r => setTimeout(r, delay))
  if (path.endsWith('/attachments')) {
    calls.push({ path, body: 'file' }); if (fail === 'upload') { fail = ''; return response({ error: 'Syntetiskt uppladdningsfel' }, 502) }
    const invoice = data.invoices.find((i: SupplierInvoice) => path.includes(i.id)), form = options.body as FormData, file = form.get('file') as File
    invoice.attachments.push({ id: crypto.randomUUID(), fileName: file.name, fileSizeBytes: file.size, contentType: file.name.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'image/png', createdAt: new Date().toISOString() }); persist(); return response(data)
  }
  const request = JSON.parse(String(options.body)); calls.push({ path, body: request })
  if (fail === 'save') { fail = ''; return response({ error: 'Syntetiskt sparfel. Dina uppgifter finns kvar.' }, 500) }
  if (path.endsWith('/billing-flow')) {
    if (acknowledgements.has(request.requestId)) return response(acknowledgements.get(request.requestId))
    if (request.revision !== billing.revision) return response({ error: 'Nyare faktureringsversion finns' }, 409)
    try {
      billing.flow = applyBillingCommand(billing.flow, request.command, billingContext(), new Date().toISOString())
      billing.revision++; billing.history.unshift({ id: request.requestId, operation: request.command.operation, actor: 'Testansvarig', at: new Date().toISOString() })
      const result = { revision: billing.revision }; acknowledgements.set(request.requestId, result); persist(); return response(result)
    } catch (e) { return response({ error: (e as Error).message }, 409) }
  }
  if (path === '/api/supplier-invoices') {
    const old = data.invoices.find((i: SupplierInvoice) => i.id === request.id)
    if (old?.revision === request.expectedRevision + 1 && JSON.stringify(request.invoice) === JSON.stringify(Object.fromEntries(Object.entries(old).filter(([k]) => !['id', 'revision', 'attachments', 'source', 'externalId', 'createdAt', 'updatedAt'].includes(k))))) return response({ ...data, saved: { id: old.id, revision: old.revision } })
    if ((old?.revision ?? 0) !== request.expectedRevision) return response({ error: 'Fakturan har ändrats i en annan flik.' }, 409)
    const invoice = { ...request.invoice, id: request.id, revision: request.expectedRevision + 1, source: 'manual', externalId: null, attachments: old?.attachments ?? [], createdAt: old?.createdAt ?? new Date().toISOString(), updatedAt: new Date().toISOString() }
    data.invoices = [invoice, ...data.invoices.filter((i: SupplierInvoice) => i.id !== request.id)]; persist()
    return response({ ...data, saved: { id: invoice.id, revision: invoice.revision } })
  }
  if (acknowledgements.has(request.requestId)) return response(acknowledgements.get(request.requestId))
  if (path.endsWith('/supplier-invoices')) {
    const lines = request.sources.map((s: { invoiceId: string; allocationId: string; markupPercent: number; lineId: string; description: string; vatRate: number; agreement: string }) => {
      const invoice = data.invoices.find((i: SupplierInvoice) => i.id === s.invoiceId), allocation = invoice.allocations.find((a: { id: string }) => a.id === s.allocationId)
      const net = Math.round(allocation.amountOre * (1 + s.markupPercent / 100))
      data.links.push({ invoiceId: s.invoiceId, allocationId: s.allocationId, basisId: request.id, lineId: s.lineId, customerNetOre: net, agreement: s.agreement })
      return { id: s.lineId, description: s.description, quantity: 1, unit: 'st', unitPriceOre: net, vatRate: s.vatRate }
    })
    admin.bases.unshift({ id: request.id, revision: 1, body: { ...request.body, lines }, updatedAt: new Date().toISOString(), sourceLineIds: lines.map((l: { id: string }) => l.id) })
  } else if (path.endsWith('/administration')) {
    const old = admin.bases.find((b: { id: string }) => b.id === request.id)
    if ((old?.revision ?? 0) !== request.revision) return response({ error: 'Underlaget har ändrats.' }, 409)
    admin.bases = [{ id: request.id, revision: request.revision + 1, body: request.body, updatedAt: new Date().toISOString(), sourceLineIds: old?.sourceLineIds ?? [] }, ...admin.bases.filter((b: { id: string }) => b.id !== request.id)]
  }
  const result = { id: request.id, revision: (request.revision ?? 0) + 1 }; acknowledgements.set(request.requestId, result); persist(); return response(result)
}
Object.assign(window, { fixture: { calls, failNext: (kind = 'save') => { fail = kind }, delay: (ms: number) => { delay = ms }, data: () => data, billing: billingContext, admin: () => admin, legacyIds: () => { for (const a of data.invoices[0].allocations) delete a.id; persist() }, advanceRevision: () => { data.invoices[0].revision++; data.invoices[0].notes = 'Nyare sparad text'; persist() }, protected: () => protectedProject } })
function App() {
  const [view, setView] = useState('supplier'), [dirty, setDirty] = useState(false), [basisDirty, setBasisDirty] = useState(false), [version, setVersion] = useState(0), [supplierId, setSupplierId] = useState<string>()
  return <main className="gizmo-workspace" style={{ maxWidth: 1280, margin: 'auto', padding: 20 }}><h1>Testprojekt · leverantörsfakturor</h1><div role="tablist" className="gizmo-register-tabs gizmo-payment-tabs">{['basis', 'supplier'].map(key => <button className="gizmo-register-tab" key={key} role="tab" aria-selected={view === key} onClick={() => setView(key)}>{key === 'basis' ? 'Fakturering' : 'Leverantörsfakturor'}</button>)}</div><span data-testid="dirty">{dirty || basisDirty ? 'dirty' : 'clean'}</span><div hidden={view !== 'supplier'}><ProjectSupplierInvoices caseId={caseId} items={[{ id: id(10), estimatedCost: 12000 }]} active={view === 'supplier'} onDirty={setDirty} basisBlocked={basisDirty} onBasis={invoiceId => { setSupplierId(invoiceId); setVersion(v => v + 1); setDirty(false); setView('basis') }} /></div><div hidden={view !== 'basis'}><ProjectBillingFlow key={version} caseId={caseId} supplierInvoiceId={supplierId} active={view === 'basis'} onDirty={setBasisDirty} /></div></main>
}
createRoot(document.getElementById('root')!).render(<div className="uppdrag-scope"><App /></div>)
