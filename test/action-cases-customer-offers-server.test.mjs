import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as crypto from 'node:crypto'
import ts from 'typescript'
import * as domain from '../src/lib/action-cases/customerOffers.ts'
import * as quotes from '../src/lib/action-cases/quotes.ts'
import * as costingDomain from '../src/lib/action-cases/customerOfferCosting.ts'
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
              property_address: 'Address'
            },
            action_case_customer_offer_drafts: { body: draft, revision: 1, internal_costing: options.costing ?? {} },
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
          accepted_option_ids: [id(11)],
          accepted_total_ore: 143500000
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
  const costing = { [id(11)]: { ...costingDomain.emptyCustomerOfferCalculation(), purchaseOre: 10000 } }
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
  const costing = { [id(11)]: { ...costingDomain.emptyCustomerOfferCalculation(), purchaseOre: 9876543 } }
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

test('grouped alternatives are checked before an email code is sent', async () => {
  const h = harness()
  h.draft.items[1].optionGroup = 'Fönster'
  h.draft.items.push({ ...h.draft.items[1], id: id(13), title: 'Alternativ B' })
  await h.run()
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
      selection: [id(11)],
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
