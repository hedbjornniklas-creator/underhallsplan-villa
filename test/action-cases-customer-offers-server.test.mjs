import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as crypto from 'node:crypto'
import ts from 'typescript'
import * as domain from '../src/lib/action-cases/customerOffers.ts'
import * as quotes from '../src/lib/action-cases/quotes.ts'
import * as costingDomain from '../src/lib/action-cases/customerOfferCosting.ts'
import * as planningDomain from '../src/lib/action-cases/customerPlanning.ts'
import { emptyContractDetails } from '../src/lib/action-cases/customerContract.ts'
import { emptyContractParties } from '../src/lib/action-cases/customerContractParties.ts'
import {
  workspace,
  snapshot,
  id,
  token
} from './fixtures/customer-offer-data.ts'

const code = ts.transpileModule(
  readFileSync(
    new URL('../src/lib/action-cases/customerOffersServer.ts', import.meta.url),
    'utf8'
  ),
  {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022
    }
  }
).outputText
function harness(options = {}) {
  const calls = [],
    reads = [],
    sent = [],
    copies = [],
    removed = [],
    signed = []
  const draft = structuredClone(workspace.draft)
  if (!options.legacyDraft) draft.items = draft.items.filter((i) => i.kind !== 'option')
  let saved = options.saved ?? null
  let sendFailed = Boolean(options.sendFailed)
  const link = {
    id: id(40),
    org_id: id(90),
    action_case_id: id(1),
    participant_id: id(2),
    revoked_at: null,
    expires_at: '2099-01-01',
    ...options.link
  }
  const participant = {
    id: id(2),
    role: 'customer',
    name: 'Anna Exempel',
    email: 'anna@example.test',
    ...options.participant
  }
  const admin = {
    from(table) {
      const read = { table, columns: '', filters: [] }
      reads.push(read)
      const result = () => {
        if (table === 'action_case_customer_planning' && options.planningMissing)
          return { error: { code: '42P01' } }
        if (table === 'action_case_customer_offer_drafts' && read.columns.includes('internal_costing') && options.costingMissing)
          return { error: { code: '42703' } }
        if (table === 'action_case_customer_offers') {
          if (options.schemaMissing) return { error: { code: '42P01' } }
          if (
            options.uncertain &&
            calls.some((c) => c.p_operation === 'publish')
          )
            return { error: { code: 'connection_failed' } }
          if (read.filters.some(([key]) => key === 'draft_revision'))
            return { data: saved ? { id: saved.id } : null }
          if (read.filters.some(([key]) => key === 'id')) return { data: saved }
          return { data: saved ? [saved] : [] }
        }
        return {
          data: {
            action_cases: {
              id: id(1),
              title: 'Project',
              property_address: 'Address',
              ...(options.customerRegistry ? { organization_customer_id: null } : {})
            },
            action_case_customer_offer_drafts: { body: draft, revision: 1, internal_costing: options.costing ?? {} },
            action_case_customer_planning: options.planning ?? null,
            action_case_participants: participant,
            organizations: { name: 'Exempelbygg AB' },
            profiles: { email: 'byggare@example.test' },
            action_case_access_links: link,
            action_case_attachments: options.missingFile
              ? []
              : [
                  {
                    id: id(4),
                    file_name: 'Terms.pdf',
                    content_type: 'application/pdf',
                    file_size_bytes: 1000,
                    storage_bucket: 'action-case-files',
                    file_path: `${id(90)}/${id(1)}/source`
                  }
                ]
          }[table]
        }
      }
      const chain = {
        select(cols) {
          read.columns = cols
          return chain
        },
        eq(...f) {
          read.filters.push(f)
          return chain
        },
        in(...f) {
          read.filters.push(f)
          return chain
        },
        order() {
          return chain
        },
        maybeSingle() {
          return Promise.resolve(result())
        },
        single() {
          return Promise.resolve(result())
        },
        then(done) {
          return Promise.resolve(result()).then(done)
        }
      }
      return chain
    },
    storage: {
      from(bucket) {
        return {
          async copy(path, to, opts) {
            copies.push({ bucket, path, to, opts })
            return options.copyFailed ? { error: { message: 'failed' } } : {}
          },
          async info() {
            return { data: { size: 1000 } }
          },
          async remove(paths) {
            removed.push(...paths)
            return {}
          },
          async createSignedUrl(...args) {
            signed.push({ bucket, args })
            return { data: { signedUrl: 'https://storage.example.test/file' } }
          }
        }
      }
    },
    async rpc(name, args) {
      calls.push({ name, ...args })
      if (name === 'assert_customer_offer_scope_conditions' && options.conditionsMissing)
        return { error: { code: 'PGRST202' } }
      if (name === 'assert_customer_payment_plan' && options.paymentPlanMissing)
        return { error: { code: 'PGRST202' } }
      if (name === 'assert_customer_contract' && options.contractMissing)
        return { error: { code: 'PGRST202' } }
      if (name === 'save_customer_offer_costing' && options.costingMissing)
        return { error: { code: 'PGRST202' } }
      if (name === 'assert_customer_offer_pricing' && options.pricingMissing)
        return { error: { code: '42883' } }
      if (args.p_operation === 'publish') {
        if (options.publishFailed || options.uncertain)
          return { error: { message: 'CUSTOMER_OFFER_STALE' } }
        const p = args.p_data
        saved = {
          id: p.id,
          org_id: id(90),
          action_case_id: id(1),
          participant_id: id(2),
          version: 1,
          status: 'published',
          snapshot: p.snapshot,
          files: p.files,
          email_payload: p.emailPayload,
          published_at: '2026-09-29T10:00:00Z',
          accepted_total_ore: null
        }
        return { data: { id: saved.id } }
      }
      if (args.p_operation === 'claim_send')
        return {
          data: saved.sent_at
            ? { sent: true }
            : { leaseId: id(99), payload: saved.email_payload }
        }
      if (args.p_operation === 'finish_send') {
        if (args.p_data.success) saved.sent_at = '2026-09-29T10:00:01Z'
        return { data: {} }
      }
      if (args.p_operation === 'challenge')
        return { data: { challengeId: args.p_data.challengeId } }
      if (args.p_operation === 'accept') {
        saved = {
          ...saved,
          status: 'accepted',
          accepted_at: '2026-09-29T12:34:00Z',
          accepted_by: 'Server-stored name',
          accepted_option_ids: [],
          accepted_total_ore: 125000000
        }
        return { data: { accepted: true } }
      }
      return { data: {} }
    }
  }
  const deps = {
    'server-only': {},
    'node:crypto': crypto,
    './quotes': quotes,
    './customerOffers': domain,
    './customerOfferCosting': costingDomain,
    './customerPlanning': planningDomain,
    './customerRegistryServer': { async writeContractCustomer(ctx, caseId, payload, bind) { calls.push({ name: 'writeContractCustomer', ctx, caseId, payload, bind }) } },
    '@/lib/supabase/admin': { createSupabaseAdminClient: () => admin },
    '@/lib/assignments/tokens': {
      generateAssignmentToken: () => token,
      hashAssignmentToken: (t) =>
        crypto.createHash('sha256').update(t).digest('hex')
    },
    '@/lib/assignments/mailer': {
      async sendAssignmentEmail(payload) {
        sent.push(payload)
        if (sendFailed) throw Error('private provider error')
        return { providerMessageId: 'mail-1' }
      }
    }
  }
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', 'process', code)(
    mod,
    mod.exports,
    (name) => {
      assert.ok(name in deps, name)
      return deps[name]
    },
    {
      env: {
        NODE_ENV: 'production',
        APP_BASE_URL: 'https://customer.example.test',
        ASSIGNMENTS_MAIL_FROM: 'sender@example.test',
        RESEND_API_KEY: 'test-only'
      }
    }
  )
  return {
    api: mod.exports,
    calls,
    reads,
    sent,
    copies,
    removed,
    signed,
    draft,
    link,
    participant,
    saved: () => saved,
    recover: () => {
      sendFailed = false
    },
    run: (extra = {}) =>
      mod.exports.publishCustomerOffer(
        { orgId: id(90), userId: id(91) },
        id(1),
        { revision: 1, confirmed: true, ...extra },
        'https://ignored.example.test'
      )
  }
}

test('structured parties are stored internally, checked before delivery and projected without buyer identifiers', async () => {
  const h = harness(), ctx = { orgId: id(90), userId: id(91) }
  h.draft.contractParties = emptyContractParties('Anna Exempel', 'anna@example.test')
  h.draft.contractParties.customers[0].personalNumber = '19000101-0000'
  await h.api.saveCustomerOffer(ctx, id(1), { revision: 1, draft: h.draft })
  assert.equal(h.calls.find((call) => call.p_operation === 'save').p_data.body.contractParties.customers[0].personalNumber, '19000101-0000')
  await assert.rejects(h.run(), /INCOMPLETE/)
  assert.equal(h.sent.length, 0)
  assert.equal(h.copies.length, 0)
  Object.assign(h.draft.contractParties, { street: 'Testgatan 1', postalCode: '11122', city: 'Stockholm' })
  Object.assign(h.draft.contractParties.contractor, { companyName: 'Exempelbygg AB', organizationNumber: '556000-0000', street: 'Bygggatan 1', postalCode: '11122', city: 'Stockholm', email: 'byggare@example.test', fTax: 'yes' })
  h.draft.contractParties.customers.push({ name: 'Bo Exempel', personalNumber: '' })
  await assert.rejects(h.run(), /INCOMPLETE/)
  h.draft.contractParties.customers.pop()
  await h.run()
  assert.equal(h.saved().snapshot.contractParties.customers[0].personalNumber, '19000101-0000')
  assert.equal(h.sent[0].subject, `Avtal: ${h.draft.title}`)
  assert.equal(JSON.stringify(h.sent).includes('19000101'), false)
  const shared = await h.api.getSharedCustomerOffers(h.link, h.participant)
  assert.equal(shared.offers[0].snapshot.contractParties.customers[0].personalNumber, '')
})

test('migrated contract saves use the atomic customer writer and recipient mismatch never emails or copies files', async () => {
  const h = harness({ customerRegistry: true }), ctx = { orgId: id(90), userId: id(91) }
  h.draft.contractParties = emptyContractParties('Anna Exempel', 'anna@example.test')
  Object.assign(h.draft.contractParties, { street: 'Gatan 1', postalCode: '12345', city: 'Ort' })
  Object.assign(h.draft.contractParties.contractor, { companyName: 'Bygg AB', organizationNumber: '556000-0000',
    street: 'Bygggatan 2', postalCode: '12345', city: 'Ort', email: 'bygg@example.test', fTax: 'yes' })
  await h.api.saveCustomerOffer(ctx, id(1), { revision: 1, draft: h.draft, costing: {} })
  assert.ok(h.calls.some(call => call.name === 'writeContractCustomer'))
  const read = await h.api.getCustomerOfferWorkspace(ctx, id(1))
  assert.equal(read.customerLink.available, true)
  assert.equal(read.recipient.email, h.participant.email)
  assert.equal(read.customerLink.organizationId, ctx.orgId)
  h.draft.contractParties.email = 'different@example.test'
  await assert.rejects(h.run(), /CUSTOMER_OFFER_RECIPIENT/)
  h.draft.contractParties.email = h.participant.email
  h.draft.contractParties.customers[0].name = 'Other Person'
  await assert.rejects(h.run(), /CUSTOMER_OFFER_RECIPIENT/)
  assert.equal(h.sent.length, 0)
  assert.equal(h.copies.length, 0)
})

test('contract autosave writes only the internal draft, including incomplete contact details, without recipient or registry side effects', async () => {
  for (const withCosting of [false, true]) {
    const h = harness({ customerRegistry: true }), ctx = { orgId: id(90), userId: id(91) }
    h.draft.contractParties = emptyContractParties('', 'unfinished@')
    h.draft.contractParties.customers.push({ name: '', personalNumber: '' })
    await h.api.saveCustomerOffer(ctx, id(1), { revision: 1, draft: h.draft, ...(withCosting ? { costing: {} } : {}) }, 'autosave')
    const saved = h.calls.find(call => withCosting ? call.name === 'save_customer_offer_costing' : call.p_operation === 'save')
    assert.equal(saved.p_data.body.contractParties.email, 'unfinished@')
    assert.equal(saved.p_data.body.contractParties.customers.length, 2)
    assert.equal(saved.p_data.revision, 1)
    assert.equal(h.calls.some(call => call.name === 'writeContractCustomer' || ['publish', 'claim_send'].includes(call.p_operation)), false)
    assert.equal(h.participant.email, 'anna@example.test')
    assert.equal(h.sent.length, 0)
    assert.equal(h.copies.length, 0)
  }
})

test('payment plans require schema protection before save or publication and freeze into public versions', async () => {
  const ctx = { orgId: id(90), userId: id(91) }
  const h = harness()
  h.draft.paymentPlan = { version: 1, installments: [{ id: id(80), title: 'Slutbetalning', condition: 'Efter utfört arbete.', plannedDate: '', amountOre: h.draft.baseAmountOre }] }
  await h.api.saveCustomerOffer(ctx, id(1), { revision: 1, draft: h.draft })
  assert.deepEqual(h.calls.find((c) => c.p_operation === 'save').p_data.body.paymentPlan, h.draft.paymentPlan)
  assert.equal(h.calls.find((c) => c.name === 'assert_customer_payment_plan').p_complete, false)
  await h.run()
  assert.deepEqual(h.saved().snapshot.paymentPlan, h.draft.paymentPlan)
  const shared = await h.api.getSharedCustomerOffers(h.link, h.participant)
  assert.deepEqual(shared.offers[0].snapshot.paymentPlan, h.draft.paymentPlan)
  const missing = harness({ paymentPlanMissing: true })
  missing.draft.paymentPlan = h.draft.paymentPlan
  await assert.rejects(missing.api.saveCustomerOffer(ctx, id(1), { revision: 1, draft: missing.draft }), /SCHEMA/)
  await assert.rejects(missing.run(), /SCHEMA/)
  assert.equal(missing.sent.length, 0)
  assert.equal(missing.copies.length, 0)
  assert.equal(missing.calls.some((c) => c.p_operation === 'save'), false)
  delete missing.draft.paymentPlan
  await missing.api.saveCustomerOffer(ctx, id(1), { revision: 1, draft: missing.draft })
})

test('an incomplete payment plan blocks issuance before copying attachments or sending mail', async () => {
  const h = harness()
  h.draft.paymentPlan = { version: 1, installments: [{ id: id(80), title: 'Grund', condition: 'Efter färdig grund.', plannedDate: '', amountOre: 100 }] }
  await assert.rejects(h.run(), /INCOMPLETE/)
  assert.equal(h.sent.length, 0)
  assert.equal(h.copies.length, 0)
})

test('itemized save computes totals and requires the database guard; legacy saves remain compatible', async () => {
  const ctx = { orgId: id(90), userId: id(91) }
  const h = harness()
  const draft = { ...h.draft, pricingMode: 'itemized', baseAmountOre: 1,
    items: h.draft.items.map((i) => i.kind === 'included' ? { ...i, amountOre: 990050 } : i) }
  await h.api.saveCustomerOffer(ctx, id(1), { revision: 1, draft })
  assert.equal(h.calls[0].name, 'assert_customer_offer_pricing')
  assert.equal(h.calls[0].p_body.baseAmountOre, 990050)
  assert.equal(h.calls[1].p_data.body.baseAmountOre, 990050)
  const unmigrated = harness({ pricingMissing: true })
  await assert.rejects(unmigrated.api.saveCustomerOffer(ctx, id(1), { revision: 1, draft }), /SCHEMA/)
  assert.equal(unmigrated.calls.length, 1)
  await unmigrated.api.saveCustomerOffer(ctx, id(1), { revision: 1, draft: unmigrated.draft })
  assert.equal(unmigrated.calls.at(-1).p_operation, 'save')
  Object.assign(unmigrated.draft, draft)
  await assert.rejects(unmigrated.run(), /SCHEMA/)
  assert.equal(unmigrated.sent.length, 0)
})

test('costing saves atomically with public draft; missing schema cannot silently drop private edits', async () => {
  const h = harness(), ctx = { orgId: id(90), userId: id(91) }
  const costing = { [id(10)]: { ...costingDomain.emptyCustomerOfferCalculation(), purchaseOre: 10000 } }
  await h.api.saveCustomerOffer(ctx, id(1), { revision: 1, draft: h.draft, costing })
  assert.equal(h.calls.length, 1)
  assert.equal(h.calls[0].name, 'save_customer_offer_costing')
  assert.equal(h.calls[0].p_org_id, id(90))
  assert.deepEqual(h.calls[0].p_data.costing, costing)
  assert.equal(h.calls[0].p_data.body.costing, undefined)
  const legacy = harness({ costingMissing: true })
  const result = await legacy.api.getCustomerOfferWorkspace(ctx, id(1))
  assert.equal(result.costingAvailable, false)
  assert.deepEqual(result.costing, {})
  await assert.rejects(legacy.api.saveCustomerOffer(ctx, id(1), { revision: 1, draft: h.draft, costing }), /SCHEMA/)
  assert.equal(legacy.calls.length, 1)
})

test('private worksheets are returned internally but never published, emailed or exposed by portal', async () => {
  const costing = { [id(10)]: { ...costingDomain.emptyCustomerOfferCalculation(), purchaseOre: 9876543 } }
  const h = harness({ costing })
  const result = await h.api.getCustomerOfferWorkspace({ orgId: id(90), userId: id(91) }, id(1))
  assert.deepEqual(result.costing, costing)
  assert.equal(result.costingAvailable, true)
  await h.run()
  const portal = await h.api.getSharedCustomerOffers(id(90), id(1), id(2))
  for (const value of [h.saved().snapshot, h.sent, portal]) {
    const serialized = JSON.stringify(value)
    assert.ok(!serialized.includes('purchaseOre'))
    assert.ok(!serialized.includes('9876543'))
    assert.ok(!serialized.includes('costing'))
  }
})

test('historical grouped alternatives are checked before an email code is sent', async () => {
  const h = harness()
  await h.run()
  const old = structuredClone(workspace.draft)
  old.items[1].optionGroup = 'Fönster'
  old.items.push({ ...old.items[1], id: id(13), title: 'Alternativ B' })
  h.saved().snapshot = snapshot(old)
  const sentBefore = h.sent.length
  await assert.rejects(h.api.respondCustomerOffer(token, h.saved().id, {
    operation: 'challenge', selection: [id(11), id(13)], signerName: 'Anna', confirmed: true
  }, 'https://ignored.example.test'), /INVALID/)
  assert.equal(h.sent.length, sentBefore)
  assert.ok(!h.calls.some((c) => c.p_operation === 'challenge'))
})

test('publish freezes selected files, uses configured origin/recipient, and a retry never duplicates a confirmed email', async () => {
  const h = harness()
  await assert.rejects(h.run({ confirmed: false }), /CONFIRM/)
  assert.equal(h.reads.length, 0)
  await h.run()
  assert.equal(h.sent.length, 1)
  assert.equal(h.copies.length, 1)
  assert.equal(h.sent[0].to, 'anna@example.test')
  assert.ok(
    h.sent[0].text.includes('https://customer.example.test/atgardsarende/')
  )
  assert.equal(h.sent[0].attachments, undefined)
  assert.deepEqual(h.copies[0].opts, {
    destinationBucket: 'action-case-customer-offers'
  })
  assert.ok(
    h.reads
      .filter((r) => r.table.startsWith('action_case'))
      .every((r) =>
        r.filters.some(([key, value]) => key === 'org_id' && value === id(90))
      )
  )
  assert.equal(h.calls[0].p_data.snapshot.baseAmountOre, 125000000)
  assert.deepEqual(h.removed, [])
  await h.run()
  assert.equal(h.sent.length, 1)
  assert.equal(h.copies.length, 1)
})

test('failed email retains published version; retry uses frozen email even after mutable input changes', async () => {
  const h = harness({ sendFailed: true })
  await assert.rejects(h.run(), /CUSTOMER_OFFER_SEND_FAILED/)
  assert.equal(h.calls.at(-1).p_data.success, false)
  assert.deepEqual(h.removed, [])
  h.draft.title = 'Changed unsaved title'
  h.participant.email = 'changed@example.test'
  h.recover()
  await h.run()
  assert.deepEqual(h.sent[1], h.sent[0])
  assert.equal(h.copies.length, 1)
})

test('missing files/copy errors and rolled-back publications do not send; uncertain commit never deletes candidate files', async () => {
  for (const options of [
    { missingFile: true },
    { copyFailed: true },
    { publishFailed: true },
    { uncertain: true }
  ]) {
    const h = harness(options)
    await assert.rejects(h.run())
    assert.equal(h.sent.length, 0)
    assert.equal(
      h.removed.length,
      options.missingFile || options.uncertain ? 0 : 1
    )
  }
})

test('public access is revocable/customer-scoped, file URLs are scoped and the accepted receipt comes from the server', async () => {
  const h = harness()
  await h.run()
  const offer = h.saved()
  assert.deepEqual(
    (await h.api.getSharedCustomerOffers(id(90), id(1), id(2))).offers[0]
      .snapshot,
    offer.snapshot
  )
  await assert.rejects(
    h.api.customerOfferFileUrl({ token, offerId: offer.id, fileId: id(999) }),
    /NOT_FOUND/
  )
  await h.api.customerOfferFileUrl({ token, offerId: offer.id, fileId: id(4) })
  assert.equal(h.signed[0].bucket, 'action-case-customer-offers')
  assert.equal(h.signed[0].args[1], 60)
  const response = await h.api.respondCustomerOffer(
    token,
    offer.id,
    {
      operation: 'challenge',
      selection: [],
      signerName: 'Anna',
      confirmed: true
    },
    'https://ignored.example.test'
  )
  assert.match(h.sent.at(-1).text, /Kod: \d{6}/)
  assert.equal(h.sent.at(-1).to, 'anna@example.test')
  assert.equal(response.code, undefined)
  assert.equal(response.codeHash, undefined)
  const receipt = await h.api.respondCustomerOffer(
    token,
    offer.id,
    { operation: 'accept', challengeId: response.challengeId, code: '123456' },
    'https://ignored.example.test'
  )
  assert.equal(receipt.offer.acceptedAt, '2026-09-29T12:34:00Z')
  assert.equal(receipt.offer.acceptedBy, 'Server-stored name')
  assert.equal(receipt.offer.email_payload, undefined)
  assert.equal(receipt.offer.files[0].path, undefined)
  h.link.revoked_at = '2026-09-29'
  await assert.rejects(
    h.api.customerOfferFileUrl({ token, offerId: offer.id, fileId: id(4) }),
    /CLOSED/
  )
  h.link.revoked_at = null
  h.participant.role = 'subcontractor'
  await assert.rejects(
    h.api.customerOfferFileUrl({ token, offerId: offer.id, fileId: id(4) }),
    /NOT_FOUND/
  )
})

test('unmigrated or unpublished customer flows keep the existing portal', async () => {
  assert.deepEqual(
    await harness({ schemaMissing: true }).api.getSharedCustomerOffers(
      id(90),
      id(1),
      id(2)
    ),
    { enabled: false, offers: [] }
  )
  assert.deepEqual(
    await harness().api.getSharedCustomerOffers(id(90), id(1), id(2)),
    { enabled: false, offers: [] }
  )
})

test('shared planning is projected from shared_items only and scoped to its customer', async () => {
  const item = { id: id(80), title: 'Målning', scope: 'Senare beslut', status: 'deferred', budgetOre: null, decisionBy: '' }
  const h = harness({ planning: { revision: 2, items: [{ ...item, scope: 'Privat arbetsutkast' }], shared_items: [item] } })
  const result = await h.api.getSharedCustomerOffers(id(90), id(1), id(2))
  assert.equal(result.enabled, true)
  assert.deepEqual(result.plannedItems, [item])
  assert.equal(JSON.stringify(result).includes('Privat arbetsutkast'), false)
  const read = h.reads.find((r) => r.table === 'action_case_customer_planning')
  assert.equal(read.columns, 'shared_items')
  assert.deepEqual(read.filters, [['org_id', id(90)], ['action_case_id', id(1)], ['participant_id', id(2)]])
})

test('planning writes are private, explicitly shared and migration-aware', async () => {
  const h = harness(), ctx = { orgId: id(90), userId: id(91) }
  const item = { id: id(80), title: 'Målning', scope: 'Senare beslut', status: 'deferred', budgetOre: null, decisionBy: '' }
  await h.api.writeCustomerPlanning(ctx, id(1), { operation: 'save', revision: 0, items: [item] })
  assert.equal(h.calls.at(-1).name, 'write_customer_planning')
  assert.deepEqual(h.calls.at(-1).p_data.items, [item])
  assert.equal(h.sent.length, 0)
  await assert.rejects(h.api.writeCustomerPlanning(ctx, id(1), { operation: 'share', revision: 1, items: [item] }), /CONFIRM/)
  await assert.rejects(h.api.writeCustomerPlanning(ctx, id(1), { operation: 'share', revision: 1, items: [{ ...item, scope: '' }], confirmed: true }), /INCOMPLETE|INVALID/)
  const missing = harness({ planningMissing: true })
  assert.equal((await missing.api.getCustomerPlanning(ctx, id(1))).available, false)
  assert.deepEqual(await missing.api.getSharedCustomerOffers(id(90), id(1), id(2)), { enabled: false, offers: [] })
})

test('new contract details require their database guard while old drafts still save', async () => {
  const h = harness({ contractMissing: true }), ctx = { orgId: id(90), userId: id(91) }
  await assert.rejects(h.api.saveCustomerOffer(ctx, id(1), { revision: 1, draft: { ...h.draft, contractDetails: emptyContractDetails() } }), /SCHEMA/)
  assert.equal(h.calls.length, 1)
  await h.api.saveCustomerOffer(ctx, id(1), { revision: 1, draft: h.draft })
  assert.equal(h.calls.at(-1).p_operation, 'save')
})

test('conditions survive public projection and require schema protection before writes or delivery', async () => {
  const ctx = { orgId: id(90), userId: id(91) }, h = harness()
  h.draft.items[0].scopeConditions = 'Fri tillgång till arbetsområdet'
  await h.api.saveCustomerOffer(ctx, id(1), { revision: 1, draft: h.draft })
  assert.ok(h.calls.some((c) => c.name === 'assert_customer_offer_scope_conditions'))
  assert.equal(h.calls.find((c) => c.p_operation === 'save').p_data.body.items[0].scopeConditions, h.draft.items[0].scopeConditions)
  await h.run()
  const shared = await h.api.getSharedCustomerOffers(h.link, h.participant)
  assert.equal(shared.offers[0].snapshot.items[0].scopeConditions, h.draft.items[0].scopeConditions)
  const missing = harness({ conditionsMissing: true })
  missing.draft.items[0].scopeConditions = ''
  await assert.rejects(missing.api.saveCustomerOffer(ctx, id(1), { revision: 1, draft: missing.draft }), /SCHEMA/)
  await assert.rejects(missing.run(), /SCHEMA/)
  assert.equal(missing.sent.length, 0)
  assert.equal(missing.copies.length, 0)
  assert.equal(missing.calls.some((c) => c.p_operation === 'save'), false)
  delete missing.draft.items[0].scopeConditions
  await missing.api.saveCustomerOffer(ctx, id(1), { revision: 1, draft: missing.draft })
  assert.equal(missing.calls.at(-1).p_operation, 'save')
})

test('main publication stops before files or email if draft still contains choices', async () => {
  const h = harness({ legacyDraft: true })
  await assert.rejects(h.run(), /SEPARATE_CHOICES/)
  assert.equal(h.copies.length, 0)
  assert.equal(h.sent.length, 0)
})

test('choice split carries tenant identity and both revisions, never email or client snapshots', async () => {
  const h = harness(), ctx = { orgId: id(90), userId: id(91) }
  await h.api.separateCustomerChoices(ctx, id(1), { revision: 3, planningRevision: 6 })
  assert.deepEqual(h.calls.at(-1), { name: 'separate_customer_choices', p_org_id: ctx.orgId, p_case_id: id(1), p_user_id: ctx.userId, p_revision: 3, p_planning_revision: 6 })
  assert.equal(h.sent.length, 0)
  await assert.rejects(h.api.separateCustomerChoices(ctx, id(1), { revision: 3 }), /INVALID/)
})

test('choice price calculations save privately and public projection strips unexpected internal fields', async () => {
  const item = { id: id(80), title: 'Fönster A', scope: 'Leverans och montage', status: 'planned', budgetOre: 16264948, decisionBy: '', optionGroup: 'Fönster' }
  const costing = { [item.id]: { ...costingDomain.emptyCustomerOfferCalculation(), purchaseOre: 998877 } }
  const h = harness({ planning: { revision: 2, items: [item], shared_items: [{ ...item, internal_costing: costing, approved: true }], internal_costing: costing } })
  const ctx = { orgId: id(90), userId: id(91) }
  const internal = await h.api.getCustomerPlanning(ctx, id(1))
  assert.deepEqual(internal.costing, costing)
  const external = await h.api.getSharedCustomerOffers(id(90), id(1), id(2))
  assert.deepEqual(external.plannedItems, [item])
  assert.equal(JSON.stringify(external).includes('998877'), false)
  await h.api.writeCustomerPlanning(ctx, id(1), { operation: 'save', revision: 2, items: [item], costing })
  assert.equal(h.calls.at(-1).name, 'save_customer_planning_costing')
  assert.deepEqual(h.calls.at(-1).p_data.costing, costing)
})
