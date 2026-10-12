import test from 'node:test'
import assert from 'node:assert/strict'
import sharp from 'sharp'
import { readFileSync } from 'node:fs'
import { normalizeContractSenderProfile } from '../src/lib/action-cases/contractSenderProfile.ts'
import { normalizeCustomerOffer, mapCustomerOffer } from '../src/lib/action-cases/customerOffers.ts'
import { normalizeContractParties } from '../src/lib/action-cases/customerContractParties.ts'
import { renderContractSigningPdf, contractSigningSections } from '../src/lib/action-cases/contractSigningPdf.ts'
import { contractSenderFixture } from './fixtures/contract-sender-profile.ts'
import { signingSnapshot, signingId } from './fixtures/contract-signing.ts'

test('sender profile is explicitly normalized and retained through a contract/public snapshot', () => {
  const senderProfile = contractSenderFixture(), snapshot = { ...signingSnapshot(), senderProfile }
  assert.deepEqual(normalizeCustomerOffer(snapshot).senderProfile, senderProfile)
  const projected = mapCustomerOffer({ id: signingId(500), version: 1, snapshot: { ...snapshot, privateSecret: 'PRIVATE' },
    files: [], status: 'published', published_at: '2026-10-12' })
  assert.deepEqual(projected.snapshot.senderProfile, senderProfile)
  assert.doesNotMatch(JSON.stringify(projected), /PRIVATE|privateSecret/)
  senderProfile.name = 'Edited live name'
  assert.equal(projected.snapshot.senderProfile.name, 'STYR - FIKTIV TESTPROFIL')
})

test('legacy documents remain unbranded and untouched', () => {
  const before = signingSnapshot(), serialized = JSON.stringify(before)
  assert.equal(normalizeCustomerOffer(before).senderProfile, undefined)
  assert.doesNotMatch(JSON.stringify(contractSigningSections({ snapshot: before, files: [] })), /Juridiskt bolag/)
  assert.equal(JSON.stringify(before), serialized)
})

test('sender parser rejects unsafe/foreign logo references and remote image URLs', () => {
  const profile = contractSenderFixture()
  for (const change of [
    { version: 2 }, { profileId: 'oops' }, { profileVersion: 0 }, { legalName: '' }, { organizationNumber: '' },
    { logoDataUrl: 'https://evil.example/logo.png' }, { logoDataUrl: 'data:image/svg+xml;base64,PHN2Zz4=' },
    { logoPath: 'organizations/00000000-0000-4000-8000-000000000001/logo-00000000-0000-4000-8000-000000000092.png' },
    { website: 'javascript:alert(1)' }, { website: 'https://user:password@example.test/' }, { email: 'a\r\nb' },
  ]) assert.throws(() => normalizeContractSenderProfile({ ...profile, ...change }), /CUSTOMER_OFFER_INVALID/)
  assert.equal(normalizeContractSenderProfile({ ...profile, extra: 'never project' }).extra, undefined)
})

test('complete profile contact field bounds fit the contractor parser without truncation', () => {
  const parties = signingSnapshot().contractParties
  parties.contractor.street = 'x'.repeat(300)
  parties.contractor.email = 'e'.repeat(320)
  assert.equal(normalizeContractParties(parties).contractor.street.length, 300)
  assert.equal(normalizeContractParties(parties).contractor.email.length, 320)
})

test('PDF uses embedded PNG, legal name and profile note without resolving live resources', async () => {
  const snapshot = signingSnapshot(), senderProfile = contractSenderFixture()
  const bytes = await sharp({ create: { width: 100, height: 30, channels: 4, background: '#183d57' } }).png().toBuffer()
  senderProfile.logoPath = `organizations/${senderProfile.organizationId}/logo-00000000-0000-4000-8000-000000000092.png`
  senderProfile.logoDataUrl = `data:image/png;base64,${bytes.toString('base64')}`
  snapshot.senderProfile = normalizeContractSenderProfile(senderProfile)
  snapshot.contractParties.contractor.companyName = senderProfile.name
  snapshot.issuerName = senderProfile.name
  snapshot.replyEmail = senderProfile.email
  const before = JSON.stringify(snapshot)
  const sections = contractSigningSections({ snapshot, files: [] })
  assert.match(JSON.stringify(sections), /Juridiskt bolag: Fiktivt Juridiskt Bolag AB/)
  const pdf = await renderContractSigningPdf({ id: signingId(500), version: 1, createdAt: '2026-10-12T10:00:00Z', snapshot, files: [] })
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-')
  assert.ok(pdf.length > 8000)
  assert.equal(JSON.stringify(snapshot), before)
  const source = readFileSync(new URL('../src/lib/action-cases/contractSigningPdf.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(source, /createSupabase|fetch\(|readOrganization|senderProfiles/)
  assert.match(source, /s\.senderProfile\?\.reportFooterText/)
})
