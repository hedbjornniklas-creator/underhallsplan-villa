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
  const workspace = { questions: [], assignees: [customer], customersAvailable: true }
  const original = { fetch: globalThis.fetch, document: globalThis.document, raf: globalThis.requestAnimationFrame }
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
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) }
  }
  const code = ts.transpileModule(readFileSync(new URL('../src/components/tasks/ProjectQuestions.tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
  const module = { exports: {} }
  new Function('require', 'module', 'exports', code)(name => { assert.ok(name in dependencies, name); return dependencies[name] }, module, module.exports)
  const render = () => { stateIndex = 0; refIndex = 0; tree = module.exports.default({ caseId: id(1), active: true, files: [], onFiles() {}, onDirty() {} }); return tree }
  const button = name => { const b = nodes(tree).find(n => n.type === 'button' && (content(n) === name || n.props['aria-label'] === name)); assert.ok(b, name); return b }
  const field = label => { const n = nodes(tree).find(n => n.type === 'label' && content(n).startsWith(label)); assert.ok(n, label); return nodes(n).find(child => ['input', 'textarea', 'select'].includes(child.type)) }
  render()
  return { requests, customer, render, button, field, text: () => content(tree),
    click(name) { button(name).props.onClick(); render() },
    input(label, value) { field(label).props.onChange({ target: { value } }); render() },
    async start() { button('Hämta sparade frågor och svar').props.onClick(); await tick(); render(); button('Ny fråga').props.onClick(); render() },
    async reply(index, error, questionId) { requests[index].resolve({ ok: !error, json: async () => error ? { error } : { questionId: questionId || requests[index].body.questionId } }); await tick(); render() },
    failRefresh() { failRefresh = true },
    dispose() { globalThis.fetch = original.fetch; globalThis.document = original.document; globalThis.requestAnimationFrame = original.raf }
  }
}

test('save and create next keeps text on failure, reuses retry identity and opens a clean question only after acknowledgement', async () => {
  const h = harness()
  try {
    await h.start(); h.input('Rubrik', 'Första frågan'); h.input('Fråga', 'Ett fiktivt underlag'); h.input('Ansvarig', `customer:${h.customer.id}`)
    h.click('Spara och skapa nästa')
    const first = h.requests[0].body
    assert.equal(first.operation, 'create'); assert.equal(first.body.assignee.kind, 'customer')
    assert.equal(h.button('Spara och skapa nästa').props.disabled, true)
    h.button('Spara och skapa nästa').props.onClick()
    assert.equal(h.requests.length, 1)
    await h.reply(0, 'Tillfälligt fel')
    assert.equal(h.field('Rubrik').props.value, 'Första frågan')
    h.click('Spara och skapa nästa')
    assert.equal(h.requests[1].body.requestId, first.requestId)
    await h.reply(1)
    assert.equal(h.field('Rubrik').props.value, '')
    assert.equal(h.field('Fråga').props.value, '')
    assert.equal(h.field('Ansvarig').props.value, '')
    assert.equal(h.button('Spara och skapa nästa').props.disabled, true)
    assert.match(h.text(), /Frågan är sparad/)
    h.input('Rubrik', 'Andra frågan'); h.input('Fråga', 'Ett annat underlag'); h.click('Spara och skapa nästa')
    assert.notEqual(h.requests[2].body.questionId, first.questionId)
    assert.notEqual(h.requests[2].body.requestId, first.requestId)
    assert.deepEqual(h.requests[2].body.fileIds, [])
    assert.equal(h.requests[2].body.body.assignee, null)
    await h.reply(2)
  } finally { h.dispose() }
})

test('a failed list refresh after confirmed creation never replays the saved question', async () => {
  const h = harness()
  try {
    await h.start(); h.input('Rubrik', 'Sparad fråga'); h.input('Fråga', 'Underlag'); h.click('Spara och skapa nästa'); h.failRefresh(); await h.reply(0)
    assert.match(h.text(), /Frågan är sparad/)
    assert.match(h.text(), /Listan kunde inte hämtas/)
    assert.equal(h.field('Rubrik').props.value, '')
    assert.equal(h.requests.length, 1)
  } finally { h.dispose() }
})

test('an unexpected mutation response preserves the current question instead of clearing it', async () => {
  const h = harness()
  try {
    await h.start(); h.input('Rubrik', 'Behåll denna'); h.input('Fråga', 'Underlag'); h.click('Spara och skapa nästa'); await h.reply(0, null, id(99))
    assert.equal(h.field('Rubrik').props.value, 'Behåll denna')
    assert.match(h.text(), /Sparningen kunde inte bekräftas/)
  } finally { h.dispose() }
})
