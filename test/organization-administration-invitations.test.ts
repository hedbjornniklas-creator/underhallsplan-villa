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
const TU = 'technical_investigations'
const draft = { requestId: REQUEST, email: 'member@example.test', fullName: 'Anna Medlem', role: 'inspector', modules: [TU] }
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
      const run = () => options.query?.(call) ?? { data: row, error: null }
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
})

test('draft accepts canonical TU only and rejects elevated/global roles or invalid versions', async () => {
  const { domain, calls } = harness()
  assert.deepEqual(domain.parseOrganizationInvitationDraft({ ...draft, email: ' Member@Example.Test ' }), { ...draft, email: 'member@example.test' })
  for (const change of [{ modules: ['tu'] }, { modules: ['inspections'] }, { modules: [TU, TU] }, { role: 'superadmin' }, { modules: [] }, { email: 'member@example.test\r\nBCC:evil' }]) {
    assert.throws(() => domain.parseOrganizationInvitationDraft({ ...draft, ...change }), /ORG_REQUEST_INVALID/)
  }
  await assert.rejects(domain.changeOrganizationInvitation(ORG, { action: 'revoke', id: INVITE, revision: -1 }), /ORG_REQUEST_INVALID/)
  assert.deepEqual(calls.rpc, [])
})

test('cross-organization and non-admin callers are rejected before service-role reads or mutations', async () => {
  const { domain, calls } = harness({ roleError: 'ORG_ADMIN_REQUIRED' })
  for (const operation of [() => domain.listOrganizationMembers(ORG), () => domain.listOrganizationInvitations(ORG),
    () => domain.createOrganizationInvitation(ORG, draft), () => domain.updateOrganizationMember(ORG, { profileId: MEMBER, role: 'admin', modules: [TU], isActive: true })]) {
    await assert.rejects(operation(), /ORG_ADMIN_REQUIRED/)
  }
  assert.equal(calls.contexts.length, 4)
  assert.deepEqual(calls.queries, [])
  assert.deepEqual(calls.rpc, [])
})

test('member updates derive actor and org from checked context and ignore browser actor claims', async () => {
  const { domain, calls } = harness({ rpc: () => ({ data: { saved: true }, error: null }) })
  await domain.updateOrganizationMember(ORG, { profileId: MEMBER, actorProfileId: MEMBER, role: 'inspector', isActive: false, modules: [] })
  assert.deepEqual(calls.rpc, [{ name: 'organization_member_update', values: { p_actor: ACTOR, p_org: ORG, p_profile: MEMBER, p_values: { role: 'inspector', isActive: false, modules: [] } } }])
})

test('disabled organizational module cannot be granted by invitations or membership edits', async () => {
  const { domain, calls } = harness({ modules: [] })
  await assert.rejects(domain.createOrganizationInvitation(ORG, draft), /ORG_MODULE_NOT_ENABLED/)
  await assert.rejects(domain.updateOrganizationMember(ORG, { profileId: MEMBER, role: 'inspector', isActive: true, modules: [TU] }), /ORG_MODULE_NOT_ENABLED/)
  assert.deepEqual(calls.rpc, [])
})

test('member list includes only active unexpired exact-org TU grants and invite list redacts token hashes', async () => {
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
  assert.ok(calls.queries[2].ops.some(op => op.name === 'eq' && op.args[0] === 'org_id' && op.args[1] === ORG))
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
  const { domain, calls } = harness({
    rpc: (_name, input) => {
      stored ??= { ...row, token_hash: (input.p_values as Record<string, unknown>).tokenHash }
      return { data: stored, error: null }
    },
    query: () => ({ data: { id: INVITE }, error: null }),
  })
  await domain.createOrganizationInvitation(ORG, { ...draft, actorProfileId: MEMBER })
  await domain.createOrganizationInvitation(ORG, draft)
  assert.equal(sent.length, 1)
  assert.equal(sent[0].headers.get('idempotency-key'), `organization-invite/${INVITE}/0`)
  assert.match(String(sent[0].body.text), /https:\/\/hushub\.se\/organisation\/inbjudan#invite=[a-f0-9]{64}/)
  assert.equal(calls.rpc[0].values.p_actor, ACTOR)
  assert.ok(calls.queries[0].ops.some(op => op.name === 'eq' && op.args[0] === 'notification_state' && op.args[1] === 'pending'))
  assert.ok(calls.queries[1].ops.some(op => op.name === 'eq' && op.args[0] === 'notification_state' && op.args[1] === 'sending'))
})

test('accept existing verified session preserves its credentials and delegates atomic membership to SQL', async () => {
  const { domain, calls } = harness({ user: { id: MEMBER, email: draft.email, email_confirmed_at: '2026-01-01' } })
  assert.deepEqual(await domain.acceptOrganizationInvitation(TOKEN, 'ignored-user-password'), { accepted: true, createdUser: false, email: draft.email, organizationId: ORG })
  assert.deepEqual(calls.accounts, [])
  assert.deepEqual(calls.rpc, [{ name: 'organization_invitation_accept', values: { p_actor: MEMBER, p_token_hash: crypto.createHash('sha256').update(TOKEN).digest('hex') } }])
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
  const { domain, calls } = harness({ user: { id: MEMBER, email: 'other@example.test', email_confirmed_at: '2026-01-01' } })
  const preview = await domain.previewOrganizationInvitation(TOKEN)
  assert.equal(preview.hasSession, true)
  assert.equal((preview.invitation as Record<string, unknown>).email, draft.email)
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
