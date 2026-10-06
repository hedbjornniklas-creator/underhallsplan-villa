import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { actionScopeDraft } from '../src/lib/action-cases/scopeDraft.ts'

const source = readFileSync(new URL('../src/components/tasks/ActionCaseItemSheet.tsx', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText

// Render the actual sheet's handlers with persistent hook storage. Child editors
// and unrelated pricing services are boundaries; no browser or HTTP is simulated.
function sheetHarness(overrides = {}) {
  const slots = []
  let cursor = 0, tree, closes = 0, flushes = 0, confirmations = 0, accept = false
  const slot = (initial) => {
    const index = cursor++
    if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial
    return [slots[index], (value) => { slots[index] = typeof value === 'function' ? value(slots[index]) : value }]
  }
  const dependencies = {
    react: { useState: slot, useRef: (value) => slot({ current: value })[0], useId: () => 'sheet', useEffect: () => {} },
    'react-dom': { createPortal: (children) => children },
    'react/jsx-runtime': { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }), Fragment: 'fragment' },
    'lucide-react': new Proxy({}, { get: (_, key) => `icon:${String(key)}` }),
    '@/lib/action-cases/domain': { calculateActionCaseCostTotals: () => ({ internalCost: null, customerPrice: null }), actionCaseCostCoverage: () => ({ knownTotals: { internalCost: null } }) },
    '@/lib/action-cases/costing': {},
    '@/lib/action-cases/scopeAttachments': { scopeAttachmentIds: () => [] },
    '@/lib/action-cases/scopeDraft': { actionScopeDraft },
    './actionCaseGroupPricing': {},
    './ActionCaseWorkParts': { ActionCaseWorkParts: 'WorkParts', ActionCaseWorkSelection: 'WorkSelection', UNASSIGNED_WORK: 'unassigned' },
  }
  for (const name of ['ActionCaseWorkQuotes', 'ActionCaseAttachmentPicker', 'ActionCaseLumpSumEditor', 'ActionCaseDirectCostFields']) dependencies[`./${name}`] = { default: name }
  const module = { exports: {} }
  new Function('require', 'module', 'exports', 'document', 'window', compiled)(
    (name) => { if (!(name in dependencies)) throw new Error(name); return dependencies[name] }, module, module.exports, { body: {} },
    { confirm: () => { confirmations++; return accept } },
  )
  const props = {
    item: { id: 'test', title: 'Grund', scope: 'Arbete', scopeNotesAvailable: true, lumpSumAvailable: true, costLines: [], status: 'pricing_needed' },
    busy: false, scopeBlocked: false,
    onClose: () => { closes++ }, onScopeFlush: () => { flushes++ },
    ...overrides,
  }
  const render = () => { cursor = 0; tree = module.exports.default(props) }
  const nodes = () => {
    const result = []
    const visit = (node) => {
      if (Array.isArray(node)) { node.forEach(visit); return }
      if (!node || typeof node !== 'object') return
      result.push(node); visit(node.props?.children)
    }
    visit(tree); return result
  }
  const find = (predicate) => { const node = nodes().find(predicate); assert.ok(node, 'Element is rendered'); return node }
  const backdropEvent = (inside = false) => ({ currentTarget: tree, target: inside ? {} : tree, button: 0 })
  render()
  return {
    find, nodes, render, props,
    tab: (name) => find((node) => node.props.role === 'tab' && node.props.children.includes(name)),
    pointerDown: (inside = false) => tree.props.onPointerDown(backdropEvent(inside)),
    pointerCancel: () => tree.props.onPointerCancel(),
    clickBackdrop: (inside = false) => tree.props.onClick(backdropEvent(inside)),
    allowDiscard: () => { accept = true },
    get result() { return { closes, flushes, confirmations } },
  }
}

test('register tabs replace the duplicate CTA and open calculation during background scope saving', () => {
  const h = sheetHarness({ scopeBlocked: true, scopeSave: { status: 'saving', draft: { title: 'Grund', scope: 'Ny text', scopeAttachmentIds: [] } } })
  assert.equal(h.tab('Omfattning').props['aria-selected'], true)
  assert.equal(h.tab('Omfattning').props.tabIndex, 0)
  assert.equal(h.tab('Kalkyl').props.tabIndex, -1)
  assert.equal(h.tab('Kalkyl').props.disabled, false)
  assert.doesNotMatch(source, /Gå till kalkyl/)
  h.tab('Kalkyl').props.onClick(); h.render()
  assert.equal(h.result.flushes, 1)
  assert.equal(h.tab('Kalkyl').props['aria-selected'], true)
  const panel = h.find((node) => node.props.role === 'tabpanel')
  assert.equal(panel.props['aria-labelledby'], h.tab('Kalkyl').props.id)
  assert.equal(panel.props.id, h.tab('Kalkyl').props['aria-controls'])
  h.pointerDown(); h.clickBackdrop()
  assert.equal(h.result.closes, 1, 'Parent owns the background save after unmount')
})

test('optional conditions sit between scope and exclusions and use the parent autosave draft', () => {
  const changes = [], h = sheetHarness({ onScopeChange: (draft) => changes.push(draft) })
  h.props.item.scopeConditionsAvailable = true
  h.props.item.scopeConditions = 'Befintlig text'
  h.render()
  const labels = h.nodes().filter((node) => node.type === 'label').map((node) => node.props.children[0])
  assert.equal(labels[labels.indexOf('Arbetets omfattning') + 1], 'Förutsättningar (valfritt)')
  assert.equal(labels[labels.indexOf('Förutsättningar (valfritt)') + 1], 'Ingår inte (valfritt)')
  const input = h.find((node) => node.type === 'textarea' && node.props.value === 'Befintlig text')
  assert.equal(input.props.disabled, false)
  assert.equal(input.props.maxLength, 6000)
  input.props.onChange({ target: { value: 'Nytt villkor' } })
  assert.equal(changes[0].scopeConditions, 'Nytt villkor')
  assert.equal(changes[0].scope, 'Arbete')
})

test('only a complete backdrop click closes, not clicks or selections that start inside', () => {
  const h = sheetHarness()
  h.pointerDown(true); h.clickBackdrop(true)
  h.pointerDown(true); h.clickBackdrop()
  h.pointerDown(); h.clickBackdrop(true)
  h.pointerDown(); h.pointerCancel(); h.clickBackdrop()
  h.clickBackdrop()
  assert.equal(h.result.closes, 0)
  h.pointerDown(); h.clickBackdrop()
  assert.equal(h.result.closes, 1)
})

test('pending mutations block backdrop close and switching tabs', () => {
  const h = sheetHarness({ busy: true })
  h.pointerDown(); h.clickBackdrop()
  h.tab('Kalkyl').props.onClick(); h.render()
  assert.equal(h.result.closes, 0)
  assert.equal(h.result.flushes, 0)
  assert.equal(h.tab('Omfattning').props['aria-selected'], true)
  assert.equal(h.tab('Kalkyl').props.disabled, true)
})

test('backdrop, Escape and close button preserve the unsaved calculation confirmation', () => {
  const h = sheetHarness({ initialCostLineId: 'cost' })
  h.find((node) => node.type === 'ActionCaseLumpSumEditor').props.onDirty(true); h.render()
  assert.equal(h.tab('Omfattning').props.disabled, true)
  h.pointerDown(); h.clickBackdrop()
  h.find((node) => node.props['aria-label'] === 'Stäng åtgärd').props.onClick()
  h.find((node) => node.props.role === 'dialog').props.onKeyDown({ key: 'Escape', preventDefault() {} })
  assert.deepEqual(h.result, { closes: 0, flushes: 0, confirmations: 3 })
  h.allowDiscard(); h.pointerDown(); h.clickBackdrop()
  assert.deepEqual(h.result, { closes: 1, flushes: 0, confirmations: 4 })
})
