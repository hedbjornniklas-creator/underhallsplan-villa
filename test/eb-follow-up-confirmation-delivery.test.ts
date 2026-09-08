import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import ts from 'typescript'
import type * as Delivery from '../src/lib/eb/followUpDelivery'

const require = createRequire(import.meta.url)
type Row = {
  id: string; order_id: string | null; event_id: string | null; kind: string; dedupe_key: string
  lease_id: string; attempts: number; payload_ciphertext: string | null
}
type Mail = Delivery.EbFollowUpEmail & { idempotencyKey: string }
type Confirmation = NonNullable<Delivery.EbFollowUpEmail['confirmationPdf']>
const confirmation = {
  orderId: 'synthetic-order', acceptedAt: '2026-09-08T10:00:00Z',
  fixtureMarker: 'Immutable purchase snapshot; renderer is isolated in this test.',
} as unknown as Confirmation
const filename = 'Beställningsbekräftelse – syntetisk beställning.pdf'
const result = (counts: Partial<{ sent: number; failed: number; skipped: number }> = {}) =>
  ({ claimed: 1, sent: 0, skipped: 0, expanded: 0, failed: 0, ...counts })

/** No Supabase, PDF browser or provider is contacted: the real delivery module
 * executes against an isolated, lease-aware encrypted outbox and mock sender. */
function fixture() {
  const state = {
    rows: [] as Row[], sends: [] as Mail[], finishes: [] as Array<Record<string, unknown>>,
    renderInputs: [] as Confirmation[], filenameInputs: [] as Confirmation[],
    writes: [] as Array<{ values: Record<string, unknown>; filters: Record<string, unknown> }>,
    trace: [] as string[], rendererImports: 0, renderError: false, persistError: false,
    loseLease: false, sendError: false, finishSuccessError: false,
  }
  const admin = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (name === 'eb_claim_follow_up_emails') {
        state.trace.push('claim')
        // Simulate a new worker process receiving fresh database rows, not the
        // object a previous worker might have changed only in memory.
        return { data: structuredClone(state.rows), error: null }
      }
      assert.equal(name, 'eb_finish_follow_up_email')
      state.trace.push(args.p_success ? 'finish-success' : 'finish-retry')
      state.finishes.push(structuredClone(args))
      return { data: true, error: state.finishSuccessError && args.p_success ? { message: 'Synthetic finish failure' } : null }
    },
    from: (table: string) => {
      assert.equal(table, 'eb_follow_up_email_outbox', 'receipt preparation must not expand recipients or query live order data')
      const filters: Record<string, unknown> = {}
      let values: Record<string, unknown> | undefined
      const query = {
        update: (input: Record<string, unknown>) => { values = structuredClone(input); return query },
        eq: (key: string, value: unknown) => { filters[key] = value; return query },
        select: (columns: string) => { assert.equal(columns, 'id'); return query },
        maybeSingle: async () => {
          state.trace.push('persist')
          assert.ok(values, 'the attachment bytes must be persisted with an UPDATE before sending')
          assert.deepEqual(Object.keys(values), ['payload_ciphertext'], 'preparing a PDF must not modify order or recipient metadata')
          assert.deepEqual(Object.keys(filters).sort(), ['id', 'lease_id'], 'payload persistence must be bound to the exact claimed lease')
          state.writes.push({ values: structuredClone(values), filters: structuredClone(filters) })
          if (state.persistError) return { data: null, error: { message: 'Synthetic private persistence failure' } }
          const row = state.rows.find(item => item.id === filters.id && item.lease_id === filters.lease_id)
          if (state.loseLease || !row) return { data: null, error: null }
          assert.equal(typeof values.payload_ciphertext, 'string')
          row.payload_ciphertext = values.payload_ciphertext as string
          return { data: { id: row.id }, error: null }
        },
      }
      return query
    },
  }
  const source = ts.transpileModule(readFileSync(new URL('../src/lib/eb/followUpDelivery.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const loadWorker = () => {
    const compiled = { exports: {} }
    new Function('require', 'module', 'exports', 'process', source)((name: string) => {
      if (name === 'node:crypto') return require(name)
      if (name === '@/lib/supabase/admin') return { createSupabaseAdminClient: () => admin }
      if (name === '@/lib/eb/followUp') return {
        EB_FOLLOW_UP_ADMIN_EMAIL: 'admin@example.invalid', normalizeEbFollowUpEmail: (email: string) => email.trim().toLowerCase(),
      }
      if (name === '@/lib/eb/followUpConfirmationPdf') {
        state.rendererImports++
        return {
          renderEbFollowUpConfirmationPdf: async (data: Confirmation) => {
            state.trace.push('render')
            state.renderInputs.push(structuredClone(data))
            if (state.renderError) throw new Error('Synthetic render failure containing private order details')
            // Every render is deliberately different. A retry may only reuse
            // the already persisted bytes, not render a similar-looking PDF.
            return Buffer.concat([Buffer.from(`%PDF-1.7\nrender-${state.renderInputs.length}\n`), Buffer.from([0, 255, 128, 1])])
          },
          buildEbFollowUpConfirmationFilename: (data: Confirmation) => {
            state.filenameInputs.push(structuredClone(data)); return filename
          },
        }
      }
      if (name === '@/lib/assignments/mailer') return {
        sendAssignmentEmail: async (email: Mail) => {
          state.trace.push('send')
          state.sends.push(structuredClone(email))
          if (state.sendError) throw new Error('Synthetic provider failure containing a private recipient address')
        },
      }
      throw new Error(`Unexpected confirmation delivery dependency: ${name}`)
    }, compiled, compiled.exports, { env: {
      EB_FOLLOW_UP_EMAIL_ENCRYPTION_KEY: 'synthetic-confirmation-delivery-key', ASSIGNMENTS_MAIL_FROM: 'test@example.invalid',
    } })
    return compiled.exports as typeof Delivery
  }
  const delivery = loadWorker()
  const email = (overrides: Partial<Delivery.EbFollowUpEmail> = {}): Delivery.EbFollowUpEmail => ({
    to: 'buyer@example.invalid', replyTo: 'seller@example.invalid', subject: 'Din beställning är bekräftad',
    html: '<p>Beställningen är bekräftad.</p>', text: 'Beställningen är bekräftad.', ...overrides,
  })
  const job = (payload: Delivery.EbFollowUpEmail, kind = 'receipt'): Row => ({
    id: 'receipt-job', order_id: 'synthetic-order', event_id: null, kind, dedupe_key: 'receipt:synthetic-order',
    lease_id: 'lease-first', attempts: 1, payload_ciphertext: delivery.encryptEbFollowUpPayload(payload),
  })
  const storedEmail = () => delivery.decryptEbFollowUpPayload<Delivery.EbFollowUpEmail>(state.rows[0].payload_ciphertext!)
  return { state, delivery, loadWorker, email, job, storedEmail }
}

test('a receipt PDF is rendered lazily, encrypted and lease-persisted before sending only to the buyer', async () => {
  const { state, delivery, email, job, storedEmail } = fixture()
  state.rows = [job(email({ confirmationPdf: confirmation }))]
  const originalCiphertext = state.rows[0].payload_ciphertext
  assert.deepEqual(await delivery.processEbFollowUpEmails(), result({ sent: 1 }))
  assert.deepEqual(state.trace, ['claim', 'render', 'persist', 'send', 'finish-success'])
  assert.equal(state.rendererImports, 1)
  assert.deepEqual(state.renderInputs, [confirmation])
  assert.deepEqual(state.filenameInputs, [confirmation])
  assert.deepEqual(state.writes[0].filters, { id: 'receipt-job', lease_id: 'lease-first' })
  assert.notEqual(state.rows[0].payload_ciphertext, originalCiphertext)
  assert.match(state.rows[0].payload_ciphertext!, /^v1\./)
  assert.doesNotMatch(state.rows[0].payload_ciphertext!, /%PDF-1\.7|buyer@example\.invalid|Immutable purchase snapshot/)
  assert.equal(state.sends.length, 1)
  assert.equal(state.sends[0].to, 'buyer@example.invalid')
  assert.equal(state.sends[0].from, 'test@example.invalid')
  assert.equal(state.sends[0].replyTo, 'seller@example.invalid')
  assert.equal(state.sends[0].idempotencyKey, 'eb-follow-up-receipt-job')
  assert.equal('cc' in state.sends[0], false)
  assert.equal('bcc' in state.sends[0], false)
  assert.equal('confirmationPdf' in state.sends[0], false, 'internal rendering data is not forwarded to the generic email sender')
  assert.deepEqual(state.sends[0].attachments, storedEmail().attachments)
  assert.equal(state.sends[0].attachments?.length, 1)
  assert.equal(state.sends[0].attachments?.[0].filename, filename)
  assert.equal(state.sends[0].attachments?.[0].contentType, 'application/pdf')
  assert.deepEqual(Buffer.from(state.sends[0].attachments![0].contentBase64, 'base64'),
    Buffer.concat([Buffer.from('%PDF-1.7\nrender-1\n'), Buffer.from([0, 255, 128, 1])]))
})

test('a provider retry in a fresh worker reuses exactly the same PDF bytes, filename and idempotency key', async () => {
  const { state, delivery, loadWorker, email, job, storedEmail } = fixture()
  state.rows = [job(email({ confirmationPdf: confirmation }))]
  state.sendError = true
  assert.deepEqual(await delivery.processEbFollowUpEmails(), result({ failed: 1 }))
  assert.equal(state.finishes.at(-1)?.p_success, false)
  const persistedAttachments = structuredClone(storedEmail().attachments)
  const firstSend = structuredClone(state.sends[0])
  state.sendError = false
  state.rows[0].lease_id = 'lease-after-restart'
  state.rows[0].attempts = 2
  assert.deepEqual(await loadWorker().processEbFollowUpEmails(), result({ sent: 1 }))
  assert.equal(state.renderInputs.length, 1, 'a cold worker must use persisted bytes, not render the confirmation again')
  assert.equal(state.rendererImports, 1)
  assert.equal(state.writes.length, 1)
  assert.equal(state.sends.length, 2)
  assert.deepEqual(state.sends[1].attachments, persistedAttachments)
  assert.deepEqual(state.sends[1].attachments, firstSend.attachments)
  assert.equal(state.sends[1].idempotencyKey, firstSend.idempotencyKey)
  assert.deepEqual(state.sends.map(message => message.to), ['buyer@example.invalid', 'buyer@example.invalid'])
  assert.equal(state.finishes.at(-1)?.p_lease_id, 'lease-after-restart')
})

test('a finish failure after sending retries with the persisted attachment and the same provider idempotency key', async () => {
  const { state, delivery, loadWorker, email, job } = fixture()
  state.rows = [job(email({ confirmationPdf: confirmation }))]
  state.finishSuccessError = true
  assert.deepEqual(await delivery.processEbFollowUpEmails(), result({ failed: 1 }))
  assert.equal(state.sends.length, 1)
  assert.deepEqual(state.finishes.map(finish => finish.p_success), [true, false])
  state.finishSuccessError = false
  state.rows[0].lease_id = 'lease-retry-finish'
  assert.deepEqual(await loadWorker().processEbFollowUpEmails(), result({ sent: 1 }))
  assert.equal(state.renderInputs.length, 1)
  assert.equal(state.writes.length, 1)
  assert.deepEqual(state.sends[1].attachments, state.sends[0].attachments)
  assert.equal(state.sends[1].idempotencyKey, state.sends[0].idempotencyKey)
})

for (const failure of ['renderError', 'persistError', 'loseLease'] as const) {
  test(`a ${failure} blocks sending and schedules a safe retry before any receipt can leave the worker`, async () => {
    const { state, delivery, loadWorker, email, job } = fixture()
    state.rows = [job(email({ confirmationPdf: confirmation }))]
    const ciphertextBefore = state.rows[0].payload_ciphertext
    state[failure] = true
    assert.deepEqual(await delivery.processEbFollowUpEmails(), result({ failed: 1 }))
    assert.equal(state.sends.length, 0)
    assert.equal(state.rows[0].payload_ciphertext, ciphertextBefore)
    assert.equal(state.writes.length, failure === 'renderError' ? 0 : 1)
    assert.equal(state.finishes.at(-1)?.p_success, false)
    assert.equal(state.finishes.at(-1)?.p_error, 'E-postleveransen misslyckades. Automatiskt nytt försök.')
    assert.doesNotMatch(String(state.finishes.at(-1)?.p_error), /private|buyer@example|order details/)
    state[failure] = false
    state.rows[0].lease_id = 'lease-recovered'
    assert.deepEqual(await loadWorker().processEbFollowUpEmails(), result({ sent: 1 }))
    assert.equal(state.sends.length, 1)
    assert.equal(state.writes.at(-1)?.filters.lease_id, 'lease-recovered')
  })
}

test('legacy jobs without confirmation data retain their existing recipients and bypass PDF preparation', async () => {
  for (const kind of ['receipt', 'invoice', 'email', 'access', 'verification']) {
    const { state, delivery, email, job } = fixture()
    state.rows = [job(email(), kind)]
    assert.deepEqual(await delivery.processEbFollowUpEmails(), result({ sent: 1 }), kind)
    assert.equal(state.rendererImports, 0, kind)
    assert.equal(state.writes.length, 0, kind)
    assert.equal(state.sends.length, 1, kind)
    assert.equal(state.sends[0].to, 'buyer@example.invalid')
    assert.equal(state.sends[0].attachments, undefined)
  }
})

test('already prepared receipt attachments are sent unchanged without importing or rendering another PDF', async () => {
  const { state, delivery, email, job } = fixture()
  const attachments = [{ filename: 'Previously frozen receipt.pdf', contentBase64: Buffer.from('frozen receipt bytes').toString('base64'), contentType: 'application/pdf' }]
  state.rows = [job(email({ confirmationPdf: confirmation, attachments }))]
  assert.deepEqual(await delivery.processEbFollowUpEmails(), result({ sent: 1 }))
  assert.equal(state.rendererImports, 0)
  assert.equal(state.writes.length, 0)
  assert.deepEqual(state.sends[0].attachments, attachments)
})

test('an empty receipt attachment list still triggers confirmation preparation', async () => {
  const { state, delivery, email, job } = fixture()
  state.rows = [job(email({ confirmationPdf: confirmation, attachments: [] }))]
  assert.deepEqual(await delivery.processEbFollowUpEmails(), result({ sent: 1 }))
  assert.equal(state.renderInputs.length, 1)
  assert.equal(state.writes.length, 1)
  assert.equal(state.sends[0].attachments?.length, 1)
})

test('an expired queued confirmation is skipped before PDF rendering or attachment persistence', async () => {
  const { state, delivery, email, job } = fixture()
  state.rows = [job(email({ confirmationPdf: confirmation, expiresAt: '2000-01-01T00:00:00Z' }))]
  assert.deepEqual(await delivery.processEbFollowUpEmails(), result({ skipped: 1 }))
  assert.equal(state.rendererImports, 0)
  assert.equal(state.writes.length, 0)
  assert.equal(state.sends.length, 0)
  assert.equal(state.finishes.at(-1)?.p_success, true)
})
