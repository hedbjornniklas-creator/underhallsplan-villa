import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as crypto from 'node:crypto'
import test from 'node:test'
import ts from 'typescript'

const ORG = '11111111-1111-4111-8111-111111111111'
const ACTOR = '22222222-2222-4222-8222-222222222222'
const MEMBER = '33333333-3333-4333-8333-333333333333'
const INVITE = '44444444-4444-4444-8444-444444444444'
const REQUEST = '55555555-5555-4555-8555-555555555555'
const TOKEN = 'ab'.repeat(32)
const OB = 'inspections'
const TU = 'technical_investigations'
const parsedDraft = { requestId: REQUEST, email: 'member@example.test', fullName: 'Anna Medlem', role: 'inspector', modules: [TU] }
const draft = { ...parsedDraft, moduleSetVersion: 2 }
const row = { id: INVITE, org_id: ORG, email: draft.email, full_name: draft.fullName, role: 'inspector', modules: [TU],
  status: 'pending', expires_at: new Date(Date.now() + 86400000).toISOString(), revision: 0, notification_state: 'pending',
  organization: { name: 'Exempel AB' } }

function load<T>(file: string, dependencies: Record<string, unknown>): T {
  const output = ts.transpileModule(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), {
    fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const compiled = { exports: {} }
  new Function('require', 'module', 'exports', output)((name: string) => {
    if (name in dependencies) return dependencies[name]
    throw new Error(`Unexpected dependency: ${name}`)
  }, compiled, compiled.exports)
  return compiled.exports as T
}

type Http = {
  organizationJson: (body: unknown, status?: number) => Response
  organizationFailure: (error: unknown) => Response
  readOrganizationJson: (request: Request, options?: { maxBytes?: number }) => Promise<Record<string, unknown>>
  isOrganizationUuid: (value: unknown) => boolean
  organizationOrgId: (request: Request) => string
}
const http = load<Http>('src/lib/organizations/administrationHttp.ts', {})
const supportedModules = load<Record<string, unknown>>('src/lib/organizations/supportedModules.ts', {})
type Domain = {
  createOrganizationInvitation: (org: string, values: Record<string, unknown>) => Promise<Record<string, unknown>>
  changeOrganizationInvitation: (org: string, values: Record<string, unknown>) => Promise<Record<string, unknown>>
  updateOrganizationMember: (org: string, values: Record<string, unknown>) => Promise<Record<string, unknown>>
  listOrganizationMembers: (org: string) => Promise<Record<string, unknown>[]>
  listOrganizationInvitations: (org: string) => Promise<Record<string, unknown>[]>
  previewOrganizationInvitation: (token: string) => Promise<Record<string, unknown>>
  acceptOrganizationInvitation: (token: string, password?: string) => Promise<Record<string, unknown>>
  parseOrganizationInvitationDraft: (value: Record<string, unknown>) => Record<string, unknown>
  isOrganizationInviteToken: (value: unknown) => boolean
}
type Query = { table: string, ops: { name: string, args: unknown[] }[] }
type Result = { data: unknown, error: { code?: string, message?: string } | null }
type User = { id: string, email: string, email_confirmed_at?: string }

function harness(options: {
  roleError?: string
  user?: User | null
  sessionError?: unknown
  modules?: string[]
  managedModules?: string[]
  query?: (call: Query) => Result
  rpc?: (name: string, values: Record<string, unknown>) => Result
  createError?: unknown
} = {}) {
  const calls = { contexts: [] as string[], queries: [] as Query[], rpc: [] as { name: string, values: Record<string, unknown> }[], accounts: [] as unknown[] }
  const context = { profileId: ACTOR, role: 'admin', organization: { id: ORG, name: 'Exempel AB' }, modules: options.modules ?? [TU] }
  const db = {
    from(table: string) {
      const call: Query = { table, ops: [] }
      calls.queries.push(call)
      const builder: Record<string, unknown> = {}
      for (const name of ['select', 'eq', 'order', 'limit', 'update']) builder[name] = (...args: unknown[]) => {
        call.ops.push({ name, args }); return builder
      }
      const run = () => options.query?.(call) ?? { data: table === 'organization_enabled_modules'
        ? (options.managedModules ?? options.modules ?? [TU]).map(module_key => ({ module_key })) : row, error: null }
      builder.maybeSingle = async () => run()
      builder.then = (resolve: (result: Result) => unknown, reject: (error: unknown) => unknown) => Promise.resolve().then(run).then(resolve, reject)
      return builder
    },
    async rpc(name: string, values: Record<string, unknown>) {
      calls.rpc.push({ name, values })
      return options.rpc?.(name, values) ?? { data: { accepted: true, organizationId: ORG }, error: null }
    },
    auth: { admin: { async createUser(values: unknown) {
      calls.accounts.push(values)
      return { data: { user: options.createError ? null : { id: MEMBER } }, error: options.createError ?? null }
    } } },
  }
  const domain = load<Domain>('src/lib/organizations/invitations.ts', {
    'server-only': {}, 'node:crypto': crypto,
    '@/lib/supabase/admin': { createSupabaseAdminClient: () => db },
    '@/lib/supabase/server': { createSupabaseServerClient: () => ({ auth: { getUser: async () => ({ data: { user: options.user ?? null }, error: options.sessionError ?? null }) } }) },
    '@/lib/organizations/administrationHttp': http,
    '@/lib/organizations/supportedModules': supportedModules,
    '@/lib/organizations/administration': { requireOrganizationAdmin: async (org: string) => {
      calls.contexts.push(org)
      if (options.roleError) throw new Error(options.roleError)
      return context
    } },
  })
  return { domain, calls, context }
}

function request(body: string, headers: Record<string, string> = {}) {
  return new Request('https://hushub.se/api/organizations/invitations', {
    method: 'POST', body, headers: { origin: 'https://hushub.se', 'content-type': 'application/json', ...headers },
  })
}

test('organization HTTP boundary rejects cross-site, malformed, duplicate org and oversized streams', async () => {
  await assert.rejects(http.readOrganizationJson(request('{}', { origin: 'https://other.test' })), /ORG_ORIGIN_FORBIDDEN/)
  await assert.rejects(http.readOrganizationJson(request('{}', { 'sec-fetch-site': 'cross-site' })), /ORG_ORIGIN_FORBIDDEN/)
  await assert.rejects(http.readOrganizationJson(request('{}', { 'content-type': 'text/plain' })), /ORG_CONTENT_TYPE_INVALID/)
  for (const body of ['{', 'null', '[]', '"x"']) await assert.rejects(http.readOrganizationJson(request(body)), /ORG_REQUEST_INVALID/)
  await assert.rejects(http.readOrganizationJson(request(JSON.stringify({ data: 'ä'.repeat(5000) }))), /ORG_REQUEST_TOO_LARGE/)
  assert.throws(() => http.organizationOrgId(new Request(`https://hushub.se/a?orgId=${ORG}&orgId=${MEMBER}`)), /ORG_REQUEST_INVALID/)
})

test('private organization errors never expose provider diagnostics or untrusted error codes', async () => {
  const response = http.organizationFailure(new Error('token=secret private@example.test'))
  assert.equal(response.status, 500)
  assert.equal(response.headers.get('cache-control'), 'private, no-store, max-age=0')
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer')
  assert.equal(response.headers.get('vary'), 'Cookie')
  assert.deepEqual(await response.json(), { code: 'ORG_REQUEST_FAILED', error: 'Uppgifterna kunde inte hanteras just nu. Försök igen.' })
  assert.equal(http.organizationFailure(new Error('ORG_LAST_ADMIN')).status, 409)
  const outdated = http.organizationFailure(new Error('ORG_MODULE_SELECTION_REFRESH_REQUIRED'))
  assert.equal(outdated.status, 409)
  assert.equal((await outdated.json()).code, 'ORG_MODULE_SELECTION_REFRESH_REQUIRED')
})

test('draft accepts canonical OB and TU sets and rejects duplicates, unsupported modules, elevated roles or invalid versions', async () => {
  const { domain, calls } = harness()
  assert.deepEqual(domain.parseOrganizationInvitationDraft({ ...draft, email: ' Member@Example.Test ' }), { ...parsedDraft, email: 'member@example.test' })
  for (const modules of [[OB], [TU], [OB, TU], [TU, OB]]) {
    assert.deepEqual(domain.parseOrganizationInvitationDraft({ ...draft, modules }), { ...parsedDraft, modules: [...modules].sort() })
  }
  assert.deepEqual(domain.parseOrganizationInvitationDraft({ ...draft, role: 'admin', modules: [] }), { ...parsedDraft, role: 'admin', modules: [] })
  for (const change of [{ modules: ['tu'] }, { modules: ['eb'] }, { modules: ['entrepreneur_inspections'] },
    { modules: ['construction_inspections'] }, { modules: [TU, TU] }, { modules: [OB, OB] }, { modules: [OB, TU, OB] },
    { modules: [OB, null] }, { modules: [OB, 'admin'] }, { modules: 'inspections' },
    { role: 'superadmin' }, { modules: [] }, { email: 'member@example.test\r\nBCC:evil' }]) {
    assert.throws(() => domain.parseOrganizationInvitationDraft({ ...draft, ...change }), /ORG_REQUEST_INVALID/)
  }
  await assert.rejects(domain.changeOrganizationInvitation(ORG, { action: 'revoke', id: INVITE, revision: -1 }), /ORG_REQUEST_INVALID/)
  assert.deepEqual(calls.rpc, [])
})

test('stale TU-only invitation and member forms cannot silently remove newly supported OB selections', async () => {
  for (const version of [undefined, 1, '2', null]) {
    const { domain, calls } = harness({ modules: [OB, TU] })
    const staleDraft = { ...draft, moduleSetVersion: version }
    if (version === undefined) delete (staleDraft as Record<string, unknown>).moduleSetVersion
    assert.throws(() => domain.parseOrganizationInvitationDraft(staleDraft), /ORG_MODULE_SELECTION_REFRESH_REQUIRED/)
    await assert.rejects(domain.createOrganizationInvitation(ORG, staleDraft), /ORG_MODULE_SELECTION_REFRESH_REQUIRED/)
    await assert.rejects(domain.updateOrganizationMember(ORG, { profileId: MEMBER, role: 'inspector', isActive: true,
      modules: [TU], ...(version === undefined ? {} : { moduleSetVersion: version }) }), /ORG_MODULE_SELECTION_REFRESH_REQUIRED/)
    assert.deepEqual(calls.rpc, [])
    assert.deepEqual(calls.queries, [])
  }
})

test('cross-organization and non-admin callers are rejected before service-role reads or mutations', async () => {
  const { domain, calls } = harness({ roleError: 'ORG_ADMIN_REQUIRED', modules: [OB, TU] })
  for (const operation of [() => domain.listOrganizationMembers(ORG), () => domain.listOrganizationInvitations(ORG),
    () => domain.createOrganizationInvitation(ORG, { ...draft, modules: [OB, TU] }),
    () => domain.updateOrganizationMember(ORG, { moduleSetVersion: 2, profileId: MEMBER, role: 'admin', modules: [OB, TU], isActive: true })]) {
    await assert.rejects(operation(), /ORG_ADMIN_REQUIRED/)
  }
  assert.equal(calls.contexts.length, 4)
  assert.deepEqual(calls.queries, [])
  assert.deepEqual(calls.rpc, [])
})

test('member updates derive actor and org from checked context and ignore browser actor claims', async () => {
  const { domain, calls } = harness({ rpc: () => ({ data: { saved: true }, error: null }) })
  await domain.updateOrganizationMember(ORG, { moduleSetVersion: 2, profileId: MEMBER, actorProfileId: MEMBER, role: 'inspector', isActive: false, modules: [] })
  assert.deepEqual(calls.rpc, [{ name: 'organization_member_update', values: { p_actor: ACTOR, p_org: ORG, p_profile: MEMBER, p_values: { role: 'inspector', isActive: false, modules: [] } } }])
})

test('disabled organizational module cannot be granted by invitations or membership edits', async () => {
  for (const [enabled, requested] of [[[], [OB]], [[], [TU]], [[TU], [OB]], [[OB], [TU]], [[TU], [OB, TU]], [[OB], [OB, TU]]] as string[][][]) {
    const { domain, calls } = harness({ modules: enabled })
    await assert.rejects(domain.createOrganizationInvitation(ORG, { ...draft, modules: requested }), /ORG_MODULE_NOT_ENABLED/)
    await assert.rejects(domain.updateOrganizationMember(ORG, { moduleSetVersion: 2, profileId: MEMBER, role: 'inspector', isActive: true, modules: requested }), /ORG_MODULE_NOT_ENABLED/)
    assert.deepEqual(calls.rpc, [])
  }
})

test('member update sends a sorted OB and TU set without touching another organization or accepting actor claims', async () => {
  const { domain, calls } = harness({ modules: [OB, TU], rpc: () => ({ data: { saved: true }, error: null }) })
  await domain.updateOrganizationMember(ORG, { moduleSetVersion: 2, profileId: MEMBER, actorProfileId: MEMBER, role: 'inspector', isActive: true, modules: [TU, OB] })
  assert.deepEqual(calls.rpc, [{ name: 'organization_member_update', values: {
    p_actor: ACTOR, p_org: ORG, p_profile: MEMBER, p_values: { role: 'inspector', isActive: true, modules: [OB, TU] },
  } }])
})

test('expired grants are omitted and invite list redacts token hashes', async () => {
  const { domain, calls } = harness({ query: call => ({ error: null, data: call.table === 'org_members'
    ? [{ profile_id: MEMBER, role: 'inspector', is_active: true, profile: { full_name: 'Anna', email: draft.email } }]
    : call.table === 'platform_access_assignments'
      ? [{ profile_id: MEMBER, product: { key: 'dashboard' }, module: { key: TU }, expires_at: '2000-01-01' }]
      : [{ ...row, token_hash: 'secret', created_by_profile_id: ACTOR }] }) })
  const members = await domain.listOrganizationMembers(ORG)
  assert.deepEqual(members[0].modules, [])
  const invites = await domain.listOrganizationInvitations(ORG)
  assert.equal(invites.length, 1)
  assert.equal('token_hash' in invites[0], false)
  assert.equal('created_by_profile_id' in invites[0], false)
  assert.ok(calls.queries[1].ops.some(op => op.name === 'eq' && op.args[0] === 'scope_id' && op.args[1] === ORG))
  assert.ok(calls.queries.find(call => call.table === 'organization_invitations')!.ops
    .some(op => op.name === 'eq' && op.args[0] === 'org_id' && op.args[1] === ORG))
})

test('member list projects only exact-org active unexpired OB and TU inspector grants as a sorted unique set', async () => {
  const base = { profile_id: MEMBER, product: { key: 'dashboard' }, module: { key: OB }, role: { key: 'inspector' },
    scope_type: 'organization', scope_id: ORG, is_active: true, expires_at: null }
  const invalidGrants = [
    { ...base, module: { key: 'construction_inspections' } }, { ...base, role: { key: 'dashboard_admin' } },
    { ...base, role: null }, { ...base, product: { key: 'renoapp' } },
    { ...base, is_active: false }, { ...base, scope_type: 'global' }, { ...base, scope_id: INVITE },
    { ...base, expires_at: '2000-01-01' }, { ...base, expires_at: 'invalid' },
  ].map((grant, index) => ({ ...grant, profile_id: `66666666-6666-4666-8666-${String(index).padStart(12, '0')}` }))
  const rows: Record<string, Record<string, unknown>[]> = {
    org_members: [
      { org_id: ORG, profile_id: MEMBER, role: 'inspector', is_active: true, profile: { full_name: 'Anna', email: draft.email } },
      { org_id: ORG, profile_id: ACTOR, role: 'inspector', is_active: false, profile: { full_name: 'Inactive', email: null } },
      ...invalidGrants.map(grant => ({ org_id: ORG, profile_id: grant.profile_id, role: 'inspector', is_active: true,
        profile: { full_name: 'No valid module grant', email: null } })),
    ],
    organization_enabled_modules: [{ org_id: ORG, module_key: OB }, { org_id: ORG, module_key: TU }],
    platform_access_assignments: [
      { ...base, module: [{ key: TU }], product: [{ key: 'dashboard' }], role: [{ key: 'inspector' }], expires_at: '2999-01-01' },
      base, { ...base }, { ...base, profile_id: ACTOR },
      ...invalidGrants,
    ],
  }
  const { domain, calls } = harness({ modules: [OB, TU], query: call => ({ error: null,
    data: (rows[call.table] ?? []).filter(row => call.ops.filter(op => op.name === 'eq').every(op => row[String(op.args[0])] === op.args[1])),
  }) })
  const members = await domain.listOrganizationMembers(ORG)
  assert.deepEqual(members.map(member => member.modules), [[OB, TU], [], ...invalidGrants.map(() => [])])
  const grantQuery = calls.queries.find(call => call.table === 'platform_access_assignments')!
  assert.deepEqual(grantQuery.ops.filter(op => op.name === 'eq').map(op => op.args), [
    ['scope_type', 'organization'], ['scope_id', ORG], ['is_active', true],
  ])
  assert.match(String(grantQuery.ops.find(op => op.name === 'select')?.args[0]), /role:platform_roles\(key\)/u)
})

test('member editing hides unmanaged OB grants but keeps OB visible when explicitly managed even if disabled', async () => {
  for (const [managedModules, expected] of [[[TU], [TU]], [[OB, TU], [OB, TU]]] as string[][][]) {
    const { domain, calls } = harness({ modules: [TU], query: call => ({ error: null,
      data: call.table === 'org_members'
        ? [{ profile_id: MEMBER, role: 'inspector', is_active: true, profile: { full_name: 'Anna', email: draft.email } }]
        : call.table === 'organization_enabled_modules' ? managedModules.map(module_key => ({ module_key }))
        : [OB, TU].map(key => ({ profile_id: MEMBER, product: { key: 'dashboard' }, module: { key }, role: { key: 'inspector' }, expires_at: null })),
    }) })
    const members = await domain.listOrganizationMembers(ORG)
    assert.deepEqual(members[0].modules, expected)
    const enabledQuery = calls.queries.find(call => call.table === 'organization_enabled_modules')!
    assert.ok(enabledQuery.ops.some(op => op.name === 'eq' && op.args[0] === 'org_id' && op.args[1] === ORG))
  }
})

test('failed entitlement metadata is never treated as an unmanaged empty module selection', async () => {
  for (const error of [{ code: '42P01', message: 'private database detail' }, { message: 'private database detail' }]) {
    const { domain, calls } = harness({ query: call => ({
      data: call.table === 'organization_enabled_modules' ? null : [],
      error: call.table === 'organization_enabled_modules' ? error : null,
    }) })
    await assert.rejects(domain.listOrganizationMembers(ORG), {
      message: error.code === '42P01' ? 'ORG_SCHEMA_REQUIRED' : 'ORG_REQUEST_FAILED',
    })
    assert.deepEqual(calls.rpc, [])
  }
})

test('new invitation is mailed once; repeated request cannot resend its independently generated token', async t => {
  const previous = { from: process.env.ASSIGNMENTS_MAIL_FROM, base: process.env.APP_BASE_URL, key: process.env.RESEND_API_KEY, fetch: globalThis.fetch }
  process.env.ASSIGNMENTS_MAIL_FROM = 'HusHub <test@example.test>'
  process.env.APP_BASE_URL = 'https://hushub.se'
  process.env.RESEND_API_KEY = 'test-key'
  const sent: { headers: Headers, body: Record<string, unknown> }[] = []
  globalThis.fetch = async (_url, init) => {
    sent.push({ headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) })
    return Response.json({ id: 'mail-1' })
  }
  t.after(() => {
    for (const [name, value] of [['ASSIGNMENTS_MAIL_FROM', previous.from], ['APP_BASE_URL', previous.base], ['RESEND_API_KEY', previous.key]] as const) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value
    }
    globalThis.fetch = previous.fetch
  })
  let stored: Record<string, unknown> | undefined
  const { domain, calls } = harness({ modules: [OB, TU],
    rpc: (_name, input) => {
      stored ??= { ...row, modules: (input.p_values as Record<string, unknown>).modules, token_hash: (input.p_values as Record<string, unknown>).tokenHash }
      return { data: stored, error: null }
    },
    query: () => ({ data: { id: INVITE }, error: null }),
  })
  await domain.createOrganizationInvitation(ORG, { ...draft, actorProfileId: MEMBER, modules: [TU, OB] })
  await domain.createOrganizationInvitation(ORG, { ...draft, modules: [OB, TU] })
  assert.equal(sent.length, 1)
  assert.equal(sent[0].headers.get('idempotency-key'), `organization-invite/${INVITE}/0`)
  assert.match(String(sent[0].body.text), /https:\/\/hushub\.se\/organisation\/inbjudan#invite=[a-f0-9]{64}/)
  assert.equal(calls.rpc[0].values.p_actor, ACTOR)
  assert.deepEqual((calls.rpc[0].values.p_values as Record<string, unknown>).modules, [OB, TU])
  for (const format of ['text', 'html']) {
    assert.match(String(sent[0].body[format]), /Överlåtelsebesiktning \(ÖB\)/u)
    assert.match(String(sent[0].body[format]), /Tekniska utredningar \(TU\)/u)
    assert.doesNotMatch(String(sent[0].body[format]), /Entreprenadbesiktning/u)
  }
  assert.ok(calls.queries[0].ops.some(op => op.name === 'eq' && op.args[0] === 'notification_state' && op.args[1] === 'pending'))
  assert.ok(calls.queries[1].ops.some(op => op.name === 'eq' && op.args[0] === 'notification_state' && op.args[1] === 'sending'))
})

test('accept existing verified session preserves its credentials and delegates atomic membership to SQL', async () => {
  for (const modules of [[OB], [TU], [OB, TU]]) {
    const { domain, calls } = harness({ user: { id: MEMBER, email: draft.email.toUpperCase(), email_confirmed_at: '2026-01-01' },
      query: () => ({ data: { ...row, modules }, error: null }) })
    assert.deepEqual(await domain.acceptOrganizationInvitation(TOKEN, 'ignored-user-password'), { accepted: true, createdUser: false, email: draft.email, organizationId: ORG })
    assert.deepEqual(calls.accounts, [])
    assert.deepEqual(calls.rpc, [{ name: 'organization_invitation_accept', values: { p_actor: MEMBER, p_token_hash: crypto.createHash('sha256').update(TOKEN).digest('hex') } }])
  }
})

test('accept denies a different or unconfirmed session without creating another account', async () => {
  for (const user of [{ id: MEMBER, email: 'other@example.test', email_confirmed_at: '2026-01-01' }, { id: MEMBER, email: draft.email }]) {
    const { domain, calls } = harness({ user })
    await assert.rejects(domain.acceptOrganizationInvitation(TOKEN, 'some-password-12'), /INVITE_EMAIL_(MISMATCH|UNVERIFIED)/)
    assert.deepEqual(calls.accounts, [])
    assert.deepEqual(calls.rpc, [])
  }
})

test('bearer preview permits account switching while acceptance still rejects the other account', async () => {
  const { domain, calls } = harness({ user: { id: MEMBER, email: 'other@example.test', email_confirmed_at: '2026-01-01' },
    query: () => ({ data: { ...row, modules: [OB, TU] }, error: null }) })
  const preview = await domain.previewOrganizationInvitation(TOKEN)
  assert.equal(preview.hasSession, true)
  assert.equal((preview.invitation as Record<string, unknown>).email, draft.email)
  assert.deepEqual((preview.invitation as Record<string, unknown>).modules, [OB, TU])
  await assert.rejects(domain.acceptOrganizationInvitation(TOKEN), /INVITE_EMAIL_MISMATCH/)
  assert.deepEqual(calls.rpc, [])
})

test('new account requires strong length and an existing account can only use sign in', async () => {
  const weak = harness()
  await assert.rejects(weak.domain.acceptOrganizationInvitation(TOKEN, 'short'), /INVITE_PASSWORD_REQUIRED/)
  assert.deepEqual(weak.calls.accounts, [])
  const existing = harness({ createError: { code: 'email_exists', message: 'User already exists' } })
  await assert.rejects(existing.domain.acceptOrganizationInvitation(TOKEN, 'a-secure-password'), /EXISTING_USER_LOGIN_REQUIRED/)
  assert.deepEqual(existing.calls.rpc, [])
  const fresh = harness()
  const result = await fresh.domain.acceptOrganizationInvitation(TOKEN, 'a-secure-password')
  assert.equal(result.createdUser, true)
  assert.deepEqual(fresh.calls.accounts, [{ email: draft.email, password: 'a-secure-password', email_confirm: true, user_metadata: { full_name: draft.fullName } }])
})

test('revoked and expired links fail before account creation and accepted link needs session', async () => {
  for (const invalid of [{ ...row, status: 'revoked' }, { ...row, expires_at: '2000-01-01' }]) {
    const { domain, calls } = harness({ query: () => ({ data: invalid, error: null }) })
    await assert.rejects(domain.acceptOrganizationInvitation(TOKEN, 'a-secure-password'), /INVITE_INVALID/)
    assert.deepEqual(calls.accounts, [])
  }
  const accepted = harness({ query: () => ({ data: { ...row, status: 'accepted' }, error: null }) })
  await assert.rejects(accepted.domain.acceptOrganizationInvitation(TOKEN, 'a-secure-password'), /EXISTING_USER_LOGIN_REQUIRED/)
  assert.equal((await accepted.domain.previewOrganizationInvitation(TOKEN)).requiresSignIn, true)
})

test('session outage blocks account creation and failed membership after signup can be recovered by sign in', async () => {
  const outage = harness({ sessionError: { status: 503, name: 'AuthRetryableFetchError' } })
  await assert.rejects(outage.domain.acceptOrganizationInvitation(TOKEN, 'a-secure-password'), /ORG_REQUEST_FAILED/)
  assert.deepEqual(outage.calls.accounts, [])
  const partial = harness({ rpc: () => ({ data: null, error: { message: 'INVITE_INVALID' } }) })
  await assert.rejects(partial.domain.acceptOrganizationInvitation(TOKEN, 'a-secure-password'), /INVITE_ACCOUNT_CREATED/)
  assert.equal(partial.calls.accounts.length, 1)
})

test('invitation API rejects invalid org and cross-site requests before invoking the service', async () => {
  const calls: unknown[] = []
  const route = load<{ POST: (r: Request) => Promise<Response> }>('src/app/api/organizations/invitations/route.ts', {
    '@/lib/organizations/administrationHttp': http,
    '@/lib/organizations/invitations': { createOrganizationInvitation: async (...values: unknown[]) => { calls.push(values); return { saved: true } } },
  })
  assert.equal((await route.POST(request(JSON.stringify({ ...draft, orgId: 'invalid', action: 'create' })))).status, 400)
  assert.equal((await route.POST(request(JSON.stringify({ ...draft, orgId: ORG, action: 'create' }), { origin: 'https://evil.test' }))).status, 403)
  assert.deepEqual(calls, [])
  assert.equal((await route.POST(request(JSON.stringify({ ...draft, orgId: ORG, action: 'create' })))).status, 200)
  assert.equal(calls.length, 1)
})

test('public accept API refuses oversized/invalid tokens and rate-limits before calling auth', async () => {
  const calls: unknown[] = []
  const { domain } = harness()
  const route = load<{ POST: (r: Request) => Promise<Response> }>('src/app/api/organizations/invitations/accept/route.ts', {
    'node:crypto': crypto, '@/lib/organizations/administrationHttp': http,
    '@/lib/organizations/invitations': { isOrganizationInviteToken: domain.isOrganizationInviteToken, acceptOrganizationInvitation: async (...args: unknown[]) => { calls.push(args) } },
    '@/lib/besiktapp/invitationRateLimit': { createInvitationRateLimit: () => () => false },
  })
  assert.equal((await route.POST(request(JSON.stringify({ action: 'accept', token: 'bad' })))).status, 400)
  assert.equal((await route.POST(request(JSON.stringify({ action: 'accept', token: TOKEN, password: 'a-secure-password' })))).status, 429)
  assert.deepEqual(calls, [])
})
