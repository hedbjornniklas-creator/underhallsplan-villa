import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

const ACTOR = '11111111-1111-4111-8111-111111111111'
const REQUEST = '22222222-2222-4222-8222-222222222222'
const ORG = '33333333-3333-4333-8333-333333333333'
const draft = () => ({ requestId: REQUEST, name: ' Exempel AB ', organizationNumber: '5592810823' })
function load<T>(file: string, dependencies: Record<string, unknown>): T {
  const output = ts.transpileModule(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), {
    fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const compiled = { exports: {} }
  new Function('require', 'module', 'exports', output)((name: string) => {
    if (name in dependencies) return dependencies[name]
    throw new Error(`Unexpected self-service dependency: ${name}`)
  }, compiled, compiled.exports)
  return compiled.exports as T
}
const http = load<Record<string, unknown>>('src/lib/organizations/administrationHttp.ts', {})
const fortnox = load<Record<string, unknown>>('src/lib/fortnox/domain.ts', {})
const parser = load<{ parseSelfServiceOrganizationCreate: (value: unknown) => unknown }>('src/lib/organizations/selfServiceTypes.ts', {
  '@/lib/organizations/administrationHttp': http, '@/lib/fortnox/domain': fortnox,
})
type Domain = { createSelfServiceOrganization: (value: unknown) => Promise<unknown>; requireOrganizationCreationAccount: () => Promise<string> }
type DbResult = { data: unknown; error: { code?: string; message?: string } | null }
function harness(options: { user?: unknown; authError?: unknown; rpc?: DbResult } = {}) {
  const events: string[] = []
  const rpcs: { name: string; args: Record<string, unknown> }[] = []
  const domain = load<Domain>('src/lib/organizations/selfService.ts', {
    'server-only': {},
    '@/lib/supabase/server': { createSupabaseServerClient: () => ({ auth: { getUser: async () => {
      events.push('auth')
      return { data: { user: options.user === undefined ? { id: ACTOR, email: 'owner@example.test', email_confirmed_at: '2026-10-12T00:00:00Z' } : options.user }, error: options.authError ?? null }
    } } }) },
    '@/lib/supabase/admin': { createSupabaseAdminClient: () => {
      events.push('service-client')
      return { rpc: async (name: string, args: Record<string, unknown>) => {
        rpcs.push({ name, args })
        return options.rpc ?? { data: { saved: true, organizationId: ORG }, error: null }
      } }
    } },
    '@/lib/organizations/administrationHttp': http,
    '@/lib/organizations/selfServiceTypes': parser,
  })
  const route = load<{ POST: (request: Request) => Promise<Response> }>('src/app/api/organizations/route.ts', {
    '@/lib/organizations/selfService': domain, '@/lib/organizations/administrationHttp': http,
  })
  return { domain, route, events, rpcs }
}
function request(body: unknown = draft(), headers: Record<string, string> = {}, raw = false) {
  return new Request('https://hushub.se/api/organizations', { method: 'POST',
    headers: { origin: 'https://hushub.se', 'sec-fetch-site': 'same-origin', 'content-type': 'application/json', ...headers },
    body: raw ? String(body) : JSON.stringify(body) })
}
function privateResponse(response: Response) {
  assert.match(response.headers.get('cache-control') ?? '', /private.*no-store/u)
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer')
  assert.equal(response.headers.get('vary'), 'Cookie')
}

test('signed-in confirmed actor is session-derived; only normalized company fields reach one service RPC', async () => {
  const h = harness()
  const result = await h.domain.createSelfServiceOrganization(draft())
  assert.deepEqual(result, { saved: true, organizationId: ORG })
  assert.deepEqual(h.events, ['auth', 'service-client'])
  assert.deepEqual(h.rpcs, [{ name: 'organization_self_service_create', args: {
    p_actor: ACTOR, p_request_id: REQUEST, p_values: { name: 'Exempel AB', organizationNumber: '559281-0823' },
  } }])
})

test('anonymous, expired and unverified sessions never open a service client', async () => {
  for (const [options, message] of [
    [{ user: null }, 'UNAUTHORIZED'], [{ authError: { message: 'Session expired' } }, 'UNAUTHORIZED'],
    [{ user: { id: ACTOR, email: 'owner@example.test' } }, 'ORG_EMAIL_UNVERIFIED'],
    [{ user: { id: ACTOR, email_confirmed_at: '2026-10-12' } }, 'ORG_EMAIL_UNVERIFIED'],
  ] as const) {
    const h = harness(options)
    await assert.rejects(h.domain.createSelfServiceOrganization(draft()), { message })
    assert.deepEqual(h.events, ['auth'])
    assert.deepEqual(h.rpcs, [])
  }
})

test('self-service exact parser refuses role, identity, module or existing organization injection', async () => {
  const invalid = [null, [], {}, { ...draft(), actorProfileId: ACTOR }, { ...draft(), p_actor: ACTOR },
    { ...draft(), adminProfileId: ACTOR }, { ...draft(), role: 'admin' }, { ...draft(), modules: ['inspections'] },
    { ...draft(), orgId: ORG }, { ...draft(), requestId: 'bad' }, { ...draft(), organizationNumber: null },
    { ...draft(), organizationNumber: 5592810823 }, { ...draft(), name: '' }, { ...draft(), name: 'a'.repeat(241) },
    { ...draft(), name: 'bad\nname' }, { ...draft(), name: 'bad\u007fname' },
    ...['559281-0824', '559281082', 'SE559281082301', '559 281-0823', '559281+0823', ''].map(organizationNumber => ({ ...draft(), organizationNumber }))]
  for (const value of invalid) {
    const h = harness()
    await assert.rejects(h.domain.createSelfServiceOrganization(value), { message: 'ORG_INPUT_INVALID' })
    assert.deepEqual(h.events, ['auth'])
    assert.deepEqual(h.rpcs, [])
  }
})

test('API returns private success with no tokens, membership snapshots or global permission data', async () => {
  const h = harness()
  const response = await h.route.POST(request())
  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { saved: true, organizationId: ORG })
  privateResponse(response)
  assert.equal(h.rpcs.length, 1)
})

test('API authenticates before parsing and rejects cross-site/malformed/oversized bodies', async () => {
  const anonymous = harness({ user: null })
  const denied = await anonymous.route.POST(request('{', { origin: 'https://attacker.test' }, true))
  assert.equal(denied.status, 401)
  assert.deepEqual(anonymous.rpcs, [])
  for (const [body, headers, raw, status] of [
    [draft(), { origin: 'https://attacker.test' }, false, 403],
    [draft(), { 'sec-fetch-site': 'cross-site' }, false, 403],
    [draft(), { 'content-type': 'text/plain' }, false, 415],
    [draft(), { 'content-length': '100000' }, false, 413],
    [{ huge: 'x'.repeat(10000) }, {}, false, 413],
    ['{', {}, true, 400], [null, {}, false, 400], [[], {}, false, 400],
  ] as [unknown, Record<string, string>, boolean, number][]) {
    const h = harness()
    const response = await h.route.POST(request(body, headers, raw))
    assert.equal(response.status, status)
    assert.deepEqual(h.rpcs, [])
    privateResponse(response)
  }
  const h = harness()
  const noOrigin = request()
  noOrigin.headers.delete('origin')
  assert.equal((await h.route.POST(noOrigin)).status, 403)
})

test('fixed duplicate, legacy-review, verification and rate-limit messages do not leak SQL diagnostics', async () => {
  for (const [error, status, code] of [
    [{ message: 'ORG_NUMBER_EXISTS' }, 409, 'ORG_NUMBER_EXISTS'],
    [{ message: 'ORG_CREATE_LIMIT' }, 429, 'ORG_CREATE_LIMIT'],
    [{ message: 'ORG_EMAIL_UNVERIFIED' }, 403, 'ORG_EMAIL_UNVERIFIED'],
    [{ message: 'ORG_LEGACY_ACCESS_REVIEW_REQUIRED' }, 409, 'ORG_LEGACY_ACCESS_REVIEW_REQUIRED'],
    [{ message: 'ORG_CONFLICT' }, 409, 'ORG_CONFLICT'],
    [{ message: 'ORG_MEMBERSHIP_REQUIRED' }, 403, 'ORG_MEMBERSHIP_REQUIRED'],
    [{ code: 'PGRST202', message: 'SQL detail' }, 503, 'ORG_SCHEMA_REQUIRED'],
    [{ message: 'private@example.test access_token=secret relation SQL' }, 500, 'ORG_REQUEST_FAILED'],
  ] as const) {
    const h = harness({ rpc: { data: null, error } })
    const response = await h.route.POST(request())
    assert.equal(response.status, status)
    const body = await response.json()
    assert.equal(body.code, code)
    assert.doesNotMatch(JSON.stringify(body), /private@example|secret|relation SQL/u)
    privateResponse(response)
  }
})

test('unexpected RPC responses are never reported as a completed organization', async () => {
  for (const data of [null, {}, { saved: false, organizationId: ORG }, { saved: true, organizationId: 'not-uuid' }]) {
    const h = harness({ rpc: { data, error: null } })
    await assert.rejects(h.domain.createSelfServiceOrganization(draft()), { message: 'ORG_REQUEST_FAILED' })
  }
})
