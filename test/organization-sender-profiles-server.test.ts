import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'

const ACTOR = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const ID = '33333333-3333-4333-8333-333333333333'
const values = () => ({ name: ' Brand ', address: '', postalCode: null, city: null, email: ' INFO@EXAMPLE.TEST ', phone: null,
  website: 'example.test', logoPath: null, reportFooterText: 'Footer\nSecond line', isActive: true })
const draft = () => ({ action: 'saveProfile', id: ID, expectedVersion: 0, values: values() })
function load<T>(file: string, dependencies: Record<string, unknown>): T {
  const output = ts.transpileModule(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), {
    fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const compiled = { exports: {} }
  new Function('require', 'module', 'exports', output)((name: string) => {
    if (name in dependencies) return dependencies[name]
    throw new Error(`Unexpected sender-profile dependency: ${name}`)
  }, compiled, compiled.exports)
  return compiled.exports as T
}
const http = load<Record<string, unknown>>('src/lib/organizations/administrationHttp.ts', {})
const parser = load<{ parseOrganizationSenderMutation: (value: unknown) => unknown }>('src/lib/organizations/senderProfileTypes.ts', {
  '@/lib/organizations/administrationHttp': http,
})
type DbResult = { data: unknown; error: { code?: string; message?: string } | null }
class Query implements PromiseLike<DbResult> {
  private result: DbResult
  constructor(result: DbResult) { this.result = result }
  select() { return this }
  eq() { return this }
  order() { return this }
  single() { return this }
  then<TResult1 = DbResult, TResult2 = never>(resolve?: ((value: DbResult) => TResult1 | PromiseLike<TResult1>) | null,
    reject?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve(this.result).then(resolve, reject)
  }
}
type Workspace = { canEdit: boolean; migrationRequired: boolean; organization: { legalName: string | null; legalNameVersion: number }; profiles: unknown[] }
type Domain = { getOrganizationSenderWorkspace: (orgId: string) => Promise<Workspace>; saveOrganizationSenderProfile: (orgId: string, value: unknown) => Promise<unknown> }
function harness(options: { role?: string; denied?: string; rpc?: DbResult; organizations?: DbResult; profiles?: DbResult } = {}) {
  const events: string[] = []
  const rpcs: { name: string; args: Record<string, unknown> }[] = []
  const context = (admin: boolean, orgId: string) => {
    events.push(admin ? 'admin' : 'member')
    if (options.denied) throw new Error(options.denied)
    if (orgId !== ORG) throw new Error('ORG_MEMBERSHIP_REQUIRED')
    if (admin && options.role === 'inspector') throw new Error('ORG_ADMIN_REQUIRED')
    return { profileId: ACTOR, role: options.role ?? 'admin', migrationRequired: false,
      organization: { id: ORG, name: 'Unchanged company', organizationNumber: '559281-0823' } }
  }
  const domain = load<Domain>('src/lib/organizations/senderProfiles.ts', {
    'server-only': {},
    '@/lib/organizations/administration': { requireOrganizationContext: async (orgId: string) => context(false, orgId),
      requireOrganizationAdmin: async (orgId: string) => context(true, orgId) },
    '@/lib/organizations/senderProfileTypes': parser,
    '@/lib/supabase/admin': { createSupabaseAdminClient: () => {
      events.push('service-client')
      return {
        rpc: async (name: string, args: Record<string, unknown>) => {
          rpcs.push({ name, args }); return options.rpc ?? { data: { saved: true }, error: null }
        },
        from: (table: string) => {
          events.push(`read:${table}`)
          if (table === 'organizations') return new Query(options.organizations ?? { data: { legal_name: null, legal_name_version: 0 }, error: null })
          if (table === 'organization_sender_profiles') return new Query(options.profiles ?? { data: [], error: null })
          throw new Error('Unexpected table')
        },
      }
    } },
  })
  const route = load<{ GET: (request: Request) => Promise<Response>; PUT: (request: Request) => Promise<Response> }>('src/app/api/organizations/sender-profiles/route.ts', {
    '@/lib/organizations/senderProfiles': domain, '@/lib/organizations/administrationHttp': http,
  })
  return { domain, route, events, rpcs }
}
function request(body: unknown = draft(), headers: Record<string, string> = {}, orgId = ORG, raw = false) {
  return new Request(`https://hushub.se/api/organizations/sender-profiles?orgId=${orgId}`, { method: 'PUT',
    headers: { origin: 'https://hushub.se', 'sec-fetch-site': 'same-origin', 'content-type': 'application/json', ...headers },
    body: raw ? String(body) : JSON.stringify(body) })
}

test('strict sender parser rejects privilege, organization number, binding and field injections', () => {
  for (const input of [null, [], {}, { ...draft(), actor: ACTOR }, { ...draft(), orgId: ORG }, { ...draft(), id: 'bad' },
    { ...draft(), expectedVersion: -1 }, { ...draft(), expectedVersion: 1.2 }, { ...draft(), expectedVersion: '0' },
    ...['orgId', 'organizationNumber', 'isDefault', 'role'].map(key => ({ ...draft(), values: { ...values(), [key]: 'bad' } })),
    ...[null, 1, 'true'].map(isActive => ({ ...draft(), values: { ...values(), isActive } })),
    ...['', 'bad\nname', 'bad\u007fname', 'a'.repeat(241)].map(name => ({ ...draft(), values: { ...values(), name } })),
    { ...draft(), values: { ...values(), isActive: false } }, { ...draft(), values: { ...values(), email: 'bad' } },
    ...['javascript:alert(1)', 'https://u:p@example.test', 'localhost'].map(website => ({ ...draft(), values: { ...values(), website } })),
    { action: 'legalName', expectedVersion: 0, legalName: null }, { action: 'legalName', expectedVersion: 0, legalName: 'Bad\nname' },
  ]) assert.throws(() => parser.parseOrganizationSenderMutation(input), { message: 'ORG_INPUT_INVALID' })
})

test('server authorizes before service access and sends normalized values with session actor only', async () => {
  const h = harness()
  await h.domain.saveOrganizationSenderProfile(ORG, draft())
  assert.deepEqual(h.rpcs, [{ name: 'organization_sender_profile_save', args: { p_actor: ACTOR, p_org: ORG, p_id: ID,
    p_expected_version: 0, p_values: { ...values(), name: 'Brand', address: null, email: 'info@example.test', website: 'https://example.test/' } } }])
  assert.equal(h.events[0], 'admin')
  const legal = harness()
  await legal.domain.saveOrganizationSenderProfile(ORG, { action: 'legalName', expectedVersion: 0, legalName: ' Legal AB ' })
  assert.deepEqual(legal.rpcs, [{ name: 'organization_legal_name_save', args: { p_actor: ACTOR, p_org: ORG, p_expected_version: 0, p_legal_name: 'Legal AB' } }])
})

test('anonymous, other organization and inspector writes never reach the service client', async () => {
  for (const [h, org, message] of [[harness({ denied: 'UNAUTHORIZED' }), ORG, 'UNAUTHORIZED'],
    [harness({ role: 'inspector' }), ORG, 'ORG_ADMIN_REQUIRED'], [harness(), ID, 'ORG_MEMBERSHIP_REQUIRED']] as const) {
    await assert.rejects(h.domain.saveOrganizationSenderProfile(org, draft()), { message })
    assert.deepEqual(h.events, ['admin'])
    assert.deepEqual(h.rpcs, [])
  }
})

test('active member can read unset legal name without guessing from old branding; migration gate fails closed', async () => {
  const member = harness({ role: 'inspector' })
  const workspace = await member.domain.getOrganizationSenderWorkspace(ORG)
  assert.equal(workspace.canEdit, false)
  assert.equal(workspace.organization.legalName, null)
  assert.equal(workspace.organization.legalNameVersion, 0)
  const missing = harness({ organizations: { data: null, error: { code: '42703' } }, profiles: { data: null, error: { code: 'PGRST205' } } })
  assert.equal((await missing.domain.getOrganizationSenderWorkspace(ORG)).migrationRequired, true)
  const broken = harness({ profiles: { data: null, error: { code: 'unrelated' } } })
  await assert.rejects(broken.domain.getOrganizationSenderWorkspace(ORG), { message: 'ORG_REQUEST_FAILED' })
  const anonymous = harness({ denied: 'UNAUTHORIZED' })
  await assert.rejects(anonymous.domain.getOrganizationSenderWorkspace(ORG), { message: 'UNAUTHORIZED' })
  assert.deepEqual(anonymous.events, ['member'])
})

test('API enforces origin, bounded JSON and exactly one organization parameter; all responses are private', async () => {
  for (const [body, headers, raw, status] of [[draft(), { origin: 'https://attacker.test' }, false, 403],
    [draft(), { 'sec-fetch-site': 'cross-site' }, false, 403], [draft(), { 'content-type': 'text/plain' }, false, 415],
    [draft(), { 'content-length': '99999' }, false, 413], [{ large: 'a'.repeat(9999) }, {}, false, 413], ['{', {}, true, 400],
  ] as [unknown, Record<string, string>, boolean, number][]) {
    const h = harness()
    const response = await h.route.PUT(request(body, headers, ORG, raw))
    assert.equal(response.status, status)
    assert.match(response.headers.get('cache-control') ?? '', /private.*no-store/u)
    assert.equal(response.headers.get('vary'), 'Cookie')
    assert.deepEqual(h.rpcs, [])
  }
  const h = harness()
  assert.equal((await h.route.PUT(request(draft(), {}, `${ORG}&orgId=${ID}`))).status, 400)
  const success = await h.route.PUT(request())
  assert.equal(success.status, 200)
  assert.equal((await success.json()).saved, true)
  const read = await h.route.GET(new Request(`https://hushub.se/api/organizations/sender-profiles?orgId=${ORG}`))
  assert.equal(read.status, 200)
  assert.match(read.headers.get('cache-control') ?? '', /private.*no-store/u)
})

test('expected RPC failures remain bounded and private; malformed success never masquerades as saved', async () => {
  for (const [error, status, code] of [[{ message: 'ORG_CONFLICT' }, 409, 'ORG_CONFLICT'],
    [{ message: 'ORG_SENDER_MEDIA_INVALID' }, 400, 'ORG_SENDER_MEDIA_INVALID'], [{ message: 'ORG_SENDER_NAME_EXISTS' }, 409, 'ORG_SENDER_NAME_EXISTS'],
    [{ message: 'ORG_SENDER_LIMIT' }, 409, 'ORG_SENDER_LIMIT'], [{ code: 'PGRST202' }, 503, 'ORG_SENDER_SCHEMA_REQUIRED'],
    [{ message: 'private SQL payload secret' }, 500, 'ORG_REQUEST_FAILED']] as const) {
    const response = await harness({ rpc: { data: null, error } }).route.PUT(request())
    assert.equal(response.status, status)
    const body = await response.json()
    assert.equal(body.code, code)
    assert.doesNotMatch(JSON.stringify(body), /secret|private SQL/u)
  }
  for (const data of [null, {}, { saved: false }]) await assert.rejects(harness({ rpc: { data, error: null } }).domain.saveOrganizationSenderProfile(ORG, draft()),
    { message: 'ORG_REQUEST_FAILED' })
})
