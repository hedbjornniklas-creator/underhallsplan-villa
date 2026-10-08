import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const parts = () => ['Mark', 'Tak', 'Målning'].map((title, index) => ({
  id: `part-${index}`, title, kind: index === 2 ? 'excluded' : 'included',
  scope: `Omfattning ${title}`, scopeConditions: 'Förutsättning',
  scopeExclusions: 'Ingår inte', scopeAdvice: 'Avrådan', amountOre: index === 2 ? null : (index + 1) * 100000,
}))
const flatten = (node) => !node || typeof node !== 'object' ? [] : Array.isArray(node)
  ? node.flatMap(flatten) : [node, ...flatten(node.props?.children)]
const text = (node) => node == null || typeof node === 'boolean' ? '' : Array.isArray(node)
  ? node.map(text).join('') : typeof node === 'object' ? text(node.props?.children) : String(node)

function setup(overrides = {}) {
  const hooks = [], writes = [], messages = []
  let cursor = 0, tree
  const jsx = (type, props) => ({ type, props })
  const loaded = { exports: {} }
  const source = readFileSync(new URL('../src/components/tasks/CustomerContractWorkParts.tsx', import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022,
  } }).outputText
  new Function('require', 'module', 'exports', compiled)((name) => {
    if (name === 'react') return { useState: (initial) => {
      const slot = cursor++
      if (!(slot in hooks)) hooks[slot] = initial
      return [hooks[slot], (value) => { hooks[slot] = typeof value === 'function' ? value(hooks[slot]) : value }]
    } }
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx }
    if (name === 'lucide-react') return Object.fromEntries(['ArrowDown', 'ArrowUp', 'Download', 'Plus', 'Trash2', 'X'].map((key) => [key, 'svg']))
    if (name.endsWith('/customerOffers')) return { money: (value) => value === null ? 'Pris saknas' : `${value / 100} kr` }
    if (name.endsWith('/offerImport')) return { importableCustomerPrice: () => null }
    if (name.endsWith('/contractImport')) return { importContractParts: () => { throw Error('Import not expected in this test') } }
    if (name.endsWith('/AppToastProvider')) return { useToast: () => ({ success: (message) => messages.push(message) }) }
    if (name === './ProjectEditorRow') return 'editor-row'
    if (name === './CustomerOfferPriceInput') return 'price-input'
    throw Error(`Unexpected dependency: ${name}`)
  }, loaded, loaded.exports)
  const props = { items: parts(), projectItems: [{ id: 'source-1', title: 'Projekttext', scope: 'Text' }], offerItems: [],
    itemized: true, blocked: false, onChange: (items) => { writes.push(structuredClone(items)); props.items = items }, ...overrides }
  const render = () => { cursor = 0; tree = loaded.exports.default(props); return tree }
  const find = (type, name) => {
    const matches = flatten(tree).filter((node) => node.type === type && (node.props['aria-label'] ?? text(node)) === name)
    assert.equal(matches.length, 1, `${type} ${name}`)
    return matches[0].props
  }
  const click = (name) => { find('button', name).onClick(); render() }
  const select = (index, checked = true) => {
    const item = props.items[index]
    find('input', `Välj arbetsdel ${index + 1}: ${item.title || 'Ny arbetsdel'}`).onChange({ target: { checked } }); render()
  }
  const selectAll = (checked = true) => { find('input', 'Välj alla arbetsdelar').onChange({ target: { checked } }); render() }
  const changeKind = (value) => { find('select', 'Ändra Ingår som för valda arbetsdelar').onChange({ target: { value } }); render() }
  render()
  return { props, writes, messages, render, find, click, select, selectAll, changeKind, nodes: () => flatten(tree) }
}

test('checkbox selection is separate from expansion/import, supports partial/all/clear and never saves', () => {
  const h = setup()
  assert.equal(h.find('button', 'Ta bort valda arbetsdelar').disabled, true)
  h.select(0)
  assert.equal(text(h.nodes().find((node) => node.props.role === 'status')), '1 valda')
  assert.equal(h.nodes().filter((node) => node.type === 'editor-row' && node.props.open).length, 0)
  const input = {}
  h.find('input', 'Välj alla arbetsdelar').ref(input)
  assert.equal(input.indeterminate, true)
  h.click('Hämta från Projektarbete')
  assert.equal(h.nodes().filter((node) => node.type === 'input' && !node.props['aria-label']).every((node) => !node.props.checked), true)
  h.selectAll()
  assert.equal(h.find('input', 'Välj alla arbetsdelar').checked, true)
  h.select(1, false)
  assert.equal(h.find('input', 'Välj alla arbetsdelar').checked, false)
  h.click('Rensa markering')
  assert.equal(h.find('button', 'Ta bort valda arbetsdelar').disabled, true)
  assert.equal(h.writes.length, 0)
})

test('mass deletion requires confirmation, removes only captured selection and keeps remaining fields/order', () => {
  const h = setup(), original = structuredClone(h.props.items)
  h.select(0); h.select(2)
  h.click('Ta bort valda arbetsdelar')
  assert.equal(h.writes.length, 0)
  assert.equal(h.find('input', 'Välj alla arbetsdelar').disabled, true)
  h.select(1)
  h.click('Avbryt')
  assert.equal(h.writes.length, 0)
  h.click('Ta bort valda arbetsdelar')
  h.click('Ta bort från avtalet')
  assert.deepEqual(h.props.items, [original[1]])
  assert.equal(h.writes.length, 1)
  assert.equal(h.find('input', 'Välj alla arbetsdelar').checked, false)
  assert.equal(h.find('button', 'Ta bort valda arbetsdelar').disabled, true)
  assert.equal(h.messages.length, 1)
  assert.match(h.messages[0], /^2 arbetsdelar har tagits bort från avtalsutkastet\./)
})

test('select-all deletion works down to an empty draft without selecting stale removed IDs', () => {
  const h = setup()
  h.selectAll(); h.click('Ta bort valda arbetsdelar'); h.click('Ta bort från avtalet')
  assert.deepEqual(h.props.items, [])
  assert.equal(h.find('input', 'Välj alla arbetsdelar').disabled, true)
  assert.equal(h.find('button', 'Ta bort valda arbetsdelar').disabled, true)
  h.props.items = parts(); h.render()
  assert.equal(text(h.nodes().find((node) => node.props.role === 'status')), '0 valda')
})

test('bulk kind changes are confirmed, clear excluded prices and never overwrite texts/unselected rows', () => {
  const h = setup(), original = structuredClone(h.props.items)
  h.select(0); h.changeKind('excluded')
  assert.equal(h.writes.length, 0)
  assert.match(text(h.nodes().find((node) => node.props.role === 'alert')), /Deras kundpriser tas bort/)
  h.click('Bekräfta ändring')
  assert.deepEqual(h.props.items[0], { ...original[0], kind: 'excluded', amountOre: null })
  assert.deepEqual(h.props.items.slice(1), original.slice(1))
  h.changeKind('included'); h.click('Bekräfta ändring')
  assert.deepEqual(h.props.items[0], { ...original[0], kind: 'included', amountOre: null })
  assert.equal(h.writes.length, 2)
  assert.equal(h.messages[1], '1 arbetsdel har ändrats i avtalsutkastet.')
})

test('conversion of a legacy option clears optionGroup and never implicitly selects other rows', () => {
  const h = setup()
  h.props.items[0] = { ...h.props.items[0], kind: 'option', optionGroup: 'Fönster' }; h.render()
  h.select(0); h.changeKind('included'); h.click('Bekräfta ändring')
  assert.equal(h.props.items[0].optionGroup, null)
  assert.equal(h.props.items[0].amountOre, 100000)
  h.props.items = h.props.items.filter((row) => row.id !== 'part-0'); h.render()
  assert.equal(h.find('button', 'Ta bort valda arbetsdelar').disabled, true)
})

test('locked or busy contract prevents selection and pending mass changes, even if a handler is invoked', () => {
  const h = setup({ blocked: true })
  h.selectAll(); h.select(0); h.changeKind('excluded'); h.click('Ta bort valda arbetsdelar')
  assert.equal(h.writes.length, 0)
  assert.equal(text(h.nodes().find((node) => node.props.role === 'status')), '0 valda')
  h.props.blocked = false; h.render(); h.selectAll(); h.click('Ta bort valda arbetsdelar')
  h.props.blocked = true; h.render(); h.click('Ta bort från avtalet')
  assert.equal(h.writes.length, 0)
  assert.equal(h.props.items.length, 3)
})

test('selection works for the 200-row limit with duplicate names and a bounded confirmation summary', () => {
  const h = setup({ items: Array.from({ length: 200 }, (_, index) => ({ ...parts()[0], id: `part-${index}`, title: 'Mark' })) })
  h.selectAll()
  assert.equal(text(h.nodes().find((node) => node.props.role === 'status')), '200 valda')
  h.click('Ta bort valda arbetsdelar')
  assert.match(text(h.nodes().find((node) => node.props.role === 'alert')), /Mark, Mark, Mark, Mark, Mark och 195 till/)
  h.click('Avbryt'); h.select(0, false)
  h.click('Ta bort valda arbetsdelar'); h.click('Ta bort från avtalet')
  assert.equal(h.props.items.length, 1)
  assert.equal(h.props.items[0].id, 'part-0')
})
