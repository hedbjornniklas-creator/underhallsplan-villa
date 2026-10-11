import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'
import postcss from 'postcss'
import { money } from '../src/lib/action-cases/customerOffers.ts'
import * as payment from '../src/lib/action-cases/customerPaymentPlan.ts'

const source = readFileSync(new URL('../src/components/tasks/CustomerPaymentPlan.tsx', import.meta.url), 'utf8')
const code = ts.transpileModule(source, { compilerOptions: {
  module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022,
} }).outputText
const loaded = { exports: {} }, jsx = (type, props) => ({ type, props })
const modules = { 'react/jsx-runtime': { jsx, jsxs: jsx }, react: {}, 'lucide-react': {},
  '@/lib/action-cases/customerOffers': { money }, '@/lib/action-cases/customerPaymentPlan': payment,
  '@/lib/action-cases/offerImport': {}, './CustomerOfferPriceInput': {}, './ProjectEditorRow': {} }
new Function('require', 'module', 'exports', code)((name) => {
  assert(name in modules, `Unexpected dependency: ${name}`)
  return modules[name]
}, loaded, loaded.exports)
const flatten = (node) => Array.isArray(node) ? node.flatMap(flatten) : !node || typeof node !== 'object' ? [node] : [node, ...flatten(node.props?.children)]
const row = (id, title, amountOre) => ({ id, title, amountOre, condition: `Efter utfört ${title}.`, plannedDate: '2026-11-30' })
const plan = () => ({ version: 1, installments: [row('one', 'Mark', 10000), row('two', 'Stomme', 20000)] })
function view(patch = {}) {
  const nodes = flatten(loaded.exports.PaymentPlanSummary({ plan: plan(), baseAmount: 30000, paymentTerms: 'Egna betalningsvillkor.',
    conditions: { version: 1, days: 10, standardText: payment.abs18PaymentText }, priceMode: 'fixed', ...patch }))
  return { nodes, text: nodes.filter((node) => typeof node === 'string' || typeof node === 'number').join(' ') }
}

test('contract payment summary shows all terms, milestones, dates and totals without editable fields or mutation', () => {
  const original = plan(), before = structuredClone(original)
  const { nodes, text } = view({ plan: original })
  assert.match(text, /inom 10 dagar/)
  assert(text.includes(payment.abs18PaymentText))
  assert.match(text, /Egna betalningsvillkor/)
  assert.match(text, /Efter utfört Mark/)
  assert.match(text, /Efter utfört Stomme/)
  assert.match(text, /2026-11-30/)
  for (const amount of [10000, 20000, 30000]) assert(text.includes(money(amount)))
  assert.match(text, /Stämmer med avtalets belopp/)
  assert.equal(nodes.filter((node) => ['input', 'textarea', 'select', 'button'].includes(node?.type)).length, 0)
  assert.equal(nodes.filter((node) => node?.type === 'table' && node.props['aria-label'] === 'Avtalets betalningsplan').length, 1)
  assert.equal(nodes.filter((node) => node?.type === 'th' && node.props.scope === 'col').length, 4)
  assert.equal(nodes.filter((node) => node?.type === 'th' && node.props.scope === 'row').length, 2)
  assert.deepEqual(original, before)
})

test('rerender reads changed shared data and reports underallocation, overallocation and incomplete rows', () => {
  const changed = plan()
  changed.installments[0] = { ...changed.installments[0], title: 'Ny rubrik', amountOre: 5000, condition: 'Nytt villkor.', plannedDate: '' }
  const under = view({ plan: changed, paymentTerms: 'Nya egna villkor.' }).text
  assert.match(under, /Ny rubrik/)
  assert.match(under, /Nytt villkor/)
  assert.match(under, /Nya egna villkor/)
  assert.match(under, /Ej planerat/)
  assert.match(under, /Kvar att fördela/)
  assert(under.includes(money(5000)))
  assert.doesNotMatch(under, /Stämmer med avtalets belopp|Egna betalningsvillkor/)
  const over = view({ baseAmount: 25000 }).text
  assert.match(over, /Överfördelat/)
  assert(over.includes(money(5000)))
  assert.doesNotMatch(over, /Stämmer med avtalets belopp/)
  changed.installments[0].amountOre = null
  changed.installments[1].condition = ''
  const missing = view({ plan: changed, baseAmount: 20000 }).text
  assert.match(missing, /Summa angivna belopp|Belopp saknas|Faktureringsvillkor saknas/)
  assert.match(missing, /Ange ett belopp större än noll/)
  assert.doesNotMatch(missing, /Stämmer med avtalets belopp/)
})

test('absent and empty plans show an honest empty state and preserve payment conditions', () => {
  for (const value of [undefined, null, { version: 1, installments: [] }]) {
    const { nodes, text } = view({ plan: value })
    assert.match(text, /Ingen uppdelad betalningsplan finns/)
    assert.match(text, /inom 10 dagar/)
    assert.equal(nodes.filter((node) => node?.type === 'table').length, 0)
    assert.doesNotMatch(text, /Stämmer med avtalets belopp/)
  }
  assert.match(view({ plan: null, conditions: undefined, paymentTerms: '' }).text, /Betalningsvillkor saknas/)
})

test('percentage rows remain in order and a changed price is not silently reallocated by the summary', () => {
  const p = payment.configurePaymentPlan(plan(), 100000, true, 20)
  const before = structuredClone(p)
  const result = view({ plan: p, baseAmount: 100000 }).text
  assert.match(result, /20 %/)
  assert.match(result, /10 %/)
  assert(result.indexOf('Första delbetalning') < result.indexOf('Mark'))
  assert(result.indexOf('Slutbetalning') > result.indexOf('Stomme'))
  assert.match(result, /Stämmer med avtalets belopp/)
  assert.match(view({ plan: p, baseAmount: 110000 }).text, /Anpassa betalningsplanen till avtalets ändrade pris/)
  assert.deepEqual(p, before)
})

test('unknown and running contract prices never report a balanced plan', () => {
  const unknown = view({ baseAmount: null }).text
  assert.match(unknown, /Pris saknas/)
  assert.doesNotMatch(unknown, /Stämmer med avtalets belopp/)
  const running = view({ baseAmount: null, priceMode: 'running' }).text
  assert.match(running, /Löpande räkning/)
  assert.doesNotMatch(running, /Stämmer med avtalets belopp/)
})

test('contract uses its existing draft or accepted snapshot and the only command opens payment editing', () => {
  const editor = readFileSync(new URL('../src/components/tasks/CustomerOfferEditor.tsx', import.meta.url), 'utf8')
  assert.match(editor, /const paymentSource = locked \? previewOffer\.snapshot : draft/)
  assert.match(editor, /<PaymentPlanSummary plan=\{paymentSource\.paymentPlan\} baseAmount=\{customerOfferBaseAmount\(paymentSource\)\}/)
  assert.match(editor, /conditions=\{paymentSource\.paymentConditions\} priceMode=\{paymentSource\.contractPricing\?\.mode\}/)
  assert.match(editor, /onClick=\{\(\) => \{ setPaymentView\('plan'\); setView\('payments'\) \}\}[^\n]+Redigera betalningsplan/)
  const document = readFileSync(new URL('../src/components/tasks/CustomerOfferDocument.tsx', import.meta.url), 'utf8')
  assert.doesNotMatch(document, /PaymentPlanSummary/)
  assert.match(document, /<PaymentPlanDocument plan=\{s\.paymentPlan\}/)
})

test('compact summary keeps numeric amounts intact and stacks mobile rows without horizontal scrolling', () => {
  const css = postcss.parse(readFileSync(new URL('../src/components/tasks/uppdrag-theme.css', import.meta.url), 'utf8'))
  const declarations = (selector, media = '') => {
    const found = {}
    css.walkRules((rule) => {
      if (!rule.selectors.includes(selector)) return
      if ((rule.parent.type === 'atrule' ? rule.parent.params : '') !== media) return
      rule.walkDecls((decl) => { found[decl.prop] = decl.value })
    })
    return found
  }
  assert.equal(declarations('.gizmo-payment-summary-table tbody tr').height, '44px')
  assert.equal(declarations('.gizmo-payment-summary-table thead th').height, '32px')
  assert.equal(declarations('.gizmo-payment-summary-total dd')['white-space'], 'nowrap')
  assert.equal(declarations('.gizmo-payment-summary-table tbody tr', 'screen and (max-width: 767px)').display, 'grid')
  assert.equal(declarations('.gizmo-payment-summary-table tbody tr', 'screen and (max-width: 767px)').height, 'auto')
  assert.equal(declarations('.gizmo-payment-summary-table', 'screen and (max-width: 767px)')['font-size'], '16px')
  assert.equal(declarations('.gizmo-payment-summary-table thead th:first-child').width, '24%')
  assert.equal(declarations('.gizmo-payment-summary-table th:first-child').width, undefined)
})
