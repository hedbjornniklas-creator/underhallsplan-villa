import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { emptyQuestion, questionAssigneeOptions, questionStatuses } from '../src/lib/action-cases/projectQuestions.ts'

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const content = node => typeof node === 'string' ? node : Array.isArray(node) ? node.map(content).join('') : node?.props ? content(node.props.children) : ''
function nodes(tree) { return !tree || typeof tree !== 'object' ? [] : Array.isArray(tree) ? tree.flatMap(nodes) : [tree, ...nodes(tree.props?.children)] }
const tick = () => new Promise(resolve => setImmediate(resolve))

function harness() {
  const states = [], refs = [], requests = []
  let stateIndex = 0, refIndex = 0, tree, failRefresh = false
  const customer = { id: id(2), kind: 'customer', name: 'Testbeställare', email: 'test@example.invalid' }
  const workspace = { questions: [], assignees: [customer], customersAvailable: true, userId: id(9), managerId: id(9), canManageParticipants: true }
  const original = { fetch: globalThis.fetch, document: globalThis.document, raf: globalThis.requestAnimationFrame, storage: globalThis.localStorage }
  const storage = new Map()
  globalThis.localStorage = { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) }
  globalThis.document = { body: {}, activeElement: null }
  globalThis.requestAnimationFrame = fn => fn()
  globalThis.fetch = async (_url, options) => {
    if (!options?.method) return { ok: !failRefresh, json: async () => failRefresh ? { error: 'Listan kunde inte hämtas.' } : workspace }
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
    '@/lib/tasks/dateTime': { taskDateTimeInputToIso: () => null, formatTaskDateTime: value => value },
    '@/lib/action-cases/projectQuestions': { emptyQuestion, questionAssigneeOptions, questionStatuses },
    './QuestionDialogue': { default: () => null },
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
  return { requests, customer, workspace, render, button, field, nodes: () => nodes(tree), text: () => content(tree),
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
