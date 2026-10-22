import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import * as helpers from '../src/lib/action-cases/purchaseListPrint.ts'

const source = readFileSync(new URL('../src/components/tasks/ActionCasePurchaseList.tsx', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText

function harness() {
  const lines = [{ id: 'one', category: 'material', description: 'Isolering', quantity: 24, unit: 'm2', unitCost: 89 }]
  const slots = []; let cursor = 0, tree, closed = 0, printed = 0, fail = false
  const slot = initial => { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial; return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value }] }
  const dependencies = {
    react: { useState: slot, useRef: value => slot({ current: value })[0], useId: () => 'list', useEffect: () => {} },
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) },
    'lucide-react': new Proxy({}, { get: (_, key) => `icon:${String(key)}` }),
    '@/lib/action-cases/purchaseListPrint': { ...helpers, printPurchaseList: async () => { printed++; if (fail) throw new Error('Test: popup blockerad') } },
    './action-case-purchase-list.css': {},
  }
  const mod = { exports: {} }
  new Function('require', 'module', 'exports', compiled)(name => dependencies[name], mod, mod.exports)
  const render = () => { cursor = 0; tree = mod.exports.default({ lines, workTitle: 'Grund', onClose: () => closed++ }) }
  const nodes = () => { const result = []; const visit = n => { if (Array.isArray(n)) return n.forEach(visit); if (!n || typeof n !== 'object') return; result.push(n); visit(n.props?.children) }; visit(tree); return result }
  const find = predicate => { const n = nodes().find(predicate); assert.ok(n); return n }
  const field = label => find(n => n.props['aria-label'] === label)
  const change = (label, value) => { field(label).props.onChange({ target: { value } }); render() }
  const print = () => find(n => n.type === 'button' && n.props.children?.includes?.('Skriv ut'))
  render()
  return { render, nodes, field, change, print, find, lines, fail: () => { fail = true }, get tree() { return tree }, get closed() { return closed }, get printed() { return printed } }
}

test('list edits and removals never mutate calculator rows', () => {
  const h = harness(), before = structuredClone(h.lines)
  h.change('Mängd, rad 1', '30')
  h.change('Produkt, rad 1', 'Ny listtext')
  h.change('Notering, rad 1', 'Levereras i paket')
  h.find(n => n.props['aria-label'] === 'Ta bort rad 1 från beställningslistan').props.onClick(); h.render()
  assert.equal(h.print().props.disabled, true)
  assert.deepEqual(h.lines, before)
})

test('changing list units clears list unit price, not the original cost', () => {
  const h = harness()
  h.find(n => n.type === 'input' && n.props.type === 'checkbox').props.onChange({ target: { checked: true } }); h.render()
  assert.equal(h.field('Inköpspris exkl. moms, rad 1').props.value, '89')
  h.change('Enhet, rad 1', 'paket')
  assert.equal(h.field('Inköpspris exkl. moms, rad 1').props.value, '')
  assert.equal(h.lines[0].unitCost, 89)
  assert.equal(h.lines[0].unit, 'm2')
})

test('cancel and Escape preserve modified list unless explicitly discarded', () => {
  const h = harness(); h.change('Mängd, rad 1', '30')
  let prevented = 0, stopped = 0
  const event = { preventDefault: () => prevented++, stopPropagation: () => stopped++ }
  h.tree.props.onCancel(event); h.render()
  assert.equal(h.closed, 0)
  assert.equal(prevented, 1); assert.equal(stopped, 1)
  h.tree.props.onKeyDown(event)
  assert.equal(stopped, 2, 'Never bubble Escape to the calculator sheet')
  assert.equal(h.field('Mängd, rad 1').props.value, '30')
  h.find(n => n.type === 'button' && n.props.children === 'Fortsätt redigera').props.onClick(); h.render()
  assert.equal(h.print().props.disabled, false)
  h.tree.props.onCancel(event); h.render()
  h.find(n => n.type === 'button' && n.props.children === 'Stäng listan').props.onClick()
  assert.equal(h.closed, 1)
})

test('print errors leave the form editable and retryable without duplicate writes', async () => {
  const h = harness(); h.change('Mängd, rad 1', '30'); h.fail()
  h.print().props.onClick(); h.render()
  assert.equal(h.print().props.disabled, true)
  await new Promise(resolve => setImmediate(resolve)); h.render()
  assert.equal(h.print().props.disabled, false)
  assert.equal(h.find(n => n.props.role === 'alert').props.children, 'Test: popup blockerad')
  assert.equal(h.field('Mängd, rad 1').props.value, '30')
  assert.equal(h.printed, 1)
  assert.equal(h.lines[0].quantity, 24)
})
