import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import ProjectBillingFlow from '../../src/components/tasks/ProjectBillingFlow'
import { applyBillingCommand, emptyBillingFlow, type BillingWorkspace } from '../../src/lib/action-cases/billingFlow'

const caseId = '00000000-0000-4000-8000-000000000001', user = '00000000-0000-4000-8000-000000000002'
const initial: BillingWorkspace = { available: true, userId: user, title: 'Fiktivt faktureringsprojekt', revision: 0, contextHash: '0123456789abcdef0123456789abcdef', canManage: true, cancelled: false,
  issuer: 'Testbygg AB\nFiktivgatan 1', recipient: 'Fiktiv testkund', legacyCount: 0, openQuestions: 0, baseFixedGrossOre: null,
  candidates: [{ key: 'change:windows:running', title: 'Fönstermontage', group: 'change', mode: 'running', fixedGrossOre: null, hourlyGrossOre: 75000, markupPercent: 15, budgetGrossOre: null, conditions: 'Efter utfört arbete', reference: 'ÄTA F-001', fingerprint: 'running-v1' },
    { key: 'base:payment:1', title: 'Grundarbete', group: 'base', mode: 'fixed', fixedGrossOre: 2500000, hourlyGrossOre: null, markupPercent: null, budgetGrossOre: null, conditions: 'Efter utförande', reference: 'Låst testavtal version 1', fingerprint: 'fixed-v1' }],
  suppliers: [{ key: '00000000-0000-4000-8000-000000000003:00000000-0000-4000-8000-000000000004', invoiceId: '00000000-0000-4000-8000-000000000003', allocationId: '00000000-0000-4000-8000-000000000004', revision: 1, targetKey: 'change:windows', title: 'Testleverantör / A100', date: '2026-11-09', netOre: 980000, reviewed: true, original: true, legacy: false }], flow: emptyBillingFlow(), history: [] }
let data: BillingWorkspace = JSON.parse(localStorage.getItem('billing-fixture-server') || 'null') || initial
let failNext = false, delay = 0
const calls: unknown[] = [], acknowledged = new Map<string, unknown>()
const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const save = () => localStorage.setItem('billing-fixture-server', JSON.stringify(data))
const realFetch = window.fetch.bind(window)
window.fetch = async (url, options) => {
  if (!String(url).startsWith(`/api/action-cases/${caseId}/`)) throw Error('Only synthetic project access is permitted')
  if (String(url).includes('/administration')) return respond({ userId: user, status: 'in_progress', revision: 0, bases: [], defaults: { issuer: initial.issuer, recipient: initial.recipient } })
  if (String(url).endsWith('/pdf')) {
    const basis = data.flow.bases.find(b => String(url).includes(`/${b.id}/pdf`))
    if (!basis || basis.status !== 'exported') return respond({ error: 'Underlag saknas' }, 404)
    return realFetch('/preview-pdf', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: basis.id, projectTitle: basis.projectTitle, body: { version: 1, title: basis.title, date: basis.date, period: '', issuer: basis.issuer, recipient: basis.recipient, note: basis.note, lines: basis.lines.map(l => ({ id: l.id, description: l.description, quantity: 1, unit: 'post', unitPriceOre: l.netOre, vatRate: l.vatRate })) } }) })
  }
  if (options?.method !== 'POST') return respond(data)
  const request = JSON.parse(String(options.body)); calls.push(request)
  if (delay) await new Promise(r => setTimeout(r, delay))
  if (failNext) { failNext = false; return respond({ code: 'BILLING_FAILED', error: 'Syntetiskt sparfel. Utkastet finns kvar.' }, 500) }
  if (acknowledged.has(request.requestId)) return respond(acknowledged.get(request.requestId))
  if (request.revision !== data.revision) return respond({ code: 'BILLING_STALE', error: 'En nyare version finns.' }, 409)
  try {
    data.flow = applyBillingCommand(data.flow, request.command, data, new Date().toISOString())
    data.revision++; data.history.unshift({ id: request.requestId, operation: request.command.operation, actor: 'Testansvarig', at: new Date().toISOString() })
    const result = { revision: data.revision }; acknowledged.set(request.requestId, result); save(); return respond(result)
  } catch (error) { return respond({ code: (error as Error).message, error: (error as Error).message }, 409) }
}
Object.assign(window, { fixture: { calls, data: () => data, failNext: () => { failNext = true }, delay: (ms: number) => { delay = ms } } })
function App() {
  const [dirty, setDirty] = useState(false)
  return <main className="gizmo-project-page" style={{ maxWidth: 1240, margin: 'auto', padding: 20 }}><h1>Fiktivt faktureringsprojekt</h1><span data-testid="dirty">{dirty ? 'dirty' : 'clean'}</span><ProjectBillingFlow caseId={caseId} active onDirty={setDirty} /></main>
}
createRoot(document.getElementById('root')!).render(<div className="uppdrag-scope uppdrag-page"><div className="gizmo-workspace"><App /></div></div>)
