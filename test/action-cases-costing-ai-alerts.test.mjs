import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import * as crypto from 'node:crypto'
import ts from 'typescript'

const code = ts.transpileModule(readFileSync(new URL('../src/lib/action-cases/costingAiAlerts.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const start = Date.parse('2026-09-09T08:00:00Z')

function harness({ now = start, env = {}, mailFails = false, scheduleFails = false, provider = new Map() } = {}) {
  const queued = [], calls = [], logs = []
  const mod = { exports: {} }
  class Clock extends Date { static now() { return now } }
  new Function('module', 'exports', 'require', 'process', 'Date', 'console', code)(mod, mod.exports, (name) => {
    if (name === 'server-only') return {}
    if (name === 'node:crypto') return crypto
    if (name === 'next/server') return { after: (callback) => {
      if (scheduleFails) throw new Error('Scheduling unavailable')
      queued.push(callback)
    } }
    if (name === '@/lib/assignments/mailer') return { sendAssignmentEmail: async (email) => {
      calls.push(email)
      const previous = provider.get(email.idempotencyKey)
      if (previous) assert.deepEqual(email, previous, 'Provider idempotency requires identical payloads')
      else provider.set(email.idempotencyKey, email)
      if (mailFails) throw new Error('Uncertain send with private provider data')
      return { provider: 'resend', providerMessageId: 'mock-id' }
    } }
    throw new Error(name)
  }, { env: { VERCEL_ENV: 'production', ASSIGNMENTS_MAIL_FROM: 'HusHub <test@example.test>', RESEND_API_KEY: 'secret-test-key', ...env } }, Clock, { error: (...args) => logs.push(args) })
  return { queued, calls, logs, provider, schedule: mod.exports.scheduleActionCaseAiAdminAlert, flush: async () => {
    for (const callback of queued.splice(0)) await callback()
  } }
}

test('billing and configuration alarms run in the background and target only the approved admin', async () => {
  for (const code of ['CREDIT_BALANCE', 'QUOTA_EXCEEDED', 'ACCESS_FAILED', 'NOT_CONFIGURED']) {
    const h = harness()
    h.schedule(`ACTION_CASE_AI_${code}`)
    assert.equal(h.calls.length, 0, 'User response does not wait for email')
    assert.equal(h.queued.length, 1)
    await h.flush()
    assert.equal(h.calls.length, 1)
    const email = h.calls[0]
    assert.equal(email.to, 'jn@hedbjorn.se')
    assert.equal(email.from, 'HusHub <test@example.test>')
    assert.match(email.text, new RegExp(`ACTION_CASE_AI_${code}`))
    assert.match(email.subject, /HusHub driftlarm \[production\]/)
    assert.match(email.text, /AI-kalkyl i Uppdrag/)
    assert.equal(email.attachments, undefined)
    assert.equal(email.replyTo, undefined)
    assert.doesNotMatch(JSON.stringify(email), /secret-test-key/)
    if (code === 'CREDIT_BALANCE') assert.match(email.text, /credit_balance_exhausted/)
  }
})

test('repeated errors and independent server instances use identical mail/key in the same window', async () => {
  const provider = new Map()
  const a = harness({ provider })
  const b = harness({ provider, now: start + 60 * 60 * 1000 })
  a.schedule('ACTION_CASE_AI_CREDIT_BALANCE')
  a.schedule('ACTION_CASE_AI_CREDIT_BALANCE')
  b.schedule('ACTION_CASE_AI_CREDIT_BALANCE')
  await a.flush(); await b.flush()
  assert.equal(provider.size, 1)
  assert.deepEqual(a.calls[0], b.calls[0])
  const later = harness({ provider, now: start + 6 * 60 * 60 * 1000 })
  later.schedule('ACTION_CASE_AI_CREDIT_BALANCE'); await later.flush()
  assert.equal(provider.size, 2, 'A recurring fault in a later window can send a reminder')
  const preview = harness({ provider, env: { VERCEL_ENV: 'preview' } })
  preview.schedule('ACTION_CASE_AI_CREDIT_BALANCE'); await preview.flush()
  assert.equal(provider.size, 3, 'Preview and production do not suppress each other')
})

test('transient failures, local throttles and validation errors do not email the admin', async () => {
  const h = harness()
  for (const code of ['RATE_LIMIT', 'ORG_LIMIT', 'TIMEOUT', 'FAILED', 'INVALID', 'SCOPE_REQUIRED', 'STALE']) h.schedule(`ACTION_CASE_AI_${code}`)
  h.schedule('constructor')
  h.schedule('private customer text')
  assert.equal(h.queued.length, 0)
  await h.flush()
  assert.equal(h.calls.length, 0)
})

test('failed or uncertain email never breaks the user request; the next occurrence safely retries', async () => {
  const provider = new Map()
  const failure = harness({ provider, mailFails: true })
  failure.schedule('ACTION_CASE_AI_CREDIT_BALANCE')
  await assert.doesNotReject(failure.flush())
  assert.equal(failure.logs.length, 1)
  assert.doesNotMatch(JSON.stringify(failure.logs), /private provider data|secret-test-key/)
  const retry = harness({ provider, now: start + 5000 })
  retry.schedule('ACTION_CASE_AI_CREDIT_BALANCE'); await retry.flush()
  assert.equal(provider.size, 1)
  assert.deepEqual(failure.calls[0], retry.calls[0])
})

test('missing mail configuration and unavailable background scheduling stay in server logs', async () => {
  for (const env of [{ ASSIGNMENTS_MAIL_FROM: '' }, { RESEND_API_KEY: '' }]) {
    const h = harness({ env })
    h.schedule('ACTION_CASE_AI_CREDIT_BALANCE'); await h.flush()
    assert.equal(h.calls.length, 0)
    assert.match(h.logs[0][0], /configuration missing/)
  }
  const h = harness({ scheduleFails: true })
  assert.doesNotThrow(() => h.schedule('ACTION_CASE_AI_CREDIT_BALANCE'))
  assert.equal(h.calls.length, 0)
  assert.match(h.logs[0][0], /could not schedule/)
})

test('HTML output escapes configuration text and payload changes do not reuse a different email key', async () => {
  const a = harness()
  const b = harness({ env: { OPENAI_ACTION_CASE_MODEL: '<changed&model>' } })
  a.schedule('ACTION_CASE_AI_ACCESS_FAILED'); b.schedule('ACTION_CASE_AI_ACCESS_FAILED')
  await a.flush(); await b.flush()
  assert.match(b.calls[0].html, /&lt;changed&amp;model&gt;/)
  assert.doesNotMatch(b.calls[0].html, /<changed&model>/)
  assert.notEqual(a.calls[0].idempotencyKey, b.calls[0].idempotencyKey)
})
