import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import * as offers from '../src/lib/action-cases/customerOffers.ts'
import * as prices from '../src/lib/action-cases/contractPricing.ts'
import * as hours from '../src/lib/action-cases/offerHourEstimate.ts'
import * as payments from '../src/lib/action-cases/customerPaymentPlan.ts'
import { emptyCustomerOffer, normalizeCustomerOffer, customerOfferBaseAmount, customerOfferTotal, mapCustomerOffer, offerPublishIssues } from '../src/lib/action-cases/customerOffers.ts'
import { contractPricingForEditing } from '../src/lib/action-cases/contractPricing.ts'
import { estimatedLabourRange, normalizeOfferHourEstimate, offerHourEstimateIssues } from '../src/lib/action-cases/offerHourEstimate.ts'

const draft = () => {
  const fixed = { ...emptyCustomerOffer('Fiktiv offert'), contractForm: 'custom', baseAmountOre: 123456, validUntil: '2099-01-01',
    terms: 'Villkor', paymentTerms: 'Faktura', schedule: 'Efter beställning',
    items: [{ id: randomUUID(), title: 'Rivning', scope: 'Fiktiv omfattning', kind: 'included', amountOre: null }] }
  return normalizeCustomerOffer({ ...fixed, pricingMode: 'total',
    contractPricing: { ...contractPricingForEditing(fixed), mode: 'running',
      running: { hourlyOre: 75000, managementOre: null, markupPercent: 0, approximateOre: null } },
    offerHourEstimate: { version: 1, minHours: 80, maxHours: 100 } })
}

test('80-100 hours at 750 incl VAT computes only estimated labour, never a fixed price or approximate total', () => {
  const d = draft(), before = structuredClone(d)
  assert.deepEqual(estimatedLabourRange(d), { minOre: 6000000, maxOre: 7500000 })
  assert.equal(customerOfferBaseAmount(d), null)
  assert.equal(customerOfferTotal(d, []), null)
  assert.equal(d.contractPricing.running.approximateOre, null)
  assert.deepEqual(offerPublishIssues(d), [])
  assert.deepEqual(d, before)
})

test('drafts retain missing, cleared and reversed hours without fabricating an amount', () => {
  for (const estimate of [null, { version: 1, minHours: null, maxHours: 100 }, { version: 1, minHours: 100, maxHours: 80 }]) {
    const d = normalizeCustomerOffer({ ...draft(), offerHourEstimate: estimate })
    assert.deepEqual(d.offerHourEstimate, estimate)
    assert.equal(estimatedLabourRange(d), null)
    assert.equal(offerHourEstimateIssues(d).length, estimate === null ? 0 : 1)
  }
  const d = draft(); d.contractPricing.running.hourlyOre = null
  assert.equal(estimatedLabourRange(d), null)
  assert(offerPublishIssues(d).some(issue => issue.includes('timpris')))
})

test('zero and fractional hours work; money rounds once and excessive totals cannot be presented', () => {
  const d = draft()
  d.offerHourEstimate = { version: 1, minHours: 0, maxHours: 1.25 }
  d.contractPricing.running.hourlyOre = 10001
  assert.deepEqual(estimatedLabourRange(d), { minOre: 0, maxOre: 12501 })
  d.contractPricing.running.hourlyOre = 100000000000
  assert.equal(estimatedLabourRange(d), null)
  assert.equal(offerHourEstimateIssues(d).length, 1)
})

test('hour normalization rejects strings, negative, nonfinite, excessive and malformed values', () => {
  for (const value of [undefined, [], {}, { version: 2, minHours: 1, maxHours: 2 },
    ...['80', -1, NaN, Infinity, 100001, 1.234].map(minHours => ({ version: 1, minHours, maxHours: 100 }))]) {
    assert.throws(() => normalizeOfferHourEstimate(value), /CUSTOMER_OFFER_INVALID/)
  }
})

test('fixed prices and old signed snapshots are not upgraded; toggling fixed restores the original price', () => {
  const old = { ...emptyCustomerOffer('Gammalt'), baseAmountOre: 123456 }
  const original = structuredClone(old), normalized = normalizeCustomerOffer(old)
  assert.equal(normalized.offerHourEstimate, undefined)
  assert.equal(normalized.contractPricing, undefined)
  const d = draft(); d.contractPricing.mode = 'fixed'
  assert.equal(customerOfferBaseAmount(d), 123456)
  assert.equal(estimatedLabourRange(d), null)
  assert.deepEqual(offerHourEstimateIssues(d), [])
  assert.deepEqual(old, original)
})

test('public offer projection preserves hours and rates but omits internal calculation and source identifiers', () => {
  const d = draft(), before = structuredClone(d)
  d.items[0].sourceItemId = randomUUID()
  const exposed = mapCustomerOffer({ id: randomUUID(), version: 1, status: 'published', files: [],
    snapshot: { ...d, internal_costing: { secret: 123 }, projectTitle: 'Test', propertyAddress: '', customerName: '', customerEmail: '', issuerName: '', replyEmail: '' } }).snapshot
  assert.deepEqual(exposed.offerHourEstimate, before.offerHourEstimate)
  assert.deepEqual(estimatedLabourRange(exposed), { minOre: 6000000, maxOre: 7500000 })
  assert.equal(exposed.internal_costing, undefined)
  assert.equal(exposed.items[0].sourceItemId, undefined)
})

test('the real offer document prints rates and estimated labour once, never internal costs or a fixed total', () => {
  const jsx = (type, props) => ({ type, props })
  const modules = { 'react/jsx-runtime': { jsx, jsxs: jsx }, react: { useId: () => 'test' }, 'lucide-react': {},
    '@/lib/action-cases/customerOffers': offers, '@/lib/action-cases/contractPricing': prices,
    '@/lib/action-cases/offerHourEstimate': hours, '@/lib/action-cases/offerImport': {},
    '@/lib/action-cases/customerPaymentPlan': payments, './CustomerOfferPriceInput': {},
    './CustomerContractFields': {}, './CustomerPaymentPlan': {}, './CustomerContractSiteFacilities': {}, './CustomerContractPartiesEditor': {} }
  const load = name => {
    const code = ts.transpileModule(readFileSync(new URL(`../src/components/tasks/${name}.tsx`, import.meta.url), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 }
    }).outputText
    const loaded = { exports: {} }
    new Function('require', 'module', 'exports', code)(key => {
      if (!(key in modules)) throw Error(key)
      return modules[key]
    }, loaded, loaded.exports)
    return loaded.exports
  }
  modules['./CustomerContractPricing'] = load('CustomerContractPricing')
  modules['./CustomerOfferHourEstimate'] = load('CustomerOfferHourEstimate')
  const Document = load('CustomerOfferDocument').default
  const flatten = node => Array.isArray(node) ? node.flatMap(flatten) : node && typeof node === 'object'
    ? flatten(typeof node.type === 'function' ? node.type(node.props) : node.props?.children) : [node]
  const view = (snapshot, purpose = 'offer') => flatten(Document({ offer: { status: 'published', version: 0, snapshot, files: [] }, selected: [], purpose, fileUrl: () => '' }))
    .filter(value => typeof value === 'string' || typeof value === 'number').join(' ')
  const d = draft(), output = view({ ...d, internal_costing: { secret: 987654321 } })
  assert.match(output, /80–100 timmar/)
  assert.match(output, /750,00/)
  assert.match(output, /60\s000,00/)
  assert.match(output, /75\s000,00/)
  assert.match(output, /inte fast pris eller takpris/)
  assert.match(output, /Ingen fast offertsumma/)
  assert.doesNotMatch(output, /987654321|Totalsumma|Avtalets prisgrunder/)
  assert.equal(output.match(/Uppskattad tidsåtgång/g).length, 1)
  assert.doesNotMatch(view(d, 'contract'), /80–100 timmar/)
  d.contractPricing.mode = 'fixed'
  assert.doesNotMatch(view(d), /80–100 timmar|inte fast pris eller takpris/)
})
