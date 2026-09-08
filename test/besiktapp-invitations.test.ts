import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID, createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { PGlite } from '@electric-sql/pglite'
import ts from 'typescript'
// @ts-expect-error Node strip-types requires extension.
import * as contracts from '../src/lib/besiktapp/invitationContracts.ts'
// @ts-expect-error Node strip-types requires extension.
import { createInvitationRateLimit } from '../src/lib/besiktapp/invitationRateLimit.ts'
import type * as Service from '../src/lib/besiktapp/invitations'
import type * as PublicApi from '../src/app/api/besiktapp/invitations/route'
import type * as AdminApi from '../src/app/api/admin/besiktapp-invitations/route'

const nodeRequire = createRequire(import.meta.url)
function load<T>(file: string, dependencies: Record<string, unknown>): T {
  const code = ts.transpileModule(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const compiled = { exports: {} }
  new Function('require', 'module', 'exports', code)((key: string) => {
    if (key in dependencies) return dependencies[key]
    if (key === 'node:crypto') return nodeRequire(key)
    throw new Error(`Unexpected dependency ${key}`)
  }, compiled, compiled.exports)
  return compiled.exports as T
}
const draft = { request_id: randomUUID(), full_name: 'Testperson', email: 'person@example.test', organization_id: null, organization_name: 'Testbolag', modules: ['inspections'] }
test('only explicit inspector modules and a valid company choice can be invited', () => {
  assert.deepEqual(contracts.validateInvitationDraft(draft), draft)
  for (const patch of [{ modules: [] }, { modules: ['admin'] }, { modules: ['__proto__'] }, { email: 'x@example.test\nBcc:y@example.test' }, { full_name: '' }, { organization_name: '' }, { organization_id: 'bad' }]) assert.equal(contracts.validateInvitationDraft({ ...draft, ...patch }), null)
  assert.ok(contracts.validateInvitationDraft({ ...draft, organization_id: randomUUID(), organization_name: '' }))
})
test('public invitation rate brake is bounded and expires', () => {
  const permit = createInvitationRateLimit()
  for (let i = 0; i < 20; i++) assert.ok(permit('one', 1000))
  assert.equal(permit('one', 1000), false)
  assert.ok(permit('one', 601001))
})

test('atomic acceptance binds the verified user, one company and selected modules, with rollback on conflicts', async () => {
  const db = new PGlite()
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
      create table profiles(id uuid primary key,email text,full_name text,is_admin boolean default false);
      create table organizations(id uuid primary key default gen_random_uuid(),name text,created_by uuid references profiles(id));
      create table org_members(org_id uuid references organizations(id),profile_id uuid references profiles(id),role text,is_active boolean,is_default boolean,
        constraint org_members_unique_org_profile unique(org_id,profile_id));
      create unique index default_org on org_members(profile_id) where is_default;
      create table platform_products(id uuid primary key default gen_random_uuid(),key text,is_active boolean);
      create table platform_roles(id uuid primary key default gen_random_uuid(),product_id uuid,key text,is_active boolean);
      create table platform_modules(id uuid primary key default gen_random_uuid(),product_id uuid,key text,is_active boolean);
      create table platform_access_assignments(id uuid primary key default gen_random_uuid(),profile_id uuid,product_id uuid,module_id uuid,role_id uuid,scope_type text,scope_id text,is_active boolean,
        granted_by_profile_id uuid,granted_reason text,source_system text,source_record_id text);
      insert into platform_products(key,is_active) values('dashboard',true);
      insert into platform_roles(product_id,key,is_active) select id,'inspector',true from platform_products;
      insert into platform_modules(product_id,key,is_active) select id,unnest(array['inspections','construction_inspections','technical_investigations']),true from platform_products;`)
    await db.exec(readFileSync(new URL('../docs/db/2026-09-08_02_besiktapp_invitations.sql', import.meta.url), 'utf8'))
    const admin = randomUUID()
    await db.query('insert into profiles(id,email,full_name) values($1,$2,$3)', [admin, 'admin@example.test', 'Admin'])
    async function actor(email: string, confirmed = true) {
      const id = randomUUID()
      await db.query('insert into auth.users values($1,$2,$3)', [id, email, confirmed ? new Date().toISOString() : null]); return id
    }
    async function invitation(email: string, org: string | null = null, modules = ['inspections']) {
      const token = createHash('sha256').update(randomUUID()).digest('hex')
      await db.query(`insert into besiktapp_invitations(request_id,token_hash,email,full_name,organization_id,organization_name,modules,expires_at,created_by)
        values($1,$2,$3,'New name',$4,'Invited company',$5,now()+interval '7 days',$6)`, [randomUUID(), token, email, org, modules, admin]); return token
    }
    async function accept(id: string, token: string) { return db.query<{ result: { reused: boolean; organizationId: string } }>('select besiktapp_accept_invitation($1,$2) as result', [id, token]) }
    const user = await actor('first@example.test'), token = await invitation('first@example.test')
    const accepted = (await accept(user, token)).rows[0].result
    assert.equal(accepted.reused, false)
    assert.equal((await accept(user, token)).rows[0].result.reused, true)
    assert.equal((await db.query('select * from org_members where profile_id=$1', [user])).rows.length, 1)
    const grants = await db.query<{ key: string }>('select m.key from platform_access_assignments a join platform_modules m on m.id=a.module_id where a.profile_id=$1', [user])
    assert.deepEqual(grants.rows.map(row => row.key), ['inspections'])
    await db.query('update platform_access_assignments set is_active=false where profile_id=$1', [user])
    await accept(user, token)
    assert.equal((await db.query('select * from platform_access_assignments where profile_id=$1 and is_active', [user])).rows.length, 0, 'revisiting accepted invitation must not regrant revoked access')
    await assert.rejects(accept(user, await invitation('first@example.test', accepted.organizationId)), /INVITE_ACCESS_CONFLICT/)
    await assert.rejects(accept(user, await invitation('different@example.test')), /INVITE_EMAIL_MISMATCH/)
    const second = await actor('second@example.test')
    await db.query('insert into profiles values($1,$2,$3,false)', [second, 'second@example.test', 'Existing name'])
    const sameOrgToken = await invitation('second@example.test', accepted.organizationId, ['technical_investigations'])
    await accept(second, sameOrgToken)
    assert.equal((await db.query<{ full_name: string }>('select full_name from profiles where id=$1', [second])).rows[0].full_name, 'Existing name')
    for (const state of ['expired', 'revoked', 'unconfirmed', 'otherOrg', 'missingModule']) {
      const email = `${state}@example.test`, id = await actor(email, state !== 'unconfirmed'), link = await invitation(email)
      if (state === 'expired') await db.query("update besiktapp_invitations set expires_at=now()-interval '1 day' where token_hash=$1", [link])
      if (state === 'revoked') await db.query("update besiktapp_invitations set status='revoked' where token_hash=$1", [link])
      if (state === 'otherOrg') {
        await db.query('insert into profiles(id,email) values($1,$2)', [id,email])
        await db.query("insert into org_members values($1,$2,'inspector',true,true)", [accepted.organizationId,id])
      }
      if (state === 'missingModule') await db.exec("update platform_modules set is_active=false where key='inspections'")
      const before = (await db.query('select * from organizations')).rows.length
      await assert.rejects(accept(id, link), /INVITE_/)
      assert.equal((await db.query('select * from organizations')).rows.length, before)
      assert.equal((await db.query('select * from platform_access_assignments where profile_id=$1', [id])).rows.length, 0)
      await db.exec('update platform_modules set is_active=true')
    }
    const rollbackUser = await actor('rollback@example.test')
    const rollbackToken = await invitation('rollback@example.test', null, ['inspections','technical_investigations'])
    await db.exec(`create function force_grant_failure() returns trigger language plpgsql as $$ begin
      if new.module_id = (select id from public.platform_modules where key='technical_investigations') then raise exception 'simulated failure'; end if;
      return new; end; $$;
      create trigger force_grant_failure before insert on platform_access_assignments for each row execute function force_grant_failure();`)
    const orgCount = (await db.query('select * from organizations')).rows.length
    await assert.rejects(accept(rollbackUser, rollbackToken), /simulated failure/)
    assert.equal((await db.query('select * from profiles where id=$1', [rollbackUser])).rows.length, 0)
    assert.equal((await db.query('select * from organizations')).rows.length, orgCount)
    assert.equal((await db.query('select * from org_members where profile_id=$1', [rollbackUser])).rows.length, 0)
    assert.equal((await db.query('select * from platform_access_assignments where profile_id=$1', [rollbackUser])).rows.length, 0)
    for (const role of ['anon','authenticated']) {
      await db.exec(`set role ${role}`)
      await assert.rejects(db.query('select * from besiktapp_invitations'), /permission denied/)
      await assert.rejects(accept(user,token), /permission denied/)
      await db.exec('reset role')
    }
  } finally { await db.close() }
})

function serviceHarness(options: { email?: string | null; accepted?: boolean; createError?: boolean; rpcError?: boolean } = {}) {
  const calls: string[] = []
  const row = { ...draft, id: randomUUID(), organization_name: 'Testbolag', status: options.accepted ? 'accepted' : 'pending', expires_at: new Date(Date.now() + 86400000).toISOString() }
  const db = {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row, error: null }) }) }) }),
    auth: { admin: { createUser: async () => { calls.push('create'); return options.createError ? { data: { user: null }, error: { code: 'email_exists', message: 'Already exists' } } : { data: { user: { id: 'new-id' } }, error: null } } } },
    rpc: async () => { calls.push('accept'); return { data: { accepted: true }, error: options.rpcError ? { message: 'INVITE_ORG_CONFLICT' } : null } },
  }
  const service = load<typeof Service>('src/lib/besiktapp/invitations.ts', {
    'server-only': {}, '@/lib/supabase/admin': { createSupabaseAdminClient: () => db },
    '@/lib/supabase/server': { createSupabaseServerClient: () => ({ auth: { getUser: async () => ({ data: { user: options.email ? { id: 'existing-id', email: options.email } : null } }) } }) },
    '@/lib/assignments/mailer': { sendAssignmentEmail: async () => { assert.fail('Acceptance must not send email') } }, './invitationContracts': contracts,
  })
  return { service, calls }
}
test('new and existing accounts are separate, with no password reset or duplicate account takeover', async context => {
  const previous = process.env.BESIKTAPP_INVITATIONS
  context.after(() => { if (previous === undefined) delete process.env.BESIKTAPP_INVITATIONS; else process.env.BESIKTAPP_INVITATIONS = previous })
  delete process.env.BESIKTAPP_INVITATIONS
  const off = serviceHarness()
  await assert.rejects(off.service.acceptInvitation('a'.repeat(64), 'long-password'), /INVITES_DISABLED/)
  assert.deepEqual(off.calls, [])
  process.env.BESIKTAPP_INVITATIONS = '1'
  const existing = serviceHarness({ email: draft.email })
  assert.equal((await existing.service.acceptInvitation('a'.repeat(64))).createdUser, false)
  assert.deepEqual(existing.calls, ['accept'])
  const wrong = serviceHarness({ email: 'other@example.test' })
  await assert.rejects(wrong.service.acceptInvitation('a'.repeat(64)), /INVITE_EMAIL_MISMATCH/)
  assert.deepEqual(wrong.calls, [])
  const duplicate = serviceHarness({ createError: true })
  await assert.rejects(duplicate.service.acceptInvitation('a'.repeat(64), 'long-password'), /EXISTING_USER_LOGIN_REQUIRED/)
  assert.deepEqual(duplicate.calls, ['create'])
  const fresh = serviceHarness()
  assert.equal((await fresh.service.acceptInvitation('a'.repeat(64), 'long-password')).createdUser, true)
  assert.deepEqual(fresh.calls, ['create', 'accept'])
  const failed = serviceHarness({ rpcError: true })
  await assert.rejects(failed.service.acceptInvitation('a'.repeat(64), 'long-password'), /INVITE_ACCOUNT_CREATED/)
})
test('admin API authorizes before reading or changing invitations', async () => {
  for (const [error, status] of [['UNAUTHORIZED',401],['MODULE_ACCESS_REQUIRED',403]] as const) {
    const api = load<typeof AdminApi>('src/app/api/admin/besiktapp-invitations/route.ts', {
      '@/lib/access/server': { requireModuleAccess: async () => { throw new Error(error) } },
      '@/lib/besiktapp/invitations': {}, '@/lib/besiktapp/invitationContracts': contracts,
    })
    assert.equal((await api.GET(new Request('https://example.test/api'))).status, status)
    assert.equal((await api.POST(new Request('https://example.test/api', { method: 'POST' }))).status, status)
  }
})
test('public API rejects cross-origin, invalid and oversized requests before account actions', async () => {
  const api = load<typeof PublicApi>('src/app/api/besiktapp/invitations/route.ts', {
    '@/lib/besiktapp/invitations': {}, '@/lib/besiktapp/invitationContracts': contracts,
    '@/lib/besiktapp/invitationRateLimit': { createInvitationRateLimit },
  })
  function request(body: unknown, origin = 'https://example.test') { return new Request('https://example.test/api', { method: 'POST', headers: { origin, 'content-type': 'application/json' }, body: JSON.stringify(body) }) }
  assert.equal((await api.POST(request({}, 'https://evil.test'))).status, 403)
  assert.equal((await api.POST(request({ token: 'bad', action: 'accept' }))).status, 400)
  assert.equal((await api.POST(request({ padding: 'a'.repeat(5000) }))).status, 413)
})

test('sending stores only token hashes, retries do not duplicate and replacement links invalidate old hashes', async context => {
  const values = { BESIKTAPP_INVITATIONS: '1', APP_BASE_URL: 'https://example.test', ASSIGNMENTS_MAIL_FROM: 'Test <test@example.test>', RESEND_API_KEY: 'fake' }
  const previous = Object.fromEntries(Object.keys(values).map(key => [key, process.env[key]]))
  Object.assign(process.env, values)
  context.after(() => { for (const [key,value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value } })
  const rows: Record<string, unknown>[] = [], emails: { text: string; html: string }[] = []
  const db = { from: () => {
    let operation = '', payload: Record<string, unknown> = {}; const filters: Array<[string,unknown]> = []
    function run() {
      if (operation === 'insert') {
        if (rows.some(row => row.request_id === payload.request_id)) return { data: null, error: { code: '23505' } }
        const row = { ...payload, id: randomUUID(), revision: 0, status: 'pending' }; rows.push(row); return { data: { ...row }, error: null }
      }
      const row = rows.find(row => filters.every(([key,value]) => row[key] === value))
      if (row) Object.assign(row, payload)
      return { data: row ? { ...row } : null, error: null }
    }
    const query = {
      insert(value: Record<string,unknown>) { operation = 'insert'; payload = value; return query },
      update(value: Record<string,unknown>) { operation = 'update'; payload = value; return query },
      select() { return query }, eq(key: string,value: unknown) { filters.push([key,value]); return query },
      single: async () => run(), maybeSingle: async () => run(), then(resolve: (value: ReturnType<typeof run>) => unknown) { return Promise.resolve(resolve(run())) },
    }; return query
  } }
  const service = load<typeof Service>('src/lib/besiktapp/invitations.ts', {
    'server-only': {}, '@/lib/supabase/admin': { createSupabaseAdminClient: () => db }, '@/lib/supabase/server': {},
    '@/lib/assignments/mailer': { sendAssignmentEmail: async (input: { text: string; html: string }) => { emails.push(input); return { providerMessageId: 'fake-id' } } }, './invitationContracts': contracts,
  })
  const input = contracts.validateInvitationDraft({ ...draft, full_name: '<script>name</script>' })!
  await service.createInvitation(input, randomUUID())
  assert.equal(emails.length, 1); assert.doesNotMatch(emails[0].html, /<script>/)
  const token = /#invite=([a-f0-9]{64})/.exec(emails[0].text)![1]
  assert.equal(rows[0].token_hash, createHash('sha256').update(token).digest('hex'))
  assert.ok(!JSON.stringify(rows).includes(token))
  await service.createInvitation(input, randomUUID()); assert.equal(emails.length, 1)
  await service.changeInvitation(String(rows[0].id), 0, 'resend')
  assert.equal(emails.length, 2); assert.notEqual(rows[0].token_hash, createHash('sha256').update(token).digest('hex'))
  await assert.rejects(service.changeInvitation(String(rows[0].id), 0, 'resend'), /INVITE_CONFLICT/)
  await service.changeInvitation(String(rows[0].id), 1, 'revoke'); assert.equal(rows[0].status, 'revoked')
  await assert.rejects(service.changeInvitation(String(rows[0].id), 2, 'resend'), /INVITE_CONFLICT/)
  assert.equal(emails.length, 2)
})
