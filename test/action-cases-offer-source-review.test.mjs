import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { prepareOfferSource, addOfferSources, offerSourceNeedsReview, offerSourceDifferences, reviewOfferSource } from '../src/lib/action-cases/offerImport.ts'
import { emptyCustomerOffer, normalizeCustomerOffer, mapCustomerOffer } from '../src/lib/action-cases/customerOffers.ts'

const id = '00000000-0000-4000-8000-000000000001'
const source = { id, title: 'Mark', scope: 'Schakt enligt ritning', scopeConditionsAvailable: true, scopeConditions: 'Tillträde krävs',
  scopeNotesAvailable: true, scopeExclusions: 'Berg ingår inte', scopeAdvice: 'Avrådan att utreda',
  costLines: [], lumpSum: { verified: true, customerPrice: 1000, internalCost: 600, vatRate: 25 }, privateNote: 'HEMLIG KALKYL' }

test('new contract work copies all four scope fields, explicit customer price only, no duplicate or internal information', async () => {
  const prepared = await prepareOfferSource(source)
  const withoutPrice = addOfferSources([], [prepared, prepared], false)
  assert.equal(withoutPrice.length, 1)
  for (const key of ['scope', 'scopeConditions', 'scopeExclusions', 'scopeAdvice']) assert.equal(withoutPrice[0][key], source[key])
  assert.equal(withoutPrice[0].amountOre, null)
  assert.equal(addOfferSources([], [prepared], true)[0].amountOre, 125000)
  assert.equal(JSON.stringify(withoutPrice).includes('internalCost'), false)
  assert.equal(JSON.stringify(withoutPrice).includes('HEMLIG'), false)
  assert.ok(Object.values(withoutPrice[0].sourceReview).every((hash) => /^[a-f0-9]{64}$/.test(hash)))
  assert.deepEqual(addOfferSources(withoutPrice, [prepared], true), withoutPrice)
})

test('contract imports use the shared draft directly and preserve contract metadata, pricing and existing work', async () => {
  const draft = normalizeCustomerOffer({ ...emptyCustomerOffer('Testavtal'), baseAmountOre: 450000,
    contractForm: 'abs18', introduction: 'Avtalad inledning', paymentTerms: 'Efter utfört arbete',
    items: [{ id: '00000000-0000-4000-8000-000000000002', title: 'Befintlig arbetsdel', scope: 'Anpassad text', kind: 'included', amountOre: 300000 }] })
  const before = structuredClone(draft)
  const items = addOfferSources(draft.items, [await prepareOfferSource(source)], false)
  const saved = normalizeCustomerOffer({ ...draft, items })
  assert.deepEqual({ ...saved, items: before.items }, before)
  assert.deepEqual(saved.items[0], before.items[0])
  assert.equal(saved.items[1].scope, source.scope)
  assert.equal(saved.items[1].scopeConditions, source.scopeConditions)
  assert.equal(saved.items[1].scopeExclusions, source.scopeExclusions)
  assert.equal(saved.items[1].scopeAdvice, source.scopeAdvice)
  assert.equal(saved.items[1].amountOre, null)
})

test('contract exposes a collapsed direct import without mounting competing review controls', () => {
  const editor = readFileSync('src/components/tasks/CustomerOfferEditor.tsx', 'utf8')
  const contract = editor.slice(editor.indexOf('<h3 className="mt-6 font-semibold">Arbetsdelar och avgränsningar'))
  assert.match(contract, /\{contractView && <CustomerOfferSourcePicker[^>]*collapsible/)
  assert.match(editor, /\{!contractView && <CustomerOfferSourcePicker/)
  assert.equal((editor.match(/onReviewCountChange=\{setSourceReviewCount\}/g) ?? []).length, 2)
  const picker = readFileSync('src/components/tasks/CustomerOfferSourcePicker.tsx', 'utf8')
  assert.match(picker, /useState\(!collapsible\)/)
  assert.match(picker, /hidden=\{!expanded\}/)
  assert.match(picker, /Hämta från Projektarbete/)
  assert.match(picker, /onReviewCountChange\(reviewCount\)/)
})

test('intentional contract edits do not masquerade as project changes; a later project change is detected', async () => {
  const initial = await prepareOfferSource(source)
  const item = { ...addOfferSources([], [initial], true)[0], scope: 'Kundens anpassade omfattning', amountOre: 200000 }
  assert.equal(offerSourceNeedsReview(initial, item, true), false)
  const changed = await prepareOfferSource({ ...source, scope: 'Schakt och dränering' })
  assert.equal(offerSourceNeedsReview(changed, item, true), true)
  assert.deepEqual(offerSourceDifferences(changed, item, true).map((f) => f.key), ['scope', 'amountOre'])
  const frozen = structuredClone(item)
  const applied = reviewOfferSource(item, changed, ['scope'], true)
  assert.equal(applied.scope, 'Schakt och dränering')
  assert.equal(applied.amountOre, 200000)
  assert.equal(offerSourceNeedsReview(changed, applied, true), false)
  assert.deepEqual(item, frozen)
})

test('keep contract wording records review and survives normalization and reload', async () => {
  const prepared = await prepareOfferSource(source)
  const legacy = { id, title: 'Äldre rubrik', scope: 'Avtalad text', kind: 'included', amountOre: 700 }
  assert.equal(offerSourceNeedsReview(prepared, legacy, true), true)
  const reviewed = reviewOfferSource(legacy, prepared, [], true)
  const draft = normalizeCustomerOffer({ ...emptyCustomerOffer('Test'), items: [reviewed] })
  assert.equal(draft.items[0].scope, legacy.scope)
  assert.equal(draft.items[0].amountOre, 700)
  assert.equal(offerSourceNeedsReview(prepared, draft.items[0], true), false)
  assert.equal(offerSourceNeedsReview(await prepareOfferSource({ ...source, scopeExclusions: 'Nytt undantag' }), draft.items[0], true), true)
})

test('explicit replacement supports title, all scope fields, clearing text and price', async () => {
  const first = await prepareOfferSource(source)
  const old = addOfferSources([], [first], true)[0]
  const next = await prepareOfferSource({ ...source, title: 'Grund', scope: 'Ny omfattning', scopeConditions: '', scopeAdvice: '', scopeExclusions: '',
    lumpSum: { ...source.lumpSum, customerPrice: 2000 } })
  const keys = offerSourceDifferences(next, old, true).map((f) => f.key)
  assert.equal(keys.length, 6)
  const updated = reviewOfferSource(old, next, keys, true)
  assert.equal(updated.title, 'Grund')
  assert.equal(updated.amountOre, 250000)
  assert.equal(updated.scopeExclusions, '')
  assert.equal(updated.scopeConditions, '')
  assert.equal(updated.scopeAdvice, '')
})

test('unavailable fields cannot clear the contract; total pricing, exclusions and choice classification stay unchanged', async () => {
  const old = addOfferSources([], [await prepareOfferSource(source)], true)[0]
  const next = await prepareOfferSource({ ...source, scopeNotesAvailable: false, scopeConditionsAvailable: false, lumpSum: { ...source.lumpSum, verified: false } })
  assert.equal(offerSourceNeedsReview(next, old, false), false)
  const updated = reviewOfferSource(old, next, ['scopeAdvice', 'scopeConditions', 'amountOre'], false)
  assert.equal(updated.scopeAdvice, old.scopeAdvice)
  assert.equal(updated.scopeConditions, old.scopeConditions)
  assert.equal(updated.amountOre, old.amountOre)
  for (const kind of ['excluded', 'option']) {
    const item = { ...old, kind, amountOre: null }
    assert.equal(reviewOfferSource(item, next, ['amountOre'], true).kind, kind)
    assert.equal(reviewOfferSource(item, next, ['amountOre'], true).amountOre, null)
  }
  assert.deepEqual(reviewOfferSource(old, { ...next, id: 'other' }, ['scope'], true), old)
})

test('source validation ignores nontransferable properties, rejects malformed fingerprints and canonicalizes whitespace', async () => {
  assert.deepEqual(await prepareOfferSource({ ...source, title: ' Mark ', scope: 'Schakt enligt ritning\n' }), await prepareOfferSource(source))
  const item = addOfferSources([], [await prepareOfferSource(source)], true)[0]
  assert.throws(() => normalizeCustomerOffer({ ...emptyCustomerOffer('Test'), items: [{ ...item, sourceReview: { scope: 'bad' } }] }), /INVALID/)
  assert.throws(() => normalizeCustomerOffer({ ...emptyCustomerOffer('Test'), items: [{ ...item, sourceReview: [] }] }), /INVALID/)
  const normalized = normalizeCustomerOffer({ ...emptyCustomerOffer('Test'), items: [{ ...item, sourceReview: { ...item.sourceReview, privateNote: 'secret' } }] })
  assert.equal('privateNote' in normalized.items[0].sourceReview, false)
  const publicOffer = mapCustomerOffer({ id, version: 1, status: 'published', snapshot: normalized, files: [] })
  assert.equal('sourceReview' in publicOffer.snapshot.items[0], false)
  assert.equal(publicOffer.snapshot.items[0].scope, source.scope)
  assert.ok(normalized.items[0].sourceReview)
})

test('editor follows ABS 18 contract sequence, keeps explicit imports and pending work protected', () => {
  const editor = readFileSync('src/components/tasks/CustomerOfferEditor.tsx', 'utf8')
  const start = editor.indexOf('<ProjectEditorRow title="Offertuppgifter"')
  const layout = editor.slice(start)
  const order = ['title="Beställare"', 'title="Entreprenör"', "contractSection('controls'", 'title="Fastigheten"', 'title="Uppdraget"', 'title="Övriga bilagor"',
    "contractSection('work-environment'", "contractSection('advice'", 'title="Priset"', "contractSection('changes'", 'title="Tid för betalning"',
    'title="Tid för arbetenas påbörjande och avslutande"', "contractSection('delay'", "contractSection('inspection'", "contractSection('insurance'", 'title="Övrigt"']
  let previous = -1
  for (const part of order) { const position = layout.indexOf(part); assert.ok(position > previous, part); previous = position }
  assert.match(editor, /blocked=\{sourcePending \|\| locked \|\| Boolean\(busy\)\}/)
  assert.match(editor, /sourceReviewCount > 0/)
  const picker = readFileSync('src/components/tasks/CustomerOfferSourcePicker.tsx', 'utf8')
  assert.match(picker, /useState<OfferSourceField\[\]>\(\[\]\)/)
  assert.match(picker, /Underlaget har ändrats/)
  assert.match(picker, /Behåll avtalstexten/)
})
