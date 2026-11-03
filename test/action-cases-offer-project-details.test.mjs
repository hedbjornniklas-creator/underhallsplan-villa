import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { signingDraft } from './fixtures/contract-signing.ts'
import { emptyContractParties } from '../src/lib/action-cases/customerContractParties.ts'
import { emptyContractDetails } from '../src/lib/action-cases/customerContract.ts'
import { normalizeCustomerOffer } from '../src/lib/action-cases/customerOffers.ts'
import { contractSigningSections } from '../src/lib/action-cases/contractSigningPdf.ts'
import { offerProjectDetails, withOfferProjectDetails } from '../src/lib/action-cases/offerProjectDetails.ts'

function fixture() {
  const contract = signingDraft()
  contract.contractParties.customers = [{ name: 'Anna Test', personalNumber: '19000101-0000' }]
  contract.contractDetails.property = { municipality: 'Teststad', cadastralDesignation: 'TESTET 33', street: 'Byggplatsen 47', postalCode: '12346', city: 'Teststad' }
  const offer = structuredClone(contract)
  offer.contractParties = emptyContractParties('Anna Test')
  Object.assign(offer.contractParties.contractor, contract.contractParties.contractor)
  offer.contractDetails = emptyContractDetails()
  return { contract, offer, source: offerProjectDetails(contract, 12) }
}

test('missing offer address and property are completed from saved project facts without mutating other terms', () => {
  const { contract, offer, source } = fixture(), before = structuredClone({ contract, offer, source })
  const result = normalizeCustomerOffer(withOfferProjectDetails(offer, source))
  assert.equal(result.contractParties.street, 'Testgatan 1')
  assert.equal(result.contractParties.postalCode, '12345')
  assert.equal(result.contractParties.city, 'Teststad')
  assert.equal(result.contractParties.email, 'anna@example.test')
  assert.equal(result.contractParties.customers[0].personalNumber, '')
  assert.equal(result.contractDetails.property.cadastralDesignation, 'TESTET 33')
  const omit = value => { const copy = structuredClone(value); delete copy.contractParties; delete copy.contractDetails; return copy }
  assert.deepEqual(omit(result), omit(offer))
  assert.deepEqual(result.contractParties.contractor, offer.contractParties.contractor)
  assert.deepEqual({ contract, offer, source }, before)
  assert.deepEqual(withOfferProjectDetails(result, source), result)
})

test('explicit offer addresses, contact details and property identities are never overwritten or mixed', () => {
  const { offer, source } = fixture()
  Object.assign(offer.contractParties, { street: 'Egen offertadress 5', email: 'anna@example.test', mobile: '0701111111' })
  offer.contractDetails.property = { municipality: 'Annan kommun', cadastralDesignation: 'ANNAT 1', street: 'Annan gata', postalCode: '', city: '' }
  const result = withOfferProjectDetails(offer, source)
  assert.equal(result.contractParties.street, 'Egen offertadress 5')
  assert.equal(result.contractParties.postalCode, '')
  assert.equal(result.contractParties.city, '')
  assert.equal(result.contractParties.mobile, '0701111111')
  assert.deepEqual(result.contractDetails.property, offer.contractDetails.property)
})

test('a different customer, recipient or business does not inherit another party address', () => {
  for (const mismatch of ['name', 'email', 'business']) {
    const { offer, source } = fixture()
    if (mismatch === 'name') offer.contractParties.customers[0].name = 'Bo Test'
    if (mismatch === 'email') offer.contractParties.email = 'other@example.test'
    if (mismatch === 'business') offer.contractParties.business = { organizationNumber: '111111-1111', contactName: '', signatoryName: '' }
    assert.deepEqual(withOfferProjectDetails(offer, source).contractParties, offer.contractParties)
  }
})

test('new offer party facts omit personal numbers and do not import contractor or pricing from the contract', () => {
  const { offer, source } = fixture()
  delete offer.contractParties
  const fallback = emptyContractParties('Anna Test', '', '', { companyName: 'Offertavsändaren AB' })
  const result = withOfferProjectDetails(offer, source, fallback)
  assert.deepEqual(result.contractParties.customers, [{ name: 'Anna Test', personalNumber: '' }])
  assert.equal(result.contractParties.contractor.companyName, 'Offertavsändaren AB')
  assert.equal(withOfferProjectDetails(offer, source).contractParties, undefined)
  assert.equal(withOfferProjectDetails(offer, source, emptyContractParties('Bo Test')).contractParties, undefined)
  assert.deepEqual(result.contractPricing, offer.contractPricing)
  assert.deepEqual(withOfferProjectDetails(offer), offer)
})

test('legacy property text is retained instead of replacing a different documented description', () => {
  const { offer, source } = fixture()
  offer.contractDetails.fields.property = { status: 'specified', text: 'Egen tidigare fastighetsbeskrivning.' }
  const result = withOfferProjectDetails(offer, source)
  assert.deepEqual(result.contractDetails, offer.contractDetails)
})

test('registered property is a fallback only and its project link remains attached', () => {
  const { contract, offer } = fixture()
  const registered = { id: '00000000-0000-4000-8000-000000000123', name: 'Testfastighet', ...contract.contractDetails.property }
  delete contract.contractDetails.property
  const source = offerProjectDetails(contract, 4, registered)
  assert.equal(withOfferProjectDetails(offer, source).contractDetails.property.sourcePropertyId, registered.id)
  contract.contractDetails.property = { ...registered, cadastralDesignation: 'AVTALAD 2' }
  assert.equal(offerProjectDetails(contract, 5, registered).property.cadastralDesignation, 'AVTALAD 2')
})

test('ordinary offer PDF receives structured property facts and the unchanged budget and scope', () => {
  const { offer, source } = fixture(), draft = withOfferProjectDetails(offer, source)
  const sections = contractSigningSections({ kind: 'offer', snapshot: { ...draft, projectTitle: 'Fiktivt projekt', propertyAddress: 'Byggplatsen 47', customerName: 'Anna Test', customerEmail: 'anna@example.test', issuerName: 'Testbygg AB', replyEmail: 'bygg@example.test' }, files: [] })
  const property = sections.find(section => section.group === 'property')
  assert.match(JSON.stringify(property), /TESTET 33/)
  assert.deepEqual(draft.items, offer.items)
  assert.deepEqual(draft.contractPricing, offer.contractPricing)
  assert.deepEqual(draft.paymentPlan, offer.paymentPlan)
})

test('editor prepares only active editable offers, autosaves project facts and blocks PDF until acknowledged', () => {
  const editor = readFileSync(new URL('../src/components/tasks/CustomerOfferEditor.tsx', import.meta.url), 'utf8')
  assert.match(editor, /!active \|\| initial.offers.some\(offer => offer.status === 'accepted'\) \? initial.draft/)
  assert.match(editor, /if \(draftTarget !== 'offer' \|\| !active \|\| locked \|\| busy \|\| sourcePending \|\| autosave.isPending\(\)/)
  assert.match(editor, /appliedProjectDetails.current === offerDetailsKey/)
  assert.match(editor, /JSON.stringify\(next\) !== JSON.stringify\(acknowledgedDraft.current\)\) update\(next, true\)/)
  assert.match(editor, /const offerPdfBlocked = dirty \|\| Boolean\(busy\)[^\n]+\|\| offerDetailsPending/)
  assert.match(editor, /<h3 className="mb-3 font-semibold">Fastigheten<\/h3>/)
})
