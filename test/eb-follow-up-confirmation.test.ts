import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import type { EbFollowUpConfirmation } from '../src/lib/eb/followUpConfirmation'
import type * as Confirmation from '../src/lib/eb/followUpConfirmation'

const compiled = ts.transpileModule(readFileSync(new URL('../src/lib/eb/followUpConfirmation.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const compiledModule = { exports: {} }
new Function('require', 'module', 'exports', compiled)((id: string) => {
  throw new Error(`Confirmation email must not perform I/O or load live business data: ${id}`)
}, compiledModule, compiledModule.exports)
const { buildEbFollowUpConfirmationEmail } = compiledModule.exports as typeof Confirmation
const portalUrl = 'https://hushub.test/atgarder/private-buyer-token'

function fixture(customerType: 'consumer' | 'business' = 'consumer'): EbFollowUpConfirmation {
  return {
    version: 1, orderId: '234fb2a2-96c4-4738-b1da-0bde95726677',
    buyer: {
      name: 'Anna Exempel', email: 'anna@example.test', customerType,
      invoiceName: 'Anna Exempel', invoiceAddress: 'Fakturagatan 4', invoicePostalCode: '123 45',
      invoiceCity: 'Fakturastaden', invoiceOrgNo: null,
      acceptanceSnapshot: {
        termsVersion: 'frozen-v1', termsText: 'COMPLETE-ACCEPTED-TERMS-ONLY-IN-PDF', termsHash: 'frozen-sha256',
        acceptedAt: '2026-09-08T12:34:56.000Z', withdrawalDeadline: customerType === 'consumer' ? '2026-09-22' : null,
        withdrawalFormUrl: 'https://example.test/accepted-withdrawal-form',
        consentTexts: { acceptTerms: 'ACCEPTED-TERMS-CONSENT', requestImmediateStart: 'ACCEPTED-START-CONSENT',
          acceptInvoice: 'ACCEPTED-INVOICE-CONSENT', ...(customerType === 'consumer' ? { consumerWithdrawalAcknowledged: 'ACCEPTED-WITHDRAWAL-CONSENT' } : {}) },
        consents: { acceptTerms: true, requestImmediateStart: true, acceptInvoice: true, consumerWithdrawalAcknowledged: customerType === 'consumer' },
      },
    },
    seller: { name: 'JNH Consulting AB', orgNumber: '559027-7694', email: 'jn@example.test', address: 'Säljargatan 2' },
    project: { title: 'Renovering av Testvilla', propertyDesignation: 'VILLAN 1:2', address: 'Villavägen 4, 123 45 Teststad',
      customerName: 'Anna & Anders Exempel', inspectionLabel: 'Slutbesiktning 1', inspectionDate: '2026-09-03', reportNumber: 'EB 2026-0903-01' },
    price: { totalOre: 59900, netOre: 47920, vatOre: 11980, vatRate: 25 },
    withdrawalFormText: customerType === 'consumer' ? 'COMPLETE-FROZEN-WITHDRAWAL-FORM' : '',
  }
}

test('short confirmation has project, Swedish order time, frozen price, personal CTA and attachment information in HTML and text', () => {
  const data = fixture()
  const mail = buildEbFollowUpConfirmationEmail(data, portalUrl)
  assert.equal(mail.subject, 'Beställningsbekräftelse – digital åtgärdsuppföljning')
  for (const body of [mail.text, mail.html]) {
    for (const required of ['Renovering av Testvilla', 'VILLAN 1:2', 'Villavägen 4, 123 45 Teststad', 'Slutbesiktning 1',
      '2026-09-03', 'EB 2026-0903-01', data.orderId, '14:34', 'svensk tid', '599 kr inkl. moms',
      'Öppna åtgärdsuppföljningen', 'bifogad PDF', 'Fakturan skickas separat', 'inte en faktura', 'JNH Consulting AB']) {
      assert.ok(body.includes(required), required)
    }
    assert.doesNotMatch(body, /COMPLETE-ACCEPTED-TERMS|ACCEPTED-START-CONSENT|Fakturagatan 4|COMPLETE-FROZEN-WITHDRAWAL-FORM/)
  }
  assert.ok(mail.text.includes(portalUrl))
  assert.equal(mail.html.split(`href="${portalUrl}"`).length - 1, 1, 'One prominent personal portal action')
  assert.match(mail.html, /table role="presentation"/)
  assert.match(mail.html, /if mso/)
})

test('consumer receipt retains discreet withdrawal action and the accepted form URL without duplicating full legal text', () => {
  const mail = buildEbFollowUpConfirmationEmail(fixture(), portalUrl)
  for (const body of [mail.text, mail.html]) {
    assert.match(body, /Beräknad sista ångerdag: 2026-09-22 \(svensk tid\)/)
    assert.ok(body.includes(`${portalUrl}#angra-bestallning`))
    assert.ok(body.includes('https://example.test/accepted-withdrawal-form'))
    assert.match(body, /information om ångerrätt och ångerblankett/)
  }
  assert.doesNotMatch(mail.html, /<h\d[^>]*>Ångra/)
})

test('business receipt has no consumer withdrawal date or actions', () => {
  const mail = buildEbFollowUpConfirmationEmail(fixture('business'), portalUrl)
  for (const body of [mail.text, mail.html]) {
    assert.doesNotMatch(body, /ångerrätt|ångerdag|ångerblankett|angra-bestallning|accepted-withdrawal-form|14 dagar/)
    assert.match(body, /bifogad PDF/)
  }
})

test('all dynamic HTML text and URLs are escaped', () => {
  const data = fixture()
  const hostile = `<img src=x onerror="bad()">' &`
  data.buyer.name = hostile
  data.seller.name = hostile
  data.seller.email = hostile
  data.seller.phone = hostile
  data.project.title = hostile
  data.project.propertyDesignation = hostile
  data.project.address = hostile
  data.project.inspectionLabel = hostile
  data.project.inspectionDate = hostile
  data.project.reportNumber = hostile
  data.orderId = hostile
  data.buyer.acceptanceSnapshot!.withdrawalDeadline = hostile
  data.buyer.acceptanceSnapshot!.withdrawalFormUrl = 'https://example.test/form?a=1&b="quoted"'
  const mail = buildEbFollowUpConfirmationEmail(data, 'https://hushub.test/atgarder/test?a=1&b="quoted"')
  assert.doesNotMatch(mail.html, /<img|onerror="bad\(\)"/)
  assert.ok(mail.html.includes('&lt;img src=x onerror=&quot;bad()&quot;&gt;&#39; &amp;'))
  assert.ok(mail.html.includes('href="https://example.test/form?a=1&amp;b=&quot;quoted&quot;"'))
  assert.ok(mail.html.includes('href="https://hushub.test/atgarder/test?a=1&amp;b=&quot;quoted&quot;"'))
  assert.ok(mail.text.includes(hostile), 'Plaintext preserves the literal supplied name')
})

test('Swedish order time handles summer/winter offsets and date boundaries independent of host timezone', () => {
  for (const [instant, date, hour] of [
    ['2026-09-08T22:30:00Z', '9 sep.', '00:30'],
    ['2026-01-08T22:30:00Z', '8 jan.', '23:30'],
  ]) {
    const data = fixture()
    data.buyer.acceptanceSnapshot!.acceptedAt = instant
    const { text } = buildEbFollowUpConfirmationEmail(data, portalUrl)
    assert.ok(text.includes(date))
    assert.ok(text.includes(hour))
  }
})

test('missing or invalid legacy acceptance time is not replaced with the current date or invented withdrawal rights', () => {
  const data = fixture('business')
  data.buyer.acceptanceSnapshot!.acceptedAt = 'invalid'
  assert.match(buildEbFollowUpConfirmationEmail(data, portalUrl).text, /Beställt: Ej registrerat/)
  delete data.buyer.acceptanceSnapshot
  delete data.buyer.customerType
  const mail = buildEbFollowUpConfirmationEmail(data, portalUrl)
  assert.match(mail.text, /Beställt: Ej registrerat/)
  assert.doesNotMatch(mail.text, /ångerdag|Ångra beställningen/)
})

test('confirmation generation is deterministic, uses the frozen price and leaves the source unchanged', () => {
  const data = fixture()
  data.price.totalOre = 69950
  const before = JSON.stringify(data)
  const first = buildEbFollowUpConfirmationEmail(data, portalUrl)
  assert.match(first.text, /699,50 kr inkl\. moms/)
  assert.deepEqual(buildEbFollowUpConfirmationEmail(data, portalUrl), first)
  assert.equal(JSON.stringify(data), before)
})
