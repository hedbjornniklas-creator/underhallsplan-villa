import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import ProjectCompletion from '../../src/components/tasks/ProjectCompletion'
import ProjectInvoiceBasis from '../../src/components/tasks/ProjectInvoiceBasis'
import type { ProjectCompletionWorkspace } from '../../src/lib/action-cases/projectCompletion'
import type { ActionCaseStatus } from '../../src/lib/action-cases/contracts'

const caseId = '00000000-0000-4000-8000-000000000001'
const initial: ProjectCompletionWorkspace = { available: true, userId: '00000000-0000-4000-8000-000000000002', canManage: true, status: 'in_progress', revision: 0, workComplete: false, invoiced: false, completedAt: null, openQuestions: 1, bases: [], events: [], defaults: { issuer: 'Testbygg AB\nTestgatan 2', recipient: 'Fiktiv testkund\nTestgatan 3' } }
let data = JSON.parse(localStorage.getItem('completion-fixture-server') || 'null') || initial
let fail = false, delay = 0
const calls: unknown[] = [], acks = new Map<string, unknown>()
const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
window.fetch = async (url, options) => {
  if (!String(url).startsWith('/api/action-cases/')) throw Error('Only fixture API access is permitted')
  if (options?.method !== 'POST') return respond(data)
  const request = JSON.parse(String(options.body)); calls.push(request)
  if (delay) await new Promise(r => setTimeout(r, delay))
  if (fail) { fail = false; return respond({ error: 'Syntetiskt sparfel. Ändringarna finns kvar.' }, 500) }
  if (acks.has(request.requestId)) return respond(acks.get(request.requestId))
  if (request.operation === 'save_basis') {
    const old = data.bases.find((b: { id: string }) => b.id === request.id)
    if ((old?.revision || 0) !== request.revision) return respond({ error: 'Underlaget har ändrats.' }, 409)
    data.bases = [{ id: request.id, revision: request.revision + 1, body: request.body, updatedAt: new Date().toISOString() }, ...data.bases.filter((b: { id: string }) => b.id !== request.id)]
  } else {
    if (request.revision !== data.revision) return respond({ error: 'Status har ändrats.' }, 409)
    if (request.operation === 'flags') { data.workComplete = request.workComplete; data.invoiced = request.invoiced }
    if (request.operation === 'complete') { if (!data.workComplete || !data.invoiced || data.openQuestions) return respond({ error: 'Projektet har öppna frågor.' }, 409); data.status = 'completed' }
    if (request.operation === 'reopen') { data.status = 'in_progress'; data.workComplete = false; data.invoiced = false }
    data.revision++
  }
  localStorage.setItem('completion-fixture-server', JSON.stringify(data))
  const result = { id: request.id, revision: request.operation === 'save_basis' ? request.revision + 1 : data.revision, status: data.status }
  acks.set(request.requestId, result); return respond(result)
}
Object.assign(window, { fixture: { calls, failNext: () => { fail = true }, delay: (ms: number) => { delay = ms }, clearQuestions: () => { data.openQuestions = 0 }, data: () => data } })
function App() {
  const [status, setStatus] = useState<ActionCaseStatus>('in_progress'), [completionDirty, setCompletionDirty] = useState(false), [invoiceDirty, setInvoiceDirty] = useState(false)
  return <main className="gizmo-project-page" style={{ maxWidth: 1240, margin: 'auto', padding: 20 }}><p>Enbart fiktiva testuppgifter</p><h1 className="text-2xl">Projektavslut och fakturaunderlag</h1><p data-testid="status">{status}</p><span data-testid="dirty">{completionDirty || invoiceDirty ? 'dirty' : 'clean'}</span><ProjectCompletion caseId={caseId} active refreshKey={0} blocked={invoiceDirty} onStatus={setStatus} onDirty={setCompletionDirty} /><ProjectInvoiceBasis caseId={caseId} active onDirty={setInvoiceDirty} /></main>
}
createRoot(document.getElementById('root')!).render(<div className="uppdrag-scope uppdrag-page"><div className="gizmo-workspace"><App /></div></div>)
