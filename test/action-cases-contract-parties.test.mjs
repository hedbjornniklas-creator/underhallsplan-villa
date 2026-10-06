import assert from 'node:assert/strict'
import test from 'node:test'
import { emptyContractParties, normalizeContractParties, contractPartiesIssues } from '../src/lib/action-cases/customerContractParties.ts'
import { emptyCustomerOffer, normalizeCustomerOffer, mapCustomerOffer, offerPublishIssues } from '../src/lib/action-cases/customerOffers.ts'
import { emptyContractDetails } from '../src/lib/action-cases/customerContract.ts'

const parties = () => ({ ...emptyContractParties('Anna Exempel', 'anna@example.test'), street: 'Testgatan 1', postalCode: '11122', city: 'Stockholm',
  contractor: { ...emptyContractParties().contractor, companyName: 'Exempelbygg AB', organizationNumber: '556000-0000', street: 'Bygggatan 1', postalCode: '11122', city: 'Stockholm', email: 'byggare@example.test', fTax: 'yes' } })

test('structured parties allow incomplete drafts and reject malformed or oversized identity fields', () => {
  assert.deepEqual(normalizeContractParties(emptyContractParties()), emptyContractParties())
  const valid = parties()
  assert.deepEqual(normalizeContractParties(valid), valid)
  for (const input of [null, [], { ...valid, version: 2 }, { ...valid, customers: [] }, { ...valid, customers: Array(3).fill(valid.customers[0]) },
    { ...valid, contractor: [] }, { ...valid, contractor: { ...valid.contractor, fTax: 'assumed' } },
    { ...valid, customers: [{ name: 'A', personalNumber: 'x'.repeat(21) }] }, { ...valid, email: 'a\nb@example.test' }, { ...valid, street: 5 }]) {
    assert.throws(() => normalizeContractParties(input), /INVALID/)
  }
  assert.equal(normalizeContractParties({ ...valid, privateNote: 'secret' }).privateNote, undefined)
})

test('contract readiness checks the actual party fields and does not pretend one mailbox signs for two buyers', () => {
  assert.deepEqual(contractPartiesIssues(parties()), [])
  assert.match(contractPartiesIssues(emptyContractParties()).join(), /postadress/)
  assert.match(contractPartiesIssues({ ...parties(), contractor: { ...parties().contractor, fTax: 'unreviewed' } }).join(), /F-skatt/)
  assert.match(contractPartiesIssues({ ...parties(), customers: [{ name: 'Anna', personalNumber: '' }, { name: 'Bo', personalNumber: '' }] }).join(), /bådas underskrifter/)
  const details = emptyContractDetails()
  details.advice.status = 'none'
  for (const entry of Object.values(details.fields)) Object.assign(entry, { status: 'specified', text: 'Test' })
  details.fields.parties = { status: 'unreviewed', text: '' }
  const draft = normalizeCustomerOffer({ ...emptyCustomerOffer('Test'), contractDetails: details, contractParties: parties() })
  assert.equal(offerPublishIssues(draft).some((issue) => /Beställare, entreprenör/.test(issue)), false)
  assert.match(draft.contractDetails.fields.parties.text, /Anna Exempel/)
})

test('private draft retains both buyer identifiers, public contract projection removes them without mutating the draft', () => {
  const value = parties()
  value.customers[0].personalNumber = '19000101-0000'
  value.customers.push({ name: 'Bo Exempel', personalNumber: '19000202-0000' })
  const draft = normalizeCustomerOffer({ ...emptyCustomerOffer('Test'), contractParties: value, contractDetails: emptyContractDetails() })
  assert.deepEqual(draft.contractParties, value)
  const publicOffer = mapCustomerOffer({ id: 'test', version: 1, status: 'published', snapshot: draft, files: [] })
  assert.deepEqual(publicOffer.snapshot.contractParties.customers, [{ name: 'Anna Exempel', personalNumber: '' }, { name: 'Bo Exempel', personalNumber: '' }])
  assert.equal(JSON.stringify(publicOffer).includes('19000101'), false)
  assert.equal(draft.contractParties.customers[0].personalNumber, '19000101-0000')
  assert.equal(publicOffer.snapshot.contractParties.contractor.organizationNumber, value.contractor.organizationNumber)
})
