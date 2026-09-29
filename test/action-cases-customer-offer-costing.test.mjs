import test from 'node:test'
import assert from 'node:assert/strict'
import { customerOfferCalculatedPrice, normalizeCustomerOfferCosting, emptyCustomerOfferCalculation } from '../src/lib/action-cases/customerOfferCosting.ts'
import { normalizeCustomerOffer, emptyCustomerOffer } from '../src/lib/action-cases/customerOffers.ts'

const id = '00000000-0000-4000-8000-000000000001'
const item = { id, title: 'Windows', scope: 'Supply', kind: 'option', amountOre: null }
const calc = { purchaseOre: 1_000_000, fixedMarkupOre: 100_000, markupBasisPoints: 1000,
  additions: [{ id, title: 'Montage', amountOre: 200_000 }] }

test('fixed and percentage markup combine, percentage excludes additions, VAT is applied once', () => {
  assert.deepEqual(customerOfferCalculatedPrice(calc), {
    netOre: 1_400_000, vatOre: 350_000, grossOre: 1_750_000, percentageMarkupOre: 100_000
  })
  assert.equal(customerOfferCalculatedPrice({ ...calc, fixedMarkupOre: null }).grossOre, 1_625_000)
  assert.equal(customerOfferCalculatedPrice({ ...calc, markupBasisPoints: null }).grossOre, 1_625_000)
  assert.equal(customerOfferCalculatedPrice({ ...calc, purchaseOre: 10_010_871, fixedMarkupOre: null, markupBasisPoints: null, additions: [] }).grossOre, 12_513_589)
})
test('missing purchase or unfinished additions never becomes a zero price; explicit zero is allowed', () => {
  assert.equal(customerOfferCalculatedPrice(emptyCustomerOfferCalculation()), null)
  for (const patch of [{ title: '' }, { amountOre: null }]) {
    assert.equal(customerOfferCalculatedPrice({ ...calc, additions: [{ ...calc.additions[0], ...patch }] }), null)
  }
  assert.equal(customerOfferCalculatedPrice({ ...emptyCustomerOfferCalculation(), purchaseOre: 0 }).grossOre, 0)
})
test('percent and VAT round half-up to whole ore without floating point multiplication', () => {
  assert.deepEqual(customerOfferCalculatedPrice({ ...emptyCustomerOfferCalculation(), purchaseOre: 50, markupBasisPoints: 100 }), {
    percentageMarkupOre: 1, netOre: 51, vatOre: 13, grossOre: 64
  })
})
test('private normalization rejects invalid money, rates, duplicate IDs and overflow', () => {
  const normalize = (value) => normalizeCustomerOfferCosting({ [id]: value }, [item])
  for (const amount of [-1, 1.1, '100', Infinity, 100_000_000_001])
    assert.throws(() => normalize({ ...calc, purchaseOre: amount }), /INVALID/)
  assert.throws(() => normalize({ ...calc, markupBasisPoints: 100_001 }), /INVALID/)
  assert.throws(() => normalize({ ...calc, purchaseOre: 100_000_000_000 }), /INVALID/)
  assert.throws(() => normalize({ ...calc, additions: [calc.additions[0], calc.additions[0]] }), /INVALID/)
  assert.throws(() => normalizeCustomerOfferCosting(null, [item]), /INVALID/)
  assert.deepEqual(normalizeCustomerOfferCosting({ [id]: calc }, []), {})
  assert.deepEqual(normalizeCustomerOfferCosting(undefined, [item]), {})
})
test('normalization isolates costing from public draft, keeps customer price unchanged, and strips unknown private fields', () => {
  const draft = normalizeCustomerOffer({ ...emptyCustomerOffer(), costing: { [id]: calc }, items: [{ ...item, purchaseOre: calc.purchaseOre }] })
  assert.equal(draft.items[0].amountOre, null)
  assert.equal(draft.costing, undefined)
  assert.equal(draft.items[0].purchaseOre, undefined)
  assert.deepEqual(normalizeCustomerOfferCosting({ [id]: { ...calc, secret: 'not allowed' } }, [item]), { [id]: calc })
})
