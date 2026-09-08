import assert from 'node:assert/strict'
import test from 'node:test'
// @ts-expect-error Explicit extensions are required by Node's strip-types runner.
import { renderEbFollowUpConfirmationPdf, buildEbFollowUpConfirmationFilename } from '../src/lib/eb/followUpConfirmationPdf.ts'
// @ts-expect-error Explicit extensions are required by Node's strip-types runner.
import { confirmationFixture } from './fixtures/eb-follow-up-confirmation.ts'

test('renders complete consumer and business confirmations without remote assets', async () => {
  for (const type of ['consumer', 'business'] as const) {
    const data = confirmationFixture(type)
    const before = JSON.stringify(data)
    const pdf = await renderEbFollowUpConfirmationPdf(data)
    assert.equal(pdf.subarray(0, 5).toString(), '%PDF-')
    assert.ok(pdf.length > 8_000)
    assert.equal(JSON.stringify(data), before, 'rendering never rewrites frozen acceptance evidence')
    assert.equal(buildEbFollowUpConfirmationFilename(data), 'Bestallningsbekraftelse-Atgardsuppfoljning-2026-09-08-cfe2174a.pdf')
  }
})

test('filenames use Swedish order date and safe identifiers, not customer names or bearer links', () => {
  const data = confirmationFixture()
  data.buyer.acceptanceSnapshot!.acceptedAt = '2026-09-08T23:30:00.000Z'
  assert.match(buildEbFollowUpConfirmationFilename(data), /2026-09-09-cfe2174a\.pdf$/)
  data.orderId = '../../\\secret:?<>*'
  assert.doesNotMatch(buildEbFollowUpConfirmationFilename(data), /[/\\:<>?*]/)
})

test('missing frozen agreement evidence fails instead of inventing current terms', async () => {
  for (const field of ['termsText', 'termsHash', 'acceptedAt'] as const) {
    const data = confirmationFixture()
    data.buyer.acceptanceSnapshot![field] = ''
    await assert.rejects(renderEbFollowUpConfirmationPdf(data), /SNAPSHOT_INVALID/)
  }
  const data = confirmationFixture()
  data.withdrawalFormText = ''
  await assert.rejects(renderEbFollowUpConfirmationPdf(data), /SNAPSHOT_INVALID/)
  data.buyer.customerType = undefined
  await assert.rejects(renderEbFollowUpConfirmationPdf(data), /SNAPSHOT_INVALID/)
})
