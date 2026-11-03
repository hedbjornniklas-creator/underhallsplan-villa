import test from 'node:test'
import assert from 'node:assert/strict'
import { emptyCustomerOffer, mapCustomerOffer, normalizeCustomerOffer } from '../src/lib/action-cases/customerOffers.ts'
import { emptyContractDetails } from '../src/lib/action-cases/customerContract.ts'
import { assignmentPatch } from '../src/lib/action-cases/contractAssignment.ts'
import { normalizeOfferDocuments, offerDocumentMode, selectedOfferDocuments } from '../src/lib/action-cases/offerDocuments.ts'
import { customerOfferSaveChanges } from '../src/lib/action-cases/customerOfferSaveChanges.ts'
import { id } from './fixtures/customer-offer-data.ts'

const files = [{ id: id(4), fileName: 'FIKTIV ritning.pdf', contentType: 'application/pdf', fileSizeBytes: 100 }, { id: id(5), fileName: 'FIKTIV bild.jpg', contentType: 'image/jpeg', fileSizeBytes: 100 }]

test('legacy references are unchanged and explicit new PDF selections opt in without selecting other project files', () => {
  const draft = { ...emptyCustomerOffer(), attachmentIds: [id(4)] }, before = structuredClone(draft)
  assert.equal(offerDocumentMode(draft, id(4)), 'reference')
  assert.deepEqual(selectedOfferDocuments(draft, [id(4)], files), { version: 1, modes: { [id(4)]: 'reference' } })
  assert.deepEqual(selectedOfferDocuments({ ...draft, attachmentIds: [] }, [id(4)], files), { version: 1, modes: { [id(4)]: 'pdf' } })
  assert.deepEqual(selectedOfferDocuments({ ...draft, attachmentIds: [] }, [id(5)], files), { version: 1, modes: { [id(5)]: 'reference' } })
  assert.deepEqual(draft, before)
})

test('offer document modes round-trip, reject foreign and malformed references, and survive customer projection', () => {
  const draft = { ...emptyCustomerOffer(), attachmentIds: [id(4)], offerDocuments: { version: 1, modes: { [id(4)]: 'pdf' } } }
  assert.deepEqual(normalizeCustomerOffer(draft), draft)
  for (const value of [{ version: 2, modes: {} }, { version: 1, modes: [] }, { version: 1, modes: { [id(5)]: 'pdf' } }, { version: 1, modes: { [id(4)]: 'hidden' } }])
    assert.throws(() => normalizeOfferDocuments(value, [id(4)]), /CUSTOMER_OFFER_INVALID/)
  assert.equal(normalizeOfferDocuments(null, [id(4)]), null)
  const projected = mapCustomerOffer({ id: id(1), version: 0, status: 'published', files, snapshot: { ...draft, projectTitle: 'FIKTIVT', propertyAddress: 'Testgatan', customerName: 'Anna Test', customerEmail: '', issuerName: 'Testbygg', replyEmail: '' } })
  assert.deepEqual(projected.snapshot.offerDocuments, draft.offerDocuments)
  assert.deepEqual(customerOfferSaveChanges(draft, { ...draft, offerDocuments: undefined }, {}, {}), ['Villkor och bilagor'])
})

test('hiding a document removes its mode and reference without deleting any project file or changing offer terms', () => {
  const draft = { ...emptyCustomerOffer(), contractDetails: { ...emptyContractDetails(), assignment: { documents: files.map(file => ({ fileId: file.id, type: '', name: file.fileName, date: '' })), additionalScope: 'Behåll omfattning', exclusions: 'Behåll avgränsning', documentNotes: '' } }, attachmentIds: files.map(file => file.id), offerDocuments: { version: 1, modes: { [id(4)]: 'pdf', [id(5)]: 'reference' } } }
  const next = { ...draft, ...assignmentPatch(draft, { ...draft.contractDetails.assignment, documents: [draft.contractDetails.assignment.documents[1]] }) }
  assert.deepEqual(next.attachmentIds, [id(5)])
  assert.deepEqual(next.offerDocuments, { version: 1, modes: { [id(5)]: 'reference' } })
  assert.equal(next.contractDetails.assignment.additionalScope, 'Behåll omfattning')
  assert.equal(next.contractDetails.assignment.exclusions, 'Behåll avgränsning')
  assert.equal(files.length, 2)
})
