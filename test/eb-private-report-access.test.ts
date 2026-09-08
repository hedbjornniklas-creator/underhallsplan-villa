import assert from 'node:assert/strict'
import test from 'node:test'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import type * as PrivateApi from '../src/app/api/eb/customer/[token]/follow-up/route'
import type * as Session from '../src/lib/eb/customerSession'

const require = createRequire(import.meta.url)
function load<T>(file: string, dependencies: Record<string, unknown>): T {
  const output = ts.transpileModule(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText
  const compiled = { exports: {} }
  new Function('require', 'module', 'exports', output)((name: string) => {
    if (name in dependencies) return dependencies[name]
    if (name.startsWith('node:') || name === 'react/jsx-runtime') return require(name)
    throw new Error(`Unexpected dependency ${name}`)
  }, compiled, compiled.exports)
  return compiled.exports as T
}
const origin = load<typeof Session>('src/lib/eb/customerSession.ts', { 'next/headers': {} }).assertEbCustomerRequestOrigin
function fixture() {
  const bearer = 'private-buyer-secret-with-sufficient-entropy'
  const publicToken = 'separate-public-report-token-for-sharing'
  const buyer = { publicToken, personalLinkId: 'private-id', orgId: 'org', inspectionId: 'inspection', reportLinkId: 'report', email: 'private@example.test', expired: false }
  const session = { kind: 'report', email: buyer.email, challengeId: 'fresh-server-intent', personalLinkId: buyer.personalLinkId }
  const calls: Array<{ name: string; input: unknown }> = []
  const state = { available: true, expired: false, error: '' }
  const api = load<typeof PrivateApi>('src/app/api/eb/customer/[token]/follow-up/route.ts', {
    'next/server': { NextResponse: { json: (body: unknown, init: ResponseInit) => Response.json(body, init) } },
    '@/lib/eb/customerSession': { assertEbCustomerRequestOrigin: origin },
    '@/lib/eb/customerLinks': {
      resolveEbCustomerReportLink: async (token: string) => {
        calls.push({ name: 'resolve', input: token })
        if (state.error) throw new Error(state.error)
        return state.available && token === bearer ? { ...buyer, expired: state.expired } : null
      },
      ensureEbCustomerReportSession: async (token: string, input: unknown) => {
        assert.equal(token, bearer)
        assert.deepEqual(input, buyer)
        calls.push({ name: 'session', input })
        return session
      },
    },
    '@/lib/eb/followUpServer': {
      getEbFollowUpCustomerState: async (token: string, input: unknown) => {
        assert.equal(token, publicToken); assert.equal(input, session)
        calls.push({ name: 'offer', input })
        return { verified: true, offer: { available: true, priceOre: 59900 } }
      },
      completeEbFollowUpOrder: async (input: unknown) => {
        calls.push({ name: 'order', input })
        return { orderId: 'order', portalUrl: '/atgarder/owner-private-link' }
      },
    },
  })
  const context = (token = bearer) => ({ params: Promise.resolve({ token }) })
  const request = (body: unknown, requestOrigin = 'https://hushub.test') => new Request(`https://hushub.test/api/eb/customer/${bearer}/follow-up`, {
    method: 'POST', headers: { Origin: requestOrigin, 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
  return { bearer, publicToken, buyer, session, calls, state, api, context, request }
}

test('private GET resolves bearer and fresh server session without ordering or sending email', async () => {
  const f = fixture()
  const response = await f.api.GET(new Request('https://hushub.test/api/private'), f.context())
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { verified: true, offer: { available: true, priceOre: 59900 } })
  assert.deepEqual(f.calls.map(call => call.name), ['resolve', 'session', 'offer'])
  assert.match(response.headers.get('cache-control')!, /no-store/)
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer')
})

test('public token, unknown, revoked and expired buyer links cannot obtain an offer or order', async () => {
  for (const scenario of ['public', 'unknown', 'revoked', 'expired']) {
    const f = fixture()
    if (scenario === 'revoked') f.state.available = false
    if (scenario === 'expired') f.state.expired = true
    const context = f.context(scenario === 'public' ? f.publicToken : scenario === 'unknown' ? 'unknown' : f.bearer)
    const get = await f.api.GET(new Request('https://hushub.test/api/private?customer=1'), context)
    assert.equal(get.status, 401, scenario)
    assert.deepEqual(await get.json(), { verified: false, offer: null, accessAvailable: false })
    const post = await f.api.POST(f.request({ action: 'order', customerSession: f.session }), context)
    assert.equal(post.status, 401, scenario)
    assert.ok(f.calls.every(call => call.name === 'resolve'))
  }
})

test('order target and authority come only from private bearer, never body/query-supplied values', async () => {
  const f = fixture()
  const input = { action: 'order', token: 'other-public-report', publicToken: 'other', customerSession: { email: 'attacker@example.test' }, challengeId: 'forged' }
  assert.equal((await f.api.POST(f.request(input), f.context())).status, 200)
  assert.deepEqual(f.calls.at(-1), { name: 'order', input: { token: f.publicToken, input, baseUrl: 'https://hushub.test', customerSession: f.session } })
})

test('same-origin mutations remain required and obsolete code/recovery actions cannot send mail', async () => {
  const f = fixture()
  for (const requestOrigin of ['', 'https://attacker.test']) {
    assert.equal((await f.api.POST(f.request({ action: 'order' }, requestOrigin), f.context())).status, 403)
  }
  for (const action of ['request_link','request_code','verify_code', ['order']]) {
    assert.equal((await f.api.POST(f.request({ action }), f.context())).status, 400)
  }
  assert.equal(f.calls.length, 0)
})

test('input and internal failure paths do not disclose private data', async () => {
  const f = fixture()
  for (const [body, status] of [['{', 400], ['[]', 400], ['null', 400], ['x'.repeat(12001), 413]] as const) {
    assert.equal((await f.api.POST(f.request(body), f.context())).status, status)
  }
  f.state.error = 'SECRET_TOKEN_EMAIL_DATABASE_FAILURE'
  for (const response of [await f.api.GET(new Request('https://hushub.test/api/private'), f.context()), await f.api.POST(f.request({ action: 'order' }), f.context())]) {
    assert.equal(response.status, 503)
    assert.doesNotMatch(await response.text(), /SECRET|private@example/)
  }
})

test('private page reuses frozen public renderer; expired buyer link retains read-only report', async () => {
  const renderer = () => null
  const publicToken = 'ordinary-public-report-token'
  type Page = { default: (input: { params: Promise<{ token: string }> }) => Promise<{ type: unknown; props: Record<string, unknown> }> }
  for (const expired of [false, true]) {
    const page = load<Page>('src/app/rapport/bestallare/[token]/page.tsx', {
      'next/navigation': { notFound: () => { throw new Error('NOT_FOUND') } },
      '@/components/report/PublicReportPageContent': { __esModule: true, default: renderer },
      '@/lib/eb/customerLinks': { resolveEbCustomerReportLink: async () => ({ publicToken, expired }) },
    })
    const result = await page.default({ params: Promise.resolve({ token: 'private-buyer-token' }) })
    assert.equal(result.type, renderer)
    assert.deepEqual(result.props, { publicToken, buyerAccessExpired: expired,
      buyerFollowUpEndpoint: expired ? undefined : '/api/eb/customer/private-buyer-token/follow-up' })
  }
  const unavailable = load<Page>('src/app/rapport/bestallare/[token]/page.tsx', {
    'next/navigation': { notFound: () => { throw new Error('NOT_FOUND') } },
    '@/components/report/PublicReportPageContent': { __esModule: true, default: renderer },
    '@/lib/eb/customerLinks': { resolveEbCustomerReportLink: async () => null },
  })
  await assert.rejects(unavailable.default({ params: Promise.resolve({ token: 'revoked-or-invalid' }) }), /NOT_FOUND/)
})

test('already delivered customer URLs redirect to private report without cookies, including expired read-only links', async () => {
  type LegacyApi = { GET: (request: Request, context: { params: Promise<{ token: string }> }) => Promise<Response> }
  class RedirectResponse extends Response {
    static redirect(url: URL, init: ResponseInit) {
      return new Response(null, { ...init, headers: { ...init.headers, Location: url.toString() } })
    }
  }
  for (const valid of [true, false]) {
    const api = load<LegacyApi>('src/app/api/eb/customer/[token]/route.ts', {
      'next/server': { NextResponse: RedirectResponse },
      '@/lib/eb/customerLinks': { openEbCustomerLink: async (token: string) => valid ? `/rapport/bestallare/${token}` : null },
    })
    const response = await api.GET(new Request('https://hushub.test/api/eb/customer/private-secret'), { params: Promise.resolve({ token: 'private-secret' }) })
    assert.equal(response.status, valid ? 303 : 410)
    assert.equal(response.headers.get('set-cookie'), null)
    assert.equal(response.headers.get('referrer-policy'), 'no-referrer')
    assert.match(response.headers.get('cache-control')!, /no-store/)
    if (valid) assert.equal(response.headers.get('location'), 'https://hushub.test/rapport/bestallare/private-secret')
    else assert.match(await response.text(), /Kontakta besiktningsmannen/)
  }
})
