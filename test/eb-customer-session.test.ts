import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import type * as Session from '../src/lib/eb/customerSession'

const require = createRequire(import.meta.url)
const previousKey = process.env.EB_FOLLOW_UP_EMAIL_ENCRYPTION_KEY
before(() => { process.env.EB_FOLLOW_UP_EMAIL_ENCRYPTION_KEY = 'isolated-session-test-key' })
after(() => {
  if (previousKey === undefined) delete process.env.EB_FOLLOW_UP_EMAIL_ENCRYPTION_KEY
  else process.env.EB_FOLLOW_UP_EMAIL_ENCRYPTION_KEY = previousKey
})
const writes: Array<{ name: string; value: string; options: Record<string, unknown> }> = []
const jar = new Map<string, string>()
const compiledModule = { exports: {} }
const compiled = ts.transpileModule(readFileSync(new URL('../src/lib/eb/customerSession.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
new Function('require', 'module', 'exports', compiled)((name: string) => {
  if (name === 'next/headers') return { cookies: async () => ({
    get: (key: string) => jar.has(key) ? { value: jar.get(key) } : undefined,
    set: (key: string, value: string, options: Record<string, unknown>) => { jar.set(key, value); writes.push({ name: key, value, options }) },
  }) }
  if (name.startsWith('node:')) return require(name)
  throw new Error(`Unexpected dependency ${name}`)
}, compiledModule, compiledModule.exports)
const auth = compiledModule.exports as typeof Session

function session(): Session.EbCustomerSession {
  return { orgId: randomUUID(), inspectionId: randomUUID(), email: 'buyer@example.test', kind: 'report',
    reportLinkId: randomUUID(), challengeId: randomUUID(), code: '123456', expiresAt: Date.now() + 15 * 60_000 }
}

test('customer credentials are encrypted, inspection-bound and expire', () => {
  const value = session(), now = Date.now()
  const encoded = auth.encodeEbCustomerSession(value, now)
  assert.doesNotMatch(encoded, /123456|buyer@example|challengeId/)
  assert.equal(auth.decodeEbCustomerSession(encoded, value.inspectionId, now)?.email, value.email)
  assert.equal(auth.decodeEbCustomerSession(encoded, randomUUID(), now), null)
  assert.equal(auth.decodeEbCustomerSession(encoded, value.inspectionId, value.expiresAt), null)
  assert.equal(auth.decodeEbCustomerSession(`${encoded}.suffix`, value.inspectionId), null)
  assert.equal(auth.decodeEbCustomerSession('attacker-json', value.inspectionId), null)
  const parts = encoded.split('.')
  parts[2] = Buffer.alloc(16).toString('base64url')
  assert.equal(auth.decodeEbCustomerSession(parts.join('.'), value.inspectionId), null)
})

test('unbounded expiry and malformed or missing report evidence cannot mint a credential', () => {
  const value = session()
  assert.throws(() => auth.encodeEbCustomerSession({ ...value, expiresAt: Date.now() + 9 * 3600_000 }))
  assert.throws(() => auth.encodeEbCustomerSession({ ...value, challengeId: undefined }))
  assert.throws(() => auth.encodeEbCustomerSession({ ...value, portalPath: 'https://attacker.test/' }))
})

test('cookies are HttpOnly, host-only in production, scoped per inspection and absent from response data', async () => {
  const env = process.env.NODE_ENV
  Object.assign(process.env, { NODE_ENV: 'production' })
  try {
    const value = session()
    await auth.setEbCustomerSession(value)
    const saved = writes.at(-1)!
    assert.match(saved.name, /^__Host-eb_customer_/)
    assert.deepEqual(Object.fromEntries(['httpOnly', 'secure', 'sameSite', 'path'].map(key => [key, saved.options[key]])), {
      httpOnly: true, secure: true, sameSite: 'lax', path: '/',
    })
    assert.equal(saved.options.domain, undefined)
    assert.equal((await auth.readEbCustomerSession(value.inspectionId))?.email, value.email)
    await auth.clearEbCustomerSession(value.inspectionId)
    assert.equal(await auth.readEbCustomerSession(value.inspectionId), null)
  } finally { Object.assign(process.env, { NODE_ENV: env }) }
})

test('cookie-authorized mutations reject cross-site and missing origins', () => {
  const rejected: Record<string, string>[] = [{}, { origin: 'https://evil.test' }, { origin: 'https://hushub.test', 'sec-fetch-site': 'cross-site' }]
  for (const headers of rejected) {
    assert.throws(() => auth.assertEbCustomerRequestOrigin(new Request('https://hushub.test/api/order', { method: 'POST', headers })), /ORIGIN_FORBIDDEN/)
  }
  assert.doesNotThrow(() => auth.assertEbCustomerRequestOrigin(new Request('https://hushub.test/api/order', {
    method: 'POST', headers: { origin: 'https://hushub.test', 'sec-fetch-site': 'same-origin' },
  })))
})
