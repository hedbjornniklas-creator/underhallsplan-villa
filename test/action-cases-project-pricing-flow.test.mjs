import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import * as billing from '../src/lib/action-cases/projectPricingFlow.ts'
import * as shared from '../src/lib/action-cases/projectCustomerPricing.ts'
import * as pricing from '../src/lib/action-cases/contractPricing.ts'
import * as offers from '../src/lib/action-cases/customerOffers.ts'

const line = patch => ({ id: 'line', category: 'own_labor', quantity: 2, unitCost: 100, markupPercent: 20, vatRate: 25, verified: false, ...patch })
const item = patch => ({ id: 'moment', title: 'Fiktivt byggarbete', costLines: [line()], ...patch })
const terms = () => ({ ...shared.emptyProjectCustomerPricing(), combined: { ...shared.emptyCustomerCharge(), fixedOre: 10001 } })

test('explicit calculation proposals use marked-up customer amounts, not internal cost or Klar, without mutating either record', () => {
  const source = item(), t = terms(), before = structuredClone({ source, t })
  assert.deepEqual(billing.billingCalculation(source), { netOre: 24000, grossOre: 30000, vatRate: 25, available: true, reason: '' })
  assert.equal(billing.applyBillingCalculation(t, source, 'combined').combined.fixedOre, 30000)
  t.combined.mode = 'budget'
  const budget = billing.applyBillingCalculation(t, source, 'combined')
  assert.equal(budget.combined.budgetOre, 30000); assert.equal(budget.combined.fixedOre, 10001)
  t.combined.mode = 'fixed'
  assert.deepEqual({ source, t }, before)
  assert.equal(billing.billingCalculation(item({ costLines: [line({ unitCost: 0 })] })).grossOre, 0)
})

test('missing amounts, uncertain split allocations and mixed VAT cannot become a fabricated fixed price or budget', () => {
  for (const costLines of [[], [line({ quantity: null })], [line({ unitCost: null })], [line({ vatRate: undefined })], [line(), line({ id: 'other', vatRate: 12 })]]) {
    const source = item({ costLines })
    assert.equal(billing.billingCalculation(source).available, false)
    assert.throws(() => billing.applyBillingCalculation(terms(), source, 'combined'), /CALCULATION_UNAVAILABLE/)
  }
  assert.equal(billing.billingCalculation(item({ costLines: [line({ vatRate: undefined })] })).vatRate, 25)
  const split = item({ costLines: [line(), line({ id: 'm', category: 'material', quantity: 1, unitCost: 50, markupPercent: 0 })] })
  assert.equal(billing.billingCalculation(split, 'labour').grossOre, 30000)
  assert.equal(billing.billingCalculation(split, 'material').grossOre, 6250)
  split.costLines.push(line({ id: 'w', category: 'waste' }))
  assert.equal(billing.billingCalculation(split, 'labour').available, false)
  assert.equal(billing.billingCalculation(split, 'combined').available, true)
  assert.equal(billing.billingCalculation(item({ lumpSum: { customerPrice: 123, internalCost: 1, vatRate: 25 } }), 'material').available, false)
  assert.equal(billing.billingCalculation(item({ costLines: [line(), line({ coveredByQuoteId: 'q', unitCost: 999 })] })).grossOre, 30000)
  assert.equal(billing.billingCalculation(item({ costLines: [line(), line({ coveredByQuoteId: 'q' })] }), 'labour').available, false)
})

test('VAT conversion retains zero and unknown, and never writes when changing display basis', () => {
  assert.equal(billing.exclusiveAmount(null), null); assert.equal(billing.inclusiveAmount(null), null)
  assert.equal(billing.exclusiveAmount(3125000), 2500000)
  assert.equal(billing.inclusiveAmount(2500000), 3125000)
  assert.equal(billing.inclusiveAmount(0), 0)
  assert.equal(billing.inclusiveAmount(10000, 12), 11200)
})

const jsx = { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }), Fragment: 'fragment' }
function load(path, deps) {
  const code = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
  const m = { exports: {} }
  new Function('require', 'module', 'exports', code)(name => { assert.ok(name in deps, name); return deps[name] }, m, m.exports)
  return m.exports.default
}
function nodes(tree) {
  const result = []
  function visit(node) { if (Array.isArray(node)) return node.forEach(visit); if (node && typeof node === 'object') { result.push(node); visit(node.props?.children) } }
  visit(tree); return result
}
const text = node => typeof node === 'string' || typeof node === 'number' ? String(node) : Array.isArray(node) ? node.map(text).join('') : node ? text(node.props?.children) : ''
function priceHarness(initialTerms = null, overrides = {}) {
  let cursor = 0, tree
  const slots = [], writes = [], dirty = []
  const react = { useId: () => 'billing', useState: initial => { const n = cursor++; if (!(n in slots)) slots[n] = initial; return [slots[n], next => { slots[n] = typeof next === 'function' ? next(slots[n]) : next }] } }
  const Component = load('src/components/tasks/ActionCaseCustomerPricing.tsx', { react, 'react/jsx-runtime': jsx,
    'lucide-react': new Proxy({}, { get: (_, key) => `icon:${String(key)}` }), '@/lib/action-cases/projectCustomerPricing': shared,
    '@/lib/action-cases/contractPricing': pricing, '@/lib/action-cases/projectPricingFlow': billing, '@/lib/action-cases/customerOffers': offers,
    './CustomerOfferPriceInput': { default: 'PriceInput' }, './ActionCaseContractPrice': { default: 'LockedPrice' } })
  const props = { item: item({ contractWork: { locked: false, customerPricing: { terms: initialTerms, revision: initialTerms ? 1 : 0, candidates: [] } } }), blocked: false,
    onChange: (t, immediate) => { writes.push({ terms: t, immediate }); props.entry = { terms: t, status: 'saved' } }, onRetry() {}, onReload() {}, onDraftDirty: value => dirty.push(value), ...overrides }
  const render = () => { cursor = 0; tree = Component(props) }
  const find = predicate => { const result = nodes(tree).find(predicate); assert.ok(result); return result }
  render()
  return { props, writes, dirty, render, find, all: () => nodes(tree), button: label => find(node => node.type === 'button' && text(node).includes(label)), content: () => text(tree) }
}

test('existing saved customer prices are never adopted, recalculated or rounded by opening the billing section', () => {
  const t = terms(), before = structuredClone(t), h = priceHarness(t)
  assert.equal(h.writes.length, 0)
  h.find(n => n.props?.['aria-label'] === 'Beloppsinmatning').props.onChange({ target: { value: 'incl' } }); h.render()
  assert.equal(h.writes.length, 0); assert.deepEqual(t, before)
  assert.equal(h.find(n => n.type === 'PriceInput' && n.props.label.startsWith('Fast pris')).props.value, 10001)
  h.button('Använd kalkylens belopp').props.onClick(); h.render()
  assert.equal(h.writes[0].terms.combined.fixedOre, 30000)
})

test('new pricing is proposed from calculation but saved only after an explicit adoption; subsequent edits autosave', () => {
  const h = priceHarness()
  assert.equal(h.writes.length, 0)
  h.button('Ange prisform från kalkylen').props.onClick(); h.render()
  assert.equal(h.writes.length, 0); assert.equal(h.dirty.at(-1), true)
  assert.equal(h.find(n => n.type === 'PriceInput' && n.props.label.startsWith('Fast pris')).props.value, 24000)
  h.button('Spara och använd för momentet').props.onClick(); h.render()
  assert.equal(h.writes[0].terms.combined.fixedOre, 30000); assert.equal(h.writes[0].immediate, true)
  h.find(n => n.type === 'PriceInput' && n.props.label.startsWith('Fast pris')).props.onChange(10000); h.render()
  assert.equal(h.writes.at(-1).terms.combined.fixedOre, 12500)
  h.find(n => n.type === 'PriceInput' && n.props.label.startsWith('Fast pris')).props.onChange(null)
  assert.equal(h.writes.at(-1).terms.combined.fixedOre, null)
})

test('locked and failed customer terms retain the existing protections and retry path', () => {
  const t = terms(), h = priceHarness(t, { entry: { terms: t, status: 'error', error: 'Fiktivt sparfel' } })
  assert.match(h.content(), /Fiktivt sparfel/); assert.ok(h.button('Försök igen'))
  const locked = priceHarness(null, { item: item({ contractWork: { locked: true, customerPricing: { terms: null } } }) })
  assert.match(locked.content(), /låst avtal/)
  assert.equal(locked.all().filter(n => n.type === 'PriceInput').length, 0)
})

test('offer summary reads the saved document, not a newer calculation, and separates fixed and budget amounts', () => {
  const t = { ...terms(), split: 'separate', labour: { ...shared.emptyCustomerCharge(), fixedOre: 10000 }, material: { ...shared.emptyCustomerCharge(), mode: 'budget', budgetOre: 25000, markupPercent: 15 } }
  const p = { version: 1, mode: 'mixed', basis: 'rows', split: 'combined', display: 'priced', rows: [{ id: 'stored', sourceItemId: 'moment', title: 'Sparat moment', kind: 'running', amountOre: null, labourOre: null, materialOre: null, projectPricing: { revision: 1, terms: t } }], running: { hourlyOre: null, markupPercent: null }, totalOre: null, labourOre: null, materialOre: null }
  const draft = { contractPricing: p }, before = structuredClone(draft)
  const Component = load('src/components/tasks/CustomerOfferPricingSummary.tsx', { react: { useState: value => [value, () => {}] }, 'react/jsx-runtime': jsx, 'lucide-react': new Proxy({}, { get: (_, key) => `icon:${String(key)}` }), '@/lib/action-cases/customerOffers': offers, '@/lib/action-cases/contractPricing': pricing, '@/lib/action-cases/projectPricingFlow': billing })
  const opened = [], displays = [], tree = Component({ draft, sources: [item()], blocked: false, onEditWork: id => opened.push(id), onDisplayChange: value => displays.push(value) })
  const content = text(tree)
  assert.match(content, /Summa fasta priser/); assert.match(content, /Planeringsbudget, löpande del/)
  assert.doesNotMatch(content, /350,00|Samlad kostnadsplan|240,00|300,00/)
  assert.equal(nodes(tree).some(n => n.type === 'input' || n.type === 'PriceInput'), false)
  nodes(tree).find(n => n.type === 'button' && n.props['aria-label']?.startsWith('Ändra prisvillkor')).props.onClick()
  assert.deepEqual(opened, ['moment'])
  nodes(tree).find(n => n.type === 'select').props.onChange({ target: { value: 'unpriced' } })
  assert.deepEqual(displays, ['unpriced']); assert.deepEqual(draft, before)
})

test('older running total-basis budgets and manual fixed totals retain their original meaning in the summary', () => {
  const p = { mode: 'running', basis: 'total', split: 'combined', rows: [{ id: 'legacy', title: 'Äldre budgetpost', kind: 'fixed', amountOre: null, labourOre: null, materialOre: null }], budget: { rows: [{ id: 'legacy', amountOre: 11750000 }] } }
  assert.deepEqual(billing.offerBillingSummary({ contractPricing: p })[0], { id: 'legacy', title: 'Äldre budgetpost', mode: 'budget', amountOre: 11750000, sourceItemId: undefined, shared: false })
  const fixed = { contractPricing: { ...p, mode: 'fixed', totalOre: 999999 } }
  assert.equal(billing.offerBillingSummary(fixed)[0].amountOre, 999999)
})

const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const legacyPricing = patch => ({ version: 1, mode: 'fixed', basis: 'total', split: 'combined', display: 'unpriced', totalOre: 999999, labourOre: null, materialOre: null,
  rows: [{ id: uuid(1), sourceItemId: uuid(2), title: 'Sparat moment', kind: 'fixed', amountOre: null, labourOre: null, materialOre: null }],
  running: { hourlyOre: 75000, managementOre: null, markupPercent: 15, approximateOre: null }, ...patch })

test('explicit moment transition does not distribute a lump sum, mutate its source or import matching titles', () => {
  const draft = { contractPricing: legacyPricing(), offerHourEstimate: { minHours: 80, maxHours: 100 }, items: [] }
  const sources = [item({ id: uuid(99), title: 'Sparat moment', contractWork: { customerPricing: { revision: 1, terms: terms() } } })]
  const before = structuredClone({ draft, sources })
  const patch = billing.offerMomentPricing(draft, sources)
  assert.equal(patch.contractPricing.basis, 'rows'); assert.equal(patch.contractPricing.totalOre, null)
  assert.equal(patch.contractPricing.rows[0].amountOre, null)
  assert.equal(patch.contractPricing.rows[0].projectPricing, undefined)
  assert.equal(patch.offerHourEstimate, null)
  assert.deepEqual({ draft, sources }, before)
})

test('explicit moment transition adopts only linked terms and never reinterprets an approximate price as budget', () => {
  const t = { ...terms(), split: 'separate', labour: { ...shared.emptyCustomerCharge(), fixedOre: 10000 }, material: { ...shared.emptyCustomerCharge(), mode: 'budget', budgetOre: 25000, markupPercent: 15 } }
  const p = legacyPricing({ mode: 'running', running: { hourlyOre: 75000, managementOre: null, markupPercent: 15, approximateOre: 999999 } })
  const draft = { contractPricing: p }, before = structuredClone(draft)
  const patch = billing.offerMomentPricing(draft, [item({ id: uuid(2), contractWork: { customerPricing: { revision: 3, terms: t } } })])
  assert.equal(patch.contractPricing.running.approximateOre, null)
  assert.equal(patch.contractPricing.mode, 'mixed')
  assert.deepEqual(patch.contractPricing.rows[0].projectPricing, { revision: 3, terms: t })
  assert.equal(pricing.contractFixedAmount(patch.contractPricing), 10000)
  assert.equal(pricing.offerBudgetBreakdown(patch.contractPricing).runningOre, 25000)
  assert.deepEqual(draft, before)
})

test('mixed manual total summary keeps its actual total separate from running budget and ignores stale fixed row prices', () => {
  const p = legacyPricing({ mode: 'mixed', budget: { version: 1, rows: [{ id: uuid(3), amountOre: 45000 }], assumptions: 'Fiktivt', reviewTerms: 'Samrad' } })
  p.rows[0].amountOre = 12345
  p.rows.push({ ...p.rows[0], id: uuid(3), sourceItemId: uuid(4), kind: 'running', amountOre: null })
  const rows = billing.offerBillingSummary({ contractPricing: p })
  assert.equal(rows.length, 2)
  assert.deepEqual(rows.map(row => [row.mode, row.amountOre]), [['fixed', 999999], ['budget', 45000]])
})

test('legacy price transition requires confirmation and cancel leaves the saved document intact', () => {
  let cursor = 0, adopted = 0, tree
  const slots = [], draft = { contractPricing: legacyPricing() }, before = structuredClone(draft)
  const react = { useState: initial => { const n = cursor++; if (!(n in slots)) slots[n] = initial; return [slots[n], value => { slots[n] = value }] } }
  const Component = load('src/components/tasks/CustomerOfferPricingSummary.tsx', { react, 'react/jsx-runtime': jsx,
    'lucide-react': new Proxy({}, { get: (_, key) => `icon:${String(key)}` }), '@/lib/action-cases/customerOffers': offers,
    '@/lib/action-cases/contractPricing': pricing, '@/lib/action-cases/projectPricingFlow': billing })
  const render = () => { cursor = 0; tree = Component({ draft, sources: [], blocked: false, onDisplayChange() {}, onUseMomentPricing: () => adopted++ }) }
  const click = label => { const button = nodes(tree).find(n => n.type === 'button' && text(n) === label); assert.ok(button, label); button.props.onClick(); render() }
  render(); assert.equal(adopted, 0)
  click('Övergå till momentens prisvillkor')
  assert.ok(nodes(tree).some(n => n.props?.role === 'alertdialog'))
  assert.match(text(tree), /fördelas inte/)
  click('Behåll äldre underlag')
  assert.equal(adopted, 0); assert.deepEqual(draft, before)
  click('Övergå till momentens prisvillkor'); click('Bekräfta övergång till momentpriser')
  assert.equal(adopted, 1); assert.deepEqual(draft, before)
})
