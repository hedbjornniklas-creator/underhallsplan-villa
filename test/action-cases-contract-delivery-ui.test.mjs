import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const source = readFileSync(new URL('../src/components/tasks/CustomerContractDelivery.tsx', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText

function harness(overrides = {}, result = true) {
  const slots = [], actions = []
  let cursor = 0, tree, picks = 0
  const slot = initial => {
    const index = cursor++
    if (!(index in slots)) slots[index] = initial
    return [slots[index], value => { slots[index] = value }]
  }
  const deps = {
    react: { useState: slot, useRef: value => slot({ current: value })[0] },
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }), Fragment: 'fragment' },
    'lucide-react': new Proxy({}, { get: (_, key) => `icon:${String(key)}` }),
  }
  const mod = { exports: {} }
  new Function('require', 'module', 'exports', compiled)(name => { assert.ok(name in deps, name); return deps[name] }, mod, mod.exports)
  const props = { caseId: 'test-case', version: { id: 'locked-version', version: 3, delivery: null }, available: true, disabled: false, busy: '', customerUrl: '',
    onAction: async (...args) => { actions.push(args); return result }, ...overrides }
  const render = () => { cursor = 0; tree = mod.exports.default(props) }
  const nodes = () => {
    const found = []
    const visit = node => { if (Array.isArray(node)) return node.forEach(visit); if (!node || typeof node !== 'object') return; found.push(node); visit(node.props?.children) }
    visit(tree); return found
  }
  const find = predicate => { const node = nodes().find(predicate); assert.ok(node, 'Element is rendered'); return node }
  const label = node => (Array.isArray(node.props.children) ? node.props.children : [node.props.children]).filter(child => typeof child === 'string').join('').trim()
  const button = name => find(node => node.type === 'button' && label(node) === name)
  const input = () => find(node => node.type === 'input' && node.props.type === 'file')
  const checkbox = () => find(node => node.type === 'input' && node.props.type === 'checkbox')
  const select = file => { input().props.onChange({ target: { files: file ? [file] : [] } }); render() }
  const check = value => { checkbox().props.onChange({ target: { checked: value } }); render() }
  render()
  if (nodes().some(node => node.type === 'input' && node.props.type === 'file')) input().props.ref.current = { click() { picks++ } }
  return { props, actions, nodes, find, render, button, input, checkbox, select, check, get picks() { return picks } }
}

test('signed copy has a styled keyboard-accessible picker and file status without saving on selection', () => {
  const h = harness(), before = structuredClone(h.props.version)
  const picker = h.button('Välj signerad PDF')
  assert.equal(picker.props.type, 'button')
  assert.match(picker.props.className, /gizmo-button/)
  assert.equal(picker.props.disabled, false)
  assert.equal(h.input().props.accept, 'application/pdf,.pdf')
  assert.equal(h.input().props['aria-label'], 'Välj signerad PDF-fil')
  assert.equal(h.input().props.className, 'hidden')
  assert.equal(h.find(node => node.props.role === 'status').props.children, 'Ingen PDF vald.')
  picker.props.onClick()
  assert.equal(h.picks, 1)
  const file = new File(['%PDF-test'], 'Fiktivt underskrivet avtal.pdf', { type: 'application/pdf' })
  h.select(file)
  assert.equal(h.find(node => node.props.role === 'status').props.children, file.name)
  assert.equal(h.button('Registrera underskriven kopia').props.disabled, true)
  assert.deepEqual(h.actions, [])
  assert.deepEqual(h.props.version, before)
})

test('registration still requires a chosen file and manual confirmation for that exact locked version', async () => {
  const h = harness(), before = structuredClone(h.props.version)
  h.check(true)
  assert.equal(h.button('Registrera underskriven kopia').props.disabled, true)
  const file = new File(['%PDF-test'], 'Fiktivt-avtal.pdf', { type: 'application/pdf' })
  h.select(file)
  assert.equal(h.checkbox().props.checked, false)
  h.check(true)
  assert.equal(h.button('Registrera underskriven kopia').props.disabled, false)
  await h.button('Registrera underskriven kopia').props.onClick()
  h.render()
  assert.deepEqual(h.actions, [['upload_signed', { id: 'locked-version', file, confirmed: true }]])
  assert.equal(h.find(node => node.props.role === 'status').props.children, 'Ingen PDF vald.')
  assert.equal(h.checkbox().props.checked, false)
  assert.deepEqual(h.props.version, before)
})

test('replacing or clearing a file resets confirmation and failed registration retains the selection', async () => {
  const h = harness({}, false), file = new File(['%PDF-test'], 'Fiktivt-avtal.pdf', { type: 'application/pdf' })
  h.select(file); h.check(true)
  await h.button('Registrera underskriven kopia').props.onClick(); h.render()
  assert.equal(h.find(node => node.props.role === 'status').props.children, file.name)
  assert.equal(h.checkbox().props.checked, true)
  h.select(new File(['%PDF-other'], 'Annan-kopia.pdf', { type: 'application/pdf' }))
  assert.equal(h.checkbox().props.checked, false)
  h.check(true); h.select(null)
  assert.equal(h.checkbox().props.checked, false)
  assert.equal(h.button('Registrera underskriven kopia').props.disabled, true)
})

test('busy controls stay disabled and registered copies expose no picker or registration action', () => {
  const busy = harness({ disabled: true, busy: 'upload_signed' })
  assert.equal(busy.button('Välj signerad PDF').props.disabled, true)
  assert.equal(busy.input().props.disabled, true)
  assert.equal(busy.checkbox().props.disabled, true)
  const signed = harness({ version: { id: 'locked-version', version: 3, delivery: { signedCopy: { registeredAt: '2026-11-06T10:00:00Z' } } } })
  assert.ok(!signed.nodes().some(node => node.type === 'input' && node.props.type === 'file'))
  assert.ok(signed.nodes().some(node => node.type === 'a' && node.props.href.endsWith('/locked-version/signed')))
  assert.deepEqual(signed.actions, [])
  const unavailable = harness({ available: false })
  assert.ok(!unavailable.nodes().some(node => node.type === 'input' || node.type === 'button'))
})
