import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import { randomUUID, createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { PGlite } from '@electric-sql/pglite'
import ts from 'typescript'
import type * as FollowUp from '../src/lib/eb/followUp'
import type * as Delivery from '../src/lib/eb/followUpDelivery'
import type * as Server from '../src/lib/eb/followUpServer'

const require = createRequire(import.meta.url)
const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
function load<T>(file: string, dependencies: Record<string, unknown>, expose: string[] = []): T {
  const source = `${read(file)}\n${expose.map(name => `exports.${name} = ${name};`).join('\n')}`
  const compiled = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
  } }).outputText
  const module = { exports: {} }
  new Function('require', 'exports', 'module', compiled)((id: string) => {
    if (id in dependencies) return dependencies[id]
    if (id.startsWith('node:')) return require(id)
    throw new Error(`Unexpected I/O dependency ${id}`)
  }, module.exports, module)
  return module.exports as T
}
const shared = load<typeof FollowUp>('src/lib/eb/followUp.ts', {})
const db = new PGlite()
const org = randomUUID()
const migration = read('docs/db/2026-09-07_07_eb_follow_up_orders.sql')
before(async () => {
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
  await db.exec(migration)
  await db.exec(migration)
  await db.query('insert into organizations(id) values($1)', [org])
  await db.exec(`create function test_reject_follow_up_email() returns trigger language plpgsql as $$
    begin if current_setting('test.reject_follow_up_email',true)='yes' then raise exception 'TEST_QUEUE_FAILURE'; end if; return new;end $$;
    create trigger reject_test_mail before insert on eb_follow_up_email_outbox for each row execute function test_reject_follow_up_email();`)
})
after(async () => { await db.close() })

const hash = (id: string, code: string) => createHash('sha256').update(`${id}:${code}`).digest('hex')
async function fixture() {
  const inspection = randomUUID(), project = randomUUID(), link = randomUUID(), note = randomUUID(), challenge = randomUUID()
  await db.query('insert into eb_projects values($1,$2)', [project, org])
  await db.query('insert into inspections values($1)', [inspection])
  await db.query('insert into eb_notes(id,org_id,eb_project_id,inspection_id,note_text) values($1,$2,$3,$4,$5)', [note, org, project, inspection, 'Live text'])
  const snapshot = { module: 'EB', report: { notes: [{ id: note, noteText: 'Published original' }] } }
  await db.query('insert into inspection_report_links(id,org_id,inspection_id,snapshot_payload) values($1,$2,$3,$4)', [link, org, inspection, snapshot])
  const request = async (id = challenge, email = 'buyer@example.test', eligible = true) =>
    (await db.query<{ result: { limited: boolean } }>('select eb_request_follow_up_challenge($1,$2,$3,$4,$5,$6,$7,$8) result',
      [id, org, inspection, link, email, hash(id, '123456'), eligible, eligible ? 'encrypted-code' : null])).rows[0].result
  const verify = async (code = '123456', id = challenge) =>
    (await db.query<{ result: { verified: boolean; email?: string } }>('select eb_verify_follow_up_challenge($1,$2,$3) result', [id, link, hash(id, code)])).rows[0].result
  const complete = async (id = challenge, email = 'buyer@example.test', create = true) => {
    const owner = randomUUID()
    return (await db.query<{ result: { orderId: string; encryptedResult: string; created: boolean } }>(
      'select eb_complete_follow_up_order($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) result', [
        id, link, id, project, { name: 'Buyer', email, invoiceName: 'Buyer', invoiceAddress: 'Street1', invoicePostalCode: '12345', invoiceCity: 'City' },
        { name: 'Seller', email: 'seller@example.test' },
        [{ noteId: note, snapshot: { originalNoteId: note, noteText: 'Published original' }, images: [{ filePath: `frozen/${id}/photo.jpg`, storageBucket: 'eb-follow-up-originals' }] }],
        { id: owner, tokenHash: `hash-${owner}`, expiresAt: new Date(Date.now()+180*86400_000).toISOString(), encryptedResult: `encrypted-url:${owner}` },
        ['receipt','invoice','access'].map(kind => ({ kind, dedupeKey: `${kind}:${id}`, ciphertext: `encrypted-${kind}` })), create, '2026-09-07',
      ])).rows[0].result
  }
  return { inspection, project, link, note, challenge, snapshot, request, verify, complete }
}

test('fixed inclusive price and all three explicit consents are validated before purchase', () => {
  assert.equal(shared.EB_FOLLOW_UP_PRICE_ORE, 59900)
  assert.equal(shared.EB_FOLLOW_UP_NET_PRICE_ORE + shared.EB_FOLLOW_UP_VAT_ORE, shared.EB_FOLLOW_UP_PRICE_ORE)
  const valid = { name: 'Buyer', invoiceName: 'Recipient', invoiceAddress: 'Street1', invoicePostalCode: '12345', invoiceCity: 'City',
    acceptTerms: true, requestImmediateStart: true, acceptInvoice: true, termsVersion: '2026-09-07', confirmedPriceOre: 59900 }
  assert.equal(shared.validateEbFollowUpBuyer(valid, 'buyer@example.test').email, 'buyer@example.test')
  for (const key of ['acceptTerms','requestImmediateStart','acceptInvoice']) {
    for (const value of [false, undefined, 'true']) assert.throws(() => shared.validateEbFollowUpBuyer({ ...valid, [key]: value }, 'buyer@example.test'), /CONSENT_REQUIRED/)
  }
  for (const changed of [{ confirmedPriceOre: 50000 }, { termsVersion: 'old' }]) {
    assert.throws(() => shared.validateEbFollowUpBuyer({ ...valid, ...changed }, 'buyer@example.test'), /OFFER_CHANGED/)
  }
  assert.throws(() => shared.validateEbFollowUpBuyer({ ...valid, invoiceAddress: '\nBcc: x@example.test' }, 'buyer@example.test'), /BUYER_INVALID/)
})

test('challenge creation is rate-limited atomically and wrong addresses receive no email or eligibility result', async () => {
  const f = await fixture()
  assert.deepEqual(await f.request(), { limited: false })
  assert.deepEqual(await f.request(randomUUID()), { limited: true })
  assert.equal((await db.query('select id from eb_follow_up_challenges where inspection_id=$1', [f.inspection])).rows.length, 1)
  const decoy = randomUUID()
  assert.deepEqual(await f.request(decoy, 'unknown@example.test', false), { limited: false })
  assert.equal((await db.query('select id from eb_follow_up_email_outbox where dedupe_key=$1', [`challenge:${decoy}`])).rows.length, 0)
  assert.deepEqual(await f.verify('123456', decoy), { verified: false })
})

test('incorrect verification attempts are committed and a correct sixth attempt cannot bypass the cap', async () => {
  const f = await fixture()
  await f.request()
  for (let i = 0; i < 5; i++) assert.deepEqual(await f.verify('000000'), { verified: false })
  assert.equal((await db.query<{ attempts: number }>('select attempts from eb_follow_up_challenges where id=$1', [f.challenge])).rows[0].attempts, 5)
  assert.deepEqual(await f.verify(), { verified: false })
  await assert.rejects(f.complete(), /VERIFICATION_REQUIRED/)
})

test('expired and report-mismatched codes cannot verify or activate an order', async () => {
  const f = await fixture()
  await f.request()
  assert.deepEqual((await db.query<{ result: object }>('select eb_verify_follow_up_challenge($1,$2,$3) result', [f.challenge, randomUUID(), hash(f.challenge,'123456')])).rows[0].result, { verified: false })
  await db.query("update eb_follow_up_challenges set expires_at=now()-interval '1 second' where id=$1", [f.challenge])
  assert.deepEqual(await f.verify(), { verified: false })
  await assert.rejects(f.complete(), /VERIFICATION_REQUIRED/)
})

test('atomic activation freezes the report and images, isolates legacy tasks and queues one receipt and invoice', async () => {
  const f = await fixture()
  await db.query(`insert into eb_remediation_tasks(org_id,eb_project_id,inspection_id,eb_note_id,status,note_snapshot)
    values($1,$2,$3,$4,'reported_remedied',$5)`, [org, f.project, f.inspection, f.note, { noteText: 'Existing progressed task' }])
  await f.request()
  await assert.rejects(f.complete(), /VERIFICATION_REQUIRED/)
  assert.deepEqual(await f.verify(), { verified: true, email: 'buyer@example.test' })
  const first = await f.complete(), replay = await f.complete()
  assert.equal(first.created, true)
  assert.equal(replay.created, false)
  assert.equal(first.orderId, replay.orderId)
  assert.equal(first.encryptedResult, replay.encryptedResult)
  const order = (await db.query<Record<string, unknown>>('select * from eb_follow_up_orders where id=$1', [first.orderId])).rows[0]
  assert.equal(order.price_ore, 59900)
  assert.deepEqual(order.report_snapshot, f.snapshot)
  const tasks = (await db.query<Record<string, unknown>>('select * from eb_remediation_tasks where inspection_id=$1 order by follow_up_order_id nulls first', [f.inspection])).rows
  assert.equal(tasks.length, 2)
  assert.equal(tasks[0].status, 'reported_remedied')
  assert.deepEqual(tasks[0].note_snapshot, { noteText: 'Existing progressed task' })
  assert.equal(tasks[1].status, 'unassigned')
  assert.deepEqual(tasks[1].note_snapshot, { originalNoteId: f.note, noteText: 'Published original' })
  assert.deepEqual(tasks[1].original_images, [{ filePath: `frozen/${f.challenge}/photo.jpg`, storageBucket: 'eb-follow-up-originals' }])
  const jobs = (await db.query<{ kind: string }>('select kind from eb_follow_up_email_outbox where order_id=$1 order by kind', [first.orderId])).rows
  assert.deepEqual(jobs.map(job => job.kind), ['invoice','receipt'])
  assert.equal((await db.query('select id from eb_remediation_access_links where follow_up_order_id=$1', [first.orderId])).rows.length, 1)
  await assert.rejects(db.query('update eb_follow_up_orders set report_snapshot=$1 where id=$2', [{ tampered: true }, first.orderId]), /IMMUTABLE/)
})

test('a new verified code recovers an existing order without rebilling; a different email cannot become owner', async () => {
  const f = await fixture()
  await f.request(); await f.verify(); const initial = await f.complete()
  await db.query("update eb_follow_up_challenges set created_at=created_at-interval '2 minutes' where id=$1", [f.challenge])
  const next = randomUUID()
  await f.request(next); await f.verify('123456', next)
  const recovered = await f.complete(next, 'buyer@example.test', false)
  assert.equal(recovered.orderId, initial.orderId)
  assert.equal(recovered.created, false)
  assert.equal((await db.query('select id from eb_follow_up_orders where inspection_id=$1', [f.inspection])).rows.length, 1)
  assert.equal((await db.query("select id from eb_follow_up_email_outbox where order_id=$1 and kind='invoice'", [initial.orderId])).rows.length, 1)
  const other = randomUUID()
  await f.request(other, 'replacement@example.test'); await f.verify('123456', other)
  await assert.rejects(f.complete(other, 'replacement@example.test'), /BUYER_MISMATCH/)
})

test('a superseded or revoked report cannot activate a new purchase, even after code verification', async () => {
  const f = await fixture()
  await f.request(); await f.verify()
  await db.query("insert into inspection_report_links(id,org_id,inspection_id,snapshot_payload,created_at) values($1,$2,$3,'{}',now()+interval '1 second')", [randomUUID(), org, f.inspection])
  await assert.rejects(f.complete(), /REPORT_REPLACED/)
  await db.query('update inspection_report_links set revoked_at=now() where id=$1', [f.link])
  await assert.rejects(f.complete(), /REPORT_UNAVAILABLE/)
  assert.equal((await db.query('select id from eb_follow_up_orders where inspection_id=$1', [f.inspection])).rows.length, 0)
})

test('queue insertion failure rolls back purchase, access link and tasks; retry activates exactly once', async () => {
  const f = await fixture()
  await f.request(); await f.verify()
  await db.exec("set test.reject_follow_up_email='yes'")
  try { await assert.rejects(f.complete(), /TEST_QUEUE_FAILURE/) } finally { await db.exec("set test.reject_follow_up_email='no'") }
  for (const table of ['eb_follow_up_orders','eb_remediation_tasks','eb_remediation_access_links']) {
    assert.equal((await db.query(`select id from ${table} where inspection_id=$1`, [f.inspection])).rows.length, 0)
  }
  assert.equal((await f.complete()).created, true)
  assert.equal((await f.complete()).created, false)
})

test('withdrawal is recorded once, pauses invoicing and queues a durable acknowledgement without deleting evidence', async () => {
  const f = await fixture()
  await f.request(); await f.verify(); const order = await f.complete()
  await assert.rejects(db.query('select eb_withdraw_follow_up_order($1,$2)', [order.orderId, 'other@example.test']), /FORBIDDEN/)
  const call = async () => (await db.query<{ result: object }>('select eb_withdraw_follow_up_order($1,$2) result', [order.orderId, 'buyer@example.test'])).rows[0].result
  assert.deepEqual(await call(), await call())
  assert.equal((await db.query<{ billing_status: string }>('select billing_status from eb_follow_up_orders where id=$1', [order.orderId])).rows[0].billing_status, 'on_hold')
  assert.equal((await db.query("select id from eb_follow_up_email_outbox where order_id=$1 and kind='withdrawal'", [order.orderId])).rows.length, 1)
  assert.equal((await db.query('select id from eb_remediation_tasks where follow_up_order_id=$1', [order.orderId])).rows.length, 1)
})

test('a worker crash at the final attempt becomes failed rather than permanent processing', async () => {
  const id = randomUUID()
  await db.query(`insert into eb_follow_up_email_outbox(id,dedupe_key,kind,status,attempts,locked_at)
    values($1,$2,'email','processing',10,now()-interval '6 minutes')`, [id, `exhausted:${id}`])
  await db.query('select * from eb_claim_follow_up_emails(1)')
  assert.equal((await db.query<{ status: string }>('select status from eb_follow_up_email_outbox where id=$1', [id])).rows[0].status, 'failed')
})

test('browser roles have no direct purchase, challenge or mail queue permissions', async () => {
  for (const role of ['anon','authenticated']) {
    const access = await db.query<{ allowed: boolean }>("select has_table_privilege($1,'eb_follow_up_orders','INSERT') allowed", [role])
    assert.equal(access.rows[0].allowed, false)
    const rpc = await db.query<{ allowed: boolean }>("select has_function_privilege($1,'eb_complete_follow_up_order(uuid,uuid,uuid,uuid,jsonb,jsonb,jsonb,jsonb,jsonb,boolean,text)','EXECUTE') allowed", [role])
    assert.equal(rpc.rows[0].allowed, false)
  }
})

test('outbox encrypts private links, retries failed sends, and suppresses expired verification emails', async () => {
  const previousKey = process.env.EB_FOLLOW_UP_EMAIL_ENCRYPTION_KEY
  const previousFrom = process.env.ASSIGNMENTS_MAIL_FROM
  process.env.EB_FOLLOW_UP_EMAIL_ENCRYPTION_KEY = 'test-only-encryption-key'
  process.env.ASSIGNMENTS_MAIL_FROM = 'test@example.test'
  const state = { jobs: [] as object[], failed: false, sends: 0, finished: [] as Record<string, unknown>[] }
  const delivery = load<typeof Delivery>('src/lib/eb/followUpDelivery.ts', {
    '@/lib/eb/followUp': shared,
    '@/lib/assignments/mailer': { sendAssignmentEmail: async () => { state.sends++; if (state.failed) throw new Error('Test transport failure') } },
    '@/lib/supabase/admin': { createSupabaseAdminClient: () => ({ rpc: async (name: string, input: Record<string, unknown>) => {
      if (name === 'eb_claim_follow_up_emails') return { data: state.jobs, error: null }
      assert.equal(name, 'eb_finish_follow_up_email'); state.finished.push(input); return { data: true, error: null }
    } }) },
  })
  try {
    const encrypted = delivery.encryptEbFollowUpPayload({ portalUrl: 'https://example.test/atgarder/PRIVATE-TOKEN' })
    assert.doesNotMatch(encrypted, /PRIVATE-TOKEN|atgarder/)
    assert.deepEqual(delivery.decryptEbFollowUpPayload(encrypted), { portalUrl: 'https://example.test/atgarder/PRIVATE-TOKEN' })
    const email = { to: 'buyer@example.test', subject: 'Test', html: '<p>Test</p>', text: 'Test' }
    state.jobs = [{ id: 'mail', lease_id: 'lease', kind: 'verification', payload_ciphertext: delivery.encryptEbFollowUpPayload({ ...email, expiresAt: '2000-01-01T00:00:00Z' }) }]
    assert.deepEqual(await delivery.processEbFollowUpEmails(), { claimed: 1, sent: 1, failed: 0 })
    assert.equal(state.sends, 0)
    state.jobs = [{ id: 'mail', lease_id: 'lease2', kind: 'receipt', payload_ciphertext: delivery.encryptEbFollowUpPayload(email) }]
    state.failed = true
    assert.deepEqual(await delivery.processEbFollowUpEmails(), { claimed: 1, sent: 0, failed: 1 })
    assert.equal(state.finished.at(-1)?.p_success, false)
    state.failed = false
    assert.deepEqual(await delivery.processEbFollowUpEmails(), { claimed: 1, sent: 1, failed: 0 })
  } finally {
    if (previousKey === undefined) delete process.env.EB_FOLLOW_UP_EMAIL_ENCRYPTION_KEY; else process.env.EB_FOLLOW_UP_EMAIL_ENCRYPTION_KEY = previousKey
    if (previousFrom === undefined) delete process.env.ASSIGNMENTS_MAIL_FROM; else process.env.ASSIGNMENTS_MAIL_FROM = previousFrom
  }
})

test('actual server keeps recovery verified when sales are off and returns only a relative private portal path', async () => {
  const oldFlag = process.env.EB_FOLLOW_UP_ENABLED
  const oldKey = process.env.EB_FOLLOW_UP_EMAIL_ENCRYPTION_KEY
  delete process.env.EB_FOLLOW_UP_ENABLED
  process.env.EB_FOLLOW_UP_EMAIL_ENCRYPTION_KEY = 'test-only-verification-pepper'
  const inspection = randomUUID(), project = randomUUID(), link = randomUUID(), order = randomUUID(), note = randomUUID()
  const buyer = { email: 'PRIVATE-BUYER@example.test', invoiceAddress: 'PRIVATE-INVOICE', name: 'Private Buyer' }
  const seller = { name: 'Public Seller', orgNumber: '123456-7890', address: 'Business Street', email: 'seller@example.test' }
  const report = { project: { id: project }, inspection: { inspectionId: inspection, reportLockedAt: '2026-09-01T10:00:00Z' }, notes: [{ id: note, noteText: 'Published note' }], images: [] }
  let verified = false
  let completions = 0
  const admin = {
    from: (table: string) => {
      const rows: Record<string, unknown> = {
        inspection_report_links: { id: link, org_id: org, inspection_id: inspection, snapshot_payload: report },
        eb_projects: { id: project, org_id: org, client_email: buyer.email }, eb_inspection_details: { eb_project_id: project },
        eb_follow_up_orders: { id: order, buyer_snapshot: buyer, seller_snapshot: seller },
      }
      assert.ok(table in rows, `Unexpected table: ${table}`)
      const query = { select: () => query, eq: () => query, is: () => query, order: () => query, limit: () => query,
        maybeSingle: async () => ({ data: rows[table], error: null }) }
      return query
    },
    rpc: async (name: string, input: Record<string, unknown>) => {
      if (name === 'eb_verify_follow_up_challenge') return { data: { verified, email: buyer.email.toLowerCase() }, error: null }
      assert.equal(name, 'eb_complete_follow_up_order')
      completions++
      assert.equal(input.p_create, false)
      assert.deepEqual(input.p_tasks, [])
      return { data: { orderId: order, created: false, encryptedResult: JSON.stringify({ portalUrl: 'https://hushub.test/atgarder/abcdefghijklmnopqrstuvwxyz1234567890' }) }, error: null }
    },
  }
  const server = load<typeof Server>('src/lib/eb/followUpServer.ts', {
    '@/lib/eb/followUp': shared,
    '@/lib/supabase/admin': { createSupabaseAdminClient: () => admin },
    '@/lib/assignments/tokens': { generateAssignmentToken: () => 'new-owner-token-long-enough', hashAssignmentToken: (token: string) => `hashed:${token}` },
    '@/lib/eb/reportSnapshot': { getEbInspectionReportFromSnapshot: (snapshot: unknown) => snapshot },
    '@/lib/eb/followUpDelivery': { encryptEbFollowUpPayload: JSON.stringify, decryptEbFollowUpPayload: JSON.parse, escapeEbFollowUpHtml: (value: string) => value },
  })
  try {
    const offer = await server.getEbFollowUpOffer('public-report-token-long-enough')
    assert.equal(offer.alreadyActive, true)
    assert.equal(offer.available, true)
    assert.doesNotMatch(JSON.stringify(offer), /PRIVATE-BUYER|PRIVATE-INVOICE|Private Buyer/)
    const input = { token: 'public-report-token-long-enough', input: { action: 'access', challengeId: randomUUID(), code: '123456' }, baseUrl: 'https://hushub.test' }
    await assert.rejects(server.completeEbFollowUpOrder(input), /VERIFICATION_REQUIRED/)
    assert.equal(completions, 0)
    verified = true
    assert.equal((await server.completeEbFollowUpOrder(input)).portalUrl, '/atgarder/abcdefghijklmnopqrstuvwxyz1234567890')
    assert.equal(completions, 1)
  } finally {
    if (oldFlag === undefined) delete process.env.EB_FOLLOW_UP_ENABLED; else process.env.EB_FOLLOW_UP_ENABLED = oldFlag
    if (oldKey === undefined) delete process.env.EB_FOLLOW_UP_EMAIL_ENCRYPTION_KEY; else process.env.EB_FOLLOW_UP_EMAIL_ENCRYPTION_KEY = oldKey
  }
})

test('original-image preparation executes actual bounded copies and retains the published note text', async () => {
  const note = randomUUID(), inspection = randomUUID()
  let concurrent = 0, peak = 0
  const copies: string[] = []
  const server = load<{ createFrozenTasks: (context: unknown, orderId: string) => Promise<Array<{ snapshot: { noteText: string }; images: Array<{ storageBucket: string }> }>> }>('src/lib/eb/followUpServer.ts', {
    '@/lib/eb/followUp': shared,
    '@/lib/supabase/admin': { createSupabaseAdminClient: () => { throw new Error('No real database') } },
    '@/lib/assignments/tokens': {}, '@/lib/eb/reportSnapshot': {}, '@/lib/eb/followUpDelivery': {},
  }, ['createFrozenTasks'])
  const prepared = await server.createFrozenTasks({
    link: { org_id: org, inspection_id: inspection },
    report: { notes: [{ id: note, noteText: 'FROZEN SOURCE' }], inspection: { variant: 'SLB', variantLabel: 'Slutbesiktning', sequenceNo: 1 },
      images: Array.from({ length: 9 }, () => ({ id: randomUUID(), noteId: note, filePath: `${inspection}/original.jpg` })) },
    admin: { storage: { from: (bucket: string) => ({ copy: async (source: string, destination: string, options: { destinationBucket: string }) => {
      assert.equal(bucket, 'inspection-images'); assert.equal(source, `${inspection}/original.jpg`)
      assert.equal(options.destinationBucket, 'eb-follow-up-originals')
      concurrent++; peak = Math.max(peak, concurrent)
      await new Promise(resolve => setTimeout(resolve, 1))
      copies.push(destination); concurrent--
      return { error: null }
    } }) } },
  }, randomUUID())
  assert.equal(copies.length, 9)
  assert.equal(peak, 4)
  assert.equal(prepared[0].snapshot.noteText, 'FROZEN SOURCE')
  assert.equal(prepared[0].images.length, 9)
  assert.equal(prepared[0].images.every(image => image.storageBucket === 'eb-follow-up-originals'), true)
})
