import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import ts from 'typescript'
import type * as Delivery from '../src/lib/eb/followUpDelivery'

const require = createRequire(import.meta.url)
type Row = { id: string; order_id: string | null; kind: string; dedupe_key: string; lease_id: string; payload_ciphertext: string | null }

function fixture() {
  const state = {
    jobs: [] as Row[], sources: new Map<string, { kind: string; order_id: string | null }>(),
    sent: [] as Array<Delivery.EbFollowUpEmail & { idempotencyKey: string }>,
    finished: [] as Array<Record<string, unknown>>, queued: new Map<string, Row>(),
    sourceError: false, finishError: false, lookups: 0,
  }
  const admin = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (name === 'eb_claim_follow_up_emails') return { data: state.jobs, error: null }
      assert.equal(name, 'eb_finish_follow_up_email')
      state.finished.push(args)
      return { data: true, error: state.finishError && args.p_success ? { message: 'Test finish failure' } : null }
    },
    from: (table: string) => {
      let id: string
      const query = {
        select: () => query,
        eq: (key: string, value: string) => { assert.equal(key, 'id'); id = value; return query },
        maybeSingle: async () => {
          assert.equal(table, 'eb_follow_up_email_outbox'); state.lookups++
          return { data: state.sources.get(id) ?? null, error: state.sourceError ? { message: 'Test lookup failure' } : null }
        },
        single: async () => {
          assert.equal(table, 'eb_follow_up_orders'); assert.equal(id, 'order')
          return { data: { id, buyer_snapshot: { name: 'Buyer', email: 'buyer@example.invalid' },
            seller_snapshot: { email: 'seller@example.invalid' }, withdrawal_requested_at: '2026-09-08T12:00:00Z' }, error: null }
        },
        upsert: async (value: Record<string, string>, options: Record<string, unknown>) => {
          assert.equal(table, 'eb_follow_up_email_outbox'); assert.equal(options.ignoreDuplicates, true)
          if (!state.queued.has(value.dedupe_key)) state.queued.set(value.dedupe_key, {
            id: `child-${state.queued.size}`, order_id: value.order_id, kind: value.kind,
            dedupe_key: value.dedupe_key, lease_id: 'child-lease', payload_ciphertext: value.payload_ciphertext,
          })
          return { error: null }
        },
      }
      return query
    },
  }
  const source = ts.transpileModule(readFileSync(new URL('../src/lib/eb/followUpDelivery.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const compiled = { exports: {} }
  new Function('require', 'module', 'exports', 'process', source)((name: string) => {
    if (name === 'node:crypto') return require(name)
    if (name === '@/lib/supabase/admin') return { createSupabaseAdminClient: () => admin }
    if (name === '@/lib/eb/followUp') return { EB_FOLLOW_UP_ADMIN_EMAIL: 'admin@example.invalid', normalizeEbFollowUpEmail: (email: string) => email.trim().toLowerCase() }
    if (name === '@/lib/assignments/mailer') return { sendAssignmentEmail: async (email: typeof state.sent[number]) => { state.sent.push(email) } }
    throw new Error(`Unexpected mail policy dependency: ${name}`)
  }, compiled, compiled.exports, { env: { EB_FOLLOW_UP_EMAIL_ENCRYPTION_KEY: 'isolated-test-only', ASSIGNMENTS_MAIL_FROM: 'test@example.invalid' } })
  const delivery = compiled.exports as typeof Delivery
  const job = (id: string, kind: string, dedupe = `${kind}:${id}`, to = 'contractor@example.invalid'): Row => ({
    id, kind, dedupe_key: dedupe, order_id: 'order', lease_id: `lease-${id}`,
    payload_ciphertext: delivery.encryptEbFollowUpPayload({ to, subject: `Test ${kind}`, html: '<p>Test</p>', text: 'Test' }),
  })
  return { state, delivery, job }
}

test('every list event is consumed without expansion or email, while audit history stays untouched', async () => {
  const { state, delivery, job } = fixture()
  state.jobs = ['assigned', 'status_changed', 'comment', 'photo_added'].map(kind => ({
    ...job(kind, 'task_event'), payload_ciphertext: null,
  }))
  assert.deepEqual(await delivery.processEbFollowUpEmails(), { claimed: 4, sent: 0, skipped: 4, expanded: 0, failed: 0 })
  assert.equal(state.sent.length, 0); assert.equal(state.queued.size, 0); assert.equal(state.lookups, 0)
  assert.equal(state.finished.length, 4)
  for (const row of state.jobs) assert.ok(state.finished.some(result => result.p_id === row.id && result.p_lease_id === row.lease_id && result.p_success === true))
})

test('already expanded activity emails to both contractor and buyer are suppressed by source kind, not their subject', async () => {
  const { state, delivery, job } = fixture()
  state.sources.set('old-event', { kind: 'task_event', order_id: 'order' })
  state.jobs = ['buyer', 'contractor'].map(recipient => ({ ...job(recipient, 'email', `notification:old-event:${recipient}`),
    // The historical event parent remains even after its payload is cleared.
    // Suppression must work before decrypting a child or contacting the sender.
    payload_ciphertext: 'unreadable-legacy-payload',
  }))
  assert.deepEqual(await delivery.processEbFollowUpEmails(), { claimed: 2, sent: 0, skipped: 2, expanded: 0, failed: 0 })
  assert.equal(state.sent.length, 0); assert.equal(state.queued.size, 0)
})

test('explicit invitations and transactional mail still send; withdrawal children sharing the prefix are not suppressed', async () => {
  const { state, delivery, job } = fixture()
  state.sources.set('withdrawal', { kind: 'withdrawal', order_id: 'order' })
  state.jobs = [job('invitation', 'email', 'access:personal-link'), job('receipt', 'receipt'), job('invoice', 'invoice'),
    job('access', 'access'), job('code', 'verification'), { ...job('withdrawal', 'withdrawal'), payload_ciphertext: null }]
  assert.deepEqual(await delivery.processEbFollowUpEmails(), { claimed: 6, sent: 5, skipped: 0, expanded: 1, failed: 0 })
  assert.equal(state.queued.size, 3)
  assert.equal(state.sent[0].idempotencyKey, 'eb-follow-up-invitation')
  state.jobs = [...state.queued.values()]
  assert.deepEqual(await delivery.processEbFollowUpEmails(), { claimed: 3, sent: 3, skipped: 0, expanded: 0, failed: 0 })
  assert.deepEqual(state.sent.slice(-3).map(email => email.to).sort(), ['admin@example.invalid', 'buyer@example.invalid', 'seller@example.invalid'])
  assert.ok(state.sent.slice(-3).every(email => email.subject.startsWith('Mottagningsbekräftelse')))
})

test('unclassified or cross-order queued notifications retry safely instead of leaking activity or silently dropping receipts', async () => {
  for (const source of [null, { kind: 'task_event', order_id: 'other-order' }, { kind: 'unrecognised', order_id: 'order' }]) {
    const { state, delivery, job } = fixture()
    if (source) state.sources.set('source', source)
    state.jobs = [job('notification', 'email', 'notification:source:recipient')]
    assert.deepEqual(await delivery.processEbFollowUpEmails(), { claimed: 1, sent: 0, skipped: 0, expanded: 0, failed: 1 })
    assert.equal(state.sent.length, 0); assert.equal(state.finished.at(-1)?.p_success, false)
    state.sources.set('source', { kind: 'withdrawal', order_id: 'order' })
    assert.deepEqual(await delivery.processEbFollowUpEmails(), { claimed: 1, sent: 1, skipped: 0, expanded: 0, failed: 0 })
  }
})

test('lookup or lease completion failures never re-enable an activity email on retry', async () => {
  const { state, delivery, job } = fixture()
  state.sources.set('source', { kind: 'task_event', order_id: 'order' })
  state.jobs = [job('notification', 'email', 'notification:source:recipient')]
  state.sourceError = true
  assert.equal((await delivery.processEbFollowUpEmails()).failed, 1)
  state.sourceError = false; state.finishError = true
  assert.equal((await delivery.processEbFollowUpEmails()).failed, 1)
  state.finishError = false
  assert.equal((await delivery.processEbFollowUpEmails()).skipped, 1)
  assert.equal(state.sent.length, 0)
})
