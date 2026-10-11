import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { activeSigningVersion, signingPdfFilename } from '../src/lib/action-cases/contractSigning.ts'
import { contractSigningSections, renderContractSigningPdf } from '../src/lib/action-cases/contractSigningPdf.ts'
import { emptyCustomerOffer, offerPublishIssues } from '../src/lib/action-cases/customerOffers.ts'
import { signingSnapshot, signingId } from './fixtures/contract-signing.ts'

const input = () => ({ id: signingId(500), version: 1, createdAt: '2026-10-11T10:00:00Z', snapshot: signingSnapshot(), files: [] })
test('existing mailbox approval still rejects two buyers and incomplete contracts', () => {
  assert.ok(offerPublishIssues(input().snapshot).some((issue) => issue.includes('två beställare')))
  assert.ok(offerPublishIssues(emptyCustomerOffer()).length > 0)
})
test('PDF projection preserves frozen customer text, price display, payment terms and workplace arrangements only', () => {
  const value = input(), before = JSON.stringify(value)
  const sections = contractSigningSections(value), all = JSON.stringify(sections)
  assert.match(all, /Bo Test|Anna Test/)
  assert.match(all, /Bergschakt ingår inte/)
  assert.match(all, /Byggcentral vid garaget/)
  assert.match(all, /Färdigställd grund/)
  assert.match(all, /30 dagar/)
  assert.equal(JSON.stringify(value), before)
  assert.ok(sections.findIndex((s) => s.title.startsWith('Priset')) < sections.findIndex((s) => s.title === 'Besiktning'))
  value.snapshot.contractPricing.display = 'total'
  const price = contractSigningSections(value).find((s) => s.title.startsWith('Priset'))
  assert.equal(price.rows.length, 1)
  assert.doesNotMatch(JSON.stringify(price), /Mark och grund|Tak/)
  value.snapshot.contractPricing.display = 'unpriced'
  const unpriced = contractSigningSections(value).find((s) => s.title.startsWith('Priset'))
  assert.equal(unpriced.rows[0].length, 1)
  assert.equal(unpriced.rows.at(-1).length, 2)
  assert.doesNotMatch(all, /internalCost|costing|sourceItemId|email_payload/)
})
test('shared PDF renderer produces printable PDF without mutating frozen evidence', async () => {
  const value = input(), before = JSON.stringify(value), bytes = await renderContractSigningPdf(value)
  assert.equal(bytes.subarray(0, 5).toString(), '%PDF-')
  assert.ok(bytes.length > 8000)
  assert.equal(JSON.stringify(value), before)
})

test('draft PDF renders empty and partially filled contracts without completeness checks or invented markups', async () => {
  const value = input()
  value.draftRevision = 12
  value.snapshot = { ...value.snapshot, ...emptyCustomerOffer() }
  delete value.snapshot.contractParties
  delete value.snapshot.contractDetails
  delete value.snapshot.contractPricing
  delete value.snapshot.paymentPlan
  delete value.snapshot.paymentConditions
  const before = JSON.stringify(value)
  assert.equal((await renderContractSigningPdf(value)).subarray(0, 5).toString(), '%PDF-')
  assert.equal(JSON.stringify(value), before)
  const partial = input()
  partial.snapshot.contractPricing.mode = 'running'
  partial.snapshot.contractPricing.running.markupPercent = null
  assert.doesNotMatch(JSON.stringify(contractSigningSections(partial)), /null %|undefined/)
  partial.snapshot.paymentPlan.installments[0].amountOre = null
  assert.equal(contractSigningSections(partial).find((s) => s.title === 'Betalningsplan').rows.at(-1)[2], 'Pris saknas')
})
test('released versions do not lock a new draft; filenames never expose names', () => {
  assert.equal(activeSigningVersion([{ id:'old', releasedAt:'2026-10-11' }, { id:'current', releasedAt:null }]).id,'current')
  assert.equal(activeSigningVersion([{ releasedAt:'2026-10-11' }]),undefined)
  assert.equal(signingPdfFilename(input()),'Avtal-v1-00000000.pdf')
})
test('signing routes never send, accept or expose anonymous downloads', () => {
  const route = readFileSync(new URL('../src/app/api/action-cases/[caseId]/contract-signing/route.ts',import.meta.url),'utf8')
  const download = readFileSync(new URL('../src/app/api/action-cases/[caseId]/contract-signing/[documentId]/[fileId]/route.ts',import.meta.url),'utf8')
  const draftPdf = readFileSync(new URL('../src/app/api/action-cases/[caseId]/contract-signing/pdf/route.ts',import.meta.url),'utf8')
  assert.match(route,/customerOfferContext/); assert.match(route,/offerRequestBody/)
  assert.match(download,/customerOfferContext/); assert.match(download,/attachment; filename/)
  assert.match(draftPdf,/customerOfferContext/); assert.match(draftPdf,/private, no-store/)
  assert.match(draftPdf,/attachment; filename/)
  assert.doesNotMatch(route + download + draftPdf,/sendAssignmentEmail|acceptCustomerOffer|createSignedUrl/)
})
