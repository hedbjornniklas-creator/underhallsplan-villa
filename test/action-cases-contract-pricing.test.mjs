import assert from 'node:assert/strict'
import { test } from 'node:test'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import * as prices from '../src/lib/action-cases/contractPricing.ts'
import * as offers from '../src/lib/action-cases/customerOffers.ts'

const row = (title = 'Mark', amountOre = 10000) => ({ id: randomUUID(), title, kind: 'fixed', amountOre, labourOre: null, materialOre: null })
const pricing = () => ({ version: 1, mode: 'fixed', display: 'priced', split: 'combined', basis: 'rows', rows: [row(), row('Tak', 20000)],
  totalOre: null, labourOre: null, materialOre: null, running: { hourlyOre: null, managementOre: null, markupPercent: null, approximateOre: null } })
const draft = (p = pricing()) => offers.normalizeCustomerOffer({ ...offers.emptyCustomerOffer('Testavtal'), baseAmountOre: 999999,
  contractForm: 'custom', validUntil: '2099-01-01', schedule: 'Tider', terms: 'Villkor', paymentTerms: 'Efter utfört arbete',
  items: [{ id: randomUUID(), kind: 'included', title: 'Mark', scope: 'Hela omfattningen', amountOre: 987654 }], contractPricing: p })
const publicOffer = (d) => offers.mapCustomerOffer({ id: randomUUID(), snapshot: d, files: [], version: 1, status: 'published' })

test('contract prices are canonical and independent of scope, the offer and the former base amount', () => {
  const d = draft(), original = structuredClone(d)
  assert.equal(d.baseAmountOre, 30000)
  assert.equal(d.pricingMode, 'total')
  assert.equal(offers.customerOfferBaseAmount({ ...d, items: d.items.map((r) => ({ ...r, amountOre: 42 })) }), 30000)
  assert.equal(offers.customerOfferTotal(d, []), 30000)
  assert.deepEqual(d, original)
  assert.deepEqual(prices.contractPricingIssues(d.contractPricing), [])
  assert.deepEqual(offers.offerPublishIssues(d), [])
})

test('legacy lump sums and signed snapshots do not acquire guessed allocations or a new format', () => {
  const old = { ...offers.emptyCustomerOffer(), baseAmountOre: 120000, items: [{ ...draft().items[0], amountOre: null }] }
  const original = structuredClone(old), p = prices.contractPricingForEditing(old)
  assert.equal(p.basis, 'total')
  assert.equal(prices.contractFixedAmount(p), 120000)
  assert.equal(p.rows[0].amountOre, null)
  assert.equal(p.labourOre, null)
  assert.deepEqual(old, original)
  assert.equal(offers.normalizeCustomerOffer(old).contractPricing, undefined)
  assert.equal(publicOffer(old).snapshot.contractPricing, undefined)
})

test('unknown is not zero; explicit zero is supported for labour, material and fixed totals', () => {
  const p = pricing()
  p.rows[0].amountOre = null
  assert.equal(prices.contractFixedAmount(p), null)
  assert(prices.contractPricingIssues(p).length)
  p.rows[0].amountOre = 0
  assert.equal(prices.contractFixedAmount(p), 20000)
  p.split = 'separate'
  p.rows = p.rows.map((r) => ({ ...r, labourOre: 0, materialOre: r.amountOre }))
  assert.equal(prices.contractFixedAmount(p), 20000)
  p.rows[1].labourOre = null
  assert.equal(prices.contractFixedAmount(p), null)
})

test('running prices have no fixed total, require rates, and preserve an optional approximate price separately', () => {
  const p = { ...pricing(), mode: 'running', running: { hourlyOre: 65000, managementOre: null, markupPercent: 10, approximateOre: 500000 } }
  const d = draft(p)
  assert.equal(d.baseAmountOre, null)
  assert.equal(offers.customerOfferTotal(d, []), null)
  assert.equal(offers.customerPriceLabel(d), 'Löpande räkning')
  assert.deepEqual(offers.offerPublishIssues(d), [])
  p.running.hourlyOre = 0
  p.running.managementOre = 0
  p.running.markupPercent = null
  assert.equal(prices.contractPricingIssues(p).length, 3)
  assert.throws(() => offers.customerOfferTotal(d, [randomUUID()]), /INVALID/)
})

test('mixed prices count only fixed rows and need an explicit fixed/running boundary', () => {
  const p = pricing(); p.mode = 'mixed'
  assert(prices.contractPricingIssues(p).some((s) => s.includes('vilka moment')))
  p.rows[1].kind = 'running'
  p.running = { hourlyOre: 65000, managementOre: 75000, markupPercent: 0, approximateOre: null }
  const d = draft(p)
  assert.equal(d.baseAmountOre, 10000)
  assert.deepEqual(offers.offerPublishIssues(d), [])
  assert.match(offers.customerPriceLabel(d), /^Fast del .* \+ löpande räkning$/)
})

test('selected imports overwrite only their price rows and never change source data or contract text', () => {
  const p = pricing(), first = { id: randomUUID(), title: 'Mark', amountOre: 40000 }, second = { id: randomUUID(), title: 'Fönster', amountOre: 50000 }
  const before = structuredClone(p), source = structuredClone(first)
  const next = prices.importContractPrices(p, [first, second], [first.id])
  assert.equal(next.rows.length, 2)
  assert.equal(next.rows[0].amountOre, 40000)
  assert.equal(next.rows[0].id, p.rows[0].id)
  assert.equal(next.rows[0].sourceItemId, first.id)
  assert.deepEqual(next.rows[1], p.rows[1])
  assert.deepEqual(p, before)
  assert.deepEqual(first, source)
  first.title = 'Ändrat namn'; first.amountOre = 60000
  assert.equal(prices.importContractPrices(next, [first], [first.id]).rows[0].title, 'Mark')
  assert.equal(prices.importContractPrices(next, [second], [second.id]).rows.length, 3)
  assert.notEqual(prices.importContractPrices(next, [second], [second.id]).rows[2].id, second.id)
  assert.throws(() => prices.importContractPrices(p, [first], [first.id, first.id]), /INVALID/)
  assert.throws(() => prices.importContractPrices(p, [{ ...first, amountOre: null }], [first.id]), /INVALID/)
})

test('ambiguous legacy titles and too many price rows abort the entire import without guessing or partial writes', () => {
  const p=pricing(), source={ id:randomUUID(),title:'Mark',amountOre:40000 }
  p.rows.push(row('Mark',50000))
  const before=structuredClone(p)
  assert.throws(()=>prices.importContractPrices(p,[source],[source.id]),/AMBIGUOUS/)
  assert.deepEqual(p,before)
  const full={ ...pricing(),rows:Array.from({length:200},(_,i)=>row(`Moment ${i}`,100)) }
  assert.throws(()=>prices.importContractPrices(full,[source],[source.id]),/INVALID/)
  assert.equal(full.rows.length,200)
})

test('hidden line prices and source identifiers never reach the public projection, but scope and total remain', () => {
  for (const display of ['priced', 'unpriced', 'total']) {
    const d = draft(); d.contractPricing.display = display
    d.contractPricing.rows[0].sourceItemId = randomUUID()
    const original = structuredClone(d), exposed = publicOffer(d).snapshot
    assert.equal(exposed.items[0].amountOre, null)
    assert.equal(exposed.items[0].scope, 'Hela omfattningen')
    assert.equal(exposed.contractPricing.rows[0].sourceItemId, undefined)
    assert.equal(exposed.contractPricing.rows[0].amountOre, display === 'priced' ? 10000 : null)
    assert.equal(offers.customerOfferBaseAmount(exposed), 30000)
    assert.equal(offers.normalizeCustomerOffer(exposed).baseAmountOre, 30000)
    assert.deepEqual(d, original)
  }
})

test('split totals survive public redaction without exposing the underlying labour/material line prices', () => {
  const p = pricing(); p.display = 'unpriced'; p.split = 'separate'
  p.rows = p.rows.map((r) => ({ ...r, labourOre: r.amountOre / 2, materialOre: r.amountOre / 2 }))
  const exposed = publicOffer(draft(p)).snapshot
  assert.equal(exposed.contractPricing.labourOre, 15000)
  assert.equal(exposed.contractPricing.materialOre, 15000)
  assert.equal(exposed.contractPricing.rows[0].labourOre, null)
  assert.equal(offers.normalizeCustomerOffer(exposed).baseAmountOre, 30000)
})

test('inactive price forms, splits and running-row amounts never leak into the customer snapshot', () => {
  const p = pricing(); p.totalOre=765432; p.labourOre=555555; p.materialOre=666666
  p.rows[0].labourOre=123456; p.rows[0].materialOre=654321
  p.running.hourlyOre=77777
  let exposed=publicOffer(draft(p)).snapshot.contractPricing
  assert.equal(exposed.totalOre,null)
  assert.equal(exposed.rows[0].labourOre,null)
  assert.equal(exposed.running.hourlyOre,null)
  p.mode='running'
  exposed=publicOffer(draft(p)).snapshot.contractPricing
  assert.equal(exposed.totalOre,null)
  assert(exposed.rows.every((r)=>r.amountOre===null && r.labourOre===null && r.materialOre===null))
  p.mode='mixed'; p.rows[1].kind='running'
  exposed=publicOffer(draft(p)).snapshot.contractPricing
  assert.equal(exposed.rows[0].amountOre,10000)
  assert.equal(exposed.rows[1].amountOre,null)
})

test('malformed modes, identifiers, rates, money and overflowing totals fail closed', () => {
  for (const patch of [{ mode: 'budget' }, { display: 'internal' }, { split: 'guess' }, { basis: 'other' }, { version: 2 },
    { rows: [row(), row()].map((r) => ({ ...r, id: 'invalid' })) }, { totalOre: -1 }, { totalOre: 1.5 },
    { running: { ...pricing().running, markupPercent: 1.001 } }, { running: { ...pricing().running, hourlyOre: '65000' } },
    { rows: [row('A', 100_000_000_000), row('B', 100_000_000_000)] }])
    assert.throws(() => prices.normalizeContractPricing({ ...pricing(), ...patch }), /INVALID/)
  const p = pricing(); p.rows.push({ ...p.rows[0] })
  assert.throws(() => prices.normalizeContractPricing(p), /INVALID/)
})

function priceDocument(value) {
  const source = readFileSync(new URL('../src/components/tasks/CustomerContractPricing.tsx', import.meta.url), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText
  const loaded = { exports: {} }, jsx = (type, props) => ({ type, props })
  const modules = { 'react/jsx-runtime': { jsx, jsxs: jsx }, react: {}, 'lucide-react': {},
    '@/lib/action-cases/contractPricing': prices, '@/lib/action-cases/customerOffers': offers,
    '@/lib/action-cases/offerImport': {}, './CustomerOfferPriceInput': {} }
  new Function('require', 'module', 'exports', code)((name) => modules[name], loaded, loaded.exports)
  const flatten = (node) => Array.isArray(node) ? node.flatMap(flatten) : node && typeof node === 'object' ? flatten(node.props?.children) : [node]
  return flatten(loaded.exports.ContractPriceDocument({ value })).filter((n) => typeof n === 'string' || typeof n === 'number').join(' ')
}
test('customer document honours all three display modes and identifies mixed/running rates without a fake total', () => {
  const p = pricing()
  assert.match(priceDocument(p), /Mark/)
  assert.match(priceDocument(p), /100,00/)
  p.display = 'unpriced'
  assert.match(priceDocument(p), /Mark/)
  assert.doesNotMatch(priceDocument(p), /100,00/)
  p.display = 'total'
  assert.doesNotMatch(priceDocument(p), /Mark/)
  assert.match(priceDocument(p), /300,00/)
  p.mode = 'running'; p.running.hourlyOre = 65000; p.running.markupPercent = 10
  assert.match(priceDocument(p), /Ingen fast kontraktssumma/)
  assert.match(priceDocument(p), /650,00/)
  assert.doesNotMatch(priceDocument(p), /300,00/)
})
