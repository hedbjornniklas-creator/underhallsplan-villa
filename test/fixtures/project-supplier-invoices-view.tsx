import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import ProjectSupplierInvoices from '../../src/components/tasks/ProjectSupplierInvoices'
import ProjectInvoiceBasis from '../../src/components/tasks/ProjectInvoiceBasis'
import type { ProjectInvoiceWorkspace, SupplierInvoice } from '../../src/lib/supplier-invoices/contracts'
import type { ProjectCompletionWorkspace } from '../../src/lib/action-cases/projectCompletion'
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const caseId = id(1), userId = id(2), initial: ProjectInvoiceWorkspace = { userId, status: 'in_progress', targets: [
  { id: id(10), kind: 'item', title: 'Grundarbete', mode: 'running', markupPercent: 15 },
  { id: id(11), kind: 'item', title: 'Byggarbete fast pris', mode: 'fixed', markupPercent: null },
  { id: id(12), kind: 'change', title: 'Extra vägg', mode: 'running', markupPercent: 10 },
  { id: id(13), kind: 'item', title: 'Delat arbete och material', mode: 'unknown', markupPercent: null, parts: [{ key: 'labour', mode: 'fixed', markupPercent: null }, { key: 'material', mode: 'running', markupPercent: 15 }] },
], invoices: [], links: [] }
const adminInitial: ProjectCompletionWorkspace = { available: true, userId, canManage: true, status: 'in_progress', revision: 0, workComplete: false, invoiced: false, completedAt: null, openQuestions: 0, bases: [], events: [], defaults: { issuer: 'Fiktivt Testbygg AB', recipient: 'Fiktiv testkund' } }
let data = JSON.parse(localStorage.getItem('psi-fixture') || 'null') || initial
let admin = JSON.parse(localStorage.getItem('psi-fixture-admin') || 'null') || adminInitial
let fail = '', delay = 0
const calls: { path: string; body: unknown }[] = [], acknowledgements = new Map<string, unknown>()
const nativeFetch = window.fetch.bind(window)
const persist = () => { localStorage.setItem('psi-fixture', JSON.stringify(data)); localStorage.setItem('psi-fixture-admin', JSON.stringify(admin)) }
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })
window.fetch = async (url, options) => {
  const path = String(url)
  if (!path.startsWith('/api/')) throw Error('Only synthetic APIs are permitted')
  if (path.includes('/invoice-basis/') && path.includes('/pdf')) {
    const record = admin.bases.find((b: { id: string }) => path.includes(b.id))
    return nativeFetch('/preview-invoice-basis-pdf', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(record) })
  }
  if (options?.method !== 'POST') return response(path.endsWith('/administration') ? admin : data)
  if (delay) await new Promise(r => setTimeout(r, delay))
  if (path.endsWith('/attachments')) {
    calls.push({ path, body: 'file' }); if (fail === 'upload') { fail = ''; return response({ error: 'Syntetiskt uppladdningsfel' }, 502) }
    const invoice = data.invoices.find((i: SupplierInvoice) => path.includes(i.id)), form = options.body as FormData, file = form.get('file') as File
    invoice.attachments.push({ id: crypto.randomUUID(), fileName: file.name, fileSizeBytes: file.size, contentType: 'image/png', createdAt: new Date().toISOString() }); persist(); return response(data)
  }
  const request = JSON.parse(String(options.body)); calls.push({ path, body: request })
  if (fail === 'save') { fail = ''; return response({ error: 'Syntetiskt sparfel. Dina uppgifter finns kvar.' }, 500) }
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
Object.assign(window, { fixture: { calls, failNext: (kind = 'save') => { fail = kind }, delay: (ms: number) => { delay = ms }, data: () => data, admin: () => admin, advanceRevision: () => { data.invoices[0].revision++; data.invoices[0].notes = 'Nyare sparad text'; persist() }, protected: () => ({ contract: 'unchanged', calculation: 'unchanged' }) } })
function App() {
  const [view, setView] = useState('supplier'), [dirty, setDirty] = useState(false), [basisDirty, setBasisDirty] = useState(false), [version, setVersion] = useState(0)
  return <main className="gizmo-workspace" style={{ maxWidth: 1280, margin: 'auto', padding: 20 }}><h1>Testprojekt · leverantörsfakturor</h1><div role="tablist" className="gizmo-register-tabs gizmo-payment-tabs">{['basis', 'supplier'].map(key => <button className="gizmo-register-tab" key={key} role="tab" aria-selected={view === key} onClick={() => setView(key)}>{key === 'basis' ? 'Fakturaunderlag' : 'Leverantörsfakturor'}</button>)}</div><span data-testid="dirty">{dirty || basisDirty ? 'dirty' : 'clean'}</span><div hidden={view !== 'supplier'}><ProjectSupplierInvoices caseId={caseId} active={view === 'supplier'} onDirty={setDirty} basisBlocked={basisDirty} onBasis={() => { setVersion(v => v + 1); setDirty(false); setView('basis') }} /></div><div hidden={view !== 'basis'}><ProjectInvoiceBasis key={version} caseId={caseId} active={view === 'basis'} onDirty={setBasisDirty} /></div></main>
}
createRoot(document.getElementById('root')!).render(<div className="uppdrag-scope"><App /></div>)
