import test from 'node:test'
import assert from 'node:assert/strict'
import { choiceOfferForEditing, normalizeChoiceOffer, synchronizeChoiceOffers, calculatedChoicePricing, choiceOfferBudget, choicePriceLabel, choiceTimeText } from '../src/lib/action-cases/choiceOffer.ts'
import { choiceOfferSections } from '../src/lib/action-cases/choiceOfferDocument.ts'
import { normalizeCustomerChoiceCosting, choiceRowCost, choiceCalculatedPrice, guardChoiceCostingDowngrade } from '../src/lib/action-cases/customerChoiceCosting.ts'
import { normalizePlannedItems } from '../src/lib/action-cases/customerPlanning.ts'

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const item = { id: id(1), title: 'Fiktivt alternativ', scope: 'Montage enligt beskrivning.', budgetOre: 12300, decisionBy: '', status: 'planned' }
const row = (n, patch = {}) => ({ id: id(n), title: 'Material', costOre: 10000, markupBasisPoints: 1500, fixedMarkupOre: null, complete: false, quantity: 2.5, unit: 'm', unitCostOre: 4000, category: 'material', chargeType: 'fixed', ...patch })
const offer = patch => ({ ...choiceOfferForEditing(item), ...patch })

test('opening an older alternative preserves its customer price and makes no changes', () => {
  const before = structuredClone(item), value = choiceOfferForEditing(item)
  assert.equal(value.priceSource, 'manual'); assert.equal(choiceOfferBudget(value), 12300)
  assert.deepEqual(item, before); assert.equal(item.offer, undefined)
  assert.deepEqual(normalizePlannedItems([item]), [item])
})
test('offer terms round-trip independently, including explicit free and unknown prices', () => {
  const value = offer({ conditions: 'Tillträde finns.', exclusions: 'Målning ingår inte.', priceNeutral: true })
  assert.deepEqual(normalizeChoiceOffer(value), value)
  assert.equal(choiceOfferBudget(value), 0)
  assert.equal(choicePriceLabel({ ...item, offer: value }, String), 'Ingår utan prisändring')
  const unknown = offer({ pricing: { ...value.pricing, totalOre: null } })
  assert.equal(choiceOfferBudget(unknown), null)
  assert.match(choicePriceLabel({ ...item, offer: unknown, budgetOre: null }, String), /ej fastställt/)
  assert.deepEqual(normalizePlannedItems([{ ...item, offer: value }])[0].offer, value)
})
test('bounded terms reject malformed types, amounts, days and versions', () => {
  for (const bad of [null, [], { ...offer(), version: 2 }, { ...offer(), priceNeutral: 1 }, { ...offer(), kind: 'approval' }, { ...offer(), conditions: 'x'.repeat(6001) }, { ...offer(), time: null },
    ...[-1, 1.2, 3651, '2', NaN].map(workingDays => ({ ...offer(), time: { status: 'extension', workingDays, explanation: '' } }))]) assert.throws(() => normalizeChoiceOffer(bad), /INVALID/)
})
test('quantity and unit costs round using ore, retain zero and reject mismatched derived costs', () => {
  assert.equal(choiceRowCost(row(2)), 10000)
  assert.equal(choiceRowCost(row(2, { quantity: 0.001, unitCostOre: 1500, costOre: 2 })), 2)
  assert.equal(choiceRowCost(row(2, { unitCostOre: 0 })), 0)
  assert.equal(choiceRowCost(row(2, { quantity: null })), null)
  const normalize = value => normalizeCustomerChoiceCosting({ [item.id]: value }, [item])
  const good = { version: 3, priceMode: 'calculated', rows: [row(2)] }
  assert.deepEqual(normalize(good)[item.id], good)
  for (const patch of [{ quantity: 1 }, { quantity: 0.0001 }, { quantity: -1 }, { quantity: 1e20 }, { unitCostOre: 1.2 }, { unit: '' }, { category: 'wrong' }, { chargeType: 'unknown' }]) assert.throws(() => normalize({ ...good, rows: [row(2, patch)] }), /INVALID/)
  assert.throws(() => normalize({ ...good, version: '3' }), /INVALID/)
  assert.throws(() => guardChoiceCostingDowngrade({ [item.id]: good }, { [item.id]: { version: 2, priceMode: 'calculated', rows: [] } }), /STALE/)
})
test('calculated price rows allocate VAT rounding to the same aggregate as the internal worksheet', () => {
  const rows = [row(2, { quantity: 1, unitCostOre: 1, costOre: 1, markupBasisPoints: 0 }), row(3, { quantity: 1, unitCostOre: 1, costOre: 1, markupBasisPoints: 0 })]
  const pricing = calculatedChoicePricing(offer(), rows)
  assert.equal(pricing.rows.reduce((sum, row) => sum + row.amountOre, 0), choiceCalculatedPrice(rows).grossOre)
  assert.equal(choiceOfferBudget(offer({ pricing })), 3)
  assert.equal(calculatedChoicePricing(offer(), [row(2, { title: '' })]).rows[0].amountOre, null)
})
test('internal worksheet edits change only opted-in fixed customer prices', () => {
  const manual = { ...item, offer: offer() }, calculated = { ...item, offer: offer({ priceSource: 'calculation' }) }
  const costs = { [item.id]: { version: 3, priceMode: 'calculated', rows: [row(2)] } }
  assert.equal(synchronizeChoiceOffers([manual], costs)[0].budgetOre, 12300)
  assert.equal(synchronizeChoiceOffers([calculated], costs)[0].budgetOre, 14375)
  assert.equal(synchronizeChoiceOffers([item], costs)[0], item)
  assert.equal(synchronizeChoiceOffers([calculated], { [item.id]: { ...costs[item.id], rows: [row(2, { quantity: null, costOre: null })] } })[0].budgetOre, null)
})
test('running or mixed internal estimates never become a fixed customer total', () => {
  for (const mode of ['running', 'mixed']) {
    const value = offer({ priceSource: 'calculation', pricing: { ...offer().pricing, mode } })
    const next = synchronizeChoiceOffers([{ ...item, offer: value }], { [item.id]: { version: 3, priceMode: 'calculated', rows: [row(2), row(3, { chargeType: 'running' })] } })[0]
    assert.equal(next.budgetOre, null)
    assert.match(choicePriceLabel(next, String), /löpande/i)
  }
})
test('customer document honours total, unpriced, priced and labour/material presentation', () => {
  for (const display of ['total', 'unpriced', 'priced']) {
    const value = offer({ pricing: { ...offer().pricing, basis: 'rows', display, rows: [{ id: id(2), title: 'Montage', kind: 'fixed', amountOre: 10000, labourOre: null, materialOre: null }] } })
    const section = choiceOfferSections({ ...item, offer: value }).find(s => s.title === 'Fast pris')
    assert.match(section.paragraphs.join(), /100,00/)
    assert.equal(Boolean(section.rows), display !== 'total')
    if (section.rows) assert.equal(section.rows[0].length, display === 'priced' ? 2 : 1)
  }
  const value = offer({ pricing: { ...offer().pricing, split: 'separate', labourOre: 0, materialOre: 50000 } })
  assert.match(JSON.stringify(choiceOfferSections({ ...item, offer: value })), /Arbete: 0,00/)
})
test('PDF/public projection includes customer running terms and time, not private costs or a false fixed total', () => {
  const value = offer({ pricing: { ...offer().pricing, mode: 'running', running: { hourlyOre: 75000, managementOre: null, markupPercent: 15, approximateOre: 900000 } }, time: { status: 'extension', workingDays: 3, explanation: 'Leveransen påverkar färdigställandet.' } })
  const text = JSON.stringify(choiceOfferSections({ ...item, offer: value, internal_costing: { costOre: 123456789, secret: 'private' } }))
  for (const phrase of ['750,00', '15 %', 'Moms tillkommer', 'inte ett fast pris', '3 arbetsdagar']) assert.ok(text.includes(phrase), phrase)
  assert.doesNotMatch(text, /123456789|private|costOre|Fast pris inklusive/)
  assert.match(choiceTimeText({ status: 'extension', workingDays: null, explanation: '' }), /inte fastställd/)
})
