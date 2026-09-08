import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createHmac, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import ts from 'typescript'
import type * as Server from '../src/lib/eb/followUpServer'
import type * as Shared from '../src/lib/eb/followUp'
import type { EbCustomerSession } from '../src/lib/eb/customerSession'

const require = createRequire(import.meta.url)
const envKeys = ['EB_FOLLOW_UP_ENABLED', 'RESEND_API_KEY', 'ASSIGNMENTS_MAIL_FROM', 'EB_FOLLOW_UP_EMAIL_ENCRYPTION_KEY', 'APP_BASE_URL']
const previous = Object.fromEntries(envKeys.map(key => [key, process.env[key]]))
before(() => Object.assign(process.env, { EB_FOLLOW_UP_ENABLED: 'true', RESEND_API_KEY: 'isolated-test',
  ASSIGNMENTS_MAIL_FROM: 'sender@example.test', EB_FOLLOW_UP_EMAIL_ENCRYPTION_KEY: 'checkout-test-key', APP_BASE_URL: 'https://hushub.test' }))
after(() => {
  for (const key of envKeys) {
    if (previous[key] === undefined) delete process.env[key]
    else process.env[key] = previous[key]
  }
})
function load<T>(path: string, dependencies: Record<string, unknown>): T {
  const compiled = ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const compiledModule = { exports: {} }
  new Function('require', 'module', 'exports', compiled)((name: string) => {
    if (name in dependencies) return dependencies[name]
    if (name === '@/lib/eb/followUpTerms') return terms
    if (name === '@/lib/eb/customerLinks') return { isEbCustomerLinkSessionActive: async () => true }
    if (name.startsWith('node:')) return require(name)
    throw new Error(`Unexpected dependency ${name}`)
  }, compiledModule, compiledModule.exports)
  return compiledModule.exports as T
}
const shared = load<typeof Shared>('src/lib/eb/followUp.ts', {})
const terms = load<typeof import('../src/lib/eb/followUpTerms')>('src/lib/eb/followUpTerms.ts', { './followUp': shared })
const platformSeller = load<{ getEbFollowUpPlatformSeller: () => Shared.EbFollowUpSeller }>('src/lib/eb/followUpSeller.ts', {
  '@/lib/eb/followUp': shared,
  '@/lib/publicCompanyInfo': load('src/lib/publicCompanyInfo.ts', {}),
})
type Row = Record<string, unknown>
function fixture() {
  const org = randomUUID(), inspection = randomUUID(), project = randomUUID(), link = randomUUID(), challenge = randomUUID()
  const token = 'public-report-token-that-may-be-forwarded'
  const ownerToken = 'private-owner-token-needing-email-verification'
  const email = 'customer@example.test'
  const report = { project: { id: project, title: 'Testvilla', propertyDesignation: 'VILLAN 1', address: 'Testgatan 1' },
    inspection: { inspectionId: inspection, variantLabel: 'Slutbesiktning', sequenceNo: 1, date: '2026-09-03', reportLockedAt: '2026-09-08T08:00:00Z' },
    notes: [{ id: randomUUID(), noteText: 'Frozen note', inspectionId: inspection }], images: [] }
  const rows: Record<string, Row[]> = {
    inspection_report_links: [{ id: link, org_id: org, inspection_id: inspection, created_at: '2026-09-08T08:00:00Z',
      token_hash: token, revoked_at: null, snapshot_payload: report }],
    eb_projects: [{ id: project, org_id: org, client_email: 'stale-project-contact@example.test' }],
    eb_inspection_details: [{ org_id: org, inspection_id: inspection, eb_project_id: project, report_locked_at: report.inspection.reportLockedAt }],
    eb_follow_up_orders: [],
    organizations: [{ id: org, created_by: null, eb_follow_up_seller: { name: 'Inspection Seller', orgNumber: '123456-7890', address: 'Businessgatan 2', email: 'seller@example.test' } }],
    eb_follow_up_challenges: [{ id: challenge, org_id: org, inspection_id: inspection, report_link_id: link, purpose: 'report', expires_at: new Date(Date.now() + 15 * 60_000).toISOString() }],
    eb_remediation_access_links: [],
  }
  const state = { session: null as EbCustomerSession | null, designated: email, sessionReadError: false, linkRequests: 0, rpcs: [] as Array<{ name: string; input: Row }> }
  const admin = {
    from: (table: string) => {
      assert.ok(table in rows, `Unexpected table ${table}`)
      let selected = rows[table]
      const query = {
        select: () => query,
        eq: (key: string, value: unknown) => { selected = selected.filter(row => row[key] === value); return query },
        is: (key: string, value: unknown) => query.eq(key, value), order: () => query, limit: () => query,
        maybeSingle: async () => ({ data: selected[0] ?? null, error: null }),
      }
      return query
    },
    rpc: async (name: string, input: Row) => {
      state.rpcs.push({ name, input })
      if (name === 'eb_request_follow_up_challenge') return { data: { limited: false }, error: null }
      if (name === 'eb_verify_follow_up_challenge') {
        const expected = createHmac('sha256', 'checkout-test-key').update(`eb-follow-up-code-v1:${challenge}:123456`).digest('hex')
        return { data: { verified: input.p_id === challenge && input.p_report_link_id === link && input.p_code_hash === expected, email }, error: null }
      }
      assert.equal(name, 'eb_complete_follow_up_order')
      rows.eb_follow_up_orders.push({ id: challenge, org_id: org, eb_project_id: project, inspection_id: inspection,
        buyer_snapshot: input.p_buyer, seller_snapshot: input.p_seller })
      rows.eb_remediation_access_links.push({ id: randomUUID(), token_hash: ownerToken, org_id: org, inspection_id: inspection,
        follow_up_order_id: challenge, email, role: 'customer_owner', revoked_at: null, expires_at: new Date(Date.now() + 86400_000).toISOString() })
      return { data: { orderId: challenge, encryptedResult: JSON.stringify({ portalUrl: `https://hushub.test/atgarder/${ownerToken}` }), created: true }, error: null }
    },
  }
  const server = load<typeof Server>('src/lib/eb/followUpServer.ts', {
    '@/lib/eb/followUp': shared,
    '@/lib/eb/followUpConfirmation': load('src/lib/eb/followUpConfirmation.ts', {}),
    '@/lib/supabase/admin': { createSupabaseAdminClient: () => admin },
    '@/lib/assignments/tokens': { hashAssignmentToken: (value: string) => value, generateAssignmentToken: () => ownerToken },
    '@/lib/eb/reportSnapshot': { getEbInspectionReportFromSnapshot: (value: unknown) => value },
    '@/lib/eb/followUpDelivery': { encryptEbFollowUpPayload: JSON.stringify, decryptEbFollowUpPayload: JSON.parse, escapeEbFollowUpHtml: (value: string) => value },
    '@/lib/eb/followUpCustomer': { resolveEbFollowUpCustomer: async () => ({ email: state.designated || null, source: 'confirmed' }) },
    '@/lib/eb/followUpSeller': platformSeller,
    '@/lib/eb/customerLinks': {
      isEbCustomerLinkSessionActive: async () => true,
      EB_CUSTOMER_LINK_MESSAGE: 'Generic personal-link message',
      issueEbCustomerLink: async () => { state.linkRequests++; if (state.linkRequests > 1) throw new Error('EB_FOLLOW_UP_RATE_LIMITED'); return 'private-link' },
    },
    '@/lib/eb/customerSession': {
      readEbCustomerSession: async () => { if (state.sessionReadError) throw new Error('PRIVATE_AUTH_ERROR'); return state.session },
      setEbCustomerSession: async (session: EbCustomerSession) => { state.session = session },
    },
  })
  const verify = (code = '123456') => server.verifyEbFollowUpCustomerCode({ token, challengeId: challenge, code })
  const orderInput = { action: 'order', name: 'Verified Buyer', invoiceName: 'Fakturamottagare', invoiceAddress: 'Fakturagatan 3',
    invoicePostalCode: '12345', invoiceCity: 'Staden', invoiceOrgNo: '556677-8899',
    customerType: 'consumer', consumerWithdrawalAcknowledged: true,
    acceptTerms: true, requestImmediateStart: true, acceptInvoice: true, termsVersion: shared.EB_FOLLOW_UP_TERMS_VERSION, confirmedPriceOre: 59900 }
  return { org, inspection, project, link, challenge, token, email, ownerToken, rows, state, server, verify, orderInput }
}

test('public report holder gets no offer, price, seller or purchase state before verification', async () => {
  const f = fixture()
  assert.deepEqual(await f.server.getEbFollowUpCustomerState(f.token), { verified: false, offer: null, accessAvailable: true, retryable: false })
  assert.equal(f.state.rpcs.length, 0)
})

test('wrong, eligible and rate-limited personal-link requests have identical public replies and never order', async () => {
  const f = fixture()
  const replies = []
  for (const email of ['wrong@example.test', f.email, f.email]) {
    replies.push(await f.server.requestEbFollowUpCustomerLink({token:f.token,email,baseUrl:'https://hushub.test'}))
  }
  assert.deepEqual(replies[0],replies[1])
  assert.deepEqual(replies[1],replies[2])
  assert.equal(f.state.linkRequests,2)
  assert.equal(f.state.session,null)
  assert.equal(f.state.rpcs.length,0)
})

test('temporary session lookup failure is a neutral retry without revealing an offer or internal error', async () => {
  const f = fixture()
  f.state.sessionReadError = true
  assert.deepEqual(await f.server.getEbFollowUpCustomerState(f.token), { verified: false, offer: null, accessAvailable: false, retryable: true })
})

test('a report recipient or stale project email cannot obtain a customer verification email', async () => {
  const f = fixture()
  for (const email of ['contractor@example.test', 'stale-project-contact@example.test']) {
    const response = await f.server.requestEbFollowUpCode({ token: f.token, email })
    assert.ok(response.challengeId)
    assert.doesNotMatch(JSON.stringify(response), /customer@example/)
    const requested = f.state.rpcs.at(-1)!.input
    assert.equal(requested.p_eligible, false)
    assert.equal(requested.p_mail_ciphertext, null)
  }
  await f.server.requestEbFollowUpCode({ token: f.token, email: f.email })
  assert.equal(f.state.rpcs.at(-1)!.input.p_eligible, true)
})

test('wrong codes and owner-purpose codes never expose checkout or mint report sessions', async () => {
  const f = fixture()
  await assert.rejects(f.verify('654321'), /VERIFICATION_REQUIRED/)
  assert.equal(f.state.session, null)
  f.rows.eb_follow_up_challenges[0].purpose = 'owner'
  const calls = f.state.rpcs.length
  await assert.rejects(f.verify(), /VERIFICATION_REQUIRED/)
  assert.equal(f.state.rpcs.length, calls)
})

test('verification is its own step and client-submitted code without the server session cannot order', async () => {
  const f = fixture()
  await assert.rejects(f.server.completeEbFollowUpOrder({ token: f.token,
    input: { ...f.orderInput, challengeId: f.challenge, code: '123456', session: { email: f.email } } }), /VERIFICATION_REQUIRED/)
  const verified = await f.verify()
  assert.equal(verified.verified, true)
  assert.equal(verified.offer.priceOre, 59900)
  assert.equal(f.state.session?.kind, 'report')
  assert.equal(f.state.rpcs.some(call => call.name === 'eb_complete_follow_up_order'), false)
  assert.equal((await f.server.getEbFollowUpCustomerState(f.token)).verified, true)
})

test('another inspection, report or changed designated contact invalidates checkout permission', async () => {
  const f = fixture()
  await f.verify()
  const original = { ...f.state.session! }
  for (const change of [{ orgId: randomUUID() }, { inspectionId: randomUUID() }, { reportLinkId: randomUUID() }]) {
    f.state.session = { ...original, ...change }
    await assert.rejects(f.server.completeEbFollowUpOrder({ token: f.token, input: f.orderInput }), /VERIFICATION_REQUIRED/)
  }
  f.state.session = original
  f.state.designated = 'new-confirmed-customer@example.test'
  assert.equal((await f.server.getEbFollowUpCustomerState(f.token)).verified, false)
  await assert.rejects(f.server.completeEbFollowUpOrder({ token: f.token, input: f.orderInput }), /VERIFICATION_REQUIRED/)
})

test('a new purchase queues full manual invoice material only to Admin and a separate buyer receipt', async () => {
  const f = fixture()
  await f.verify()
  const result = await f.server.completeEbFollowUpOrder({ token: f.token, input: { ...f.orderInput, email: 'attacker@example.test',
    acceptanceSnapshot: { termsText: 'UNTRUSTED-CHECKOUT-TERMS' }, confirmationPdf: { project: { title: 'UNTRUSTED-PROJECT' } } } })
  assert.equal(result.portalUrl, `/atgarder/${f.ownerToken}`)
  const completion = f.state.rpcs.find(call => call.name === 'eb_complete_follow_up_order')!.input
  assert.equal((completion.p_buyer as Row).email, f.email)
  assert.deepEqual(completion.p_seller, platformSeller.getEbFollowUpPlatformSeller())
  assert.equal(completion.p_terms_version, '2026-09-08.2')
  const mails = completion.p_emails as Array<{ kind: string; ciphertext: string; dedupeKey: string }>
  const invoice = JSON.parse(mails.find(mail => mail.kind === 'invoice')!.ciphertext)
  assert.equal(invoice.to, 'jn@hedbjorn.se')
  for (const text of ['599,00', '479,20', '119,80', 'JNH Consulting AB', '559027-7694', 'Fakturamottagare', 'Fakturagatan 3', '12345', 'Staden', '556677-8899', f.email, f.inspection, f.challenge, 'Testvilla', 'VILLAN 1', '2026-09-03', 'Ingen faktura har skapats']) {
    assert.ok(invoice.text.includes(text), `Missing invoice material: ${text}`)
  }
  assert.equal(JSON.parse(mails.find(mail => mail.kind === 'receipt')!.ciphertext).to, f.email)
  const receipt = JSON.parse(mails.find(mail => mail.kind === 'receipt')!.ciphertext)
  const saved = (completion.p_buyer as Shared.EbFollowUpBuyer).acceptanceSnapshot!
  assert.equal(receipt.confirmationPdf.version, 1)
  assert.equal(receipt.confirmationPdf.orderId, f.challenge)
  assert.deepEqual(receipt.confirmationPdf.buyer, completion.p_buyer)
  assert.deepEqual(receipt.confirmationPdf.seller, completion.p_seller)
  assert.deepEqual(receipt.confirmationPdf.buyer.acceptanceSnapshot, saved, 'PDF source contains exact archived terms, consents, hash and timestamps')
  assert.deepEqual(receipt.confirmationPdf.price, { totalOre: 59900, netOre: 47920, vatOre: 11980, vatRate: 25 })
  assert.deepEqual(receipt.confirmationPdf.project, { title: 'Testvilla', propertyDesignation: 'VILLAN 1', address: 'Testgatan 1',
    customerName: 'Verified Buyer', inspectionLabel: 'Slutbesiktning 1', inspectionDate: '2026-09-03', reportNumber: '' })
  assert.equal(receipt.confirmationPdf.withdrawalFormText, terms.getEbFollowUpWithdrawalFormText(completion.p_seller as Shared.EbFollowUpSeller))
  assert.match(receipt.confirmationPdf.withdrawalFormText, /Underskrift \(endast om blanketten skickas på papper\)/)
  assert.doesNotMatch(JSON.stringify(receipt), /UNTRUSTED-CHECKOUT-TERMS|UNTRUSTED-PROJECT|Intern besiktningsvy/)
  assert.ok(!receipt.text.includes(saved.termsText), 'Full terms belong in the durable attachment, not duplicated in the short email')
  assert.match(receipt.text, /bifogad PDF/)
  assert.ok(receipt.text.includes(saved.withdrawalDeadline))
  assert.match(receipt.text, /Beställt: .*\(svensk tid\)/)
  assert.ok(receipt.html.includes(`href="https://hushub.test/atgarder/${f.ownerToken}#angra-bestallning"`))
  assert.ok(receipt.html.includes(terms.EB_FOLLOW_UP_WITHDRAWAL_FORM_URL))
  assert.equal(invoice.confirmationPdf, undefined)
  assert.equal(JSON.parse(mails.find(mail => mail.kind === 'access')!.ciphertext).confirmationPdf, undefined)
  assert.ok(invoice.text.includes(saved.withdrawalDeadline))
  assert.equal(f.state.session?.kind, 'owner')
  const before = f.state.rpcs.length
  f.state.designated = 'later-project-contact@example.test'
  assert.equal((await f.server.completeEbFollowUpOrder({ token: f.token, input: { action: 'access' } })).orderId, f.challenge)
  assert.equal(f.state.rpcs.length, before, 'Reopening does not enqueue invoice, receipt or another access email')
})

test('revoked or expired private entry cannot be restored merely with an old owner session', async () => {
  const f = fixture()
  await f.verify(); await f.server.completeEbFollowUpOrder({ token: f.token, input: f.orderInput })
  f.rows.eb_remediation_access_links[0].revoked_at = new Date().toISOString()
  await assert.rejects(f.server.completeEbFollowUpOrder({ token: f.token, input: { action: 'access' } }), /VERIFICATION_REQUIRED/)
})
