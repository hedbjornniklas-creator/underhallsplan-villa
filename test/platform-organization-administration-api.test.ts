import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

const ORG = '11111111-1111-4111-8111-111111111111'
const ACTOR = '22222222-2222-4222-8222-222222222222'
const MEMBER = '33333333-3333-4333-8333-333333333333'
const REQUEST = '44444444-4444-4444-8444-444444444444'
const TU = 'technical_investigations'
const permission = { productKey: 'hushub_admin', moduleKey: 'access_management', scopeType: 'global' }
const createDraft = { requestId: REQUEST, name: 'Exempel AB', organizationNumber: null, adminProfileId: MEMBER, modules: [TU] }
const modulesDraft = { expectedModules: [TU], modules: [] }
const memberDraft = { profileId: MEMBER, expected: null, role: 'inspector', isActive: true, modules: [TU] }

function load<T>(file: string, dependencies: Record<string, unknown>): T {
  const output = ts.transpileModule(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), {
    fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const compiled = { exports: {} }
  new Function('require', 'module', 'exports', output)((name: string) => {
    if (name in dependencies) return dependencies[name]
    throw new Error(`Unexpected central organization API dependency: ${name}`)
  }, compiled, compiled.exports)
  return compiled.exports as T
}

type Parsers = {
  parsePlatformOrganizationCreate: (value: unknown) => unknown
  parsePlatformOrganizationModules: (value: unknown) => unknown
  parsePlatformOrganizationMember: (value: unknown) => unknown
  parsePlatformOrganizationId: (value: unknown) => string
}
const http = load<Record<string, unknown>>('src/lib/organizations/administrationHttp.ts', {})
const fortnox = load<Record<string, unknown>>('src/lib/fortnox/domain.ts', {})
const parsers = load<Parsers>('src/lib/organizations/platformAdministrationTypes.ts', {
  '@/lib/organizations/administrationHttp': http,
  '@/lib/fortnox/domain': fortnox,
})

type RouteContext = { params: Promise<{ orgId: string }> }
type Route = Record<'GET' | 'POST' | 'PATCH', (request: Request, context: RouteContext) => Promise<Response>>
type Call = { name: string; args: unknown[] }

function harness(options: { denied?: string; serviceError?: string } = {}) {
  const gates: unknown[] = []
  const calls: Call[] = []
  const serviceResult = { marker: 'test-service-result', organizationId: ORG }
  const authorize = async (value: unknown) => {
    gates.push(value)
    if (options.denied) throw new Error(options.denied)
    return { identity: { profileId: ACTOR } }
  }
  const run = (name: string, args: unknown[]) => {
    calls.push({ name, args })
    if (options.serviceError) throw new Error(options.serviceError)
    return serviceResult
  }
  const dependencies = {
    '@/lib/access/server': { requireModuleAccess: authorize },
    '@/lib/organizations/administrationHttp': http,
    '@/lib/organizations/platformAdministrationTypes': parsers,
    '@/lib/organizations/platformAdministration': {
      listPlatformOrganizations: async () => { await authorize(permission); return run('list', []) },
      getPlatformOrganization: async (orgId: unknown) => {
        await authorize(permission)
        parsers.parsePlatformOrganizationId(orgId)
        return run('get', [orgId])
      },
      createPlatformOrganization: async (values: unknown) => {
        await authorize(permission)
        parsers.parsePlatformOrganizationCreate(values)
        return run('create', [values])
      },
      savePlatformOrganizationModules: async (orgId: unknown, values: unknown) => {
        await authorize(permission)
        parsers.parsePlatformOrganizationId(orgId)
        parsers.parsePlatformOrganizationModules(values)
        return run('modules', [orgId, values])
      },
      savePlatformOrganizationMember: async (orgId: unknown, values: unknown) => {
        await authorize(permission)
        parsers.parsePlatformOrganizationId(orgId)
        parsers.parsePlatformOrganizationMember(values)
        return run('member', [orgId, values])
      },
    },
  }
  return {
    index: load<Route>('src/app/api/admin/organizations/route.ts', dependencies),
    detail: load<Route>('src/app/api/admin/organizations/[orgId]/route.ts', dependencies),
    members: load<Route>('src/app/api/admin/organizations/[orgId]/members/route.ts', dependencies),
    gates, calls, serviceResult,
  }
}

function request(method: string, body?: unknown, headers: Record<string, string> = {}, raw = false) {
  return new Request('https://hushub.se/api/admin/organizations', {
    method, body: body === undefined ? undefined : raw ? String(body) : JSON.stringify(body),
    headers: { origin: 'https://hushub.se', 'sec-fetch-site': 'same-origin', 'content-type': 'application/json', ...headers },
  })
}
const context = (orgId = ORG): RouteContext => ({ params: Promise.resolve({ orgId }) })
function privateResponse(response: Response) {
  assert.match(response.headers.get('cache-control') ?? '', /\bprivate\b/u)
  assert.match(response.headers.get('cache-control') ?? '', /\bno-store\b/u)
  assert.equal(response.headers.get('pragma'), 'no-cache')
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer')
  assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow')
  assert.equal(response.headers.get('vary'), 'Cookie')
}

test('central organization routes forward the exact organization and validated operation without client identity', async () => {
  const h = harness()
  const responses = [
    await h.index.GET(request('GET'), context()),
    await h.detail.GET(request('GET'), context()),
    await h.index.POST(request('POST', createDraft), context()),
    await h.detail.PATCH(request('PATCH', modulesDraft), context()),
    await h.members.POST(request('POST', memberDraft), context()),
  ]
  for (const response of responses) {
    assert.ok(response.ok, `Unexpected response ${response.status}`)
    assert.match(JSON.stringify(await response.json()), /test-service-result/u)
    privateResponse(response)
  }
  assert.deepEqual(h.calls, [
    { name: 'list', args: [] }, { name: 'get', args: [ORG] }, { name: 'create', args: [createDraft] },
    { name: 'modules', args: [ORG, modulesDraft] }, { name: 'member', args: [ORG, memberDraft] },
  ])
  assert.deepEqual(h.gates, Array(8).fill(permission))
})

test('unauthenticated callers and organization-only administrators cannot read or mutate central organization administration', async () => {
  for (const [denied, status] of [['UNAUTHORIZED', 401], ['MODULE_ACCESS_REQUIRED', 403]] as const) {
    const h = harness({ denied })
    const responses = [
      await h.index.GET(request('GET'), context()), await h.detail.GET(request('GET'), context()),
      await h.index.POST(request('POST', createDraft), context()),
      await h.detail.PATCH(request('PATCH', modulesDraft), context()),
      await h.members.POST(request('POST', memberDraft), context()),
    ]
    for (const response of responses) {
      assert.equal(response.status, status)
      assert.equal((await response.json()).code, denied)
      privateResponse(response)
    }
    assert.deepEqual(h.calls, [])
    assert.deepEqual(h.gates, Array(5).fill(permission))
  }
})

test('authorization precedes parsing mutation bodies', async () => {
  const h = harness({ denied: 'MODULE_ACCESS_REQUIRED' })
  for (const [route, method] of [[h.index, 'POST'], [h.detail, 'PATCH'], [h.members, 'POST']] as const) {
    const response = await route[method](request(method, '{', { origin: 'https://attacker.test' }, true), context())
    assert.equal(response.status, 403)
    assert.equal((await response.json()).code, 'MODULE_ACCESS_REQUIRED')
  }
  assert.deepEqual(h.calls, [])
})

test('every mutation rejects cross-site, wrong-type and declared or streamed oversized bodies', async () => {
  for (const kind of ['create', 'modules', 'member'] as const) {
    for (const [headers, status] of [
      [{ origin: 'https://attacker.test' }, 403],
      [{ 'sec-fetch-site': 'cross-site' }, 403],
      [{ 'content-type': 'text/plain' }, 415],
      [{ 'content-length': '1000000' }, 413],
    ] as [Record<string, string>, number][]) {
      const h = harness()
      const route = kind === 'create' ? h.index.POST : kind === 'modules' ? h.detail.PATCH : h.members.POST
      const body = kind === 'create' ? createDraft : kind === 'modules' ? modulesDraft : memberDraft
      const response = await route(request(kind === 'modules' ? 'PATCH' : 'POST', body, headers), context())
      assert.equal(response.status, status)
      privateResponse(response)
      assert.deepEqual(h.calls, [])
    }
    const h = harness()
    const route = kind === 'create' ? h.index.POST : kind === 'modules' ? h.detail.PATCH : h.members.POST
    const response = await route(request(kind === 'modules' ? 'PATCH' : 'POST', { oversized: 'x'.repeat(1000000) }), context())
    assert.equal(response.status, 413)
    assert.deepEqual(h.calls, [])
    privateResponse(response)
  }
})

test('mutations require same-origin proof even when the caller has a platform-admin session', async () => {
  const h = harness()
  const req = request('POST', createDraft)
  req.headers.delete('origin')
  const response = await h.index.POST(req, context())
  assert.equal(response.status, 403)
  assert.deepEqual(h.calls, [])
})

test('malformed JSON and body identity injection fail without entering a mutation', async () => {
  for (const kind of ['create', 'modules', 'member'] as const) {
    const body = kind === 'create' ? createDraft : kind === 'modules' ? modulesDraft : memberDraft
    for (const candidate of ['{', 'null', '[]', JSON.stringify({ ...body, actorProfileId: ACTOR }), JSON.stringify({ ...body, p_actor: ACTOR })]) {
      const h = harness()
      const route = kind === 'create' ? h.index.POST : kind === 'modules' ? h.detail.PATCH : h.members.POST
      const response = await route(request(kind === 'modules' ? 'PATCH' : 'POST', candidate, {}, true), context())
      assert.equal(response.status, 400)
      assert.deepEqual(h.calls, [])
      privateResponse(response)
    }
  }
})

test('scoped routes reject invalid organization IDs and never use a default organization', async () => {
  const h = harness()
  const responses = [
    await h.detail.GET(request('GET'), context('invalid')),
    await h.detail.PATCH(request('PATCH', modulesDraft), context('invalid')),
    await h.members.POST(request('POST', memberDraft), context('invalid')),
  ]
  for (const response of responses) {
    assert.equal(response.status, 400)
    privateResponse(response)
  }
  assert.deepEqual(h.calls, [])
})

test('SQL conflicts and missing migration return fixed actionable errors while unknown diagnostics remain opaque', async () => {
  for (const [serviceError, status, code] of [
    ['ORG_CONFLICT', 409, 'ORG_CONFLICT'], ['ORG_LAST_ADMIN', 409, 'ORG_LAST_ADMIN'],
    ['ORG_SCHEMA_REQUIRED', 503, 'ORG_SCHEMA_REQUIRED'],
    ['access_token=secret private@example.test database details', 500, 'ORG_REQUEST_FAILED'],
  ] as const) {
    const h = harness({ serviceError })
    const response = await h.members.POST(request('POST', memberDraft), context())
    assert.equal(response.status, status)
    const body = await response.json()
    assert.equal(body.code, code)
    assert.doesNotMatch(JSON.stringify(body), /access_token|secret|private@example|database details/u)
    privateResponse(response)
  }
})
