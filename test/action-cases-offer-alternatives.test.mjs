import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeCustomerOffer, emptyCustomerOffer, customerOfferBaseAmount, customerPriceLabel, mapCustomerOffer, offerPublishIssues } from '../src/lib/action-cases/customerOffers.ts'
import { normalizeOfferAlternatives } from '../src/lib/action-cases/offerAlternatives.ts'
import { offerAlternativeSections, renderContractSigningPdf } from '../src/lib/action-cases/contractSigningPdf.ts'
import { emptyContractDetails } from '../src/lib/action-cases/customerContract.ts'
import { customerOfferSaveChanges } from '../src/lib/action-cases/customerOfferSaveChanges.ts'

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const alternatives = () => ({ version: 1, issuedOn: '2026-11-02', selectionTerms: 'Del 3 ersätter del 2. Beställning sker skriftligen.', parts: [
  { id: id(1), title: '1. Arbete', scope: 'FIKTIV exakt omfattning.', amountExVatOre: 10800000 },
  { id: id(2), title: '2. Lagning', scope: 'FIKTIV avgränsad lagning.', amountExVatOre: 840000 },
  { id: id(3), title: '3. Alternativ', scope: 'FIKTIV alternativ omfattning.', amountExVatOre: 9840000 },
] })
const draft = () => normalizeCustomerOffer({ ...emptyCustomerOffer('Fiktiv offert'), contractForm: 'custom', offerAlternatives: alternatives(),
  schedule: 'FIKTIV tidplan.', paymentTerms: 'FIKTIVT: 30 dagar netto.', terms: 'FIKTIV skriftlig beställning.',
  contractDetails: { ...emptyContractDetails(), fields: { ...emptyContractDetails().fields, changes: { status: 'specified', text: 'FIKTIVA skriftliga ändringsvillkor.' } } } })

test('saved alternatives retain exact separate ex-VAT prices and scope, never an aggregate contract sum', () => {
  const value = draft(), before = structuredClone(value)
  assert.deepEqual(normalizeCustomerOffer(value), value)
  assert.equal(customerOfferBaseAmount(value), null)
  assert.equal(customerPriceLabel(value), '3 valbara offertdelar')
  assert.deepEqual(mapCustomerOffer({ id: id(10), snapshot: value, files: [] }).snapshot.offerAlternatives, alternatives())
  assert(offerPublishIssues(value).some(issue => issue.includes('Valbara offertdelar')))
  assert.deepEqual(value, before)
  const free = alternatives(); free.parts[0].amountExVatOre = 0; free.parts[1].amountExVatOre = null
  assert.equal(normalizeOfferAlternatives(free).parts[0].amountExVatOre, 0)
  assert.equal(normalizeOfferAlternatives(free).parts[1].amountExVatOre, null)
  assert(customerOfferSaveChanges(value, { ...value, offerAlternatives: undefined }, {}, {}).some(change => change.includes('Valbara offertdelar')))
})

test('invalid alternative fields and mixed contract pricing are rejected rather than coerced or summed', () => {
  for (const change of [ { issuedOn: '2026-02-30' }, { version: 2 }, { parts: [{ ...alternatives().parts[0], amountExVatOre: -1 }] },
    { parts: [alternatives().parts[0], alternatives().parts[0]] }, { parts: [{ ...alternatives().parts[0], scope: 'x'.repeat(6001) }] } ])
    assert.throws(() => normalizeOfferAlternatives({ ...alternatives(), ...change }), /INVALID/)
  assert.throws(() => normalizeCustomerOffer({ ...draft(), baseAmountOre: 100 }), /INVALID/)
  assert.throws(() => normalizeCustomerOffer({ ...draft(), items: [{ id: id(4), kind: 'included', title: 'Kontraktsarbete', scope: '', amountOre: 100 }] }), /INVALID/)
  assert.equal(normalizeOfferAlternatives(null), null)
})

test('ordinary PDF export automatically uses the persisted sections, including separate payment and ATA terms', async () => {
  const value = draft(), snapshot = { ...value, projectTitle: 'Internt', propertyAddress: 'Testvägen 1', customerName: 'Fiktiv BRF', customerEmail: '', issuerName: 'Test AB', replyEmail: '' }
  const input = { kind: 'offer', id: id(10), version: 0, draftRevision: 1, createdAt: '2026-11-03T10:00:00Z', snapshot, files: [] }, before = structuredClone(snapshot)
  const parts = offerAlternativeSections(input)
  assert.deepEqual(parts.filter(part => !['parties', 'property'].includes(part.group)).map(part => part.title), ['Arbeten', 'Priser', 'Tid', 'Betalningsvillkor', 'Ändringar och tilläggsarbeten (ÄTA)', 'Beställning'])
  assert.equal(parts.find(part => part.title === 'Priser').rows.length, 3)
  assert.equal(parts.some(part => part.totalRow), false)
  const bytes = await renderContractSigningPdf(input)
  assert.equal(bytes.subarray(0, 5).toString(), '%PDF-')
  assert.deepEqual(snapshot, before)
  assert.throws(() => offerAlternativeSections({ ...input, kind: undefined }), /OFFER_PRESENTATION_REQUIRED/)
})
