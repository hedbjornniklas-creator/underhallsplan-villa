import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import * as pricing from '../src/lib/action-cases/contractPricing.ts'
import * as offers from '../src/lib/action-cases/customerOffers.ts'
import { emptyCustomerCharge, emptyProjectCustomerPricing } from '../src/lib/action-cases/projectCustomerPricing.ts'
import { contractSigningSections } from '../src/lib/action-cases/contractSigningPdf.ts'

const terms = (charge, patch = {}) => ({ ...emptyProjectCustomerPricing(), combined: { ...emptyCustomerCharge(), mode: 'running', ...charge }, ...patch })
const row = (title, value) => ({ id: randomUUID(), sourceItemId: randomUUID(), title, kind: 'running', amountOre: null, labourOre: null, materialOre: null, projectPricing: { revision: 1, terms: value } })
const price = rows => ({ version: 1, mode: 'running', basis: 'rows', split: 'combined', display: 'priced', rows, totalOre: null, labourOre: null, materialOre: null,
  running: { hourlyOre: null, managementOre: null, markupPercent: null, approximateOre: null } })
const snapshot = p => ({ ...offers.emptyCustomerOffer('Fiktivt underlag'), contractForm: 'custom', contractPricing: p, items: [], issuerName: 'Fiktiv byggare', replyEmail: '', customerName: 'Fiktiv kund', customerEmail: '', projectTitle: 'Test', propertyAddress: '' })
const document = (p, kind) => contractSigningSections({ kind, files: [], snapshot: snapshot(p) })
const jsx = (type, props) => ({ type, props })
const nodes = value => Array.isArray(value) ? value.flatMap(nodes) : value?.props ? [value, ...nodes(value.props.children)] : []
const text = value => typeof value === 'string' || typeof value === 'number' ? String(value) : Array.isArray(value) ? value.map(text).join(' ') : value?.props ? text(value.props.children) : ''
function html(p, purpose) {
  const compiled = ts.transpileModule(readFileSync(new URL('../src/components/tasks/CustomerContractPricing.tsx', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
  const m = { exports: {} }
  new Function('require', 'module', 'exports', compiled)(name => ({ react: {}, 'react/jsx-runtime': { jsx, jsxs: jsx }, 'lucide-react': {},
    '@/lib/action-cases/contractPricing': pricing, '@/lib/action-cases/customerOffers': offers, '@/lib/action-cases/offerImport': {}, './CustomerOfferPriceInput': {} })[name], m, m.exports)
  return m.exports.ContractPriceDocument({ value: p, purpose })
}

test('combined running rates occupy one PDF row, with both supplied price bases in the same cell', () => {
  const p = price([row('Material', terms({ markupPercent: 15 })), row('Transport', terms({ hourlyOre: 75000, markupPercent: 0 })), row('Tom prisgrund', terms({}))])
  const before = structuredClone(p)
  for (const kind of [undefined, 'offer']) {
    const rates = document(p, kind).find(part => part.title === 'Momentens prisgrunder för löpande räkning')
    assert.deepEqual(rates.rows.map(row => row[0]), ['Material', 'Transport', 'Tom prisgrund'])
    assert.equal(rates.rows[0][1], 'Självkostnad + 15 % exkl. moms')
    assert.equal(rates.rows[1][1], `${offers.money(75000)}/tim inkl. moms\nSjälvkostnad + 0 % exkl. moms`)
    assert.equal(rates.rows[2][1], '')
  }
  assert.deepEqual(p, before)
})

test('separate labour and material remain separate PDF rows even when the titles match other moments', () => {
  const p = price([row('Montage', terms({}, { split: 'separate', labour: { ...emptyCustomerCharge(), mode: 'running', hourlyOre: 0 }, material: { ...emptyCustomerCharge(), mode: 'running', markupPercent: 15 } })), row('Montage', terms({ markupPercent: 5 }))])
  const rates = document(p).find(part => part.title === 'Momentens prisgrunder för löpande räkning')
  assert.deepEqual(rates.rows, [['Montage – arbete', `${offers.money(0)}/tim inkl. moms`], ['Montage – material', 'Självkostnad + 15 % exkl. moms'], ['Montage', 'Självkostnad + 5 % exkl. moms']])
})

test('shared budget tables and missing-budget notices include only budget-selected parts, preserving zero and null', () => {
  const p = price([row('Material utan budget', terms({ markupPercent: 15 })), row('Budget noll', terms({ mode: 'budget', budgetOre: 0 })), row('Budget saknas', terms({ mode: 'budget' }))])
  const before = structuredClone(p)
  assert.deepEqual(pricing.contractBudgetRows(p).map(row => [row.title, row.amountOre]), [['Budget noll', 0], ['Budget saknas', null]])
  assert.deepEqual(pricing.offerBudgetBreakdown(p), { runningOre: 0, unbudgetedTitles: ['Budget saknas'] })
  for (const kind of [undefined, 'offer']) {
    const budget = document(p, kind).find(part => part.title.startsWith('Planeringsbudget'))
    assert.deepEqual(budget.rows.map(row => row[0]).slice(0, -1), ['Budget noll', 'Budget saknas'])
    assert.equal(budget.rows[0][1], offers.money(0))
    assert.doesNotMatch(JSON.stringify(budget), /Material utan budget/)
    const tree = html(p, kind ?? 'contract'), section = nodes(tree).find(node => node.props['aria-label'] === 'Planeringsbudget')
    assert.doesNotMatch(text(section), /Material utan budget/)
    assert.match(text(section), /Budget noll/)
    assert.match(text(section), /Budget saknas/)
  }
  assert.deepEqual(p, before)
})

test('split shared budgets exclude their running sibling and retain only the chosen budget amount', () => {
  const p = price([row('Bygg', terms({}, { split: 'separate', labour: { ...emptyCustomerCharge(), mode: 'budget', budgetOre: 12300, hourlyOre: 75000 }, material: { ...emptyCustomerCharge(), mode: 'running', markupPercent: 15 } }))])
  assert.deepEqual(pricing.contractBudgetRows(p).map(row => [row.title, row.amountOre]), [['Bygg – arbete', 12300]])
  assert.deepEqual(pricing.offerBudgetBreakdown(p), { runningOre: 12300, unbudgetedTitles: [] })
})

test('legacy global budgets still report missing amounts and include legacy rows alongside shared budgets', () => {
  const legacy = row('Äldre budget', terms({})); delete legacy.projectPricing
  const p = { ...price([legacy, row('Vanlig löpande', terms({ markupPercent: 15 })), row('Ny budget', terms({ mode: 'budget', budgetOre: 50000 }))]),
    budget: { version: 1, rows: [], assumptions: '', reviewTerms: '' } }
  assert.deepEqual(pricing.contractBudgetRows(p).map(row => [row.title, row.amountOre]), [['Äldre budget', null], ['Ny budget', 50000]])
  assert.deepEqual(pricing.offerBudgetBreakdown(p), { runningOre: 50000, unbudgetedTitles: ['Äldre budget'] })
  p.rows = [legacy]
  assert.deepEqual(pricing.offerBudgetBreakdown(p), { runningOre: null, unbudgetedTitles: ['Äldre budget'] })
})

test('removing an orphan price link removes its synthesized budget, not scope or any remaining price terms', () => {
  const fixed = row('Fast arbete', terms({ mode: 'fixed', fixedOre: 78350000 })); fixed.kind = 'fixed'
  const stale = row('Golvslipning', terms({ mode: 'budget' }))
  const p = { ...price([fixed, row('Material', terms({ markupPercent: 15 })), stale]), mode: 'mixed' }
  const draft = { ...snapshot(p), items: [{ id: randomUUID(), title: 'Golvslipning - separat prisöverenskommelse', kind: 'included', scope: 'Omfattning bevaras', amountOre: null }] }
  const before = structuredClone(draft), cleaned = { ...draft, contractPricing: { ...p, rows: p.rows.filter(row => row.id !== stale.id) } }
  assert.equal(pricing.contractFixedAmount(cleaned.contractPricing), 78350000)
  assert.equal(pricing.contractDisplayPricing(cleaned.contractPricing).budget, null)
  assert.equal(pricing.offerBudgetBreakdown(cleaned.contractPricing), null)
  const sections = contractSigningSections({ snapshot: cleaned, files: [] })
  assert.equal(sections.some(part => part.title.startsWith('Planeringsbudget')), false)
  assert.deepEqual(sections.find(part => part.title === 'Momentens prisgrunder för löpande räkning').rows, [['Material', 'Självkostnad + 15 % exkl. moms']])
  assert.deepEqual(cleaned.items, before.items)
  assert.deepEqual(cleaned.contractPricing.rows, before.contractPricing.rows.slice(0, -1))
  assert.deepEqual(draft, before)
})
