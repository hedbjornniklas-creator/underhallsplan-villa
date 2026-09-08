import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

function load(path: string, dependencies: Record<string, unknown> = {}) {
  const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const compiledModule = { exports: {} }
  new Function('require', 'exports', 'module', output)((id: string) => {
    if (id in dependencies) return dependencies[id]
    throw new Error(`Unexpected dependency: ${id}`)
  }, compiledModule.exports, compiledModule)
  return compiledModule.exports
}
const followUp = load('src/lib/eb/followUp.ts') as typeof import('../src/lib/eb/followUp')
const terms = load('src/lib/eb/followUpTerms.ts', { './followUp': followUp }) as typeof import('../src/lib/eb/followUpTerms')
const seller = { name: 'Säljaren AB', orgNumber: '123456-7890', address: 'Testgatan 1', email: 'seller@example.test' }

test('consumer withdrawal calendar uses Swedish date, weekends, DST and year boundaries', () => {
  for (const [instant, deadline] of [
    ['2026-09-08T10:00:00Z', '2026-09-22'],
    ['2026-09-04T22:30:00Z', '2026-09-21'], // Saturday locally, two weeks later -> Monday
    ['2026-03-20T10:00:00Z', '2026-04-07'], // Good Friday + Easter weekend/Monday
    ['2026-04-17T10:00:00Z', '2026-05-04'], // May Day + weekend
    ['2026-04-30T10:00:00Z', '2026-05-15'], // Ascension
    ['2026-06-05T10:00:00Z', '2026-06-22'], // Midsummer Eve + weekend
    ['2026-12-10T10:00:00Z', '2026-12-28'], // Christmas Eve + holidays
    ['2026-12-17T10:00:00Z', '2027-01-04'], // New Year's Eve + holidays
    ['2026-12-23T10:00:00Z', '2027-01-07'], // Epiphany
    ['2026-10-16T22:30:00Z', '2026-11-02'], // DST autumn + weekend
  ]) assert.equal(terms.getEbFollowUpWithdrawalDeadline(instant), deadline, instant)
  assert.throws(() => terms.getEbFollowUpWithdrawalDeadline('invalid'), /TIME_INVALID/)
})

test('consumer and business wording is distinct and immediate start is not a waiver', () => {
  const consumer = terms.getEbFollowUpTermsText({ seller, customerType: 'consumer' })
  const business = terms.getEbFollowUpTermsText({ seller, customerType: 'business' })
  assert.match(consumer, /14 dagar/)
  assert.match(consumer, /inte att ångerrätten upphör/)
  assert.match(consumer, /skälig och proportionell/)
  assert.match(consumer, /seller@example.test/)
  assert.ok(consumer.includes(terms.EB_FOLLOW_UP_WITHDRAWAL_FORM_URL))
  assert.match(business, /gäller inte köp för företag/)
  assert.doesNotMatch(business, /Du har rätt att ångra köpet/)
  assert.match(terms.getEbFollowUpConsentTexts('consumer').requestImmediateStart, /innan ångerfristen på 14 dagar har löpt ut/)
  assert.equal(terms.getEbFollowUpConsentTexts('business').consumerWithdrawalAcknowledged, undefined)
  assert.match(terms.getEbFollowUpWithdrawalFormText(seller), /Till: Säljaren AB/)
})

test('explicit customer type and actual booleans are mandatory, irrespective of invoice name/org number', () => {
  const input = { name: 'Kund', invoiceName: 'Kund', invoiceAddress: 'Gatan 1', invoicePostalCode: '12345', invoiceCity: 'Staden',
    acceptTerms: true, acceptInvoice: true, requestImmediateStart: true, termsVersion: followUp.EB_FOLLOW_UP_TERMS_VERSION,
    confirmedPriceOre: 59900, customerType: 'consumer', consumerWithdrawalAcknowledged: true }
  for (const customerType of [undefined, '', 'company', false]) {
    assert.throws(() => followUp.validateEbFollowUpBuyer({ ...input, customerType }, 'buyer@example.test'), /BUYER_INVALID/)
  }
  for (const value of [false, undefined, null, 'true', 1]) {
    assert.throws(() => followUp.validateEbFollowUpBuyer({ ...input, consumerWithdrawalAcknowledged: value }, 'buyer@example.test'), /CONSENT_REQUIRED/)
  }
  assert.equal(followUp.validateEbFollowUpBuyer({ ...input, customerType: 'business', consumerWithdrawalAcknowledged: false }, 'buyer@example.test').customerType, 'business')
  const buyer = followUp.validateEbFollowUpBuyer({ ...input, acceptanceSnapshot: { termsText: 'FORGED' } }, 'buyer@example.test')
  assert.equal(buyer.acceptanceSnapshot, undefined)
})
