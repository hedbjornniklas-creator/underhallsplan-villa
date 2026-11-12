import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { emptyQuestion, questionAssigneeOptions, questionStatuses } from '../src/lib/action-cases/projectQuestions.ts'
import * as questionModel from '../src/lib/action-cases/projectQuestions.ts'
import { taskDateTimeInputToIso } from '../src/lib/tasks/dateTime.ts'

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const content = node => typeof node === 'string' ? node : Array.isArray(node) ? node.map(content).join('') : node?.props ? content(node.props.children) : ''
function nodes(tree) { return !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(tree.props?.children)] }
const tick = () => new Promise(resolve => setImmediate(resolve))

function harness() {
  const states = [], refs = [], requests = [], reads = []
  let stateIndex = 0, refIndex = 0, tree, failRefresh = false, deferReads = false
  const customer = { id: id(2), kind: 'customer', name: 'Testbeställare', email: 'test@example.invalid' }
  const workspace = { questions: [], assignees: [customer], customersAvailable: true, userId: id(9), managerId: id(9), canManageParticipants: true }
  const original = { fetch: globalThis.fetch, document: globalThis.document, raf: globalThis.requestAnimationFrame, storage: globalThis.localStorage }
  const storage = new Map()
  globalThis.localStorage = { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) }
  globalThis.document = { body: {}, activeElement: null }
  globalThis.requestAnimationFrame = fn => fn()
  globalThis.fetch = async (_url, options) => {
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
    react, 'react-dom': { createPortal: node => node }, 'lucide-react': {}, '@/lib/supabaseClient': {}, './project-questions.css': {},
    '@/lib/tasks/dateTime': { taskDateTimeInputToIso, formatTaskDateTime: value => value },
    '@/lib/action-cases/projectQuestions': questionModel,
    './QuestionDialogue': { default: () => null },
    './QuestionDiaryImagePicker': { default: () => null },
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
  const render = () => { stateIndex = 0; refIndex = 0; tree = module.exports.default({ caseId: id(1), active: true, files: [], onFiles() {}, onDirty() {} }); return tree }
  const button = name => { const b = nodes(tree).find(n => n.type === 'button' && (content(n) === name || n.props['aria-label'] === name)); assert.ok(b, name); return b }
  const field = label => { const n = nodes(tree).find(n => n.type === 'label' && content(n).startsWith(label)); assert.ok(n, label); return nodes(n).find(child => ['input', 'textarea', 'select'].includes(child.type)) }
  render()
  return { requests, reads, customer, workspace, render, button, field, nodes: () => nodes(tree), text: () => content(tree),
    async click(name) { button(name).props.onClick(); await tick(); render() },
    input(label, value) { field(label).props.onChange({ target: { value } }); render() },
    async start() { button('Hämta sparade frågor och svar').props.onClick(); await tick(); render(); button('Ny fråga').props.onClick(); render() },
    async reply(index, error, questionId) {
      const request = requests[index].body
      if (!error && (!questionId || questionId === request.questionId)) {
        let question = workspace.questions.find(q => q.id === request.questionId)
        if (!question) { question = { id: request.questionId, number: workspace.questions.length + 1, events: [], tasks: [], participants: [], createdAt: new Date().toISOString() }; workspace.questions.push(question) }
        Object.assign(question, { body: request.body, revision: request.revision + 1, updatedAt: new Date().toISOString() })
      }
      requests[index].resolve({ ok: !error, json: async () => error ? { error } : { questionId: questionId || request.questionId } }); await tick(); render()
    },
    failRefresh() { failRefresh = true },
    deferReads() { deferReads = true },
    async read(index) { reads[index].resolve({ ok: true, json: async () => reads[index].body }); await tick(); render() },
    dispose() { globalThis.fetch = original.fetch; globalThis.document = original.document; globalThis.requestAnimationFrame = original.raf; globalThis.localStorage = original.storage }
  }
}

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
