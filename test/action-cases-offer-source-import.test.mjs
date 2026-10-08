import assert from 'node:assert/strict'
import test from 'node:test'
import { prepareOfferSource, offerSourceTargets, importOfferSources } from '../src/lib/action-cases/offerImport.ts'
import { emptyCustomerOffer, normalizeCustomerOffer, mapCustomerOffer } from '../src/lib/action-cases/customerOffers.ts'

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const source = (n, title = `Arbetsdel ${n}`, fields = {}) => ({ id: id(n), title, scope: 'Ny omfattning', scopeConditionsAvailable: true,
  scopeConditions: 'Ny förutsättning', scopeNotesAvailable: true, scopeExclusions: 'Nytt undantag', scopeAdvice: 'Ny avrådan',
  costLines: [], lumpSum: { verified: true, customerPrice: 1000, internalCost: 600, vatRate: 25 }, ...fields })
const item = (n, title = `Arbetsdel ${n}`, fields = {}) => ({ id: id(n), title, scope: 'Egen gammal text',
  scopeConditions: 'Egen förutsättning', scopeExclusions: 'Eget undantag', scopeAdvice: 'Egen avrådan', kind: 'included', amountOre: 98765, ...fields })
const prepare = (sources) => Promise.all(sources.map(prepareOfferSource))

test('selected existing parts replace all texts, unselected parts and prices retain their exact value', async () => {
  const existing = [item(1), item(2), item(3, 'Tillval', { kind: 'option', optionGroup: 'Fönster' })]
  const frozen = structuredClone(existing)
  const rows = await prepare([source(1), source(2)])
  const result = importOfferSources(existing, rows, [{ sourceId: id(1) }], false)
  for (const key of ['title', 'scope', 'scopeConditions', 'scopeExclusions', 'scopeAdvice']) assert.equal(result[0][key], rows[0].values[key])
  assert.equal(result[0].amountOre, 98765)
  assert.equal(result[0].id, existing[0].id)
  assert.equal(result[0].sourceItemId, id(1))
  assert.strictEqual(result[1], existing[1])
  assert.strictEqual(result[2], existing[2])
  assert.deepEqual(existing, frozen)
})

test('select all replaces existing parts and appends only truly new work without changing order', async () => {
  const rows = await prepare([source(1), source(2), source(3)])
  const result = importOfferSources([item(2), item(1)], rows, rows.map((row) => ({ sourceId: row.id })), false)
  assert.deepEqual(result.map((row) => row.id), [id(2), id(1), id(3)])
  assert.equal(result[2].amountOre, null)
  assert.equal(result.length, 3)
  assert.deepEqual(importOfferSources(result, rows, rows.map((row) => ({ sourceId: row.id })), false), result)
  assert.deepEqual(importOfferSources(result, rows, [], false), result)
})

test('explicit empty fields clear text; unavailable fields do not erase older contract data', async () => {
  const cleared = importOfferSources([item(1)], await prepare([source(1, 'Grund', { scope: '', scopeConditions: '', scopeExclusions: '', scopeAdvice: '' })]), [{ sourceId: id(1) }], false)[0]
  for (const key of ['scope', 'scopeConditions', 'scopeExclusions', 'scopeAdvice']) assert.equal(cleared[key], '')
  const result = importOfferSources([item(1)], await prepare([source(1, 'Grund', { scopeConditionsAvailable: false, scopeNotesAvailable: false })]), [{ sourceId: id(1) }], false)[0]
  for (const key of ['scopeConditions', 'scopeExclusions', 'scopeAdvice']) assert.equal(result[key], item(1)[key])
})

test('verified customer prices are opt-in and unavailable prices never remove an existing price', async () => {
  const rows = await prepare([source(1)])
  assert.equal(importOfferSources([item(1)], rows, [{ sourceId: id(1) }], false)[0].amountOre, 98765)
  assert.equal(importOfferSources([item(1)], rows, [{ sourceId: id(1) }], true)[0].amountOre, 125000)
  const unverified = await prepare([source(1, 'Grund', { lumpSum: { verified: false, customerPrice: 5000, vatRate: 25 } })])
  assert.equal(importOfferSources([item(1)], unverified, [{ sourceId: id(1) }], true)[0].amountOre, 98765)
  assert.equal(JSON.stringify(importOfferSources([], rows, [{ sourceId: id(1) }], true)).includes('internalCost'), false)
})

test('legacy exact names link without duplicates and retain original IDs, classification and cost references', async () => {
  const rows = await prepare([source(1, 'Stomme och fasad'), source(2, 'Tak')])
  const existing = [item(81, ' STOMME  och fasad '), item(82, 'Tak')]
  const targets = offerSourceTargets(existing, rows)
  assert.equal(targets.get(id(1)), id(81))
  const result = importOfferSources(existing, rows, rows.map((row) => ({ sourceId: row.id })), false)
  assert.deepEqual(result.map((row) => row.id), [id(81), id(82)])
  assert.deepEqual(result.map((row) => row.sourceItemId), [id(1), id(2)])
  assert.equal(result[0].amountOre, existing[0].amountOre)
  const saved = normalizeCustomerOffer({ ...emptyCustomerOffer('Test'), items: result })
  const renamed = await prepare([source(1, 'Ny stommerubrik'), source(2, 'Tak')])
  assert.equal(offerSourceTargets(saved.items, renamed).get(id(1)), id(81))
  assert.equal(importOfferSources(saved.items, renamed, [{ sourceId: id(1) }], false).length, 2)
})

test('different legacy names require one explicit replacement decision, not a fuzzy guess', async () => {
  const existing = [item(81, 'Mark, grund och dränering'), item(82, 'Tak')]
  const rows = await prepare([source(1, 'Mark och grund'), source(2, 'Tak')])
  assert.equal(offerSourceTargets(existing, rows).get(id(1)), undefined)
  assert.throws(() => importOfferSources(existing, rows, [{ sourceId: id(1) }], false), /INVALID/)
  const result = importOfferSources(existing, rows, [{ sourceId: id(1), targetId: id(81) }, { sourceId: id(2) }], false)
  assert.equal(result.length, 2)
  assert.equal(result[0].title, 'Mark och grund')
  assert.equal(result[0].id, id(81))
  assert.equal(result[0].amountOre, 98765)
  assert.equal(offerSourceTargets(result, rows).get(id(1)), id(81))
  assert.equal(importOfferSources(existing, rows, [{ sourceId: id(1), targetId: null }], false).length, 3)
})

test('duplicate legacy names and source names do not silently link', async () => {
  const rows = await prepare([source(1, 'Tak')])
  assert.equal(offerSourceTargets([item(81, 'Tak'), item(82, 'Tak')], rows).get(id(1)), undefined)
  const duplicateSources = await prepare([source(1, 'Tak'), source(2, 'Tak')])
  assert.equal(offerSourceTargets([item(81, 'Tak')], duplicateSources).get(id(1)), undefined)
  assert.equal(offerSourceTargets([item(81, 'Tak')], duplicateSources).get(id(2)), undefined)
})

test('invalid mappings, reused targets, and duplicate selected sources fail before any mutation', async () => {
  const existing = [item(81, 'Äldre del'), item(82, 'Tak'), item(83, 'Val', { kind: 'option' })]
  const frozen = structuredClone(existing)
  const rows = await prepare([source(1, 'Grund'), source(2, 'Tak'), source(3, 'VVS')])
  for (const selections of [
    [{ sourceId: id(1), targetId: id(999) }],
    [{ sourceId: id(1), targetId: id(83) }],
    [{ sourceId: id(1), targetId: id(82) }],
    [{ sourceId: id(2), targetId: null }],
    [{ sourceId: id(999), targetId: null }],
    [{ sourceId: id(1), targetId: id(81) }, { sourceId: id(3), targetId: id(81) }],
    [{ sourceId: id(2) }, { sourceId: id(2) }],
  ]) assert.throws(() => importOfferSources(existing, rows, selections, false), /INVALID/)
  assert.deepEqual(existing, frozen)
})

test('stable links preserve excluded and optional classification rather than moving choices into the base contract', async () => {
  for (const kind of ['excluded', 'option']) {
    const existing = item(81, 'Val', { sourceItemId: id(1), kind, optionGroup: kind === 'option' ? 'Fönster' : null, amountOre: null })
    const result = importOfferSources([existing], await prepare([source(1)]), [{ sourceId: id(1) }], true)[0]
    assert.equal(result.kind, kind)
    assert.equal(result.amountOre, null)
    assert.equal(result.optionGroup, existing.optionGroup)
  }
})

test('source links survive draft normalization but are private and cannot be malformed or duplicated', async () => {
  const rows = await prepare([source(1)])
  const items = importOfferSources([], rows, [{ sourceId: id(1) }], false)
  const draft = normalizeCustomerOffer({ ...emptyCustomerOffer('Test'), items })
  assert.equal(draft.items[0].sourceItemId, id(1))
  const publicOffer = mapCustomerOffer({ id: id(90), version: 1, status: 'published', snapshot: draft, files: [] })
  assert.equal('sourceItemId' in publicOffer.snapshot.items[0], false)
  assert.equal('sourceReview' in publicOffer.snapshot.items[0], false)
  assert.throws(() => normalizeCustomerOffer({ ...draft, items: [{ ...items[0], sourceItemId: 'bad' }] }), /INVALID/)
  assert.throws(() => normalizeCustomerOffer({ ...draft, items: [items[0], { ...items[0], id: id(2) }] }), /INVALID/)
})

test('200-part limit permits replacements but not additions', async () => {
  const existing = Array.from({ length: 200 }, (_, n) => item(n + 1))
  const rows = await prepare([source(1), source(201)])
  assert.equal(importOfferSources(existing, rows, [{ sourceId: id(1) }], false).length, 200)
  assert.throws(() => importOfferSources(existing, rows, [{ sourceId: id(201) }], false), /INVALID/)
})
