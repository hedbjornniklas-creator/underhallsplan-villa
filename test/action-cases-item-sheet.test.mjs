import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { actionScopeDraft } from '../src/lib/action-cases/scopeDraft.ts'
import { actionCaseCostCoverage, calculateActionCaseCostTotals } from '../src/lib/action-cases/domain.ts'

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
    '@/lib/action-cases/domain': { calculateActionCaseCostTotals, actionCaseCostCoverage },
    '@/lib/action-cases/costing': {},
    '@/lib/action-cases/scopeAttachments': { scopeAttachmentIds: () => [] },
    '@/lib/action-cases/scopeDraft': { actionScopeDraft },
    './actionCaseGroupPricing': { groupPriceForLine: () => null, coveringQuoteForLine: () => null },
    './ActionCaseWorkParts': { ActionCaseWorkParts: 'WorkParts', ActionCaseWorkSelection: 'WorkSelection', UNASSIGNED_WORK: 'unassigned' },
    './action-case-costs.css': {},
  }
  for (const name of ['ActionCaseWorkQuotes', 'ActionCaseAttachmentPicker', 'ActionCaseLumpSumEditor', 'ActionCaseDirectCostFields', 'ActionCaseCostHelp', 'ActionCasePurchaseList']) dependencies[`./${name}`] = { default: name }
  const mod = { exports: {} }
  new Function('require', 'module', 'exports', 'document', 'window', compiled)(
    (name) => { if (!(name in dependencies)) throw new Error(name); return dependencies[name] }, mod, mod.exports, { body: {} },
    { confirm: () => { confirmations++; return accept } },
  )
  const props = {
    item: { id: 'test', title: 'Grund', scope: 'Arbete', scopeNotesAvailable: true, lumpSumAvailable: true, costLines: [], status: 'pricing_needed' },
    busy: false, scopeBlocked: false,
    onClose: () => { closes++ }, onScopeFlush: () => { flushes++ },
    ...overrides,
  }
  const render = () => { cursor = 0; tree = mod.exports.default(props) }
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
  h.props.item.lumpSum = {internalCost:1,customerPrice:2,verified:false,vatRate:25}; h.render()
  h.find((node) => node.type === 'ActionCaseLumpSumEditor').props.onDirty(true); h.render()
  assert.equal(h.tab('Omfattning').props.disabled, true)
  h.pointerDown(); h.clickBackdrop()
  h.find((node) => node.props['aria-label'] === 'Stäng åtgärd').props.onClick()
  h.find((node) => node.props.role === 'dialog').props.onKeyDown({ key: 'Escape', preventDefault() {} })
  assert.deepEqual(h.result, { closes: 0, flushes: 0, confirmations: 3 })
  h.allowDiscard(); h.pointerDown(); h.clickBackdrop()
  assert.deepEqual(h.result, { closes: 1, flushes: 0, confirmations: 4 })
})

const testLine = (patch={}) => ({id:'line',description:'Puts',category:'other',quantity:1,unit:'paket',unitCost:64000,markupPercent:17.16,verified:false,pricingMethod:'direct',quotes:[],...patch})
const costItem = (lines) => ({id:'item',title:'Invändigt',scope:'Fiktiv omfattning',updatedAt:'2026-10-19T08:00:00.123456Z',status:'pricing_needed',costLines:lines})

test('compact table shows every priced row and one total; completion never changes its customer price', async () => {
  const calls=[],h=sheetHarness({initialCostLineId:'none',item:costItem([testLine()]),onCostAction:async(...args)=>{calls.push(args);return true}})
  assert.equal(h.find(n=>n.type==='table').props['aria-label'],'Kalkylrader')
  assert.equal(h.nodes().filter(n=>n.type==='tfoot').length,1)
  const prices=()=>h.nodes().filter(n=>n.type==='td' && n.props['data-label']==='Kundpris exkl. moms').map(n=>n.props.children.props.children)
  assert.equal(prices()[0].replaceAll('\u00a0',' '),'74 982,40 kr')
  const checkbox=h.find(n=>n.props['aria-label']==='Klar: Puts')
  assert.equal(checkbox.props.disabled,false)
  checkbox.props.onChange({target:{checked:true}})
  await new Promise(resolve=>setImmediate(resolve))
  assert.deepEqual(calls,[['set_cost_line_complete',{costLineId:'line',complete:true,expectedUpdatedAt:h.props.item.updatedAt}]])
  h.props.item.costLines[0].verified=true; h.render()
  assert.equal(prices()[0].replaceAll('\u00a0',' '),'74 982,40 kr')
  assert.equal(h.find(n=>n.props['aria-label']==='Klar: Puts').props.checked,true)
})

test('Klar remains separate from bulk selection, actual missing amounts and quote-derived completion', () => {
  const h=sheetHarness({initialCostLineId:'none',item:costItem([testLine(),testLine({id:'missing',description:'Saknat pris',unitCost:null}),testLine({id:'quote',description:'UE',category:'own_labor',pricingMethod:'quotes'}),testLine({id:'covered',description:'Material i offert',category:'material',coveredByQuoteId:'quote'})])})
  assert.equal(h.nodes().filter(n=>n.type==='input' && n.props.name==='costLineSelection').length,0)
  assert.equal(h.find(n=>n.props['aria-label']==='Klar: Puts').props.disabled,false)
  assert.equal(h.find(n=>n.props['aria-label']==='Klar: Saknat pris').props.disabled,true)
  assert.equal(h.find(n=>n.props['aria-label']==='Klar: UE').props.disabled,true)
  assert.equal(h.find(n=>n.props['aria-label']==='Klar: Material i offert').props.disabled,true)
  assert.equal(h.find(n=>n.props['aria-label']==='Klar: Material i offert').props.checked,true)
  h.find(n=>n.type==='button' && Array.isArray(n.props.children) && n.props.children.includes('Markera rader')).props.onClick(); h.render()
  const selection=h.find(n=>n.props['aria-label']==='Markera alla synliga kalkylrader')
  selection.props.onChange({target:{checked:true}}); h.render()
  assert.equal(h.find(n=>n.props['aria-label']==='Klar: Puts').props.checked,false)
  assert.equal(h.find(n=>n.props['aria-label']==='Markera Puts').props.checked,true)
})

test('pencil opens details with unsaved protection and blocks concurrent completion', () => {
  const h=sheetHarness({initialCostLineId:'none',item:costItem([testLine()])})
  h.find(n=>n.props['aria-label']==='Redigera Puts').props.onClick(); h.render()
  assert.ok(h.find(n=>typeof n.type==='function' && n.type.name==='CostLineForm'))
  assert.equal(h.find(n=>n.props['aria-label']==='Klar: Puts').props.disabled,true)
  assert.equal(h.tab('Omfattning').props.disabled,true)
  h.pointerDown();h.clickBackdrop()
  assert.equal(h.result.confirmations,1)
  assert.equal(h.result.closes,0)
})

test('incomplete rows retain a preliminary cost and customer sum, including genuine zero-priced products', () => {
  const h = sheetHarness({ initialCostLineId: 'none', item: costItem([
    testLine({ quantity: 10, unitCost: 500, markupPercent: 20 }),
    testLine({ id: 'free', description: 'Gratis material', quantity: 1, unitCost: 0 }),
    testLine({ id: 'unknown', quantity: null, unitCost: 0 }),
  ]) })
  const footer = h.find(n => n.type === 'tfoot')
  assert.equal(footer.props.children.props.children[0].props.children, 'Preliminär summa')
  assert.equal(footer.props.children.props.children[1].props.children.props.children.replaceAll('\u00a0', ' '), '5 000,00 kr')
  assert.equal(footer.props.children.props.children[3].props.children.props.children.replaceAll('\u00a0', ' '), '6 000,00 kr')
  assert.equal(h.find(n => n.type === 'table').props['aria-describedby'], 'sheet-cost-warning')
  const warning = h.find(n => n.props.id === 'sheet-cost-warning')
  assert.ok(warning.props.children.includes('1 rad saknar mängd'))
  assert.equal(h.find(n => n.props['aria-label'] === 'Klar: Gratis material').props.disabled, false)
  assert.equal(h.props.item.costLines[2].quantity, null, 'Display never fills in a missing quantity')
  h.props.item.costLines[2].quantity = 1
  h.render()
  assert.equal(h.find(n => n.type === 'tfoot').props.children.props.children[0].props.children, 'Summa')
  assert.equal(h.nodes().some(n => n.props.id === 'sheet-cost-warning'), false)
})

test('an entirely unknown calculation explicitly labels its zero display as preliminary', () => {
  const h = sheetHarness({ initialCostLineId: 'none', item: costItem([testLine({ quantity: null, unitCost: null })]) })
  assert.equal(h.find(n => n.type === 'tfoot').props.children.props.children[1].props.children.props.children, '0,00\u00a0kr')
  assert.ok(h.find(n => n.props.id === 'sheet-cost-warning').props.children.includes('Inga rader kan räknas ut ännu.'))
})

test('successful transition away from a lump sum leaves Add row enabled', async () => {
  let h
  h = sheetHarness({ initialCostLineId: 'none', item: { ...costItem([testLine()]), lumpSumAvailable: true, lumpSum: { customerPrice: 5000, internalCost: null, vatRate: 25, verified: false } }, onSave: async payload => { h.props.item.lumpSum = payload.lumpSum; return true } })
  h.find(n => n.type === 'ActionCaseLumpSumEditor').props.onDirty(true)
  h.render()
  await h.find(n => n.type === 'ActionCaseLumpSumEditor').props.onSave(null)
  h.render()
  assert.equal(h.find(n => n.type === 'button' && n.props.children?.includes?.('Lägg till rad')).props.disabled, false)
})

test('purchase list receives only selected products and no mutation callbacks', () => {
  const calls = [], h = sheetHarness({ initialCostLineId: 'none', projectTitle: 'Testprojekt', deliveryAddress: 'Testgatan 1',
    item: costItem([testLine({ category: 'material', description: 'Isolering' }), testLine({ id: 'work', category: 'own_labor', description: 'Montering' })]),
    onCostAction: (...args) => calls.push(args), onSave: (...args) => calls.push(args),
  })
  assert.equal(h.nodes().some(n => n.type === 'ActionCasePurchaseList'), false)
  h.find(n => n.type === 'button' && n.props.children?.includes?.('Markera rader')).props.onClick(); h.render()
  const printButton = () => h.find(n => n.type === 'button' && n.props.children?.includes?.('Beställningslista ('))
  assert.equal(printButton().props.disabled, true)
  h.find(n => n.props['aria-label'] === 'Markera Montering').props.onChange({ target: { checked: true } }); h.render()
  assert.equal(printButton().props.disabled, true, 'Work alone cannot create a material list')
  h.find(n => n.props['aria-label'] === 'Markera Isolering').props.onChange({ target: { checked: true } }); h.render()
  assert.equal(printButton().props.disabled, false)
  printButton().props.onClick(); h.render()
  const list = h.find(n => n.type === 'ActionCasePurchaseList')
  assert.deepEqual(list.props.lines.map(line => line.id), ['line'])
  assert.equal(list.props.projectTitle, 'Testprojekt')
  assert.equal(list.props.deliveryAddress, 'Testgatan 1')
  assert.deepEqual(Object.keys(list.props).sort(), ['lines', 'projectTitle', 'workTitle', 'deliveryAddress', 'onClose'].sort())
  list.props.onClose(); h.render()
  assert.equal(h.nodes().some(n => n.type === 'ActionCasePurchaseList'), false)
  assert.deepEqual(calls, [])
})

test('purchase action cannot bypass a pending row edit', () => {
  const h = sheetHarness({ initialCostLineId: 'none', item: costItem([testLine({ category: 'material' })]) })
  h.find(n => n.type === 'button' && n.props.children?.includes?.('Markera rader')).props.onClick(); h.render()
  h.find(n => n.props['aria-label'] === 'Markera Puts').props.onChange({ target: { checked: true } }); h.render()
  h.find(n => n.props['aria-label'] === 'Redigera Puts').props.onClick(); h.render()
  const button = h.find(n => n.type === 'button' && n.props.children?.includes?.('Beställningslista ('))
  assert.equal(button.props.disabled, true)
  button.props.onClick(); h.render()
  assert.equal(h.nodes().some(n => n.type === 'ActionCasePurchaseList'), false)
})
