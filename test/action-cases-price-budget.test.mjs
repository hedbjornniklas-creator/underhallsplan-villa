import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import * as pricing from '../src/lib/action-cases/contractPricing.ts'
import * as offers from '../src/lib/action-cases/customerOffers.ts'
import { contractSigningSections } from '../src/lib/action-cases/contractSigningPdf.ts'

const a = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', b = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
export const budgetPricing = () => ({ version: 1, mode: 'running', basis: 'rows', split: 'combined', display: 'priced', totalOre: 999999, labourOre: null, materialOre: null,
  rows: [{ id: a, title: 'Plattsättning', kind: 'running', amountOre: 777777, labourOre: null, materialOre: null }, { id: b, title: 'Målning', kind: 'running', amountOre: 888888, labourOre: null, materialOre: null }],
  running: { hourlyOre: 75000, managementOre: null, markupPercent: 15, approximateOre: null },
  budget: { version: 1, rows: [{ id: a, amountOre: 10000000 }, { id: b, amountOre: 5000000 }], assumptions: 'FIKTIVT: Ytskikt och underlag behöver undersökas.', reviewTerms: pricing.defaultBudgetReviewTerms } })
export const budgetDraft = (p = budgetPricing()) => offers.normalizeCustomerOffer({ ...offers.emptyCustomerOffer('Fiktiv budgetoffert'), contractForm: 'custom', validUntil: '2099-01-01', baseAmountOre: null,
  terms: 'Villkor', paymentTerms: 'Efter utfört arbete', schedule: 'Enligt överenskommelse', items: [{ id: a, title: 'Plattsättning', kind: 'included', scope: 'Fiktiv omfattning', amountOre: null }], contractPricing: p })
const publicDraft = d => offers.mapCustomerOffer({ id: a, snapshot: d, files: [], status: 'published', version: 1 }).snapshot
const jsx = (type, props) => ({ type, props })
const nodes = value => Array.isArray(value) ? value.flatMap(nodes) : value?.props ? [value, ...nodes(value.props.children)] : []
const text = value => typeof value === 'string' || typeof value === 'number' ? String(value) : Array.isArray(value) ? value.map(text).join(' ') : value?.props ? text(value.props.children) : ''

function editor(value) {
  const state = [], changes = []; let cursor = 0
  const props = { value, sources: [], blocked: false, importBlocked: false, purpose: 'offer', onChange(next) { changes.push(next); props.value = next } }
  const react = { useId: () => 'id', useState(initial) { const i = cursor++; if (!(i in state)) state[i] = initial; return [state[i], next => { state[i] = typeof next === 'function' ? next(state[i]) : next }] } }
  const priceInput = () => null
  const loaded = { exports: {} }
  const source = ts.transpileModule(readFileSync(new URL('../src/components/tasks/CustomerContractPricing.tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
  new Function('require','module','exports',source)(name => ({ react, 'react/jsx-runtime': { jsx, jsxs: jsx }, 'lucide-react': {},
    '@/lib/action-cases/contractPricing': pricing, '@/lib/action-cases/customerOffers': offers, '@/lib/action-cases/offerImport': {}, './CustomerOfferPriceInput': { default: priceInput } })[name], loaded, loaded.exports)
  const render = () => { cursor = 0; return loaded.exports.default(props) }
  return { props, changes, render, document: () => loaded.exports.ContractPriceDocument({ value: props.value }),
    modes: title => nodes(render()).find(node => node.props.title === title && node.type?.name === 'Modes'),
    input: label => nodes(render()).find(node => node.type === priceInput && node.props.label === label),
    button: label => nodes(render()).find(node => node.type === 'button' && (node.props['aria-label'] === label || text(node).trim() === label)),
  }
}

test('budgets round-trip separately, never create a fixed or approximate total, and preserve zero', () => {
  const p = budgetPricing(), before = structuredClone(p), draft = budgetDraft(p)
  assert.equal(pricing.contractBudgetAmount(draft.contractPricing), 15000000)
  assert.equal(draft.baseAmountOre, null); assert.equal(offers.customerOfferTotal(draft, []), null)
  assert.equal(draft.contractPricing.running.approximateOre, null)
  assert.equal(offers.customerPriceLabel(draft), 'Löpande räkning med budget')
  assert.deepEqual(offers.offerPublishIssues(draft), [])
  draft.contractPricing.budget.rows[0].amountOre = 0
  assert.equal(pricing.contractBudgetAmount(draft.contractPricing), 5000000)
  draft.contractPricing.budget.rows[0].amountOre = null
  assert.equal(pricing.contractBudgetAmount(draft.contractPricing), null)
  assert.ok(pricing.contractPricingIssues(draft.contractPricing).some(issue => issue.includes('varje moment')))
  assert.deepEqual(p, before)
})

test('mixed strategy counts the agreed fixed portion once, not its former inactive budget', () => {
  const p = budgetPricing(); p.mode = 'mixed'; p.rows[1].kind = 'fixed'; p.rows[1].amountOre = 4000000
  const draft = budgetDraft(p), publicValue = publicDraft(draft)
  assert.equal(draft.baseAmountOre, 4000000)
  assert.equal(pricing.contractBudgetAmount(draft.contractPricing), 14000000)
  assert.equal(pricing.contractBudgetAmount(publicValue.contractPricing), 14000000)
  assert.deepEqual(publicValue.contractPricing.budget.rows, [{ id: a, amountOre: 10000000 }])
  assert.equal(pricing.contractBudgetAmount(offers.normalizeCustomerOffer(publicValue).contractPricing), 14000000)
})

test('invalid budgets, duplicate/orphan row references, contradictory forms and overflow fail closed', () => {
  for (const patch of [{ version: 2 }, { rows: [{ id: a, amountOre: -1 }] }, { rows: [{ id: a, amountOre: '100' }] },
    { rows: [{ id: a, amountOre: 1.5 }] }, { rows: [{ id: a, amountOre: 100000000001 }] },
    { rows: [{ id: a, amountOre: 1 }, { id: a, amountOre: 2 }] }, { rows: [{ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', amountOre: 1 }] },
    { assumptions: false }, { reviewTerms: 'x'.repeat(6001) }, { rows: [{ id: a, amountOre: 100000000000 }, { id: b, amountOre: 1 }] }]) {
    const p = budgetPricing(); Object.assign(p.budget, patch); assert.throws(() => pricing.normalizeContractPricing(p), /INVALID/)
  }
  const fixed = budgetPricing(); fixed.mode = 'fixed'; assert.throws(() => pricing.normalizeContractPricing(fixed), /INVALID/)
  const approximate = budgetPricing(); approximate.running.approximateOre = 1; assert.throws(() => pricing.normalizeContractPricing(approximate), /INVALID/)
  const incomplete = budgetPricing(); incomplete.budget.assumptions = ''; incomplete.budget.reviewTerms = ''
  assert.equal(pricing.contractPricingIssues(incomplete).length, 2)
})

test('explicit customer-price import populates budgets only and never rewrites source or dormant fixed amounts', () => {
  const p = budgetPricing(), original = structuredClone(p), source = { id: a, title: 'Plattsättning', amountOre: 12000000 }
  const next = pricing.importContractPrices(p, [source], [a])
  assert.equal(next.rows[0].amountOre, 777777)
  assert.equal(next.budget.rows.find(row => row.id === a).amountOre, 12000000)
  assert.equal(pricing.contractBudgetAmount(next), 17000000)
  assert.equal(pricing.contractFixedAmount(next), null)
  assert.deepEqual(p, original); assert.equal(source.amountOre, 12000000)
})

test('public HTML and PDF show the same budget and conditions without internal or dormant prices', () => {
  const p = budgetPricing(); p.rows[0].sourceItemId = a
  const exposed = publicDraft(budgetDraft(p)), h = editor(exposed.contractPricing)
  const html = text(h.document()), sections = contractSigningSections({ snapshot: exposed, files: [] }), all = JSON.stringify(sections)
  assert.match(html, /150\s*000,00/); assert.match(html, /Planeringsbudget/); assert.match(html, /Uppföljning och samråd/)
  assert.doesNotMatch(html, /Ungefärligt pris|7777,77|8888,88/)
  const budget = sections.find(section => section.title === 'Planeringsbudget inklusive moms')
  assert.equal(budget.rows.length, 3); assert.match(budget.rows.at(-1)[1], /150\s*000,00/)
  assert.match(all, /prognosen visar risk/); assert.doesNotMatch(all, /Ungefärligt pris|777777|888888|sourceItemId/)
  assert.ok(exposed.contractPricing.rows.every(row => row.amountOre === null && row.sourceItemId === undefined))
})

test('legacy prices retain their exact normalized shape and do not acquire budgets just by opening', () => {
  const p = budgetPricing(); delete p.budget
  const before = pricing.normalizeContractPricing(p), h = editor(before)
  h.render(); assert.equal(h.changes.length, 0)
  assert.equal('budget' in pricing.normalizeContractPricing(before), false)
  assert.equal('budget' in publicDraft(budgetDraft(before)).contractPricing, false)
})

test('strategy changes require confirmation before replacing approximate or budget values', () => {
  const p = budgetPricing(); delete p.budget; p.running.approximateOre = 25000000
  const h = editor(p)
  h.modes('Prisform').props.onChange('budget'); assert.equal(h.changes.length, 0)
  h.button('Avbryt byte av prisupplägg').props.onClick(); assert.equal(h.props.value.running.approximateOre, 25000000)
  h.modes('Prisform').props.onChange('budget'); h.button('Bekräfta byte av prisupplägg').props.onClick()
  assert.equal(h.props.value.running.approximateOre, null); assert.deepEqual(h.props.value.budget.rows, [])
  assert.equal(h.input('Ungefärligt pris för den löpande delen inkl. moms (kr, valfritt)'), undefined)
  h.modes('Prisform').props.onChange('fixed'); assert.equal(h.props.value.mode, 'running')
  h.button('Bekräfta byte av prisupplägg').props.onClick()
  assert.equal(h.props.value.mode, 'fixed'); assert.equal(h.props.value.budget, null)
  assert.equal(h.props.value.rows[0].amountOre, 777777)
})

test('budget editing, mixed rows and deletion use the existing onChange with immutable values', () => {
  const p = budgetPricing(), before = structuredClone(p), h = editor(p)
  h.input('Budget för Plattsättning inkl. moms (kr)').props.onChange(0)
  assert.equal(h.props.value.budget.rows.find(row => row.id === a).amountOre, 0)
  assert.deepEqual(p, before)
  h.modes('Prisform').props.onChange('mixed'); assert.ok(h.props.value.budget)
  h.button('Radera prisrad Plattsättning').props.onClick(); h.button('Radera prisrad').props.onClick()
  assert.equal(h.props.value.rows.length, 1); assert.deepEqual(h.props.value.budget.rows, [{ id: b, amountOre: 5000000 }])
  h.props.blocked = true
  const count = h.changes.length; h.input('Budget för Målning inkl. moms (kr)').props.onChange(1)
  assert.equal(h.changes.length, count)
})
