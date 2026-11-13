import assert from 'node:assert/strict'
import test from 'node:test'
// @ts-expect-error Node's strip-types runner needs the explicit extension.
import { loadTuModule } from './helpers/load-tu-module.ts'
import type { TuCustomerKind } from '../src/lib/tu/customer'

const customerDomain = loadTuModule<typeof import('../src/lib/tu/customer')>('src/lib/tu/customer.ts')
const hash = 'a'.repeat(64)

function setup(kind: TuCustomerKind, objectType: string, legacy = false, consumeError?: string) {
  const customer = { version: 1, kind, identityNumber: kind === 'consumer' ? '' : '769000-0000',
    contactName: 'Kontaktperson', contactRole: 'Styrelse', invoiceName: '', invoiceAddress: '', invoiceReference: 'P1' }
  const pricing = customerDomain.calculateTuPricing(5000, 'exclusive')
  const details: Record<string, unknown> = { objectType, customerType: kind === 'consumer' ? 'consumer' : 'business',
    ...(legacy ? {} : { tuCustomer: customer, tuPricing: pricing }) }
  const payloads: Record<string, unknown>[] = []
  const chain = { update: () => chain, eq: () => chain, then: (resolve: (value: unknown) => unknown) => Promise.resolve({ error: null }).then(resolve) }
  const route = loadTuModule<{ POST: (request: Request, context: unknown) => Promise<Response> }>('src/app/api/assignments/accept/[token]/route.ts', {
    'next/server': { NextResponse: { json: (body: unknown, init?: ResponseInit) => Response.json(body, init) }, after: () => {} },
    '@/lib/assignments/server': {
      resolvePublicAssignmentByToken: async () => ({ org_id: 'org', expires_at: '2099-12-31', assignments: {
        id: 'assignment', assignment_type: 'TU', status: 'sent', price_amount: 6250, assignment_details: details,
      } }),
      consumeAssignmentToken: async (input: { payload: Record<string, unknown> }) => { if (consumeError) throw new Error(consumeError); payloads.push(input.payload) },
      getAssignmentById: async () => null,
    },
    '@/lib/assignments/terms': { resolveAssignmentTermsRole: () => 'technical', getAssignmentTermsDocument: () => ({ version: 'test', documentHash: hash }) },
    '@/lib/supabase/admin': { createSupabaseAdminClient: () => ({ from: () => chain }) },
    '@/lib/assignments/linkIncidents': { publicLinkErrorCode: () => 'TEST' },
    '@/lib/assignments/issuerIdentity': {}, '@/lib/organizations/profileCard': {},
    '@/lib/assignments/addons': {}, '@/lib/certifications/profileResolver': {},
  })
  const send = (patch: Record<string, unknown> = {}) => route.POST(new Request('https://example.test/accept', {
    method: 'POST', body: JSON.stringify({ termsAccepted: true, termsVersion: 'test', termsDocumentHash: hash,
      customerEmail: 'contact@example.test', customerName: 'Bestallare', customerAddress: 'Kundgatan 1',
      preferredDate: '2099-12-15', preferredTime: '13:00', consumerWithdrawalAcknowledged: true,
      propertyAddress: 'Objektgatan 2', cadastralId: 'Objekt 1:2', brfName: 'Objektets BRF', apartmentNumber: '12',
      ...(legacy ? {} : { tuCustomer: { ...customer, contactName: 'Godkannaren', invoiceReference: 'P2' }, representativeConfirmed: true }),
      invoiceEmail: 'invoice@example.test', priceAmount: 1, tuPricing: { gross: 1 }, ...patch,
    }),
  }), { params: Promise.resolve({ token: 'test-acceptance-token-with-enough-length' }) })
  return { send, payloads, details, pricing, customer }
}

for (const kind of ['consumer', 'business', 'association'] as const) {
  test(`TU ${kind}: public approval preserves issued prices and separates customer from object`, async () => {
    const fixture = setup(kind, kind === 'consumer' ? 'apartment' : 'villa')
    const response = await fixture.send()
    assert.equal(response.status, 200, JSON.stringify(await response.json()))
    const payload = fixture.payloads[0]
    const details = payload.assignment_details as Record<string, unknown>
    assert.deepEqual(details.tuPricing, fixture.pricing)
    assert.equal(payload.price_amount, 6250)
    assert.deepEqual(details.tuCustomer, { ...fixture.customer, contactName: 'Godkannaren', invoiceReference: 'P2' })
    assert.equal(payload.invoice_email, 'invoice@example.test')
    assert.equal(payload.customer_address, 'Kundgatan 1')
    assert.equal(payload.property_address, 'Objektgatan 2')
    assert.equal(payload.brf_name, kind === 'consumer' ? 'Objektets BRF' : null)
    assert.equal(payload.consumer_withdrawal_acknowledged, kind === 'consumer' ? true : null)
  })
}

test('public TU cannot change the contracting category or omit organization authority', async () => {
  for (const patch of [{ representativeConfirmed: false }, { tuCustomer: { ...setup('consumer', 'villa').customer } }]) {
    const fixture = setup('association', 'villa')
    assert.equal((await fixture.send(patch)).status, 400)
    assert.equal(fixture.payloads.length, 0)
  }
})

test('old TU confirmations can still be accepted without invented customer/VAT metadata', async () => {
  const fixture = setup('consumer', 'villa', true)
  assert.equal((await fixture.send()).status, 200)
  assert.deepEqual(fixture.payloads[0].assignment_details, fixture.details)
})

test('TU acceptance rejects stale content and records the version the customer actually saw', async () => {
  const fixture = setup('association', 'villa')
  fixture.details.tuEditRevision = 2
  for (const tuEditRevision of [undefined, 0, 1, '2', null]) {
    const response = await fixture.send({ tuEditRevision })
    assert.equal(response.status, 409)
    assert.equal((await response.json()).code, 'TU_ASSIGNMENT_CONTENT_CHANGED')
  }
  assert.equal(fixture.payloads.length, 0)
  assert.equal((await fixture.send({ tuEditRevision: 2 })).status, 200)
  assert.equal(fixture.payloads[0].tu_edit_revision, 2)
})

test('a concurrent TU edit detected by the database returns an actionable conflict', async () => {
  const fixture = setup('consumer', 'villa', false, 'TU_ASSIGNMENT_CONTENT_CHANGED | code=P0001')
  const response = await fixture.send()
  assert.equal(response.status, 409)
  const body = await response.json()
  assert.match(body.error, /Hämta aktuella uppgifter/)
  assert.equal(body.retryable, true)
  assert.equal(fixture.payloads.length, 0)
})
