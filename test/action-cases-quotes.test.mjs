import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { normalizeQuote, quoteIsStale, quoteRequestHtml } from '../src/lib/action-cases/quotes.ts'
import { actionCaseCostCoverage, calculateActionCaseCostTotals } from '../src/lib/action-cases/domain.ts'

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
test('quote input, date, price, source and IDs are validated; mail content is escaped', () => {
  const base = { quoteId: id(10), supplierName: ' UE ', amount: '', checked: false }
  assert.equal(normalizeQuote(base).amount, null)
  assert.equal(normalizeQuote({ ...base, amount: 0, checked: true, offeredScope: 'Repair' }).amount, 0)
  for (const change of [{ amount: false }, { amount: -1 }, { amount: [] }, { validUntil: '2026-99-99' }, { validUntil: '2026-02-30' }, { supplierEmail: 'not-mail' }, { checked: true }, { requestAttachmentIds: ['invalid'] }]) assert.throws(() => normalizeQuote({ ...base, ...change }), /ACTION_CASE_QUOTE_INVALID/)
  assert.deepEqual(normalizeQuote({ ...base, requestAttachmentIds: [id(9), id(8), id(9)] }).requestAttachmentIds, [id(8), id(9)])
  assert.ok(!quoteRequestHtml('<script>', '<img src=x>').includes('<img'))
  assert.equal(quoteIsStale({ scopeSnapshot: 'A', descriptionSnapshot: 'B', validUntil: '2026-01-01' }, 'A', 'B', '2026-02-01'), true)
  const rows = [{ quantity: 1, unitCost: 100, markupPercent: 20, verified: true }, { quantity: null, unitCost: null, markupPercent: 0, verified: false, coveredByQuoteId: id(10) }]
  assert.deepEqual(calculateActionCaseCostTotals(rows), { internalCost: 100, customerPrice: 120 })
  assert.equal(actionCaseCostCoverage(rows).complete, true)
})
const db = new PGlite()
const migration = (name) => readFileSync(new URL(`../docs/db/2026-09-08_${name}.sql`, import.meta.url), 'utf8')
before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table organizations(id uuid primary key); create table profiles(id uuid primary key);
    create function is_org_member(uuid) returns boolean language sql as $$ select true $$;
    create function operational_tasks_set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at=clock_timestamp(); return new; end $$;`)
  await db.exec(migration('01_action_cases_foundation').replace('create extension if not exists pgcrypto;', ''))
  await db.exec(`create table action_case_attachments(id uuid primary key,org_id uuid,action_case_id uuid,attachment_type text);`)
  await db.exec(migration('03_action_case_costing'))
  await db.exec(migration('04_action_case_ai_costing'))
  await db.exec(migration('05_action_case_work_quotes'))
  await db.exec(migration('05_action_case_work_quotes'))
  await db.exec(`insert into organizations values('${id(1)}'),('${id(9)}'); insert into profiles values('${id(2)}');
    insert into action_cases(id,org_id,title,customer_name,property_address) values('${id(3)}','${id(1)}','Case','Customer','Address');
    insert into action_case_items(id,org_id,action_case_id,title,scope,own_labor_ready,material_price_ready,waste_solution_ready)
    values('${id(4)}','${id(1)}','${id(3)}','Work','Repair',true,true,true);
    insert into action_case_cost_lines(id,org_id,action_case_id,action_case_item_id,category,description,quantity,unit,unit_cost,markup_percent,quantity_basis,is_verified,verified_by,verified_at,updated_by)
    values('${id(5)}','${id(1)}','${id(3)}','${id(4)}','own_labor','Repair',4,'tim',500,20,'provided',true,'${id(2)}',now(),'${id(2)}'),
      ('${id(6)}','${id(1)}','${id(3)}','${id(4)}','material','Panel',4,'st',100,20,'provided',true,'${id(2)}',now(),'${id(2)}');`)
})
after(() => db.close())
const row = async (table, key) => JSON.parse(JSON.stringify((await db.query(`select * from ${table} where id=$1`, [key])).rows[0]))
const item = () => row('action_case_items', id(4))
const line = () => row('action_case_cost_lines', id(5))
const quote = (n = 10) => row('action_case_work_quotes', id(n))
async function write(operation, data = {}, lineId = id(5), org = id(1)) {
  return (await db.query('select write_action_case_quote($1,$2,$3,$4,$5,$6,$7::jsonb) as result', [org, id(3), id(4), lineId, id(2), operation, JSON.stringify(data)])).rows[0].result
}
const offer = (n, amount = 3000, more = {}) => normalizeQuote({ quoteId: id(n), supplierName: `UE ${n}`, supplierEmail: 'ue@example.test', offeredScope: 'Repair', amount, checked: true, materials: 'included', coveredLineIds: [id(6)], requestSubject: 'Offer request', requestBody: 'Repair only', ...more })

test('legacy hours remain unchanged, alternatives only contribute when selected, included rows excluded', async () => {
  assert.equal(Number((await item()).estimated_cost), 2400)
  await write('method', { method: 'quotes' })
  assert.equal((await item()).estimated_cost, null)
  assert.equal((await line()).unit_cost, null)
  await write('save', offer(10))
  await write('save', offer(11, 3500, { materials: 'excluded', coveredLineIds: [] }))
  await write('save', offer(10))
  assert.equal((await db.query('select * from action_case_work_quotes')).rows.length, 2)
  assert.equal((await item()).estimated_cost, null)
  await write('select', { id: id(10) })
  assert.equal(Number((await item()).estimated_cost), 3000)
  assert.equal(Number((await item()).customer_price), 3600)
  assert.equal((await item()).status, 'ready_for_quote')
  assert.equal((await row('action_case_cost_lines', id(6))).covered_by_quote_id, id(10))
  await assert.rejects(db.query('update action_case_cost_lines set unit_cost=120 where id=$1', [id(6)]), /ACTION_CASE_QUOTE_COVERAGE/)
  await assert.rejects(db.query('delete from action_case_cost_lines where id=$1', [id(6)]), /ACTION_CASE_QUOTE_COVERAGE/)
  await write('select', { id: id(11) })
  assert.equal(Number((await item()).estimated_cost), 3900)
  assert.equal((await row('action_case_cost_lines', id(6))).covered_by_quote_id, null)
  await write('method', { method: 'direct' })
  assert.equal(Number((await line()).quantity), 4)
  assert.equal(Number((await line()).unit_cost), 500)
  assert.equal(Number((await item()).estimated_cost), 2400)
  assert.equal((await line()).is_verified, true)
})

test('selection rejects unreviewed, stale, foreign quotes and overlapping coverage; editing selection deselects', async () => {
  await assert.rejects(write('select', { id: id(10) }, id(5), id(9)), /ACTION_CASE_NOT_FOUND/)
  await write('save', offer(12, null, { checked: false }))
  await assert.rejects(write('select', { id: id(12) }), /ACTION_CASE_QUOTE_UNCHECKED/)
  await write('save', offer(13, 2000, { validUntil: '2000-01-01' }))
  await assert.rejects(write('select', { id: id(13) }), /ACTION_CASE_QUOTE_STALE/)
  await write('select', { id: id(10) })
  await write('create_work', { description: 'Second work' }, id(7))
  await write('save', offer(14), id(7))
  await assert.rejects(write('select', { id: id(14) }, id(7)), /ACTION_CASE_QUOTE_COVERAGE/)
  await assert.rejects(write('select', { id: id(10) }, id(7)), /ACTION_CASE_QUOTE_NOT_FOUND/)
  const q = await quote()
  await write('save', offer(10, 3100, { expectedUpdatedAt: q.updated_at }))
  assert.equal((await line()).selected_quote_id, null)
  assert.equal((await row('action_case_cost_lines', id(6))).covered_by_quote_id, null)
  await assert.rejects(write('save', offer(10, 3200, { expectedUpdatedAt: q.updated_at })), /ACTION_CASE_QUOTE_STALE/)
  await write('select', { id: id(10) })
  await db.query('update action_case_items set scope=$1 where id=$2', ['Changed scope', id(4)])
  assert.equal((await item()).estimated_cost, null)
  await assert.rejects(write('select', { id: id(10) }), /ACTION_CASE_QUOTE_STALE/)
  await db.query('update action_case_items set scope=$1 where id=$2', ['Repair', id(4)])
})

test('email claim freezes payload, rejects simultaneous sends and supports bounded identical retries', async () => {
  const q = await quote(11), payload = { to: 'ue@example.test', text: 'Repair only', attachments: [], idempotencyKey: 'test' }
  const claim = await write('claim_send', { id: id(11), expectedUpdatedAt: q.updated_at, emailPayload: payload })
  assert.deepEqual(claim.payload, payload)
  await assert.rejects(write('claim_send', { id: id(11) }), /ACTION_CASE_QUOTE_SEND_BUSY/)
  await write('finish_send', { id: id(11), leaseId: claim.leaseId, success: false })
  const retry = await write('claim_send', { id: id(11), emailPayload: { to: 'different@example.test' } })
  assert.deepEqual(retry.payload, payload)
  const sent = await quote(11)
  await assert.rejects(write('save', offer(11, 3000, { expectedUpdatedAt: sent.updated_at, supplierEmail: 'different@example.test' })), /ACTION_CASE_QUOTE_SENT_IMMUTABLE/)
  await assert.rejects(write('delete', { id: id(11) }), /ACTION_CASE_QUOTE_SENT_IMMUTABLE/)
  await assert.rejects(db.query('delete from action_case_cost_lines where id=$1', [id(5)]), /ACTION_CASE_QUOTE_SENT_IMMUTABLE/)
  await write('finish_send', { id: id(11), leaseId: claim.leaseId, success: true })
  assert.equal((await quote(11)).sent_at, null, 'old lease cannot finalize a newer attempt')
  await write('finish_send', { id: id(11), leaseId: retry.leaseId, success: true, providerMessageId: 'provider' })
  assert.deepEqual(await write('claim_send', { id: id(11) }), { alreadySent: true })
  const other = await quote(12)
  await write('claim_send', { id: id(12), expectedUpdatedAt: other.updated_at, emailPayload: payload })
  await db.query("update action_case_work_quotes set first_attempt_at=now()-interval '24 hours', delivery_status='unknown' where id=$1", [id(12)])
  await assert.rejects(write('claim_send', { id: id(12) }), /ACTION_CASE_QUOTE_SEND_UNKNOWN/)
})

test('ordinary clients cannot access quotes or call RPC; stale line updates are rejected', async () => {
  const result = await db.query("select has_function_privilege('authenticated','write_action_case_quote(uuid,uuid,uuid,uuid,uuid,text,jsonb)','EXECUTE') as rpc, has_table_privilege('authenticated','action_case_work_quotes','SELECT') as readable")
  assert.deepEqual(result.rows[0], { rpc: false, readable: false })
  await assert.rejects(write('method', { method: 'direct', expectedLineUpdatedAt: '2000-01-01' }), /ACTION_CASE_QUOTE_STALE/)
})

test('deleting an unsent selected work row releases coverage without deleting the material', async () => {
  await write('unselect', { id: id(10) })
  await write('select', { id: id(14) }, id(7))
  await db.query('delete from action_case_cost_lines where id=$1', [id(7)])
  assert.equal((await row('action_case_cost_lines', id(6))).covered_by_quote_id, null)
  assert.equal((await db.query('select count(*) as n from action_case_work_quotes where id=$1', [id(14)])).rows[0].n, 0)
})
