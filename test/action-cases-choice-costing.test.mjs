import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { choiceCalculatedPrice, choiceRowPrice, choiceRows, guardChoiceCostingDowngrade, normalizeCustomerChoiceCosting, synchronizeChoicePrices } from '../src/lib/action-cases/customerChoiceCosting.ts'
import { customerOfferCalculatedPrice } from '../src/lib/action-cases/customerOfferCosting.ts'

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const item = { id: id(1), budgetOre: 16264948, title: 'Fiktivt fönsteralternativ' }
const legacy = { purchaseOre: 10010871, markupBasisPoints: 1000, fixedMarkupOre: null, additions: [{ id: id(2), title: 'Montage', amountOre: 2000000 }] }
const row = (n, patch = {}) => ({ id: id(n), title: 'Material', costOre: 10000, markupBasisPoints: 1000, fixedMarkupOre: null, complete: false, ...patch })
const calculation = rows => ({ version: 2, priceMode: 'calculated', rows })

test('opening legacy calculations preserves every price and field, with stable row IDs', () => {
  for (const fixedMarkupOre of [null, 0, 12345]) {
    const input = { ...legacy, fixedMarkupOre }, before = JSON.stringify(input)
    const rows = choiceRows(input, item.id)
    assert.deepEqual(rows, choiceRows(input, item.id))
    assert.equal(new Set(rows.map(r => r.id)).size, rows.length)
    assert.equal(choiceCalculatedPrice(rows).grossOre, customerOfferCalculatedPrice(input).grossOre)
    assert.equal(JSON.stringify(input), before)
    assert.deepEqual(normalizeCustomerChoiceCosting({ [item.id]: input }, [item]), { [item.id]: input })
  }
})

test('each choice row owns its markup; VAT is applied once to the rounded net total', () => {
  const rows = [row(3, { costOre: 10010871 }), row(4, { title: 'Montage', costOre: 2000000, markupBasisPoints: 0 })]
  assert.deepEqual(choiceCalculatedPrice(rows), { costOre: 12010871, netOre: 13011958, vatOre: 3252990, grossOre: 16264948 })
  assert.equal(choiceRowPrice({ ...rows[1], markupBasisPoints: 500 }), 2100000)
  assert.equal(choiceCalculatedPrice([{ ...rows[0], complete: true }, rows[1]]).grossOre, 16264948)
  assert.deepEqual(choiceCalculatedPrice([row(5, { costOre: 1, markupBasisPoints: 5000 }), row(6, { costOre: 1, markupBasisPoints: 5000 })]), { costOre: 2, netOre: 4, vatOre: 1, grossOre: 5 })
})

test('blank cost is unknown, zero is a real price, and incomplete rows never retain an old calculated price', () => {
  assert.equal(choiceCalculatedPrice([]), null)
  assert.equal(choiceCalculatedPrice([row(3, { costOre: null })]), null)
  assert.equal(choiceCalculatedPrice([row(3, { title: '' })]), null)
  assert.equal(choiceCalculatedPrice([row(3, { costOre: 0 })]).grossOre, 0)
  assert.equal(synchronizeChoicePrices([item], { [item.id]: calculation([row(3, { costOre: null })]) })[0].budgetOre, null)
})

test('only calculated choice prices change; manual, legacy and unrelated items stay independent', () => {
  const items = [item, { id: id(10), budgetOre: 900, title: 'Annat alternativ' }], before = JSON.stringify(items)
  const costs = { [item.id]: calculation([row(3)]), [id(10)]: { ...calculation([row(4)]), priceMode: 'manual' } }
  const updated = synchronizeChoicePrices(items, costs)
  assert.equal(updated[0].budgetOre, 13750)
  assert.equal(updated[1], items[1])
  assert.equal(JSON.stringify(items), before)
  assert.equal(synchronizeChoicePrices([item], { [item.id]: legacy })[0], item)
})

test('normalization retains row data but rejects malformed IDs, costs, markup, flags, overflow and duplicate rows', () => {
  const normalize = value => normalizeCustomerChoiceCosting({ [item.id]: value }, [item])
  const good = calculation([row(3)])
  assert.deepEqual(normalize({ ...good, secret: true }), { [item.id]: good })
  for (const bad of [null, [], { version: 3 }, { ...good, priceMode: 'guess' }, { ...good, rows: Array(51).fill(row(3)) }, calculation([row(3), row(3)]),
    ...[{ costOre: -1 }, { costOre: 1.1 }, { costOre: NaN }, { markupBasisPoints: 100001 }, { fixedMarkupOre: -5 }, { complete: 'yes' }, { complete: true, costOre: null }, { id: 'bad' }, { title: 'x'.repeat(201) }, { costOre: 100_000_000_000 }].map(patch => calculation([row(3, patch)]))]) {
    assert.throws(() => normalize(bad), /INVALID/)
  }
  assert.deepEqual(normalizeCustomerChoiceCosting({ [item.id]: good }, []), {})
  assert.throws(() => normalizeCustomerChoiceCosting(null, [item]), /INVALID/)
})

test('stale clients cannot remove a live row worksheet; deleting an option and explicit manual mode remain possible', () => {
  const stored = { [item.id]: calculation([row(3)]) }
  assert.throws(() => guardChoiceCostingDowngrade(stored, {}), /STALE/)
  assert.throws(() => guardChoiceCostingDowngrade(stored, { [item.id]: legacy }), /STALE/)
  assert.doesNotThrow(() => guardChoiceCostingDowngrade(stored, { [item.id]: { ...stored[item.id], priceMode: 'manual' } }))
  assert.doesNotThrow(() => guardChoiceCostingDowngrade(normalizeCustomerChoiceCosting(stored, []), {}))
})

test('choice UI reuses the project table, never the offer calculator or apply-price step', () => {
  const sheet = readFileSync(new URL('../src/components/tasks/CustomerChoiceOptionSheet.tsx', import.meta.url), 'utf8')
  const table = readFileSync(new URL('../src/components/tasks/CustomerChoiceCostTable.tsx', import.meta.url), 'utf8')
  assert.match(sheet, /CustomerChoiceCostTable/)
  assert.doesNotMatch(sheet, /CustomerOfferCostCalculator|onApply|Använd kundpris/)
  for (const text of ['Kalkylrad', 'Kostnad', 'Påslag', 'Kundpris', 'Klar', 'Ångra borttagning', 'Samlat kundpris']) assert.ok(table.includes(text))
  assert.doesNotMatch(table, /customer-contract|contractDetails|paymentPlan|fetch\(/)
})
