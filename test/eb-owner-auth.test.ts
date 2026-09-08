import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import { createHmac, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { PGlite } from '@electric-sql/pglite'
import ts from 'typescript'
import type * as OwnerAuth from '../src/lib/eb/ownerAuth'
import type * as Delivery from '../src/lib/eb/followUpDelivery'
import type * as Remediation from '../src/lib/eb/remediation'
import type * as CustomerSession from '../src/lib/eb/customerSession'
import type * as PortalApi from '../src/app/api/eb/remediation/[token]/route'
import type * as ImageApi from '../src/app/api/eb/remediation/[token]/images/route'

const require = createRequire(import.meta.url)
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
function load<T>(path: string, dependencies: Record<string, unknown>): T {
  const output = ts.transpileModule(read(path), { fileName: path, compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText
  const compiledModule = { exports: {} }
  new Function('require', 'module', 'exports', output)((name: string) => {
    if (name in dependencies) return dependencies[name]
    if (name.startsWith('node:') || name === 'react/jsx-runtime') return require(name)
    throw new Error(`Unexpected owner-auth test dependency: ${name}`)
  }, compiledModule, compiledModule.exports)
  return compiledModule.exports as T
}

const db = new PGlite()
const org = randomUUID()
const secret = 'owner-verification-test-only-secret'
const previousSecret = process.env.EB_FOLLOW_UP_EMAIL_ENCRYPTION_KEY
const commonMailDependencies = {
  '@/lib/assignments/mailer': { sendAssignmentEmail: () => { throw new Error('NO_REAL_MAIL') } },
  '@/lib/supabase/admin': { createSupabaseAdminClient: () => { throw new Error('NO_LIVE_DATABASE') } },
  '@/lib/eb/followUp': load('src/lib/eb/followUp.ts', {}),
}
const delivery = load<typeof Delivery>('src/lib/eb/followUpDelivery.ts', commonMailDependencies)
const sessionHelpers = load<typeof CustomerSession>('src/lib/eb/customerSession.ts', {
  'next/headers': { cookies: () => { throw new Error('NO_REAL_COOKIES') } },
})

before(async () => {
  process.env.EB_FOLLOW_UP_EMAIL_ENCRYPTION_KEY = secret
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table organizations(id uuid primary key);
    create table profiles(id uuid primary key);
    create table eb_projects(id uuid primary key,org_id uuid references organizations);
    create table inspections(id uuid primary key);
    create table eb_notes(id uuid primary key,org_id uuid references organizations,eb_project_id uuid references eb_projects,
      inspection_id uuid references inspections,trade_group text,responsible_party text,note_text text);
    create table inspection_report_links(id uuid primary key,org_id uuid references organizations,
      inspection_id uuid references inspections,snapshot_payload jsonb,revoked_at timestamptz,created_at timestamptz default now());
    create function eb_set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at:=clock_timestamp();return new;end $$;
    create function is_org_member(uuid) returns boolean language sql stable as $$ select true $$;
    create schema storage;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
  `)
  await db.exec(read('docs/db/2026-08-15_01_eb_remediation_portal.sql'))
  await db.exec('alter table eb_remediation_access_links add column inspection_id uuid references inspections;')
  await db.exec(read('docs/db/2026-09-07_07_eb_follow_up_orders.sql'))
  await db.exec(read('docs/db/2026-09-08_02_eb_follow_up_owner_verification.sql'))
  await db.exec(read('docs/db/2026-09-08_02_eb_follow_up_owner_verification.sql'))
  await db.query('insert into organizations(id) values($1)', [org])
  await db.exec(`create function test_reject_owner_mail() returns trigger language plpgsql as $$
    begin if current_setting('test.reject_owner_mail',true)='yes' then raise exception 'TEST_OWNER_MAIL_FAILED'; end if; return new; end $$;
    create trigger test_reject_owner_mail before insert on eb_follow_up_email_outbox for each row execute function test_reject_owner_mail();`)
})
after(async () => {
  await db.close()
  if (previousSecret === undefined) delete process.env.EB_FOLLOW_UP_EMAIL_ENCRYPTION_KEY
  else process.env.EB_FOLLOW_UP_EMAIL_ENCRYPTION_KEY = previousSecret
})

type Row = Record<string, unknown>
const hash = (id: string, code: string) => createHmac('sha256', secret).update(`eb-follow-up-code-v1:${id}:${code}`).digest('hex')

async function fixture() {
  const project = randomUUID(), inspection = randomUUID(), report = randomUUID(), order = randomUUID()
  const owner = randomUUID(), otherOwner = randomUUID(), worker = randomUUID()
  const token = randomUUID().replaceAll('-', ''), otherToken = randomUUID().replaceAll('-', ''), workerToken = randomUUID().replaceAll('-', '')
  const email = 'frozen-buyer@example.test'
  await db.query('insert into eb_projects values($1,$2)', [project, org])
  await db.query('insert into inspections values($1)', [inspection])
  await db.query("insert into inspection_report_links(id,org_id,inspection_id,snapshot_payload,revoked_at) values($1,$2,$3,'{}',now())", [report, org, inspection])
  await db.query(`insert into eb_follow_up_orders(id,org_id,eb_project_id,inspection_id,report_link_id,report_snapshot,
    buyer_snapshot,seller_snapshot,terms_version,accept_terms,request_immediate_start,accept_invoice)
    values($1,$2,$3,$4,$5,'{}',$6,$7,'2026-09-07',true,true,true)`, [order, org, project, inspection, report,
    { name: 'PRIVATE BUYER', email, invoiceAddress: 'PRIVATE BILLING' }, { email: 'seller@example.test' }])
  for (const [id, bearer, role] of [[owner, token, 'customer_owner'], [otherOwner, otherToken, 'customer_owner'], [worker, workerToken, 'contractor_viewer']]) {
    await db.query(`insert into eb_remediation_access_links(id,org_id,eb_project_id,inspection_id,follow_up_order_id,role,email,token_hash,expires_at)
      values($1,$2,$3,$4,$5,$6,$7,$8,now()+interval '180 days')`, [id, org, project, inspection, order, role, email, `hashed:${bearer}`])
  }
  const calls: string[] = []
  const state = { session: null as CustomerSession.EbCustomerSession | null, failRead: false }
  const saved: CustomerSession.EbCustomerSession[] = []
  const admin = {
    from: (table: string) => {
      calls.push(`read:${table}`)
      assert.ok(['eb_remediation_access_links', 'eb_follow_up_orders', 'eb_follow_up_challenges'].includes(table), `Private data was read before authorization: ${table}`)
      let columns = '*'
      const values: unknown[] = []
      const clauses: string[] = []
      const query = {
        select: (select: string) => { assert.match(select, /^[a-z_,]+$/); columns = select; return query },
        eq: (key: string, value: unknown) => { assert.match(key, /^[a-z_]+$/); values.push(value); clauses.push(`${key}=$${values.length}`); return query },
        is: (key: string, value: unknown) => { assert.equal(value, null); assert.match(key, /^[a-z_]+$/); clauses.push(`${key} is null`); return query },
        maybeSingle: async () => {
          if (state.failRead) return { data: null, error: { message: 'SECRET_DB_ERROR' } }
          const result = await db.query<Row>(`select ${columns} from ${table} where ${clauses.join(' and ')} limit 1`, values)
          // Supabase returns timestamps as strings, while PGlite uses Date objects.
          return { data: result.rows[0] ? JSON.parse(JSON.stringify(result.rows[0])) : null, error: null }
        },
      }
      return query
    },
    rpc: async (name: string, params: Row) => {
      calls.push(`rpc:${name}`)
      try {
        if (name === 'eb_request_follow_up_owner_challenge') {
          const result = await db.query<{ result: Row }>('select eb_request_follow_up_owner_challenge($1,$2,$3,$4,$5) result',
            [params.p_id, params.p_access_link_id, params.p_email, params.p_code_hash, params.p_mail_ciphertext])
          return { data: result.rows[0].result, error: null }
        }
        assert.equal(name, 'eb_verify_follow_up_challenge')
        const result = await db.query<{ result: Row }>('select eb_verify_follow_up_challenge($1,$2,$3) result',
          [params.p_id, params.p_report_link_id, params.p_code_hash])
        return { data: result.rows[0].result, error: null }
      } catch (error) { return { data: null, error: { message: String(error) } } }
    },
  }
  const auth = load<typeof OwnerAuth>('src/lib/eb/ownerAuth.ts', {
    '@/lib/assignments/tokens': { hashAssignmentToken: (value: string) => `hashed:${value}` },
    '@/lib/supabase/admin': { createSupabaseAdminClient: () => admin },
    '@/lib/eb/followUp': commonMailDependencies['@/lib/eb/followUp'],
    '@/lib/eb/followUpDelivery': delivery,
    '@/lib/eb/customerSession': {
      readEbCustomerSession: async () => state.session,
      setEbCustomerSession: async (session: CustomerSession.EbCustomerSession) => { saved.push(session); state.session = session },
    },
  })
  const access = async (id = owner) => JSON.parse(JSON.stringify((await db.query('select * from eb_remediation_access_links where id=$1', [id])).rows[0]))
  const session = (patch: Partial<CustomerSession.EbCustomerSession> = {}) => ({
    orgId: org, inspectionId: inspection, email, kind: 'owner' as const, expiresAt: Date.now() + 3600_000, ...patch,
  })
  const request = async (bearer = token) => auth.requestEbOwnerAccessCode({ token: bearer })
  const code = async (id: string) => {
    const job = (await db.query<{ payload_ciphertext: string }>('select payload_ciphertext from eb_follow_up_email_outbox where dedupe_key=$1', [`owner-challenge:${id}`])).rows[0]
    assert.ok(job)
    const mail = delivery.decryptEbFollowUpPayload<Delivery.EbFollowUpEmail>(job.payload_ciphertext)
    assert.equal(mail.to, email)
    return { value: /är (\d{6})\./.exec(mail.text)![1], mail, job }
  }
  return { project, inspection, report, order, owner, otherOwner, worker, token, otherToken, workerToken, email,
    calls, state, saved, admin, auth, access, session, request, code }
}

test('paid owner access uses its personal scoped bearer link without an email code or cookie', async () => {
  const f = await fixture()
  await f.auth.assertEbRemediationOwnerSession(await f.access())
  await f.auth.assertEbRemediationOwnerSession(await f.access(f.worker))
  assert.equal(f.saved.length, 0)
  for (const kind of ['report', 'owner'] as const) {
    f.state.session = f.session({ kind })
    await f.auth.assertEbRemediationOwnerSession(await f.access())
  }
  for (const patch of [{ orgId: randomUUID() }, { inspectionId: randomUUID() }, { email: 'forwarded@example.test' }, { expiresAt: Date.now() - 1 }]) {
    f.state.session = f.session(patch)
    await f.auth.assertEbRemediationOwnerSession(await f.access())
  }
})

test('revoked, expired, mismatched and unavailable owner records fail closed before session access', async () => {
  const f = await fixture()
  f.state.session = f.session()
  const access = await f.access()
  await assert.rejects(f.auth.assertEbRemediationOwnerSession({ ...access, revoked_at: new Date().toISOString() }), /ACCESS_REVOKED/)
  for (const expires_at of ['invalid', new Date(Date.now() - 1).toISOString()]) {
    await assert.rejects(f.auth.assertEbRemediationOwnerSession({ ...access, expires_at }), /OWNER_LINK_EXPIRED/)
  }
  for (const patch of [{ email: 'other@example.test' }, { org_id: randomUUID() }, { inspection_id: randomUUID() }, { follow_up_order_id: null }]) {
    await assert.rejects(f.auth.assertEbRemediationOwnerSession({ ...access, ...patch }), /ACTION_FORBIDDEN/)
  }
  f.state.failRead = true
  await assert.rejects(f.auth.assertEbRemediationOwnerSession(access), /EB_FOLLOW_UP_UNAVAILABLE/)
})

test('owner OTP uses the frozen buyer and purchased report even after public report revocation, and grants an eight-hour session', async () => {
  const f = await fixture()
  const result = await f.request()
  assert.deepEqual(Object.keys(result).sort(), ['challengeId', 'message'])
  assert.doesNotMatch(JSON.stringify(result), /frozen-buyer|PRIVATE|seller@example/)
  const { value, mail, job } = await f.code(result.challengeId)
  assert.ok(mail.expiresAt)
  assert.doesNotMatch(job.payload_ciphertext, new RegExp(value))
  const challenge = (await db.query<Row>('select * from eb_follow_up_challenges where id=$1', [result.challengeId])).rows[0]
  assert.equal(challenge.purpose, 'owner')
  assert.equal(challenge.owner_access_link_id, f.owner)
  assert.equal(challenge.report_link_id, f.report)
  assert.equal(challenge.code_hash, hash(result.challengeId, value))
  const beforeVerify = Date.now()
  assert.deepEqual(await f.auth.verifyEbOwnerAccessCode({ token: f.token, challengeId: result.challengeId, code: value }), { verified: true })
  assert.equal(f.saved.length, 1)
  assert.equal(f.saved[0].email, f.email)
  assert.equal(f.saved[0].kind, 'owner')
  assert.equal(f.saved[0].portalPath, `/atgarder/${f.token}`)
  assert.ok(f.saved[0].expiresAt >= beforeVerify + 8 * 3600_000)
  assert.ok(f.saved[0].expiresAt <= Date.now() + 8 * 3600_000)
  await f.auth.assertEbRemediationOwnerSession(await f.access())
  f.state.session = null // Same link forwarded to a different browser.
  await f.auth.assertEbRemediationOwnerSession(await f.access())
  assert.equal((await db.query('select id from eb_follow_up_orders where inspection_id=$1', [f.inspection])).rows.length, 1)
  assert.deepEqual((await db.query<{ kind: string }>('select kind from eb_follow_up_email_outbox where order_id=$1', [f.order])).rows.map(row => row.kind), ['verification'])
})

test('invalid, contractor, expired and revoked owner-link code requests disclose no address and queue no mail', async () => {
  const f = await fixture()
  for (const token of ['', 'unknown'.padEnd(32, '-'), f.workerToken]) {
    const result = await f.request(token)
    assert.deepEqual(Object.keys(result).sort(), ['challengeId', 'message'])
    assert.doesNotMatch(JSON.stringify(result), /frozen-buyer|PRIVATE/)
  }
  await db.query("update eb_remediation_access_links set expires_at=now()-interval '1 second' where id=$1", [f.owner])
  await f.request()
  await db.query('update eb_remediation_access_links set revoked_at=now() where id=$1', [f.otherOwner])
  await f.request(f.otherToken)
  assert.equal((await db.query('select id from eb_follow_up_email_outbox where order_id=$1', [f.order])).rows.length, 0)
  assert.equal((await db.query('select id from eb_follow_up_challenges where inspection_id=$1', [f.inspection])).rows.length, 0)
})

test('owner verification rejects report-purpose codes, another owner link, mismatched scope and wrong codes', async () => {
  const f = await fixture()
  const issued = await f.request(), otp = await f.code(issued.challengeId)
  const valid = { token: f.token, challengeId: issued.challengeId, code: otp.value }
  assert.deepEqual(await f.auth.verifyEbOwnerAccessCode({ ...valid, token: f.otherToken }), { verified: false })
  const reportChallenge = randomUUID()
  await db.query(`insert into eb_follow_up_challenges(id,org_id,inspection_id,report_link_id,email,code_hash,eligible)
    values($1,$2,$3,$4,$5,$6,true)`, [reportChallenge, org, f.inspection, f.report, f.email, hash(reportChallenge, '123456')])
  assert.deepEqual(await f.auth.verifyEbOwnerAccessCode({ ...valid, challengeId: reportChallenge, code: '123456' }), { verified: false })
  for (const patch of [{ challengeId: '' }, { code: '1' }, { code: 123456 }, { challengeId: randomUUID() }]) {
    assert.deepEqual(await f.auth.verifyEbOwnerAccessCode({ ...valid, ...patch }), { verified: false })
  }
  for (let attempt = 0; attempt < 5; attempt++) {
    assert.deepEqual(await f.auth.verifyEbOwnerAccessCode({ ...valid, code: otp.value === '000000' ? '111111' : '000000' }), { verified: false })
  }
  assert.deepEqual(await f.auth.verifyEbOwnerAccessCode(valid), { verified: false })
  assert.equal(f.saved.length, 0)
  assert.equal((await db.query<{ attempts: number }>('select attempts from eb_follow_up_challenges where id=$1', [issued.challengeId])).rows[0].attempts, 5)
})

test('expired owner codes do not grant a session', async () => {
  const f = await fixture()
  const issued = await f.request(), otp = await f.code(issued.challengeId)
  await db.query("update eb_follow_up_challenges set expires_at=now()-interval '1 second' where id=$1", [issued.challengeId])
  assert.deepEqual(await f.auth.verifyEbOwnerAccessCode({ token: f.token, challengeId: issued.challengeId, code: otp.value }), { verified: false })
  assert.equal(f.saved.length, 0)
})

test('owner code requests share cooldown and five-per-email hourly limits across renewed links', async () => {
  const f = await fixture()
  await f.request()
  await assert.rejects(f.request(f.otherToken), /RATE_LIMITED/)
  for (let count = 1; count < 5; count++) {
    await db.query("update eb_follow_up_challenges set created_at=now()-interval '2 minutes' where inspection_id=$1", [f.inspection])
    await f.request(count % 2 ? f.otherToken : f.token)
  }
  await db.query("update eb_follow_up_challenges set created_at=now()-interval '2 minutes' where inspection_id=$1", [f.inspection])
  await assert.rejects(f.request(), /RATE_LIMITED/)
  assert.equal((await db.query('select id from eb_follow_up_challenges where inspection_id=$1', [f.inspection])).rows.length, 5)
})

test('twenty-per-inspection hourly limit includes earlier report verification attempts', async () => {
  const f = await fixture()
  for (let index = 0; index < 20; index++) await db.query(`insert into eb_follow_up_challenges(id,org_id,inspection_id,report_link_id,email,code_hash,eligible,created_at)
    values($1,$2,$3,$4,$5,$6,false,now()-interval '2 minutes')`, [randomUUID(), org, f.inspection, f.report, `other-${index}@example.test`, 'a'.repeat(64)])
  await assert.rejects(f.request(), /RATE_LIMITED/)
  assert.equal((await db.query('select id from eb_follow_up_email_outbox where order_id=$1', [f.order])).rows.length, 0)
})

test('owner OTP queue failure rolls back the challenge and does not consume a session', async () => {
  const f = await fixture()
  await db.exec("set test.reject_owner_mail='yes'")
  try { await assert.rejects(f.request(), /EB_FOLLOW_UP_UNAVAILABLE/) }
  finally { await db.exec("set test.reject_owner_mail='no'") }
  assert.equal((await db.query('select id from eb_follow_up_challenges where inspection_id=$1', [f.inspection])).rows.length, 0)
  assert.equal(f.saved.length, 0)
  await f.request()
})

test('database validates owner/frozen-email scope and denies direct browser RPC access', async () => {
  const f = await fixture()
  for (const [accessId, email] of [[f.worker, f.email], [f.owner, 'attacker@example.test']]) {
    const result = await db.query<{ result: Row }>('select eb_request_follow_up_owner_challenge($1,$2,$3,$4,$5) result', [randomUUID(), accessId, email, 'a'.repeat(64), 'encrypted-mail'])
    assert.deepEqual(result.rows[0].result, { limited: false })
  }
  assert.equal((await db.query('select id from eb_follow_up_challenges where inspection_id=$1', [f.inspection])).rows.length, 0)
  for (const role of ['anon', 'authenticated']) {
    const access = await db.query<{ allowed: boolean }>("select has_function_privilege($1,'eb_request_follow_up_owner_challenge(uuid,uuid,text,text,text)','EXECUTE') allowed", [role])
    assert.equal(access.rows[0].allowed, false)
  }
})

async function protectedFixture() {
  const f = await fixture()
  const service = load<typeof Remediation>('src/lib/eb/remediation.ts', {
    sharp: () => { throw new Error('PRIVATE_IMAGE_TRANSFORM') },
    '@/lib/assignments/tokens': { hashAssignmentToken: (value: string) => `hashed:${value}` },
    '@/lib/assignments/mailer': {},
    '@/lib/eb/server': { getEbProjectById: () => { f.calls.push('PRIVATE_PROJECT_READ'); throw new Error('PRIVATE_PROJECT_READ') } },
    '@/lib/supabase/admin': { createSupabaseAdminClient: () => f.admin },
    '@/lib/eb/remediationPolicy': load('src/lib/eb/remediationPolicy.ts', {}),
    '@/lib/eb/remediationDefaults': load('src/lib/eb/remediationDefaults.ts', {}),
    '@/lib/eb/reportSnapshot': {}, '@/lib/eb/followUpDelivery': {}, '@/lib/eb/followUpServer': {},
    '@/lib/eb/ownerAuth': f.auth,
  })
  const next = { NextResponse: { json: (body: unknown, init?: ResponseInit) => Response.json(body, init) } }
  const api = load<typeof PortalApi>('src/app/api/eb/remediation/[token]/route.ts', {
    'next/server': next, '@/lib/eb/remediation': service, '@/lib/eb/ownerAuth': f.auth,
    '@/lib/eb/customerSession': sessionHelpers,
    '@/lib/eb/followUpServer': { requestEbFollowUpOwnerRenewal: async () => ({ message: 'Om länken kan förnyas skickas en ny personlig länk.' }) },
  })
  const images = load<typeof ImageApi>('src/app/api/eb/remediation/[token]/images/route.ts', {
    'next/server': next, '@/lib/eb/remediation': service, '@/lib/eb/customerSession': sessionHelpers,
  })
  const context = { params: Promise.resolve({ token: f.token }) }
  return { ...f, service, api, images, context }
}

test('the actual workspace, mutation and image upload services stop before private reads for revoked owner links', async () => {
  const f = await protectedFixture()
  await db.query('update eb_remediation_access_links set revoked_at=now() where id=$1', [f.owner])
  await assert.rejects(f.service.getEbRemediationWorkspaceByToken(f.token), /ACCESS_REVOKED/)
  await assert.rejects(f.service.performEbRemediationTokenAction({ token: f.token, action: 'comment', payload: {
    taskId: randomUUID(), message: 'forged', session: f.session(),
  } }), /ACCESS_REVOKED/)
  await assert.rejects(f.service.uploadEbRemediationImageByToken({ token: f.token, taskId: randomUUID(),
    file: new File(['not-read'], 'photo.png', { type: 'image/png' }) }), /ACCESS_REVOKED/)
  assert.equal(f.calls.includes('PRIVATE_PROJECT_READ'), false)
  assert.ok(f.calls.every(call => ['read:eb_remediation_access_links', 'read:eb_follow_up_orders'].includes(call)))
  await db.query('update eb_remediation_access_links set revoked_at=null where id=$1', [f.owner])
  await assert.rejects(f.service.getEbRemediationWorkspaceByToken(f.token), /PRIVATE_PROJECT_READ/)
})

test('HTTP workspace and image routes reject revoked links and cross-site posts without private payloads', async () => {
  const f = await protectedFixture()
  await db.query('update eb_remediation_access_links set revoked_at=now() where id=$1', [f.owner])
  const get = await f.api.GET(new Request('https://example.test/api/owner'), f.context)
  assert.equal(get.status, 410)
  assert.match(get.headers.get('cache-control') ?? '', /no-store/)
  const post = await f.api.POST(new Request('https://example.test/api/owner', {
    method: 'POST', headers: { Origin: 'https://example.test', 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'withdraw_order', session: f.session(), payload: { session: f.session() } }),
  }), f.context)
  assert.equal(post.status, 410)
  const form = new FormData()
  form.set('taskId', randomUUID()); form.set('file', new File(['image'], 'photo.png', { type: 'image/png' }))
  const image = await f.images.POST(new Request('https://example.test/api/owner/images', {
    method: 'POST', headers: { Origin: 'https://example.test' }, body: form,
  }), f.context)
  assert.equal(image.status, 410)
  for (const response of [get, post, image]) assert.doesNotMatch(await response.text(), /PRIVATE|frozen-buyer|workspace|invoiceAddress/)
  f.calls.length = 0
  for (const origin of ['https://attacker.test', '']) {
    const response = await f.api.POST(new Request('https://example.test/api/owner', {
      method: 'POST', headers: origin ? { Origin: origin } : {}, body: '{}',
    }), f.context)
    assert.equal(response.status, 403)
    const image = await f.images.POST(new Request('https://example.test/api/owner/images', {
      method: 'POST', headers: origin ? { Origin: origin } : {}, body: '',
    }), f.context)
    assert.equal(image.status, 403)
  }
  assert.deepEqual(f.calls, [])
})

test('expired-link renewal returns only generic metadata and the API no longer exposes OTP actions', async () => {
  const f = await protectedFixture()
  const post = (action: string, payload: Row = {}) => f.api.POST(new Request('https://example.test/api/owner', {
    method: 'POST', headers: { Origin: 'https://example.test', 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, payload }),
  }), f.context)
  assert.doesNotMatch(read('src/app/api/eb/remediation/[token]/route.ts'), /request_owner_code|verify_owner_code/)
  const renewed = await (await post('renew_owner_link')).json()
  assert.deepEqual(Object.keys(renewed), ['message'])
  assert.doesNotMatch(JSON.stringify(renewed), /PRIVATE|frozen-buyer|workspace|invoiceAddress/)
})

test('an expired owner link renders only a renewal gate without customer details or OTP fields', async () => {
  const verifier = () => null
  const portal = () => null
  type Page = { default: (props: { params: Promise<{ token: string }> }) => Promise<{ type: unknown; props: Row }> }
  for (const message of ['EB_REMEDIATION_OWNER_LINK_EXPIRED']) {
    const page = load<Page>('src/app/atgarder/[token]/page.tsx', {
      'next/navigation': { notFound: () => { throw new Error('NOT_FOUND') } },
      '@/components/eb/EbOwnerAccessVerifier': { __esModule: true, default: verifier },
      '@/components/eb/EbRemediationPortalClient': { __esModule: true, default: portal },
      '@/lib/eb/remediation': { getEbRemediationWorkspaceByToken: async () => { throw new Error(message) } },
    })
    const rendered = await page.default({ params: Promise.resolve({ token: 'test-token' }) })
    assert.equal(rendered.type, verifier)
    assert.deepEqual(rendered.props, { endpoint: '/api/eb/remediation/test-token' })
  }
  assert.doesNotMatch(read('src/components/eb/EbOwnerAccessVerifier.tsx'), /engångskod|request_owner_code|verify_owner_code|one-time-code/)
})
