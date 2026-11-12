import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { emptyQuestion, questionAssigneeOptions, questionStatuses } from '../src/lib/action-cases/projectQuestions.ts'
import * as questionModel from '../src/lib/action-cases/projectQuestions.ts'
import { taskDateTimeInputToIso, taskIsoToDateTimeInput } from '../src/lib/tasks/dateTime.ts'

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const content = node => typeof node === 'string' ? node : Array.isArray(node) ? node.map(content).join('') : node?.props ? content(node.props.children) : ''
function nodes(tree) { return !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(tree.props?.children)] }
const tick = () => new Promise(resolve => setImmediate(resolve))

function harness({ onWorkspaceChanged, directFiles = false } = {}) {
  const states = [], refs = [], requests = [], reads = [], fileRequests = []
  let stateIndex = 0, refIndex = 0, tree, failRefresh = false, deferReads = false
  const customer = { id: id(2), kind: 'customer', name: 'Testbeställare', email: 'test@example.invalid' }
  const workspace = { questions: [], assignees: [customer], customersAvailable: true, userId: id(9), managerId: id(9), canManageParticipants: true }
  const original = { fetch: globalThis.fetch, document: globalThis.document, raf: globalThis.requestAnimationFrame, storage: globalThis.localStorage }
  const storage = new Map()
  globalThis.localStorage = { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) }
  globalThis.document = { body: {}, activeElement: null }
  globalThis.requestAnimationFrame = fn => fn()
  globalThis.fetch = async (_url, options) => {
    if (directFiles && _url === '/api/action-cases') {
      const body = JSON.parse(options.body); fileRequests.push(body)
      assert.ok(workspace.questions.some(q => q.id === body.payload.questionId), 'the private question must be saved before creating an upload')
      if (body.action === 'create_signed_upload') return { ok: true, json: async () => ({ upload: { bucket: 'project-question-files', filePath: 'private/question/file', token: 'fictional', contentType: 'application/pdf' } }) }
      assert.equal(body.action, 'complete_upload')
      workspace.privateFiles = [{ id: id(80), questionId: body.payload.questionId, fileName: body.payload.fileName, fileSizeBytes: body.payload.fileSize, contentType: body.payload.contentType, type: 'document' }]
      return { ok: true, json: async () => ({ attachmentId: id(80) }) }
    }
    if (!options?.method) {
      const body = structuredClone(workspace)
      if (deferReads) return new Promise(resolve => reads.push({ body, resolve }))
      return { ok: !failRefresh, json: async () => failRefresh ? { error: 'Listan kunde inte hämtas.' } : body }
    }
    return new Promise(resolve => requests.push({ body: JSON.parse(options.body), resolve }))
  }
  const react = {
    useState(initial) {
      const index = stateIndex++
      if (index >= states.length) states[index] = typeof initial === 'function' ? initial() : initial
      return [states[index], value => { states[index] = typeof value === 'function' ? value(states[index]) : value }]
    },
    useRef(value) { const index = refIndex++; return refs[index] ??= { current: value } },
    useEffect() {}, useCallback: fn => fn, useId: () => 'question-heading'
  }
  const dependencies = {
    react, 'react-dom': { createPortal: node => node }, 'lucide-react': {}, '@/lib/supabaseClient': { supabase: { storage: { from(bucket) { assert.equal(bucket, 'project-question-files'); return { async uploadToSignedUrl() { return { error: null } } } } } } }, './project-questions.css': {},
    '@/lib/tasks/dateTime': { taskDateTimeInputToIso, taskIsoToDateTimeInput, formatTaskDateTime: value => value },
    '@/lib/action-cases/projectQuestions': questionModel,
    './QuestionDialogue': { default: () => null },
    './QuestionAttachments': { default: () => null },
    './QuestionReminderSchedule': { default: () => null },
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) }
  }
  let queue = Promise.resolve()
  const saveModule = { exports: {} }
  const saveCode = ts.transpileModule(readFileSync(new URL('../src/components/tasks/useQuestionAutosave.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  new Function('require', 'module', 'exports', saveCode)(name => name === 'react' ? react : { useAutosaveQueue: ({ save }) => ({ enqueue: () => { const next = queue.then(() => save(true)); queue = next.catch(() => undefined); return next } }) }, saveModule, saveModule.exports)
  dependencies['./useQuestionAutosave'] = saveModule.exports
  const code = ts.transpileModule(readFileSync(new URL('../src/components/tasks/ProjectQuestions.tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
  const module = { exports: {} }
  new Function('require', 'module', 'exports', code)(name => { assert.ok(name in dependencies, name); return dependencies[name] }, module, module.exports)
  const render = () => { stateIndex = 0; refIndex = 0; tree = module.exports.default({ caseId: id(1), active: true, files: [], onFiles() {}, onDirty() {}, onWorkspaceChanged }); return tree }
  const button = name => { const b = nodes(tree).find(n => n.type === 'button' && (content(n) === name || n.props['aria-label'] === name)); assert.ok(b, name); return b }
  const field = label => { const n = nodes(tree).find(n => n.type === 'label' && content(n).startsWith(label)); assert.ok(n, label); return nodes(n).find(child => ['input', 'textarea', 'select'].includes(child.type)) }
  render()
  return { requests, reads, fileRequests, customer, workspace, render, button, field, nodes: () => nodes(tree), text: () => content(tree),
    async click(name) { button(name).props.onClick(); await tick(); render() },
    input(label, value) { field(label).props.onChange({ target: { value } }); render() },
    async start() { button('Hämta sparade frågor och svar').props.onClick(); await tick(); render(); button('Ny fråga').props.onClick(); render() },
    async reply(index, error, questionId, status) {
      const request = requests[index].body
      if (!error && (!questionId || questionId === request.questionId)) {
        let question = workspace.questions.find(q => q.id === request.questionId)
        if (!question) { question = { id: request.questionId, number: workspace.questions.length + 1, events: [], tasks: [], participants: [], createdAt: new Date().toISOString() }; workspace.questions.push(question) }
        if (request.operation === 'reassign') {
          question.body = { ...question.body, assignee: workspace.assignees.find(person => person.kind === request.assignee.kind && person.id === request.assignee.id) }
          question.tasks[0] = { ...question.tasks[0], version: question.tasks[0].version + 1, awaitingDispatch: true, assigneeName: question.body.assignee.name }
        } else if (request.operation === 'reschedule') question.tasks[0] = { ...question.tasks[0], dueAt: request.dueAt, version: question.tasks[0].version + 1 }
        else if (request.operation === 'dispatch_reassignment') question.tasks[0].awaitingDispatch = false
        else if (request.operation === 'share_files') question.tasks[0].files.push(...request.fileIds.filter(id => !question.tasks[0].files.some(f => f.sourceAttachmentId === id)).map(sourceAttachmentId => ({ id: sourceAttachmentId, sourceAttachmentId, name: 'Testbilaga.pdf', text: null, createdAt: new Date().toISOString() })))
        else question.body = request.body
        if (request.attachmentSelection === 1 && ['create','update'].includes(request.operation)) question.attachmentIds = request.fileIds
        Object.assign(question, { revision: request.revision + 1, updatedAt: new Date().toISOString() })
      }
      requests[index].resolve({ ok: !error, status: status || (error ? 500 : 200), json: async () => error ? { error } : { questionId: questionId || request.questionId } }); await tick(); render()
    },
    failRefresh() { failRefresh = true },
    deferReads() { deferReads = true },
    async read(index) { reads[index].resolve({ ok: true, json: async () => reads[index].body }); await tick(); render() },
    dispose() { globalThis.fetch = original.fetch; globalThis.document = original.document; globalThis.requestAnimationFrame = original.raf; globalThis.localStorage = original.storage }
  }
}

test('supplementing an existing question autosaves attachments, retries exactly and never creates a second task', async () => {
  const h=harness()
  try {
    const task={id:id(61),version:4,active:true,awaitingDispatch:false,status:'in_progress',dueAt:'2030-01-20T15:00:00Z',assigneeName:h.customer.name,events:[],files:[]}
    const body={...emptyQuestion(),title:'Bilagetest',description:'Underlag',assignee:h.customer}
    h.workspace.questions.push({id:id(60),number:1,revision:1,body,attachmentIds:[],createdAt:'2026-11-12',updatedAt:'2026-11-12',events:[],tasks:[task],participants:[]})
    await h.click('Hämta sparade frågor och svar');h.nodes().find(n=>n.props?.className==='gizmo-question-table-row').props.onClick({target:{closest:()=>null}});h.render()
    h.nodes().find(n=>n.props?.attachedIds).props.onChange([id(80)]);h.render()
    assert.equal(h.button('Skicka uppdatering till Testbeställare').props.disabled,true)
    await new Promise(r=>setTimeout(r,730));h.render();assert.equal(h.requests[0].body.operation,'update');assert.equal(h.requests[0].body.attachmentSelection,1)
    await h.reply(0);assert.deepEqual(h.workspace.questions[0].attachmentIds,[id(80)])
    await h.click('Skicka uppdatering till Testbeställare');const attempt=structuredClone(h.requests[1].body)
    assert.equal(attempt.operation,'share_files');assert.equal(attempt.taskId,task.id);assert.equal(attempt.taskVersion,4);assert.deepEqual(attempt.fileIds,[id(80)])
    await h.reply(1,'Fiktivt utskicksfel');await h.click('Försök skicka uppdateringen igen');assert.deepEqual(h.requests[2].body,attempt)
    await h.reply(2);assert.equal(h.workspace.questions[0].tasks.length,1);assert.equal(h.workspace.questions[0].tasks[0].status,'in_progress')
    assert.deepEqual(h.workspace.questions[0].body,body);assert.match(h.text(),/Aviseringen är sparad i utskickskön/)
    assert.equal(h.button('Skicka uppdatering till Testbeställare').props.disabled,true)
    await h.click('Stäng');h.nodes().find(n=>n.props?.className==='gizmo-question-table-row').props.onClick({target:{closest:()=>null}});h.render()
    assert.deepEqual(h.nodes().find(n=>n.props?.attachedIds).props.attachedIds,[id(80)])
  } finally {h.dispose()}
})

test('manager edits a sent question deadline with Stockholm time, exact retry and unchanged recipient/status', async () => {
  const h=harness()
  try {
    const task={id:id(61),version:4,active:true,awaitingDispatch:false,status:'in_progress',dueAt:'2030-01-20T15:00:00Z',events:[],files:[]}
    const body={...emptyQuestion(),title:'Datumtest',description:'Underlag',assignee:h.customer}
    h.workspace.questions.push({id:id(60),number:1,revision:1,body,createdAt:'2026-11-12',updatedAt:'2026-11-12',events:[],tasks:[task],participants:[]})
    await h.click('Hämta sparade frågor och svar');h.nodes().find(n=>n.props?.className==='gizmo-question-table-row').props.onClick({target:{closest:()=>null}});h.render()
    await h.click('Ändra färdigdatum')
    assert.equal(h.field('Nytt färdigdatum').props.value,'2030-01-20')
    assert.equal(h.field('Klockslag (Stockholm)').props.value,'16:00')
    assert.equal(h.button('Spara färdigdatum').props.disabled,true)
    h.input('Nytt färdigdatum','2030-01-23');assert.equal(h.button('Spara färdigdatum').props.disabled,false)
    await h.click('Spara färdigdatum');const attempt=structuredClone(h.requests[0].body)
    assert.equal(attempt.operation,'reschedule');assert.equal(attempt.taskVersion,4);assert.equal(attempt.dueAt,'2030-01-23T15:00:00.000Z')
    assert.equal('assignee' in attempt,false);assert.equal('body' in attempt,false)
    await h.reply(0,'Fiktivt sparfel');await h.click('Försök igen');assert.deepEqual(h.requests[1].body,attempt)
    await h.reply(1)
    assert.equal(h.workspace.questions[0].tasks.length,1);assert.equal(h.workspace.questions[0].tasks[0].status,'in_progress')
    assert.deepEqual(h.workspace.questions[0].body,body);assert.match(h.text(),/2030-01-23T15:00:00.000Z/)
    assert.match(h.text(),/Ingen ny tilldelning har skickats/)
    await h.click('Ändra färdigdatum');h.input('Nytt färdigdatum','2030-01-24')
    await h.click('Avbryt datumändring');assert.equal(h.requests.length,2)
  } finally {h.dispose()}
})

test('a stale date change retains the desired date but requires a new version-bound attempt',async()=>{
  const h=harness()
  try {
    const task={id:id(61),version:4,active:true,status:'assigned',dueAt:'2030-01-20T15:00:00Z',events:[],files:[]}
    const q={id:id(60),number:1,revision:1,body:{...emptyQuestion(),title:'Datumtest',description:'Underlag',assignee:h.customer},events:[],tasks:[task],participants:[]}
    h.workspace.questions.push(q)
    await h.click('Hämta sparade frågor och svar');h.nodes().find(n=>n.props?.className==='gizmo-question-table-row').props.onClick({target:{closest:()=>null}});h.render()
    await h.click('Ändra färdigdatum');h.input('Nytt färdigdatum','2030-01-23');await h.click('Spara färdigdatum')
    const original=h.requests[0].body;q.revision=2;task.version=5;task.dueAt='2030-01-21T15:00:00Z'
    await h.reply(0,'Fiktiv versionskonflikt',undefined,409)
    assert.equal(h.field('Nytt färdigdatum').props.value,'2030-01-23');assert.match(h.text(),/Granska och bekräfta på nytt/)
    await h.click('Spara färdigdatum');const next=h.requests[1].body
    assert.equal(next.revision,2);assert.equal(next.taskVersion,5);assert.notEqual(next.requestId,original.requestId)
    await h.reply(1);assert.equal(task.status,'assigned')
  } finally {h.dispose()}
})

test('a question participant who is not manager has no internal date-edit action',async()=>{
  const h=harness()
  try {
    h.workspace.canManageParticipants=false
    h.workspace.questions.push({id:id(60),number:1,revision:1,body:{...emptyQuestion(),title:'Datumtest',description:'Underlag'},events:[],tasks:[{id:id(61),version:4,active:true,status:'assigned',dueAt:'2030-01-20T15:00:00Z',events:[],files:[]}],participants:[]})
    await h.click('Hämta sparade frågor och svar');h.nodes().find(n=>n.props?.className==='gizmo-question-table-row').props.onClick({target:{closest:()=>null}});h.render()
    assert.doesNotMatch(h.text(),/Ändra färdigdatum/)
  } finally {h.dispose()}
})

test('manager changes a sent question with exact retry and dispatches separately without replacing its task/status', async () => {
  const h = harness()
  try {
    const next = { id: id(10), kind: 'profile', name: 'Ny ansvarig', email: 'next@example.invalid' }
    h.workspace.assignees.push(next)
    const task = { id: id(61), version: 4, active: true, awaitingDispatch: false, status: 'in_progress', dueAt: '2030-01-20T16:00:00Z', events: [], files: [] }
    h.workspace.questions.push({ id: id(60), number: 1, revision: 1, body: { ...emptyQuestion(), title: 'Fiktiv fråga', description: 'Underlag', assignee: h.customer }, createdAt: '2026-11-12', updatedAt: '2026-11-12', events: [], tasks: [task], participants: [] })
    await h.click('Hämta sparade frågor och svar'); h.nodes().find(n => n.props?.className === 'gizmo-question-table-row').props.onClick({ target: { closest: () => null } }); h.render()
    await h.click('Byt ansvarig'); h.input('Ny ansvarig', `profile:${next.id}`)
    const confirm = () => h.nodes().find(n => n.type === 'label' && content(n).includes('Jag bekräftar bytet av ansvarig.')).props.children[0]
    confirm().props.onChange({ target: { checked: true } }); h.render()
    await h.click('Bekräfta byte')
    assert.equal(h.requests[0].body.operation, 'reassign'); assert.equal(h.requests[0].body.taskId, task.id); assert.equal(h.requests[0].body.taskVersion, 4)
    const attempt = structuredClone(h.requests[0].body)
    await h.reply(0, 'Fiktivt nätfel'); await h.click('Försök igen'); assert.deepEqual(h.requests[1].body, attempt)
    await h.reply(1)
    assert.equal(h.workspace.questions[0].body.assignee.id, next.id)
    assert.match(h.text(), /Inget nytt utskick har gjorts/)
    assert.equal(h.requests.some(r => r.body.operation === 'dispatch_reassignment'), false)
    h.nodes().find(n => n.type === 'summary' && content(n) === 'Skicka till ny ansvarig').props.onClick({ preventDefault() {} }); await tick(); h.render()
    assert.equal(h.button('Skicka till ny ansvarig').props.disabled, true)
    const reviewed = h.nodes().find(n => n.type === 'label' && content(n).includes('Jag har granskat mottagaren')).props.children[0]
    reviewed.props.onChange({ target: { checked: true } }); h.render()
    assert.equal(h.button('Skicka till ny ansvarig').props.disabled, false)
    await h.click('Skicka till ny ansvarig')
    assert.equal(h.requests[2].body.operation, 'dispatch_reassignment')
    assert.equal('dueAt' in h.requests[2].body, false)
    await h.reply(2)
    assert.equal(h.workspace.questions[0].tasks.length, 1)
    assert.equal(h.workspace.questions[0].tasks[0].id, task.id)
    assert.equal(h.workspace.questions[0].tasks[0].status, 'in_progress')
    assert.equal(h.workspace.questions[0].tasks[0].awaitingDispatch, false)
  } finally { h.dispose() }
})

test('a definite assignment conflict reloads versions, preserves the selected person and requires fresh confirmation', async () => {
  const h=harness()
  try {
    const next={id:id(10),kind:'profile',name:'Ny ansvarig',email:'next@example.invalid'}; h.workspace.assignees.push(next)
    const q={id:id(60),number:1,revision:1,body:{...emptyQuestion(),title:'Fråga',description:'Underlag',assignee:h.customer},createdAt:'2026-11-12',updatedAt:'2026-11-12',events:[],participants:[],tasks:[{id:id(61),version:4,active:true,status:'in_progress',dueAt:'2030-01-20T16:00:00Z',events:[],files:[]}]}; h.workspace.questions.push(q)
    await h.click('Hämta sparade frågor och svar'); h.nodes().find(n=>n.props?.className==='gizmo-question-table-row').props.onClick({target:{closest:()=>null}}); h.render()
    await h.click('Byt ansvarig'); h.input('Ny ansvarig',`profile:${next.id}`)
    const confirm=()=>h.nodes().find(n=>n.type==='label'&&content(n).includes('Jag bekräftar bytet av ansvarig.')).props.children[0]
    confirm().props.onChange({target:{checked:true}});h.render();await h.click('Bekräfta byte')
    q.revision=2;q.tasks[0].version=5
    await h.reply(0,'Frågan har ändrats.',undefined,409)
    assert.match(h.text(),/Aktuella uppgifter har hämtats/)
    assert.equal(h.field('Ny ansvarig').props.value,`profile:${next.id}`)
    assert.equal(h.button('Bekräfta byte').props.disabled,true)
    confirm().props.onChange({target:{checked:true}});h.render();await h.click('Bekräfta byte')
    assert.equal(h.requests[1].body.revision,2);assert.equal(h.requests[1].body.taskVersion,5)
    assert.notEqual(h.requests[1].body.requestId,h.requests[0].body.requestId)
    await h.reply(1)
  } finally {h.dispose()}
})

test('a direct document upload saves a new question first and selects its acknowledged private attachment', async () => {
  const h = harness({ directFiles: true })
  try {
    await h.start(); h.input('Rubrik', 'Ny fråga med PDF'); h.input('Fråga', 'Fiktivt underlag')
    assert.equal(h.nodes().find(n => n.props?.attachedIds).props.disabled, false)
    const input = h.nodes().find(n => n.props?.['aria-label'] === 'Ladda upp bilaga till frågan')
    input.props.onChange({ target: { files: [new File(['test'], 'Ritning.pdf', { type: 'application/pdf' })] } }); await tick(); h.render()
    input.props.onChange({ target: { files: [new File(['second'], 'Andra.pdf', { type: 'application/pdf' })] } }); await tick(); h.render()
    assert.equal(h.requests.length,1,'a second file selection cannot race the initial question save')
    assert.equal(h.requests[0].body.operation, 'create'); assert.equal(h.fileRequests.length, 0)
    await h.reply(0); await tick(); h.render()
    assert.deepEqual(h.fileRequests.map(r => r.action), ['create_signed_upload', 'complete_upload'])
    assert.ok(h.fileRequests.every(r => r.payload.questionId === h.workspace.questions[0].id))
    assert.equal(h.workspace.privateFiles[0].fileName, 'Ritning.pdf')
    await h.click('Stäng')
    assert.deepEqual(h.requests[1].body.fileIds, [id(80)])
    await h.reply(1)
    assert.ok(h.requests.every(r => ['create', 'update'].includes(r.body.operation)))
  } finally { h.dispose() }
})

test('successful question reads notify the overview after save, but failed reads do not invalidate it', async () => {
  let updates = 0
  const h = harness({ onWorkspaceChanged: () => { updates++ } })
  try {
    await h.start()
    assert.equal(updates, 1)
    h.input('Rubrik', 'Testfråga'); h.input('Fråga', 'Fiktivt underlag')
    await h.click('Skapa fråga'); await h.reply(0)
    assert.ok(updates > 1, 'the saved question must invalidate a recently loaded overview')
    const before = updates
    h.failRefresh(); await h.click('Hämta sparade frågor och svar')
    assert.equal(updates, before)
  } finally { h.dispose() }
})

test('save and create next keeps text on failure, reuses retry identity and opens a clean question only after acknowledgement', async () => {
  const h = harness()
  try {
    await h.start(); h.input('Rubrik', 'Första frågan'); h.input('Fråga', 'Ett fiktivt underlag'); h.input('Ansvarig', `customer:${h.customer.id}`)
    await h.click('Spara och skapa nästa')
    const first = h.requests[0].body
    assert.equal(first.operation, 'create'); assert.equal(first.body.assignee.kind, 'customer')
    assert.equal(h.button('Spara och skapa nästa').props.disabled, true)
    h.button('Spara och skapa nästa').props.onClick()
    assert.equal(h.requests.length, 1)
    await h.reply(0, 'Tillfälligt fel')
    assert.equal(h.field('Rubrik').props.value, 'Första frågan')
    await h.click('Spara och skapa nästa')
    assert.equal(h.requests[1].body.requestId, first.requestId)
    await h.reply(1)
    assert.equal(h.field('Rubrik').props.value, '')
    assert.equal(h.field('Fråga').props.value, '')
    assert.equal(h.field('Ansvarig').props.value, '')
    assert.equal(h.button('Spara och skapa nästa').props.disabled, true)
    assert.match(h.text(), /Frågan är sparad/)
    h.input('Rubrik', 'Andra frågan'); h.input('Fråga', 'Ett annat underlag'); await h.click('Spara och skapa nästa')
    assert.notEqual(h.requests[2].body.questionId, first.questionId)
    assert.notEqual(h.requests[2].body.requestId, first.requestId)
    assert.deepEqual(h.requests[2].body.fileIds, [])
    assert.equal(h.requests[2].body.body.assignee, null)
    await h.reply(2)
  } finally { h.dispose() }
})

test('create question saves the current question without opening another one or sending it', async () => {
  const h = harness()
  try {
    await h.start(); h.input('Rubrik', 'En fråga'); h.input('Fråga', 'Underlag')
    await h.click('Skapa fråga')
    assert.equal(h.requests[0].body.operation, 'create')
    await h.reply(0)
    assert.equal(h.field('Rubrik').props.value, 'En fråga')
    assert.equal(h.workspace.questions.length, 1)
    assert.match(h.text(), /Inget utskick har gjorts/)
    assert.equal(h.requests.length, 1)
  } finally { h.dispose() }
})
test('create question preserves text and the exact request identity for retry', async () => {
  const h = harness()
  try {
    await h.start(); h.input('Rubrik', 'Behåll mig'); h.input('Fråga', 'Underlag')
    await h.click('Skapa fråga'); const first = h.requests[0].body
    await h.reply(0, 'Tillfälligt fel')
    assert.equal(h.field('Rubrik').props.value, 'Behåll mig')
    await h.click('Försök skapa igen')
    assert.deepEqual(h.requests[1].body, first)
    await h.reply(1)
    assert.equal(h.workspace.questions.length, 1)
  } finally { h.dispose() }
})
test('history interleaves question events, participant changes and shared evidence without claiming email delivery', async () => {
  const h = harness()
  try {
    const body = { ...emptyQuestion(), title: 'Test', description: 'Underlag' }
    h.workspace.questions.push({ id: id(60), number: 1, revision: 1, body, createdAt: '2026-11-05T10:00:00Z', updatedAt: '2026-11-05T11:00:00Z', participants: [], tasks: [],
      events: [{ id: id(70), operation: 'create', actorName: 'Manager', createdAt: '2026-11-05T10:00:00Z', text: '', reportedBy: '', body, files: [], revision: 1, taskId: null }],
      dialogueHistory: [
        { id: id(71), operation: 'participants', actorName: 'Manager', createdAt: '2026-11-05T10:01:00Z', selected: [{ key: 'a', name: 'jn' }], added: null, removed: null, snapshot: null, files: [], deliveries: [] },
        { id: id(72), operation: 'participants', actorName: 'Manager', createdAt: '2026-11-05T10:02:00Z', selected: [], added: [], removed: [{ key: 'a', name: 'jn' }], snapshot: null, files: [], deliveries: [] },
        { id: id(73), operation: 'share', actorName: 'Manager', createdAt: '2026-11-05T10:03:00Z', selected: [], added: null, removed: null, snapshot: { title: 'Sparat underlag', description: 'Delad beskrivning' }, files: [{ id: id(74), name: 'Test.pdf' }], deliveries: [{ id: id(75), name: 'nh', status: 'sent', sentAt: '2026-11-05T10:04:00Z' }] }
      ] })
    await h.click('Hämta sparade frågor och svar')
    h.nodes().find(n => n.props?.className === 'gizmo-question-open').props.onClick(); h.render()
    h.nodes().find(n => n.props?.role === 'tab' && content(n) === 'Historik').props.onClick(); await tick(); h.render()
    assert.match(h.text(), /Tidigare urval saknas/)
    assert.match(h.text(), /Borttagna ur urvalet: jn/)
    assert.match(h.text(), /Sparat underlag/)
    assert.match(h.text(), /Test.pdf/)
    assert.match(h.text(), /nh: Överlämnad till e-posttjänsten/)
    assert.doesNotMatch(h.text(), /Mejlet har levererats|Läst av/)
    assert.ok(h.text().indexOf('Fråga registrerad') < h.text().indexOf('Deltagarurval sparat'))
  } finally { h.dispose() }
})

test('refreshing linked tasks keeps unsaved question text and ignores an older out-of-order read', async () => {
  const h = harness()
  try {
    const q = { id: id(60), number: 13, revision: 1, body: { ...emptyQuestion(), title: 'Test', description: 'Frågan' }, createdAt: '2026-11-05T10:00:00Z', updatedAt: '2026-11-05T10:00:00Z', events: [], participants: [], tasks: [{ id: id(61), status: 'assigned', active: true, dueAt: '2026-11-09T15:00:00Z', assigneeName: 'Testperson', events: [], files: [] }] }
    h.workspace.questions.push(q)
    await h.click('Hämta sparade frågor och svar')
    h.nodes().find(n => n.props?.className === 'gizmo-question-open').props.onClick(); h.render()
    h.input('Sammanhang / möte', 'Min påbörjade text')
    // Exercise the same callback that the dialog refresh button invokes.
    const dialogTab = h.nodes().find(n => n.props?.role === 'tab' && content(n) === 'Kommunikation')
    dialogTab.props.onClick(); await tick(); h.render()
    await h.reply(0)
    h.deferReads()
    const dialogue = () => h.nodes().find(n => n.props?.onRefresh)
    const older = dialogue().props.onRefresh()
    await tick()
    q.tasks[0].status = 'in_progress'
    q.tasks[0].events.push({ id: id(62), actorName: 'Testperson', type: 'comment', text: 'Nytt svar', createdAt: '2026-11-05T11:00:00Z' })
    const newer = dialogue().props.onRefresh()
    await tick()
    await h.read(1); await newer
    assert.equal(dialogue().props.internalEvents[0].text, 'Nytt svar')
    await h.read(0); await older
    assert.equal(dialogue().props.internalEvents[0].text, 'Nytt svar')
    const details = h.nodes().find(n => n.props?.role === 'tab' && content(n) === 'Fråga')
    details.props.onClick(); await tick(); h.render()
    assert.equal(h.field('Sammanhang / möte').props.value, 'Min påbörjade text')
    assert.equal(h.requests.length, 1)
  } finally { h.dispose() }
})

test('the whole question row opens the shared register tabs and closing flushes a pending edit without sending it', async () => {
  const h = harness()
  try {
    h.workspace.questions.push({ id: id(60), number: 13, revision: 1, body: { ...emptyQuestion(), title: 'Test', description: 'Frågan' }, createdAt: '2026-11-05T10:00:00Z', updatedAt: '2026-11-05T10:00:00Z', events: [], tasks: [], participants: [] })
    await h.click('Hämta sparade frågor och svar')
    const row = h.nodes().find(n => n.props?.className === 'gizmo-question-table-row')
    assert.ok(row)
    row.props.onClick({ target: { closest: () => null } }); h.render()
    assert.deepEqual(h.nodes().filter(n => n.props?.role === 'tab').map(content), ['Fråga', 'Kommunikation', 'Deltagare', 'Historik'])
    assert.equal(h.nodes().filter(n => n.props?.role === 'tab' && content(n) === 'Skicka till ansvarig').length, 0)
    h.input('Sammanhang / möte', 'Autosparat')
    await h.click('Stäng')
    assert.equal(h.requests.length, 1); assert.equal(h.requests[0].body.operation, 'update')
    await h.reply(0)
    assert.equal(h.nodes().some(n => n.props?.role === 'dialog'), false)
    assert.equal(h.workspace.questions[0].body.source, 'Autosparat')
    assert.ok(h.requests.every(request => !['send', 'share', 'note', 'answer', 'close'].includes(request.body.operation)))
  } finally { h.dispose() }
})

test('an unsent dispatch keeps dates across collapse, closing and reopening, without restoring its confirmation', async () => {
  const h = harness()
  try {
    const q = { id: id(60), number: 13, revision: 1, body: { ...emptyQuestion(), title: 'Test', description: 'Frågan', assignee: h.customer }, createdAt: '2026-11-05T10:00:00Z', updatedAt: '2026-11-05T10:00:00Z', events: [], tasks: [], participants: [] }
    h.workspace.questions.push(q)
    await h.click('Hämta sparade frågor och svar')
    const open = () => { h.nodes().find(n => n.props?.className === 'gizmo-question-open').props.onClick(); h.render() }
    const toggle = async () => { h.nodes().find(n => n.type === 'summary' && content(n).startsWith('Skicka till ansvarig')).props.onClick({ preventDefault() {} }); await tick(); h.render() }
    open(); await toggle()
    h.input('Svar senast', '2026-11-10'); h.input('Första uppföljning', '2026-11-09')
    await toggle(); await toggle()
    assert.equal(h.field('Svar senast').props.value, '2026-11-10')
    await h.click('Stäng'); open(); await toggle()
    assert.equal(h.field('Svar senast').props.value, '2026-11-10')
    assert.equal(h.field('Första uppföljning').props.value, '2026-11-09')
    assert.equal(h.button('Skicka uppgift').props.disabled, true)
    assert.equal(h.requests.length, 0)
  } finally { h.dispose() }
})

test('a failed list refresh after confirmed creation never replays the saved question', async () => {
  const h = harness()
  try {
    await h.start(); h.input('Rubrik', 'Sparad fråga'); h.input('Fråga', 'Underlag'); await h.click('Spara och skapa nästa'); h.failRefresh(); await h.reply(0)
    assert.match(h.text(), /Frågan är sparad/)
    assert.match(h.text(), /Listan kunde inte hämtas/)
    assert.equal(h.field('Rubrik').props.value, '')
    assert.equal(h.requests.length, 1)
  } finally { h.dispose() }
})

test('an unexpected mutation response preserves the current question instead of clearing it', async () => {
  const h = harness()
  try {
    await h.start(); h.input('Rubrik', 'Behåll denna'); h.input('Fråga', 'Underlag'); await h.click('Spara och skapa nästa'); await h.reply(0, null, id(99))
    assert.equal(h.field('Rubrik').props.value, 'Behåll denna')
    assert.match(h.text(), /Sparningen kunde inte bekräftas/)
  } finally { h.dispose() }
})

test('question dispatch needs only the deadline; clearing an incomplete optional follow-up enables sending again', async () => {
  const h = harness()
  try {
    h.workspace.questions.push({ id: id(61), number: 14, revision: 1, body: { ...emptyQuestion(), title: 'Deadline only', description: 'Fiktiv fråga', assignee: h.customer }, createdAt: '2026-11-05T10:00:00Z', updatedAt: '2026-11-05T10:00:00Z', events: [], tasks: [], participants: [] })
    await h.click('Hämta sparade frågor och svar')
    h.nodes().find(n => n.props?.className === 'gizmo-question-open').props.onClick(); h.render()
    h.nodes().find(n => n.type === 'summary' && content(n).startsWith('Skicka till ansvarig')).props.onClick({ preventDefault() {} }); await tick(); h.render()
    h.input('Svar senast', '2026-11-19')
    const confirmation = h.nodes().find(n => n.type === 'label' && content(n).startsWith('Jag har granskat mottagaren'))
    nodes(confirmation).find(n => n.type === 'input').props.onChange({ target: { checked: true } }); h.render()
    assert.equal(h.field('Första uppföljning').props.required, undefined)
    assert.equal(h.field('Klockslag för uppföljning').props.disabled, true)
    assert.equal(h.button('Skicka uppgift').props.disabled, false)
    h.input('Första uppföljning', '2026-11-17'); h.input('Klockslag för uppföljning', '')
    assert.equal(h.button('Skicka uppgift').props.disabled, true)
    h.input('Första uppföljning', '')
    assert.equal(h.button('Skicka uppgift').props.disabled, false)
    await h.click('Skicka uppgift')
    assert.equal(h.requests.length, 1); assert.equal(h.requests[0].body.followupAt, null)
    assert.ok(h.requests[0].body.dueAt); assert.equal(h.requests[0].body.confirmed, true)
    await h.reply(0)
  } finally { h.dispose() }
})
