import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import ProjectQuestions from '@/components/tasks/ProjectQuestions'
import UppdragScope from '@/components/tasks/UppdragScope'
import { emptyQuestion, type ProjectQuestion, type QuestionWorkspace } from '@/lib/action-cases/projectQuestions'

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const manager = { id: id(9), kind: 'profile' as const, name: 'Testledare', email: 'manager@example.invalid' }
const jn = { id: id(10), kind: 'contact' as const, name: 'Testperson A', email: 'a@example.invalid' }
const nh = { id: id(11), kind: 'contact' as const, name: 'Testperson B', email: 'b@example.invalid' }
const createdAt = '2026-11-05T10:00:00Z'
const makeQuestion = (n: number, title: string): ProjectQuestion => {
  const body = { ...emptyQuestion(), title, description: 'Fiktiv testfraga. Ingen bestallning eller verklig fastighet.', assignee: jn }
  return { id: id(n), number: n, revision: 1, body, createdAt, updatedAt: createdAt, tasks: [], participants: [], events: [{ id: id(n + 100), operation: 'create', actorName: manager.name, createdAt, body: structuredClone(body), text: '', reportedBy: '', files: [], revision: 1, taskId: null }] }
}
const single = makeQuestion(1, 'TEST - En ansvarig'), group = makeQuestion(2, 'TEST - Grupp och historik')
single.tasks = [{ id: id(50), version:1, awaitingDispatch:false, status: 'assigned', active: true, dueAt: '2026-12-10T15:00:00Z', assigneeName: jn.name, replyTarget: { taskId: id(50), name: jn.name, recipient: { kind: 'contact', id: jn.id, email: jn.email } }, events: [], files: [] }]
const hp = (p: typeof manager | typeof jn) => ({ key: `${p.kind}:${p.id}`, name: p.name })
group.dialogueHistory = [
  { id: id(201), operation: 'participants', actorName: manager.name, createdAt: '2026-11-05T10:01:00Z', selected: [hp(manager), hp(jn)], added: null, removed: null, snapshot: null, files: [], deliveries: [] },
  { id: id(202), operation: 'participants', actorName: manager.name, createdAt: '2026-11-05T10:02:00Z', selected: [hp(manager), hp(jn), hp(nh)], added: [hp(nh)], removed: [], snapshot: null, files: [], deliveries: [] },
  { id: id(203), operation: 'share', actorName: manager.name, createdAt: '2026-11-05T10:03:00Z', selected: [], added: null, removed: null, snapshot: { title: group.body.title, description: group.body.description }, files: [{ id: id(70), name: 'Fiktivt underlag.pdf' }], deliveries: [{ id: id(80), name: jn.name, status: 'sent', sentAt: '2026-11-05T10:03:02Z' }, { id: id(81), name: nh.name, status: 'failed', sentAt: null }] },
  { id: id(204), operation: 'participants', actorName: manager.name, createdAt: '2026-11-05T10:04:00Z', selected: [hp(manager), hp(jn)], added: [], removed: [hp(nh)], snapshot: null, files: [], deliveries: [] },
]
const workspace: QuestionWorkspace = { questions: [single, group], assignees: [manager, jn, nh], userId: manager.id, managerId: manager.id, canManageParticipants: true, privateFiles: [] }
const storageKey = 'question-stability-fixture-v3'
try {
  const saved = JSON.parse(localStorage.getItem(storageKey) || 'null')
  if (saved?.questions) workspace.questions = saved.questions
} catch { /* A corrupt fixture is replaced by the initial fictional data. */ }
let failNext = false, writes = 0, sends = 0
const acknowledged = new Set<string>()
const messages = new Map<string, Array<Record<string, unknown>>>()
const persist = () => localStorage.setItem(storageKey, JSON.stringify(workspace))
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
window.fetch = async (input, options) => {
  const url = new URL(String(input), location.origin)
  if (url.origin !== location.origin || !url.pathname.startsWith('/api/action-cases/')) throw Error('No live requests in this fixture')
  await new Promise(resolve => setTimeout(resolve, 200))
  if (options?.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  if (url.pathname.endsWith('/dialogue')) {
    const q = workspace.questions.find(q => url.pathname.includes(q.id))!
    if (options?.method) {
      const body = JSON.parse(String(options.body))
      if (failNext) { failNext = false; return json({ error: 'Fiktivt meddelandefel. Din text finns kvar.' }, 503) }
      if (!acknowledged.has(body.requestId)) {
        if (body.operation === 'task_reply') {
          const task = q.tasks.find(t => t.id === body.taskId)
          if (!task || JSON.stringify(task.replyTarget?.recipient) !== JSON.stringify(body.recipient)) return json({ error: 'Fiktiv mottagarkonflikt', code: 'PROJECT_QUESTION_TASK_RECIPIENT_CHANGED' }, 409)
          task.events.push({ id: body.requestId, actorName: manager.name, type: 'comment', text: body.text, createdAt: new Date().toISOString() })
        } else if (body.operation === 'reply') {
          messages.set(q.id, [...messages.get(q.id) || [], { id: body.requestId, participantId: id(90), actorName: manager.name, actorMethod: 'internal_login', operation: 'reply', text: body.text, snapshot: null, files: [], createdAt: new Date().toISOString() }])
        } else return json({ error: 'Unsupported fictional operation' }, 400)
        acknowledged.add(body.requestId); writes++; sends++; persist()
      }
      return json({ questionId: q.id, messageId: body.requestId })
    }
    return json({ questionId: q.id, version: 1, sharedAt: q.id === id(2) ? createdAt : null, snapshot: null, status: q.body.status, managerId: manager.id, canManage: true, viewerId: id(90), participants: [manager, jn].map((p, i) => ({ id: id(90 + i), personId: p.id, kind: p.kind, name: p.name, email: p.email, shared: true })), messages: messages.get(q.id) || [], deliveries: [] })
  }
  if (!options?.method) return json(structuredClone(workspace))
  const body = JSON.parse(String(options.body))
  if (failNext) { failNext = false; return json({ error: 'Fiktivt sparfel. Din text finns kvar.' }, 503) }
  if (acknowledged.has(body.requestId)) return json({ questionId: body.questionId })
  let q = workspace.questions.find(q => q.id === body.questionId)
  if (!q) {
    q = { ...makeQuestion(workspace.questions.length + 1, body.body.title), id: body.questionId, revision: 0, events: [] }
    workspace.questions.push(q)
  }
  if (body.revision !== q.revision) return json({ error: 'Fiktiv versionskonflikt' }, 409)
  writes++
  if (body.operation === 'send') sends++
  if (['reassign','dispatch_reassignment','reschedule'].includes(body.operation)) {
    const task=q.tasks.find(t=>t.id===body.taskId)
    if (!task || task.version!==body.taskVersion) return json({error:'Fiktiv versionskonflikt'},409)
    if (body.operation==='reschedule') task.dueAt=body.dueAt
    else if (body.operation==='reassign') {
      const person=workspace.assignees.find(a=>a.id===body.assignee.id&&a.kind===body.assignee.kind)!
      q.body={...q.body,assignee:person}; task.assigneeName=person.name; task.awaitingDispatch=true; task.replyTarget=null
    } else { task.awaitingDispatch=false; sends++ }
    task.version=(task.version||0)+1
  }
  if (['create', 'update'].includes(body.operation)) q.body = body.body
  if (body.operation === 'close') q.body.status = 'closed'
  if (body.operation === 'reopen') q.body.status = 'open'
  q.revision++; q.updatedAt = new Date().toISOString()
  q.events.push({ id: body.requestId, operation: body.operation, actorName: manager.name, createdAt: q.updatedAt, body: structuredClone(q.body), text: body.text || '', reportedBy: '', files: [], revision: q.revision, taskId: null })
  acknowledged.add(body.requestId); persist()
  return json({ questionId: q.id })
}
function View() {
  const [count, setCount] = useState(0)
  const simulate = () => {
    const task = workspace.questions.find(q => q.id === id(1))!.tasks[0]
    task.status = task.status === 'assigned' ? 'in_progress' : 'approved'
    task.active = task.status !== 'approved'
    task.events.push({ id: crypto.randomUUID(), actorName: jn.name, type: 'comment', text: `Fiktivt mottagarsvar ${count + 1}`, createdAt: new Date().toISOString() })
    persist(); setCount(count + 1)
  }
  const changeRecipient = () => { workspace.questions.find(q => q.id === id(1))!.tasks[0].replyTarget = { taskId: id(50), name: nh.name, recipient: { kind: 'contact', id: nh.id, email: nh.email } }; persist(); setCount(count + 1) }
  return <UppdragScope><aside className="fixture-controls"><details><summary>Fiktiva testverktyg</summary><button onClick={simulate}>Simulera mottagarsvar</button><button onClick={changeRecipient}>Byt fiktiv mottagare</button><button onClick={() => { failNext = true; setCount(count + 1) }}>Fel vid nasta sparning</button><p>Simuleringar: {count} · Skrivningar: {writes} · Utskick: {sends}</p></details></aside><main className="fixture-workspace"><h1>TEST - Fragor och beslut</h1><ProjectQuestions caseId={id(99)} active files={[]} onFiles={() => {}} onDirty={() => {}} /></main></UppdragScope>
}
createRoot(document.getElementById('root')!).render(<View />)
