import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { PGlite } from '@electric-sql/pglite'
import * as quotes from '../src/lib/action-cases/quotes.ts'

const module = { exports: {} }
const source = readFileSync(new URL('../src/lib/action-cases/quoteRequests.ts', import.meta.url), 'utf8')
new Function('module', 'exports', 'require', ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(module, module.exports, () => quotes)
const { normalizeQuoteRequest, REQUEST_REQUIREMENTS } = module.exports
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const db = new PGlite()
const migration = (name) => readFileSync(new URL(`../docs/db/2026-09-08_${name}.sql`, import.meta.url), 'utf8')
before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table organizations(id uuid primary key); create table profiles(id uuid primary key);
    create function is_org_member(uuid) returns boolean language sql as $$ select true $$;
    create function operational_tasks_set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at=clock_timestamp(); return new; end $$;`)
  await db.exec(migration('01_action_cases_foundation').replace('create extension if not exists pgcrypto;', ''))
  await db.exec('create table action_case_attachments(id uuid primary key,org_id uuid,action_case_id uuid,attachment_type text);')
  for (const name of ['03_action_case_costing', '04_action_case_ai_costing', '05_action_case_work_quotes', '09_action_case_grouped_requests', '09_action_case_grouped_requests']) await db.exec(migration(name))
  await db.exec(`insert into organizations values('${id(1)}'),('${id(9)}'); insert into profiles values('${id(2)}');`)
})
after(() => db.close())
const row = async (table, key) => JSON.parse(JSON.stringify((await db.query(`select * from ${table} where id=$1`, [key])).rows[0]))
let sequence = 100
async function fixture() {
  const base = sequence; sequence += 100
  const c = id(base), r = id(base + 10)
  const lines = [1, 2].map((n) => ({ itemId: id(base + n), costLineId: id(base + n + 2), itemTitle: `Action ${n}`, scope: `Scope ${n}`, description: `Work ${n}` }))
  await db.query('insert into action_cases(id,org_id,title,customer_name,property_address) values($1,$2,$3,$4,$5)', [c, id(1), 'Case', 'Customer', 'Address'])
  for (const line of lines) {
    await db.query('insert into action_case_items(id,org_id,action_case_id,title,scope,sort_order) values($1,$2,$3,$4,$5,$6)', [line.itemId, id(1), c, line.itemTitle, line.scope, lines.indexOf(line) + 1])
    await db.query("insert into action_case_cost_lines(id,org_id,action_case_id,action_case_item_id,category,description,quantity,unit,unit_cost,quantity_basis,is_verified,verified_by,verified_at) values($1,$2,$3,$4,'own_labor',$5,4,'tim',500,'provided',true,$6,now())", [line.costLineId, id(1), c, line.itemId, line.description, id(2)])
  }
  const input = { requestId: r, supplierName: 'Test UE', supplierEmail: 'ue@example.test', subject: 'Request', lines, requirementKeys: ['travel', 'materials', 'own_waste', 'protection', 'extra_rates'], attachmentIds: [] }
  const write = async (op, data = {}, requestId = r, orgId = id(1)) => (await db.query('select write_action_case_request($1,$2,$3,$4,$5,$6::jsonb) result', [orgId, c, requestId, id(2), op, JSON.stringify(data)])).rows[0].result
  const get = () => row('action_case_quote_requests', r)
  const workQuotes = async () => JSON.parse(JSON.stringify((await db.query('select * from action_case_work_quotes where request_id=$1 order by cost_line_id', [r])).rows))
  const quoteWrite = async (op, data, n = 0) => (await db.query('select write_action_case_quote($1,$2,$3,$4,$5,$6,$7::jsonb) result', [id(1), c, lines[n].itemId, lines[n].costLineId, id(2), op, JSON.stringify(data)])).rows[0].result
  const save = async (more = {}) => write('save', normalizeQuoteRequest({ ...input, ...more }))
  const send = async () => { const claim = await write('claim_send', { expectedUpdatedAt: (await get()).updated_at, emailPayload: { to: 'ue@example.test', text: (await get()).body } }); await write('finish_send', { leaseId: claim.leaseId, success: true }); return claim }
  return { c, r, input, lines, write, get, workQuotes, quoteWrite, save, send }
}

test('selection snapshots only chosen requirements; extra rates are separate; invalid input is rejected', () => {
  const input = { requestId: id(10), supplierName: ' UE ', supplierEmail: 'UE@example.test', subject: 'Request', lines: [{ itemId: id(20), costLineId: id(21), itemTitle: 'Action', scope: ' Scope ', description: 'Work' }], requirementKeys: ['travel', 'extra_rates'], attachmentIds: [] }
  const normalized = normalizeQuoteRequest(input)
  assert.equal(normalized.supplierEmail, 'ue@example.test')
  assert.equal(normalized.lines[0].scope, ' Scope ', 'source snapshots must not be trimmed before database comparison')
  assert.deepEqual(normalized.requirements.map((r) => r.key), ['travel', 'extra_rates'])
  assert.equal(REQUEST_REQUIREMENTS.find((r) => r.key === 'extra_rates').kind, 'separate')
  assert.match(normalized.body, /Redovisa även följande prisuppgifter separat/)
  assert.ok(!normalized.body.includes('mottagningsavgifter'))
  assert.equal(normalizeQuoteRequest({ ...input, requirementKeys: [] }).requirements.length, 0)
  for (const change of [{ lines: [] }, { lines: [...input.lines, ...input.lines] }, { supplierEmail: 'invalid' }, { requirementKeys: ['unknown'] }, { lines: Array(31).fill(input.lines[0]) }]) assert.throws(() => normalizeQuoteRequest({ ...input, ...change }))
})

test('multi-action draft is isolated from existing hours; sending creates exactly one pending alternative per work row', async () => {
  const f = await fixture()
  await f.save(); await f.save()
  assert.equal((await f.workQuotes()).length, 0)
  assert.equal(Number((await row('action_case_cost_lines', f.lines[0].costLineId)).unit_cost), 500)
  const before = await f.get()
  await f.save({ message: 'Updated', expectedUpdatedAt: before.updated_at })
  await assert.rejects(f.save({ expectedUpdatedAt: before.updated_at }), /ACTION_CASE_QUOTE_STALE/)
  await f.send()
  assert.deepEqual(await f.write('claim_send'), { alreadySent: true })
  const alternatives = await f.workQuotes()
  assert.equal(alternatives.length, 2)
  for (const q of alternatives) {
    assert.equal(q.amount, null)
    assert.equal(q.checked, false)
    assert.equal(q.materials, 'unspecified')
    assert.equal(q.delivery_status, 'sent')
  }
  assert.equal((await f.get()).response_mode, 'pending')
  assert.equal((await row('action_case_cost_lines', f.lines[0].costLineId)).pricing_method, 'direct')
  await assert.rejects(f.save({ expectedUpdatedAt: (await f.get()).updated_at }), /ACTION_CASE_QUOTE_SENT_IMMUTABLE/)
  await assert.rejects(f.write('delete', { expectedUpdatedAt: (await f.get()).updated_at }), /ACTION_CASE_QUOTE_SENT_IMMUTABLE/)
})

test('tenant boundaries, stale source and private response documents are checked before sending', async () => {
  const f = await fixture(), other = await fixture()
  await assert.rejects(f.save({ lines: other.lines }), /ACTION_CASE_QUOTE_STALE/)
  await assert.rejects(f.write('save', normalizeQuoteRequest(f.input), f.r, id(9)), /ACTION_CASE_NOT_FOUND/)
  await f.save()
  await assert.rejects(other.write('delete', {}, f.r), /ACTION_CASE_NOT_FOUND/)
  await db.query('update action_case_items set scope=$1 where id=$2', ['New scope', f.lines[0].itemId])
  await assert.rejects(f.send(), /ACTION_CASE_QUOTE_STALE/)
  await db.query('update action_case_items set scope=$1 where id=$2', [f.lines[0].scope, f.lines[0].itemId])
  await other.save(); await other.send()
  const doc = id(9001)
  await db.query("insert into action_case_attachments values($1,$2,$3,'document')", [doc, id(1), other.c])
  await other.write('response', { expectedUpdatedAt: (await other.get()).updated_at, responseMode: 'package', packageAmount: 9000, responseNotes: '', responseDocumentId: doc })
  await assert.rejects(other.save({ requestId: other.r, expectedUpdatedAt: (await other.get()).updated_at, attachmentIds: [doc] }), /ACTION_CASE_QUOTE_SENT_IMMUTABLE/)
  await assert.rejects(f.save({ expectedUpdatedAt: (await f.get()).updated_at, attachmentIds: [doc] }), /ACTION_CASE_FILE_NOT_FOUND/)
  await assert.rejects(other.write('save', normalizeQuoteRequest({ ...other.input, requestId: id(9002), attachmentIds: [doc] }), id(9002)), /ACTION_CASE_QUOTE_PRIVATE_DOCUMENT/)
})

test('uncertain sends retry the frozen email with no duplicate alternatives even if work changes', async () => {
  const f = await fixture(); await f.save()
  const payload = { to: 'ue@example.test', text: (await f.get()).body, attachments: [{ content: 'bytes' }], idempotencyKey: 'fixed' }
  const claim = await f.write('claim_send', { expectedUpdatedAt: (await f.get()).updated_at, emailPayload: payload })
  await assert.rejects(f.write('claim_send'), /ACTION_CASE_QUOTE_SEND_BUSY/)
  await f.write('finish_send', { leaseId: claim.leaseId, success: false })
  await db.query('update action_case_items set scope=$1 where id=$2', ['Changed after sending', f.lines[0].itemId])
  const retry = await f.write('claim_send', { emailPayload: { to: 'different@example.test' } })
  assert.deepEqual(retry.payload, payload)
  assert.equal((await f.workQuotes()).length, 2)
  assert.deepEqual(await f.write('finish_send', { leaseId: claim.leaseId, success: true }), { ignored: true })
  await f.write('finish_send', { leaseId: retry.leaseId, success: false })
  await db.query("update action_case_quote_requests set first_attempt_at=now()-interval '24 hours' where id=$1", [f.r])
  await assert.rejects(f.write('claim_send'), /ACTION_CASE_QUOTE_SEND_UNKNOWN/)
})

test('package prices cannot be chosen per line; confirmed independent prices use the existing kalkyl and can be withdrawn', async () => {
  const f = await fixture(); await f.save(); await f.send()
  const materialId = id(9800)
  await db.query("insert into action_case_cost_lines(id,org_id,action_case_id,action_case_item_id,category,description,quantity,unit,unit_cost) values($1,$2,$3,$4,'material','Panel',4,'st',100)", [materialId, id(1), f.c, f.lines[0].itemId])
  const alternatives = await f.workQuotes()
  for (const [n, q] of alternatives.entries()) {
    await f.quoteWrite('save', quotes.normalizeQuote({ ...quotes.mapQuote(q), quoteId: q.id, expectedUpdatedAt: q.updated_at, amount: 1500, checked: true, offeredScope: f.lines[n].description, materials: 'included', coveredLineIds: n === 0 ? [materialId] : [] }), n)
    await assert.rejects(f.quoteWrite('select', { id: q.id }, n), /ACTION_CASE_REQUEST_PACKAGE_PRICE/)
  }
  const response = async (mode) => f.write('response', { expectedUpdatedAt: (await f.get()).updated_at, responseMode: mode, packageAmount: mode === 'package' ? 2500 : null, responseNotes: '', responseDocumentId: null })
  await response('package')
  assert.equal((await row('action_case_cost_lines', f.lines[0].costLineId)).pricing_method, 'direct')
  await response('itemized')
  for (const [n, q] of alternatives.entries()) await f.quoteWrite('select', { id: q.id }, n)
  assert.equal(Number((await row('action_case_cost_lines', f.lines[0].costLineId)).unit_cost), 1500)
  assert.equal((await row('action_case_cost_lines', materialId)).covered_by_quote_id, alternatives[0].id)
  await response('package')
  assert.equal((await row('action_case_cost_lines', materialId)).covered_by_quote_id, null)
  for (const line of f.lines) {
    const result = await row('action_case_cost_lines', line.costLineId)
    assert.equal(result.selected_quote_id, null)
    assert.equal(result.unit_cost, null)
  }
})

test('supplements are new requests to the same UE; ordinary clients have no direct access', async () => {
  const f = await fixture(); await f.save(); await f.send()
  const newId = id(9900)
  await assert.rejects(f.write('save', normalizeQuoteRequest({ ...f.input, requestId: newId, supplementsId: f.r, supplierEmail: 'other@example.test' }), newId), /ACTION_CASE_REQUEST_INVALID/)
  await f.write('save', normalizeQuoteRequest({ ...f.input, requestId: newId, supplementsId: f.r, lines: [f.lines[0]] }), newId)
  assert.equal((await row('action_case_quote_requests', newId)).supplements_id, f.r)
  assert.equal((await f.get()).delivery_status, 'sent')
  const result = await db.query("select has_function_privilege('authenticated','write_action_case_request(uuid,uuid,uuid,uuid,text,jsonb)','EXECUTE') rpc, has_table_privilege('authenticated','action_case_quote_requests','SELECT') readable")
  assert.deepEqual(result.rows[0], { rpc: false, readable: false })
  await db.query('delete from action_cases where id=$1', [f.c])
  assert.equal((await db.query('select count(*) n from action_case_quote_requests where action_case_id=$1', [f.c])).rows[0].n, 0)
})

test('legacy single-row quotes still select and send with migration 09 installed', async () => {
  const f = await fixture(), quoteId = id(9970)
  await f.quoteWrite('save', quotes.normalizeQuote({ quoteId, supplierName: 'Legacy UE', supplierEmail: 'ue@example.test', amount: 2000, checked: true, offeredScope: 'Work 1', requestSubject: 'Legacy request', requestBody: 'Work 1' }))
  await f.quoteWrite('select', { id: quoteId })
  assert.equal((await row('action_case_cost_lines', f.lines[0].costLineId)).selected_quote_id, quoteId)
  const q = await row('action_case_work_quotes', quoteId)
  const claim = await f.quoteWrite('claim_send', { id: quoteId, expectedUpdatedAt: q.updated_at, emailPayload: { to: 'ue@example.test', text: 'Work 1' } })
  await f.quoteWrite('finish_send', { id: quoteId, leaseId: claim.leaseId, success: true })
  assert.equal((await row('action_case_work_quotes', quoteId)).delivery_status, 'sent')
})
