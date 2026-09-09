import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import ts from 'typescript'
import * as quotes from '../src/lib/action-cases/quotes.ts'
import * as rfq from '../src/lib/action-cases/rfqDelivery.ts'
import * as crypto from 'node:crypto'

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const sql = (name) => readFileSync(new URL(`../docs/db/${name}.sql`, import.meta.url), 'utf8')
function compile(name, dependencies) {
  const mod = { exports: {} }
  new Function('module', 'exports', 'require', ts.transpileModule(readFileSync(new URL(`../src/lib/action-cases/${name}.ts`, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(mod, mod.exports, (name) => {
    assert.ok(name in dependencies, `Unexpected dependency ${name}`); return dependencies[name]
  })
  return mod.exports
}
const requests = compile('quoteRequests', { './quotes': quotes })
const db = new PGlite()
const migration = () => sql('2026-09-09_08_action_case_rfq_delivery_links')
const get = async (table, key) => JSON.parse(JSON.stringify((await db.query(`select * from ${table} where id=$1`, [key])).rows[0] ?? null))
let sequence = 100
before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table organizations(id uuid primary key); create table profiles(id uuid primary key);
    create function is_org_member(uuid) returns boolean language sql as $$ select true $$;
    create function operational_tasks_set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at=clock_timestamp(); return new; end $$;
    create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint);`)
  await db.exec(sql('2026-09-08_01_action_cases_foundation').replace('create extension if not exists pgcrypto;', ''))
  await db.exec(`create table action_case_attachments(id uuid primary key,org_id uuid,action_case_id uuid,action_case_item_id uuid,attachment_type text,
    file_name text,content_type text,file_size_bytes bigint,storage_bucket text,file_path text);`)
  for (const name of ['2026-09-08_03_action_case_costing', '2026-09-08_04_action_case_ai_costing', '2026-09-08_05_action_case_work_quotes', '2026-09-08_09_action_case_grouped_requests', '2026-09-09_02_action_case_scope_attachments', '2026-09-09_03_action_case_work_parts', '2026-09-09_04_action_case_package_pricing']) await db.exec(sql(name))
  await db.exec(`insert into organizations values('${id(1)}'),('${id(9)}'); insert into profiles values('${id(2)}');`)
  await db.exec(migration()); await db.exec(migration())
})
after(async () => { await db.close() })

async function fixture(kind = 'request') {
  const n = sequence; sequence += 10
  const caseId = id(n), itemId = id(n + 1), lineId = id(n + 2), sourceId = id(n + 3), fileId = id(n + 4), deliveryId = id(n + 5)
  await db.query("insert into action_cases(id,org_id,title,customer_name,property_address) values($1,$2,'Case','Customer','Address')", [caseId, id(1)])
  await db.query("insert into action_case_items(id,org_id,action_case_id,title,scope) values($1,$2,$3,'Action','Scope')", [itemId, id(1), caseId])
  await db.query("insert into action_case_cost_lines(id,org_id,action_case_id,action_case_item_id,category,description) values($1,$2,$3,$4,'own_labor','Work')", [lineId, id(1), caseId, itemId])
  const file = { id: fileId, fileName: 'selected.jpg', contentType: 'image/jpeg', fileSizeBytes: 6000000, sourceBucket: 'action-case-files', sourcePath: `${id(1)}/${caseId}/original`, path: `${id(1)}/${caseId}/${deliveryId}/${fileId}` }
  await db.query("insert into action_case_attachments(id,org_id,action_case_id,attachment_type,file_name,content_type,file_size_bytes,storage_bucket,file_path) values($1,$2,$3,'image',$4,$5,$6,$7,$8)", [fileId, id(1), caseId, file.fileName, file.contentType, file.fileSizeBytes, file.sourceBucket, file.sourcePath])
  const table = kind === 'request' ? 'action_case_quote_requests' : 'action_case_work_quotes'
  const write = async (operation, data) => kind === 'request'
    ? (await db.query('select write_action_case_request($1,$2,$3,$4,$5,$6::jsonb) result', [id(1), caseId, sourceId, id(2), operation, JSON.stringify(data)])).rows[0].result
    : (await db.query('select write_action_case_quote($1,$2,$3,$4,$5,$6,$7::jsonb) result', [id(1), caseId, itemId, lineId, id(2), operation, JSON.stringify({ id: sourceId, ...data })])).rows[0].result
  if (kind === 'request') await write('save', requests.normalizeQuoteRequest({ requestId: sourceId, supplierName: 'UE', supplierEmail: 'ue@example.test', subject: 'Request', attachmentIds: [fileId], requirementKeys: [],
    lines: [{ costLineId: lineId, itemId, itemTitle: 'Action', scope: 'Scope', description: 'Work', workPartId: null, workPartTitle: '', workPartScope: '' }] }))
  else await write('save', { ...quotes.normalizeQuote({ quoteId: sourceId, supplierName: 'UE', supplierEmail: 'ue@example.test', requestSubject: 'Request', requestBody: 'Body', requestAttachmentIds: [fileId] }), scopeSnapshot: 'Scope', lineDescription: 'Work' })
  const payload = { to: 'ue@example.test', subject: 'Request', text: 'Private recipient link', idempotencyKey: sourceId }
  const data = { deliveryId, tokenHash: crypto.createHash('sha256').update(deliveryId).digest('hex'), files: [file], emailPayload: payload, expectedUpdatedAt: (await get(table, sourceId)).updated_at }
  const claim = async (overrides = {}, org = id(1)) => (await db.query('select claim_action_case_rfq_delivery($1,$2,$3,$4,$5,$6::jsonb) result', [org, caseId, sourceId, id(2), kind, JSON.stringify({ ...data, ...overrides })])).rows[0].result
  return { caseId, sourceId, lineId, fileId, deliveryId, file, payload, data, claim, write, table }
}

test('first send freezes large selected originals with send claim, scoped immutable records and private ACLs', async () => {
  for (const kind of ['request', 'quote']) {
    const f = await fixture(kind), result = await f.claim()
    assert.deepEqual(result.payload, f.payload)
    const delivery = await get('action_case_rfq_deliveries', f.deliveryId)
    assert.equal(delivery.files[0].fileSizeBytes, 6000000)
    assert.equal(delivery.files[0].path, f.file.path)
    assert.equal(delivery.snapshot.supplierEmail, 'ue@example.test')
    assert.equal(delivery.snapshot.propertyAddress, 'Address')
    assert.equal(delivery.files[0].sourcePath, undefined)
    assert.ok(Date.parse(delivery.expires_at) - Date.parse(delivery.created_at) > 89 * 86400000)
    assert.deepEqual((await get(f.table, f.sourceId)).email_payload, f.payload)
    await assert.rejects(f.claim(), /QUOTE_SEND_BUSY/)
    await assert.rejects(db.query("update action_case_rfq_deliveries set snapshot='{}' where id=$1", [f.deliveryId]), /RFQ_IMMUTABLE/)
    await assert.rejects(db.query("update action_case_rfq_deliveries set files='[]' where id=$1", [f.deliveryId]), /RFQ_IMMUTABLE/)
    await db.query('delete from action_case_attachments where id=$1', [f.fileId])
    assert.deepEqual((await get('action_case_rfq_deliveries', f.deliveryId)).files, delivery.files)
    await f.write('finish_send', { leaseId: result.leaseId, success: false })
    assert.deepEqual((await f.claim({ files: [], emailPayload: { to: 'attacker@example.test' } })).payload, f.payload)
  }
  const acl = (await db.query("select has_table_privilege('authenticated','action_case_rfq_deliveries','select') allowed, has_function_privilege('anon','claim_action_case_rfq_delivery(uuid,uuid,uuid,uuid,text,jsonb)','execute') execute")).rows[0]
  assert.equal(acl.allowed, false); assert.equal(acl.execute, false)
})

test('foreign org, changed source/file, wrong selected IDs, >30 and mismatched email abort without claiming', async () => {
  const f = await fixture()
  for (const data of [{ expectedUpdatedAt: '2000-01-01' }, { files: [] }, { files: [{ ...f.file, id: id(999) }] }, { files: Array(31).fill(f.file) }, { files: [{ ...f.file, sourcePath: 'another' }] }, { files: [{ ...f.file, path: 'another' }] }, { emailPayload: { ...f.payload, to: 'another@example.test' } }]) {
    await assert.rejects(f.claim(data))
    assert.equal((await get(f.table, f.sourceId)).email_payload, null)
    assert.equal(await get('action_case_rfq_deliveries', f.deliveryId), null)
  }
  await assert.rejects(f.claim({}, id(9)), /NOT_FOUND/)
  await db.query('update action_case_quote_requests set response_document_id=$1 where id=$2', [f.fileId, f.sourceId])
  await assert.rejects(f.claim({ expectedUpdatedAt: (await get(f.table, f.sourceId)).updated_at }), /PRIVATE_DOCUMENT/)
})

test('old pending email remains byte-identical without a new link; sent is idempotent', async () => {
  for (const kind of ['request', 'quote']) {
    const f = await fixture(kind)
    const old = { to: 'ue@example.test', text: 'Old mail', attachments: [{ filename: 'old.jpg', content: 'b2xk' }] }
    const first = await f.write('claim_send', { expectedUpdatedAt: f.data.expectedUpdatedAt, emailPayload: old })
    await f.write('finish_send', { leaseId: first.leaseId, success: false })
    const retry = await f.claim({ files: null, deliveryId: null, tokenHash: null, emailPayload: null })
    assert.deepEqual(retry.payload, old)
    assert.equal(await get('action_case_rfq_deliveries', f.deliveryId), null)
    await f.write('finish_send', { leaseId: retry.leaseId, success: true })
    assert.deepEqual(await f.claim(), { alreadySent: true })
  }
})

test('revocation is tenant scoped, terminal, audited and blocks further sends', async () => {
  const f = await fixture(), result = await f.claim()
  await f.write('finish_send', { leaseId: result.leaseId, success: false })
  const revoke = (org) => db.query('select revoke_action_case_rfq_delivery($1,$2,$3,$4)', [org, f.caseId, f.deliveryId, id(2)])
  await assert.rejects(revoke(id(9)), /NOT_FOUND/)
  await revoke(id(1))
  assert.ok((await get('action_case_rfq_deliveries', f.deliveryId)).revoked_at)
  await assert.rejects(f.claim(), /ACCESS_CLOSED/)
  await assert.rejects(db.query('update action_case_rfq_deliveries set revoked_at=null where id=$1', [f.deliveryId]), /IMMUTABLE/)
  assert.equal((await db.query("select count(*)::int n from action_case_events where action_case_id=$1 and event_type='rfq_link_revoked'", [f.caseId])).rows[0].n, 1)
})

test('public capability checks: expiry, revocation, selected files only; DTO excludes private metadata', async () => {
  const token = 'A'.repeat(43), signed = [], filters = []
  const record = { id: id(5), org_id: id(1), action_case_id: id(3), expires_at: '2099-01-01', created_at: '2026-09-09', revoked_at: null,
    snapshot: { subject: 'Request', body: '<script>untrusted</script>', supplierName: 'UE', supplierEmail: 'ue@example.test', caseTitle: 'Case', propertyAddress: 'Address', internalPrice: 200 },
    files: [{ id: id(6), fileName: 'photo.jpg', contentType: 'image/jpeg', fileSizeBytes: 6000000, type: 'image', path: `${id(1)}/${id(3)}/${id(5)}/${id(6)}` }] }
  const admin = { from() { const chain = { select() { return chain }, eq(key, value) { filters.push([key, value]); return chain }, async maybeSingle() { return { data: record } } }; return chain },
    storage: { from(bucket) { return { async createSignedUrl(...args) { signed.push([bucket, ...args]); return { data: { signedUrl: 'https://storage.example.test/signed' } } } } } } }
  const server = compile('rfqDeliveryServer', { 'server-only': {}, 'node:crypto': crypto, '@/lib/supabase/admin': { createSupabaseAdminClient: () => admin }, '@/lib/assignments/tokens': { hashAssignmentToken: (token) => crypto.createHash('sha256').update(token).digest('hex') }, './quotes': quotes, './rfqDelivery': rfq })
  assert.equal(await server.getRfqPublicView('guess'), null); assert.equal(filters.length, 0)
  const view = await server.getRfqPublicView(token)
  assert.deepEqual(filters[0], ['token_hash', crypto.createHash('sha256').update(token).digest('hex')])
  assert.equal(view.body, record.snapshot.body)
  for (const forbidden of ['supplierEmail', 'org_id', 'internalPrice', 'sourcePath', 'path', 'token_hash']) assert.equal(JSON.stringify(view).includes(`"${forbidden}"`), false)
  await assert.rejects(server.getRfqPublicFileUrl(token, id(99), true), /NOT_FOUND/); assert.equal(signed.length, 0)
  await server.getRfqPublicFileUrl(token, id(6), true)
  assert.deepEqual(signed[0], ['action-case-rfq-files', record.files[0].path, 60, { download: 'photo.jpg' }])
  record.revoked_at = '2026-09-09'
  assert.equal(await server.getRfqPublicView(token), null)
  await assert.rejects(server.getRfqPublicFileUrl(token, id(6), false), /ACCESS_CLOSED/)
  record.revoked_at = null; record.expires_at = '2000-01-01'
  assert.equal(await server.getRfqPublicView(token), null)
  record.expires_at = '2099-01-01'; record.files[0].path = 'other/private'
  await assert.rejects(server.getRfqPublicFileUrl(token, id(6), false), /NOT_FOUND/)
})
