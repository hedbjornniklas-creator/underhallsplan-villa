import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { choiceOfferForEditing } from '../src/lib/action-cases/choiceOffer.ts'

const source = readFileSync(new URL('../src/components/tasks/CustomerChoiceOptionSheet.tsx', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText

function harness(overrides = {}) {
  const slots = [], changes = [], document = { body: {}, activeElement: null }
  let cursor = 0, tree
  const slot = initial => {
    const index = cursor++
    if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial
    return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value }]
  }
  const dependencies = {
    react: { useState: slot, useRef: value => slot({ current: value })[0], useId: () => 'choice-sheet', useEffect() {} },
    'react-dom': { createPortal: children => children },
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }), Fragment: 'fragment' },
    'lucide-react': new Proxy({}, { get: (_, key) => `icon:${String(key)}` }),
    '@/lib/supabaseClient': { supabase: {} },
    '@/lib/action-cases/choiceOffer': { choiceOfferForEditing },
  }
  for (const name of ['CustomerOfferPriceInput', 'CustomerChoiceCostTable', 'CustomerPlanningSaveStatus', 'CustomerChoicePriceTime']) dependencies[`./${name}`] = { default: name }
  const mod = { exports: {} }
  new Function('require', 'module', 'exports', 'document', compiled)(name => { assert.ok(name in dependencies, name); return dependencies[name] }, mod, mod.exports, document)
  const props = {
    caseId: 'project', revision: 1, offerAvailable: true,
    option: { id: 'option', title: 'Fiktivt fonster', scope: 'Befintlig omfattning', status: 'planned', budgetOre: 100000 },
    categories: [{ id: 'windows', title: 'Fonster', optionIds: ['option'] }], files: [], references: [],
    filesAvailable: true, costingAvailable: true, rowCostingAvailable: true,
    busy: false, saving: false, saveError: false,
    ...Object.fromEntries(['onRetry', 'onChange', 'onMove', 'onReferences', 'onFiles', 'onCosting', 'onRemove', 'onClose'].map(name => [name, (...args) => changes.push([name, ...args])])),
    ...overrides,
  }
  const render = () => { cursor = 0; tree = mod.exports.default(props) }
  const nodes = () => {
    const result = []
    const visit = node => {
      if (Array.isArray(node)) return node.forEach(visit)
      if (!node || typeof node !== 'object') return
      result.push(node); visit(node.props?.children)
    }
    visit(tree); return result
  }
  const find = predicate => { const node = nodes().find(predicate); assert.ok(node, 'Element is rendered'); return node }
  render()
  return { props, document, changes, nodes, find, render, tab: name => find(node => node.props.role === 'tab' && node.props.children.includes(name)) }
}

test('choice tabs reuse the work sheet register styling, icons and accessible panel links', () => {
  const h = harness(), before = structuredClone(h.props.option)
  assert.equal(h.find(node => node.props.role === 'tablist').props.className, 'gizmo-register-tabs gizmo-choice-tabs')
  for (const [name, icon, child] of [['Omfattning', 'ClipboardList', null], ['Kalkyl', 'Calculator', 'CustomerChoiceCostTable'], ['Pris och tid', 'Banknote', 'CustomerChoicePriceTime']]) {
    const tab = h.tab(name)
    assert.equal(tab.props.className, 'gizmo-register-tab')
    assert.equal(tab.props.children[0].type, `icon:${icon}`)
    assert.equal(tab.props.children[0].props['aria-hidden'], 'true')
    tab.props.onClick(); h.render()
    assert.equal(h.tab(name).props['aria-selected'], true)
    assert.equal(h.tab(name).props.tabIndex, 0)
    assert.equal(h.nodes().filter(node => node.props.role === 'tab' && node.props.tabIndex === 0).length, 1)
    const panel = h.find(node => node.props.role === 'tabpanel')
    assert.equal(panel.props['aria-labelledby'], h.tab(name).props.id)
    assert.equal(panel.props.id, h.tab(name).props['aria-controls'])
    if (child) assert.ok(h.nodes().some(node => node.type === child))
  }
  assert.deepEqual(h.props.option, before)
  assert.deepEqual(h.changes, [], 'Tab navigation must not save prices, scope, files or contracts')
})

test('choice tabs support arrows, Home and End without intercepting normal Tab navigation', () => {
  const h = harness(), names = ['Omfattning', 'Kalkyl', 'Pris och tid']
  const controls = names.map(name => ({ focus() { h.document.activeElement = this }, click() { h.tab(name).props.onClick(); h.render() } }))
  h.document.activeElement = controls[0]
  let prevented = 0
  const press = key => h.find(node => node.props.role === 'tablist').props.onKeyDown({ key, preventDefault() { prevented++ }, currentTarget: { querySelectorAll: () => controls } })
  for (const [key, selected] of [['ArrowRight', 1], ['ArrowRight', 2], ['ArrowRight', 0], ['ArrowLeft', 2], ['Home', 0], ['End', 2]]) {
    press(key)
    assert.equal(h.document.activeElement, controls[selected])
    assert.equal(h.tab(names[selected]).props['aria-selected'], true)
  }
  assert.equal(prevented, 6)
  press('Tab')
  assert.equal(prevented, 6)
  assert.deepEqual(h.changes, [])
})

test('busy sheets keep tabs disabled and pre-migration sheets do not reference missing tabs', () => {
  const busy = harness({ busy: true })
  assert.ok(busy.nodes().filter(node => node.props.role === 'tab').every(node => node.props.disabled))
  busy.find(node => node.props.role === 'tablist').props.onKeyDown({ key: 'ArrowRight', preventDefault() {}, currentTarget: { querySelectorAll: () => [] } })
  assert.equal(busy.tab('Omfattning').props['aria-selected'], true)
  const legacy = harness({ offerAvailable: false })
  assert.ok(!legacy.nodes().some(node => node.props.role === 'tablist' || node.props.role === 'tab' || node.props.role === 'tabpanel'))
  assert.ok(legacy.nodes().some(node => node.type === 'CustomerChoiceCostTable'))
  assert.deepEqual(legacy.changes, [])
})
