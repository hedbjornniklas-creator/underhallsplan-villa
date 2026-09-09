import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import * as quotes from '../src/lib/action-cases/quotes.ts'
import * as costing from '../src/lib/action-cases/costing.ts'
import * as rfq from '../src/lib/action-cases/rfqDelivery.ts'
import * as crypto from 'node:crypto'
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const code = ts.transpileModule(readFileSync(new URL('../src/lib/action-cases/quotesServer.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const groupCode = ts.transpileModule(readFileSync(new URL('../src/lib/action-cases/quoteRequestsServer.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const rfqCode = ts.transpileModule(readFileSync(new URL('../src/lib/action-cases/rfqDeliveryServer.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
function harness({ group = false, quote = {}, quoteDocument = false, groupDocument = false, failure = false, missingFile = false, tooLarge = false, copyFailure = false, claimFailure = false, uncertainClaim = false } = {}) {
  const calls = [], reads = [], downloads = [], sent = [], removed = []
  let persistedId
  const q = { id: id(5), supplier_email: 'ue@example.test', updated_at: 'v1', request_subject: 'Subject', request_body: 'Repair <here>', request_attachment_ids: [id(6)], subject: 'Two actions', body: 'Work A and work B <here>', attachment_ids: [id(6)], ...quote }
  const admin = {
    from(table) {
      const read = { table, filters: [], columns: '' }; reads.push(read)
      const result = () => table === 'profiles' ? { data: { email: 'inspector@example.test' } }
        : table === 'action_case_rfq_deliveries' ? uncertainClaim && calls.length ? { error: { message: 'unavailable' } } : { data: persistedId ? { id: persistedId } : null }
        : table === 'action_case_attachments' ? { data: missingFile ? [] : [{ id: id(6), file_name: 'photo.jpg', file_size_bytes: tooLarge ? 6000000 : 5, storage_bucket: 'action-case-files', file_path: `${id(1)}/${id(3)}/allowed-photo`, content_type: 'image/jpeg' }] }
          : { data: read.columns === 'document_id' ? quoteDocument ? [{ document_id: id(6) }] : [] : read.columns === 'response_document_id' ? groupDocument ? [{ response_document_id: id(6) }] : [] : q }
      const chain = { select(columns) { read.columns = columns; return chain }, eq(...args) { read.filters.push(args); return chain }, in(...args) { read.filters.push(args); return chain }, maybeSingle() { return Promise.resolve(result()) }, then(resolve) { return Promise.resolve(result()).then(resolve) } }
      return chain
    },
    storage: { from(bucket) { return {
      async copy(path, to, options) { downloads.push({ bucket, path, to, options }); return copyFailure ? { error: { message: 'failed' } } : {} },
      async info() { return { data: { size: tooLarge ? 6000000 : 5 } } },
      async remove(paths) { removed.push(...paths); return {} },
    } } },
    async rpc(name, args) {
      calls.push({ name, args })
      if (name === 'claim_action_case_rfq_delivery') {
        if (claimFailure || uncertainClaim) return { error: { message: 'ACTION_CASE_QUOTE_STALE' } }
        persistedId = args.p_data.deliveryId
        return { data: { leaseId: id(7), payload: q.email_payload ?? args.p_data.emailPayload } }
      }
      return { data: { id: id(5) } }
    },
  }
  const mod = { exports: {} }
  const rfqModule = { exports: {} }
  const load = (name) => {
    if (name === 'server-only') return {}
    if (name === './quotes') return quotes
    if (name === './costing') return costing
    if (name === './rfqDelivery') return rfq
    if (name === './rfqDeliveryServer') return rfqModule.exports
    if (name === 'node:crypto') return crypto
    if (name === '@/lib/assignments/tokens') return { generateAssignmentToken: () => 'A'.repeat(43), hashAssignmentToken: (token) => crypto.createHash('sha256').update(token).digest('hex') }
    if (name === './quotesServer') return mod.exports
    if (name === './quoteRequests') return {}
    if (name === './quotePackages') return {}
    if (name === '@/lib/supabase/admin') return { createSupabaseAdminClient: () => admin }
    if (name === '@/lib/assignments/mailer') return { async sendAssignmentEmail(payload) { sent.push(payload); if (failure) throw new Error('timeout'); return { providerMessageId: 'message-id' } } }
    throw new Error(name)
  }
  new Function('module', 'exports', 'require', 'process', rfqCode)(rfqModule, rfqModule.exports, load, { env: { APP_BASE_URL: 'https://hushub.example.test', ASSIGNMENTS_MAIL_FROM: 'sender@example.test', RESEND_API_KEY: 'test-only' } })
  new Function('module', 'exports', 'require', 'process', code)(mod, mod.exports, load, { env: { ASSIGNMENTS_MAIL_FROM: 'sender@example.test', RESEND_API_KEY: 'test-only' } })
  const grouped = { exports: {} }
  new Function('module', 'exports', 'require', groupCode)(grouped, grouped.exports, load)
  const run = (overrides = {}) => (group ? grouped.exports.sendGroupedRequest : mod.exports.sendQuoteRequest)({ orgId: id(1), userId: id(2) }, { caseId: id(3), itemId: id(4), costLineId: id(8), quoteId: id(5), requestId: id(5), expectedUpdatedAt: 'v1', expectedQuoteUpdatedAt: 'v1', confirmSend: true, ...overrides })
  return { calls, reads, downloads, sent, run, removed }
}
test('explicit review required; only selected tenant-scoped files sent, no portal grants changed', async () => {
  const h = harness()
  await assert.rejects(h.run({ confirmSend: false }), /CONFIRM_REQUIRED/)
  assert.equal(h.reads.length, 0)
  await h.run()
  assert.equal(h.sent.length, 1)
  assert.equal(h.sent[0].replyTo, 'inspector@example.test')
  assert.equal(h.sent[0].idempotencyKey, `action-case-rfq-${id(5)}`)
  assert.equal(h.sent[0].attachments, undefined)
  assert.ok(h.sent[0].text.includes('https://hushub.example.test/offertunderlag/'))
  assert.deepEqual(h.downloads[0].options, { destinationBucket: 'action-case-rfq-files' })
  assert.ok(h.downloads[0].to.startsWith(`${id(1)}/${id(3)}/`))
  assert.ok(h.sent[0].html.includes('&lt;here&gt;'))
  assert.ok(h.reads.filter((r) => r.table !== 'profiles').every((r) => r.filters.some(([key, value]) => key === 'org_id' && value === id(1))))
  assert.equal(h.calls[0].name, 'claim_action_case_rfq_delivery')
  assert.equal(h.calls[1].args.p_operation, 'finish_send')
  assert.deepEqual(h.removed, [])
})
test('private UE documents, missing files, failed copies and stale UI prevent email', async () => {
  for (const options of [{ quoteDocument: true }, { missingFile: true }, { copyFailure: true }, { quote: { updated_at: 'v2' } }]) {
    const h = harness(options); await assert.rejects(h.run()); assert.equal(h.sent.length, 0)
  }
})
test('uncertain delivery retains exact message for retry without rereading mutable files', async () => {
  const h = harness({ failure: true })
  await assert.rejects(h.run(), /SEND_FAILED/)
  assert.equal(h.calls.at(-1).args.p_data.success, false)
  const payload = h.sent[0]
  const retry = harness({ quote: { email_payload: payload, supplier_email: 'changed@example.test', request_attachment_ids: [id(99)] } })
  await retry.run()
  assert.deepEqual(retry.sent[0], payload)
  assert.deepEqual(retry.downloads, [])
  assert.equal(retry.calls[0].args.p_data.emailPayload, null)
})
test('already-sent requests do not send again', async () => {
  const h = harness({ quote: { sent_at: '2026-09-08T12:00:00Z' } }); await h.run(); assert.equal(h.sent.length, 0); assert.equal(h.calls.length, 0)
})

test('grouped request reuses attachment and delivery pipeline but sends one email for all works', async () => {
  const h = harness({ group: true })
  await assert.rejects(h.run({ confirmSend: false }), /CONFIRM_REQUIRED/)
  assert.equal(h.reads.length, 0)
  await h.run()
  assert.equal(h.sent.length, 1)
  assert.ok(h.sent[0].text.startsWith('Work A and work B <here>'))
  assert.equal(h.sent[0].idempotencyKey, `action-case-group-rfq-${id(5)}`)
  assert.equal(h.sent[0].attachments, undefined)
  assert.ok(h.reads.filter((r) => r.table !== 'profiles').every((r) => r.filters.some(([key, value]) => key === 'org_id' && value === id(1))))
  assert.deepEqual(h.calls.map((c) => c.name), ['claim_action_case_rfq_delivery', 'write_action_case_request'])
  for (const options of [{ groupDocument: true }, { quoteDocument: true }, { missingFile: true }, { copyFailure: true }, { quote: { updated_at: 'v2' } }]) {
    const invalid = harness({ group: true, ...options }); await assert.rejects(invalid.run()); assert.equal(invalid.sent.length, 0)
  }
  const legacy = harness({ groupDocument: true }); await assert.rejects(legacy.run(), /PRIVATE_DOCUMENT/)
})

test('large files use links, legacy attachments retry unchanged, candidate cleanup never deletes uncertain delivery', async () => {
  for (const group of [false, true]) {
    const h = harness({ group, tooLarge: true }); await h.run()
    assert.equal(h.sent.length, 1); assert.equal(h.sent[0].attachments, undefined)
    const legacyPayload = { to: 'old@example.test', text: 'Old exact body', attachments: [{ filename: 'old.jpg', content: 'b2xk' }], idempotencyKey: 'original' }
    const legacy = harness({ group, quote: { email_payload: legacyPayload } }); await legacy.run()
    assert.deepEqual(legacy.sent[0], legacyPayload); assert.equal(legacy.downloads.length, 0)
    const rollback = harness({ group, claimFailure: true }); await assert.rejects(rollback.run()); assert.equal(rollback.removed.length, 1)
    const uncertain = harness({ group, uncertainClaim: true }); await assert.rejects(uncertain.run()); assert.equal(uncertain.removed.length, 0)
    const copyFailed = harness({ group, copyFailure: true }); await assert.rejects(copyFailed.run()); assert.equal(copyFailed.removed.length, 1); assert.equal(copyFailed.calls.length, 0)
  }
})

test('group retries preserve bytes and recipient; already sent and individual linked sends never duplicate', async () => {
  const h = harness({ group: true, failure: true })
  await assert.rejects(h.run(), /SEND_FAILED/)
  assert.equal(h.calls.at(-1).args.p_data.success, false)
  const retry = harness({ group: true, quote: { email_payload: h.sent[0], supplier_email: 'changed@example.test' } })
  await retry.run()
  assert.deepEqual(retry.sent[0], h.sent[0]); assert.deepEqual(retry.downloads, [])
  const sent = harness({ group: true, quote: { sent_at: '2026-09-08' } }); await sent.run(); assert.equal(sent.sent.length, 0)
  const individual = harness({ quote: { request_id: id(20) } }); await assert.rejects(individual.run(), /REQUEST_USE_GROUP/); assert.equal(individual.sent.length, 0)
})
