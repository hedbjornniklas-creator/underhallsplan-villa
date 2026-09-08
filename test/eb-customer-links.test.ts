import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { PGlite } from '@electric-sql/pglite'
import ts from 'typescript'
import type * as Links from '../src/lib/eb/customerLinks'
import type { EbCustomerSession } from '../src/lib/eb/customerSession'

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const require = createRequire(import.meta.url)
const db = new PGlite()
const secret = process.env.EB_FOLLOW_UP_EMAIL_ENCRYPTION_KEY
const hash = (value: string) => createHash('sha256').update(value).digest('hex')
before(async () => {
  process.env.EB_FOLLOW_UP_EMAIL_ENCRYPTION_KEY = 'isolated-personal-link-test'
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table organizations(id uuid primary key);
    create table inspections(id uuid primary key);
    create table eb_projects(id uuid primary key);
    create table eb_inspection_details(inspection_id uuid primary key,org_id uuid,eb_project_id uuid);
    create table inspection_report_links(id uuid primary key,org_id uuid,inspection_id uuid,token_hash text,revoked_at timestamptz);
    create table eb_follow_up_customers(inspection_id uuid,org_id uuid,eb_project_id uuid,email text);
    create table eb_follow_up_orders(id uuid primary key,inspection_id uuid,org_id uuid,eb_project_id uuid,buyer_snapshot jsonb,status text default 'active');
    create table eb_remediation_access_links(id uuid primary key,token_hash text,role text,org_id uuid,
      inspection_id uuid,email text,follow_up_order_id uuid,expires_at timestamptz,revoked_at timestamptz);
    create table eb_follow_up_challenges(id uuid primary key,org_id uuid,inspection_id uuid,report_link_id uuid,email text,
      code_hash text,eligible boolean,verified_at timestamptz,expires_at timestamptz,purpose text,completed_order_id uuid);
    create table eb_follow_up_email_outbox(dedupe_key text unique,kind text,payload_ciphertext text);
    create function eb_resolve_follow_up_customer_email(uuid,uuid,uuid) returns text language sql as $$
      select email from eb_follow_up_customers where org_id=$1 and eb_project_id=$2 and inspection_id=$3 $$;
  `)
  await db.exec(read('docs/db/2026-09-08_05_eb_follow_up_customer_links.sql'))
  await db.exec(read('docs/db/2026-09-08_05_eb_follow_up_customer_links.sql'))
})
after(async () => {
  await db.close()
  if (secret === undefined) delete process.env.EB_FOLLOW_UP_EMAIL_ENCRYPTION_KEY
  else process.env.EB_FOLLOW_UP_EMAIL_ENCRYPTION_KEY = secret
})
type Row = Record<string, unknown>
async function fixture() {
  const org = randomUUID(), project = randomUUID(), inspection = randomUUID(), report = randomUUID()
  const publicToken = randomUUID().replaceAll('-', '')
  const email = 'buyer@example.test'
  await db.query('insert into organizations values($1)', [org])
  await db.query('insert into inspections values($1)', [inspection])
  await db.query('insert into eb_projects values($1)', [project])
  await db.query('insert into eb_inspection_details values($1,$2,$3)', [inspection, org, project])
  await db.query('insert into inspection_report_links values($1,$2,$3,$4,null)', [report, org, inspection, hash(publicToken)])
  await db.query('insert into eb_follow_up_customers values($1,$2,$3,$4)', [inspection, org, project, email])
  const state = { session: null as EbCustomerSession | null }
  const admin = { from: (table: string) => {
    assert.ok(['eb_follow_up_customer_links','inspection_report_links','eb_remediation_access_links','eb_follow_up_orders'].includes(table))
    const values: unknown[] = []
    const clauses: string[] = []
    let fields = '*'
    const query = {
      select: (value: string) => { assert.match(value, /^[a-z_,]+$/); fields = value; return query },
      eq: (key: string, value: unknown) => { assert.match(key, /^[a-z_]+$/); values.push(value); clauses.push(`${key}=$${values.length}`); return query },
      is: (key: string, value: unknown) => { assert.equal(value, null); assert.match(key, /^[a-z_]+$/); clauses.push(`${key} is null`); return query },
      maybeSingle: async () => {
        const result = await db.query<Row>(`select ${fields} from ${table} where ${clauses.join(' and ')}`, values)
        return { data: result.rows[0] ? JSON.parse(JSON.stringify(result.rows[0])) : null, error: null }
      },
    }
    return query
  }, rpc: async (name: string, input: Row) => {
    const signatures: Record<string, string[]> = {
      eb_issue_follow_up_customer_link: ['id','public_token_hash','email','token_hash','report_token_ciphertext','mail_ciphertext'],
      eb_open_follow_up_customer_link: ['token_hash','challenge_id','code_hash'],
      eb_validate_follow_up_customer_link: ['id','org_id','inspection_id','report_link_id','email'],
    }
    const keys = signatures[name]
    assert.ok(keys)
    try {
      const result = await db.query<{ result: unknown }>(`select ${name}(${keys.map((_, i) => `$${i + 1}`).join(',')}) result`, keys.map(key => input[`p_${key}`]))
      return { data: result.rows[0].result, error: null }
    } catch (error) { return { data: null, error: { message: String(error) } } }
  } }
  const compiledModule = { exports: {} }
  const dependencies: Record<string, unknown> = {
    'server-only': {},
    '@/lib/assignments/tokens': { generateAssignmentToken: () => randomUUID().replaceAll('-', ''), hashAssignmentToken: hash },
    '@/lib/supabase/admin': { createSupabaseAdminClient: () => admin },
    '@/lib/eb/followUpDelivery': { encryptEbFollowUpPayload: JSON.stringify, decryptEbFollowUpPayload: JSON.parse, escapeEbFollowUpHtml: (value: string) => value },
    '@/lib/eb/followUp': { normalizeEbFollowUpEmail: (value: string) => value?.trim().toLowerCase() || null },
    '@/lib/eb/customerSession': { readEbCustomerSession: async () => state.session,
      setEbCustomerSession: async (session: EbCustomerSession) => { state.session = session } },
  }
  const output = ts.transpileModule(read('src/lib/eb/customerLinks.ts'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  new Function('require','module','exports',output)((name: string) => name in dependencies ? dependencies[name] : require(name), compiledModule, compiledModule.exports)
  const helpers = compiledModule.exports as typeof Links
  const issue = (address = email, sendEmail = false) => helpers.issueEbCustomerLink({ publicToken, email: address, baseUrl: 'https://hushub.test', sendEmail })
  const authorize = async (token: string) => {
    const context = await helpers.resolveEbCustomerReportLink(token)
    assert.ok(context)
    return helpers.ensureEbCustomerReportSession(token, context)
  }
  return { org, project, inspection, report, publicToken, email, state, helpers, issue, authorize }
}

test('personal secret is distinct from public report; only frozen/registered buyer can receive it', async () => {
  const f = await fixture()
  assert.equal(await f.issue('contractor@example.test'), null)
  const url = await f.issue()
  assert.match(url!, /^https:\/\/hushub.test\/rapport\/bestallare\/[A-Za-z0-9_-]+$/)
  assert.ok(!url!.includes(f.publicToken))
  const row = (await db.query<Row>('select * from eb_follow_up_customer_links where inspection_id=$1', [f.inspection])).rows[0]
  assert.equal(row.token_hash, hash(url!.split('/').pop()!))
  assert.equal(row.email, f.email)
  assert.equal((await db.query('select * from eb_follow_up_email_outbox')).rows.length, 0)
  assert.equal(await f.helpers.openEbCustomerLink(f.publicToken), null)
  assert.equal(f.state.session, null)
})

test('legacy redirect keeps private address and is read-only; private authorization creates only a scoped intent', async () => {
  const f = await fixture()
  const url = await f.issue()
  const token = url!.split('/').pop()!
  const redirect = await f.helpers.openEbCustomerLink(token)
  assert.equal(redirect, `/rapport/bestallare/${token}`)
  assert.equal(f.state.session, null)
  assert.equal((await db.query('select * from eb_follow_up_challenges where inspection_id=$1', [f.inspection])).rows.length, 0)
  await f.authorize(token)
  const session = f.state.session!
  assert.equal(session.email, f.email)
  assert.equal(session.reportLinkId, f.report)
  assert.ok(session.personalLinkId)
  assert.ok(await f.helpers.isEbCustomerLinkSessionActive(session))
  assert.ok(session.expiresAt > Date.now() && session.expiresAt <= Date.now() + 15 * 60_000)
  const intent = (await db.query<Row>('select * from eb_follow_up_challenges where id=$1', [session.challengeId])).rows[0]
  assert.equal(intent.personal_link_id, session.personalLinkId)
  assert.equal(intent.eligible, true)
  assert.ok(intent.verified_at)
  assert.equal((await db.query('select * from eb_follow_up_orders where inspection_id=$1', [f.inspection])).rows.length, 0)
})

test('revocation, expiry, report revocation and customer correction revoke existing session and intent', async () => {
  for (const action of ['revoke','expire','report','customer']) {
    const f = await fixture()
    const url = await f.issue()
    const token = url!.split('/').pop()!
    await f.authorize(token)
    const session = f.state.session!
    if (action === 'revoke') await db.query('update eb_follow_up_customer_links set revoked_at=now() where id=$1', [session.personalLinkId])
    if (action === 'expire') await db.query("update eb_follow_up_customer_links set expires_at=now()-interval '1 second' where id=$1", [session.personalLinkId])
    if (action === 'report') await db.query('update inspection_report_links set revoked_at=now() where id=$1', [f.report])
    if (action === 'customer') await db.query("update eb_follow_up_customers set email='corrected@example.test' where inspection_id=$1", [f.inspection])
    assert.equal(await f.helpers.isEbCustomerLinkSessionActive(session), false, action)
    const readonlyContext = await f.helpers.resolveEbCustomerReportLink(token)
    if (action === 'expire') {
      assert.equal(readonlyContext?.expired, true)
      assert.equal(readonlyContext?.publicToken, f.publicToken)
      assert.equal(await f.helpers.openEbCustomerLink(token), `/rapport/bestallare/${token}`)
      await assert.rejects(f.helpers.ensureEbCustomerReportSession(token, readonlyContext!), /VERIFICATION_REQUIRED/)
    } else assert.equal(readonlyContext, null, action)
    await assert.rejects(db.query('update eb_follow_up_challenges set verified_at=now() where id=$1', [session.challengeId]), /VERIFICATION_REQUIRED/)
  }
})

test('scope cannot be crossed and a paid frozen buyer remains owner after source contact changes', async () => {
  const f = await fixture()
  const url = await f.issue()
  await f.authorize(url!.split('/').pop()!)
  const session = f.state.session!
  for (const patch of [{ orgId: randomUUID() }, { inspectionId: randomUUID() }, { reportLinkId: randomUUID() }, { email: 'other@example.test' }]) {
    assert.equal(await f.helpers.isEbCustomerLinkSessionActive({ ...session, ...patch }), false)
  }
  await db.query('insert into eb_follow_up_orders(id,inspection_id,org_id,eb_project_id,buyer_snapshot) values($1,$2,$3,$4,$5)', [randomUUID(), f.inspection, f.org, f.project, { email: f.email }])
  await db.query("update eb_follow_up_customers set email='new@example.test' where inspection_id=$1", [f.inspection])
  assert.equal(await f.helpers.isEbCustomerLinkSessionActive(session), true)
  assert.equal(await f.issue('new@example.test'), null)
})

test('private bearer refreshes expired reading sessions without new email or order and reuses fresh intent', async () => {
  const f = await fixture()
  const token = (await f.issue())!.split('/').pop()!
  const first = await f.authorize(token)
  assert.equal((await f.authorize(token)).challengeId, first.challengeId)
  f.state.session = { ...first, expiresAt: Date.now() - 1 }
  const fresh = await f.authorize(token)
  assert.notEqual(fresh.challengeId, first.challengeId)
  assert.equal(fresh.personalLinkId, first.personalLinkId)
  assert.equal((await db.query('select * from eb_follow_up_orders where inspection_id=$1', [f.inspection])).rows.length, 0)
  assert.equal((await db.query('select * from eb_follow_up_challenges where inspection_id=$1', [f.inspection])).rows.length, 2)
})

test('ambient report cookies for another scope are replaced, never used as private report authority', async () => {
  const f = await fixture()
  const token = (await f.issue())!.split('/').pop()!
  const original = await f.authorize(token)
  for (const patch of [{ orgId: randomUUID() }, { inspectionId: randomUUID() }, { reportLinkId: randomUUID() },
    { personalLinkId: randomUUID() }, { email: 'other@example.test' }]) {
    f.state.session = { ...original, ...patch }
    const session = await f.authorize(token)
    assert.notEqual(session.challengeId, original.challengeId)
    assert.equal(session.orgId, f.org)
    assert.equal(session.inspectionId, f.inspection)
    assert.equal(session.reportLinkId, f.report)
    assert.equal(session.personalLinkId, original.personalLinkId)
    assert.equal(session.email, f.email)
  }
})

test('valid owner portal is reused; stale, revoked or wrongly scoped owner cookies recover from the private bearer', async () => {
  for (const action of ['valid', 'expired', 'revoked', 'different_inspection', 'different_buyer', 'withdrawn']) {
    const f = await fixture()
    const token = (await f.issue())!.split('/').pop()!
    const portalToken = randomUUID().replaceAll('-', '')
    const orderId = randomUUID(), accessId = randomUUID()
    await db.query('insert into eb_follow_up_orders(id,inspection_id,org_id,eb_project_id,buyer_snapshot) values($1,$2,$3,$4,$5)',
      [orderId, f.inspection, f.org, f.project, { email: f.email }])
    await db.query("insert into eb_remediation_access_links values($1,$2,'customer_owner',$3,$4,$5,$6,now()+interval '1 day',null)",
      [accessId, hash(portalToken), f.org, f.inspection, f.email, orderId])
    const owner: EbCustomerSession = { kind: 'owner', orgId: f.org, inspectionId: f.inspection,
      email: f.email, portalPath: `/atgarder/${portalToken}`, expiresAt: Date.now() + 60 * 60_000 }
    f.state.session = owner
    if (action === 'expired') await db.query("update eb_remediation_access_links set expires_at=now()-interval '1 second' where id=$1", [accessId])
    if (action === 'revoked') await db.query('update eb_remediation_access_links set revoked_at=now() where id=$1', [accessId])
    if (action === 'different_inspection') await db.query('update eb_remediation_access_links set inspection_id=$1 where id=$2', [randomUUID(), accessId])
    if (action === 'different_buyer') await db.query("update eb_remediation_access_links set email='other@example.test' where id=$1", [accessId])
    if (action === 'withdrawn') await db.query("update eb_follow_up_orders set status='withdrawn' where id=$1", [orderId])
    const session = await f.authorize(token)
    assert.equal(session.kind, action === 'valid' ? 'owner' : 'report', action)
    if (action === 'valid') assert.equal(session.portalPath, owner.portalPath)
    else assert.ok(session.challengeId, action)
    assert.equal((await db.query('select * from eb_follow_up_orders where inspection_id=$1', [f.inspection])).rows.length, 1)
    assert.equal((await db.query('select * from eb_follow_up_challenges where inspection_id=$1', [f.inspection])).rows.length, action === 'valid' ? 0 : 1)
  }
})

test('encrypted report token cannot substitute another report scope, even for expired buyer reading', async () => {
  const f = await fixture(), other = await fixture()
  const token = (await f.issue())!.split('/').pop()!
  await db.query('update eb_follow_up_customer_links set report_token_ciphertext=$1 where token_hash=$2', [JSON.stringify({ publicToken: other.publicToken }), hash(token)])
  assert.equal(await f.helpers.resolveEbCustomerReportLink(token), null)
  await db.query("update eb_follow_up_customer_links set expires_at=now()-interval '1 second' where token_hash=$1", [hash(token)])
  assert.equal(await f.helpers.resolveEbCustomerReportLink(token), null)
})

test('recovery queues personal-link email atomically and rate limits repeated requests', async () => {
  const f = await fixture()
  const url = await f.issue(f.email, true)
  assert.ok(url)
  const row = (await db.query<Row>('select * from eb_follow_up_email_outbox where payload_ciphertext like $1', [`%${url}%`])).rows[0]
  assert.equal(row.kind, 'email')
  const mail = JSON.parse(String(row.payload_ciphertext))
  assert.equal(mail.to, f.email)
  assert.doesNotMatch(mail.text, /engångskod/)
  await assert.rejects(f.issue(f.email, true), /RATE_LIMITED/)
  assert.ok(await f.issue(f.email, false), 'Authenticated report delivery is not blocked by recovery rate limit')
})

test('browser roles cannot issue, open or validate buyer credentials through database RPCs', async () => {
  for (const role of ['anon', 'authenticated']) for (const signature of [
    'eb_issue_follow_up_customer_link(uuid,text,text,text,text,text)',
    'eb_open_follow_up_customer_link(text,uuid,text)',
    'eb_validate_follow_up_customer_link(uuid,uuid,uuid,uuid,text)',
  ]) {
    const result = await db.query<{ allowed: boolean }>('select has_function_privilege($1,$2,\'EXECUTE\') allowed', [role, signature])
    assert.equal(result.rows[0].allowed, false)
  }
})
