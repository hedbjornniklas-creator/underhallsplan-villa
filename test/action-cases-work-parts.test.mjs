import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { PGlite } from '@electric-sql/pglite'
import * as parts from '../src/lib/action-cases/workParts.ts'

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const version = '2026-09-09T10:00:00.123456+00:00'
const base = { caseId: id(10), itemId: id(20), expectedUpdatedAt: version }
const normalize = (payload) => parts.normalizeWorkPartAction({ ...base, ...payload })

test('normalization supports optional scopes, explicit ungrouping, and microsecond item versions', () => {
  assert.deepEqual(normalize({ operation: 'save', title: ' Roof ' }), { ...base, operation: 'save', partId: null, title: 'Roof' })
  assert.deepEqual(normalize({ operation: 'save', partId: id(3), title: 'Roof', scope: '  ', sortOrder: 50 }),
    { ...base, operation: 'save', partId: id(3), title: 'Roof', scope: null, sortOrder: 50 })
  assert.deepEqual(normalize({ operation: 'move_lines', partId: null, costLineIds: [id(3), id(4)] }),
    { ...base, operation: 'move_lines', partId: null, costLineIds: [id(3), id(4)] })
  assert.deepEqual(parts.mapWorkPart({ id: id(3), title: 'Roof', scope: null, sort_order: '100', updated_at: version }),
    { id: id(3), title: 'Roof', scope: null, sortOrder: 100, updatedAt: version })
  for (const change of [
    { title: '' }, { title: 'a'.repeat(301) }, { title: 'x\0' }, { title: [] }, { scope: {} }, { scope: 'x'.repeat(12001) },
    { sortOrder: null }, { sortOrder: 0 }, { sortOrder: 1.1 }, { sortOrder: '10' }, { partId: '' },
    { expectedUpdatedAt: undefined }, { expectedUpdatedAt: 'now' }, { expectedUpdatedAt: '2026-09-09' }, { caseId: 'invalid' },
  ]) assert.throws(() => normalize({ operation: 'save', title: 'Roof', ...change }))
  for (const operation of ['move_lines', 'bulk_update']) {
    for (const costLineIds of [[], [id(3), id(3)], [null], ['bad'], {}, Array(101).fill(id(3))]) {
      assert.throws(() => normalize({ operation, partId: null, costLineIds, unitCost: 50 }))
    }
  }
  const mixedCaseId = 'abcdefab-abcd-abcd-abcd-abcdefabcdef'
  assert.throws(() => normalize({ operation: 'move_lines', partId: null, costLineIds: [mixedCaseId, mixedCaseId.toUpperCase()] }))
  assert.throws(() => normalize({ operation: 'move_lines', costLineIds: [id(3)] }))
  assert.throws(() => normalize({ operation: 'delete', partId: null }))
  assert.throws(() => normalize({ operation: 'unknown' }))
})

test('bulk patches preserve omitted fields and accept generic units, free prices, unknown costs and hours', () => {
  assert.deepEqual(normalize({ operation: 'bulk_update', costLineIds: [id(3)], quantity: '2.5', unit: ' m2 ', unitCost: 0, markupPercent: -100, verified: true }),
    { ...base, operation: 'bulk_update', costLineIds: [id(3)], quantity: 2.5, unit: 'm2', unitCost: 0, markupPercent: -100 })
  assert.deepEqual(normalize({ operation: 'bulk_update', costLineIds: [id(3)], unitCost: null }),
    { ...base, operation: 'bulk_update', costLineIds: [id(3)], unitCost: null })
  for (const patch of [{}, { unitCost: '' }, { unitCost: ' ' }, { unitCost: false }, { unitCost: [] }, { unitCost: -1 },
    { unitCost: undefined }, { unitCost: Infinity }, { unitCost: 'NaN' }, { unitCost: 1e12 },
    { quantity: 0 }, { quantity: 0.0001 }, { quantity: -1 }, { quantity: 1e11 },
    { markupPercent: null }, { markupPercent: '' }, { markupPercent: -101 }, { markupPercent: 1001 },
    { unit: '' }, { unit: null }, { unit: 'x'.repeat(31) },
  ]) assert.throws(() => normalize({ operation: 'bulk_update', costLineIds: [id(3)], ...patch }), /COST_LINE_INVALID/)
})

const serverSource = ts.transpileModule(readFileSync(new URL('../src/lib/action-cases/workPartsServer.ts', import.meta.url), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
function serverHarness(response = { data: { id: id(30) }, error: null }) {
  const calls = [], mod = { exports: {} }
  new Function('module', 'exports', 'require', serverSource)(mod, mod.exports, (name) => {
    if (name === './workParts') return parts
    if (name === '@/lib/supabase/admin') return { createSupabaseAdminClient: () => ({ rpc: async (...args) => { calls.push(args); return response } }) }
    if (name === 'server-only') return {}
    throw new Error(`Unexpected dependency: ${name}`)
  })
  return { api: mod.exports, calls }
}

test('server uses one tenant-scoped RPC, strips protected fields, and follows ID/void return conventions', async () => {
  const { api, calls } = serverHarness(), ctx = { orgId: id(1), userId: id(2) }
  assert.equal(await api.handleWorkPartAction(ctx, { ...base, operation: 'save', title: 'Roof' }), id(30))
  assert.equal(await api.handleWorkPartAction(ctx, { ...base, operation: 'save', title: 'New', partId: id(30) }), id(30))
  assert.equal(await api.handleWorkPartAction(ctx, { ...base, operation: 'delete', partId: id(30) }), undefined)
  assert.equal(await api.handleWorkPartAction(ctx, { ...base, operation: 'move_lines', partId: null, costLineIds: [id(3)] }), undefined)
  assert.equal(await api.handleWorkPartAction(ctx, { ...base, operation: 'bulk_update', costLineIds: [id(3)], unitCost: '20', quantity: 2, unit: 'm2', verified: true, category: 'other', workPartId: id(999) }), undefined)
  assert.equal(calls.length, 5)
  assert.deepEqual(calls.at(-1), ['write_action_case_work_part', { p_org_id: id(1), p_case_id: id(10), p_item_id: id(20), p_user_id: id(2), p_operation: 'bulk_update',
    p_data: { expectedUpdatedAt: version, costLineIds: [id(3)], quantity: 2, unit: 'm2', unitCost: 20 } }])
  await assert.rejects(api.handleWorkPartAction(ctx, { ...base, operation: 'bulk_update', costLineIds: [id(3)], unitCost: false }))
  assert.equal(calls.length, 5)
})

test('server preserves actionable errors and identifies missing migrations', async () => {
  const invoke = (response) => serverHarness(response).api.handleWorkPartAction({ orgId: id(1), userId: id(2) }, { ...base, operation: 'save', title: 'Roof' })
  for (const code of ['PGRST202', 'PGRST204', 'PGRST205', '42883', '42P01', '42703']) {
    await assert.rejects(invoke({ error: { code, message: 'missing schema' } }), /ACTION_CASES_SCHEMA_REQUIRED/)
  }
  for (const message of ['ACTION_CASE_NOT_FOUND', 'ACTION_CASE_ITEM_STALE', 'ACTION_CASE_ITEM_LOCKED', 'ACTION_CASE_WORK_PART_NOT_FOUND',
    'ACTION_CASE_WORK_PART_INVALID', 'ACTION_CASE_COST_LINE_INVALID', 'ACTION_CASE_COST_LINE_NOT_FOUND', 'ACTION_CASE_COST_LINE_DIRECT_REQUIRED', 'ACTION_CASE_QUOTE_COVERAGE', 'ACTION_CASE_PACKAGE_REMOVE_FIRST']) {
    await assert.rejects(invoke({ error: { code: 'P0001', message: `error: ${message}` } }), new RegExp(message))
  }
  await assert.rejects(invoke({ error: { code: 'other', message: 'internal' } }), /ACTION_CASE_WORK_PART_WRITE_FAILED/)
  await assert.rejects(invoke({ data: null, error: null }), /ACTION_CASE_WORK_PART_WRITE_FAILED/)
})

const db = new PGlite()
const migration = (name) => readFileSync(new URL(`../docs/db/${name}.sql`, import.meta.url), 'utf8')
const workPartsMigration = migration('2026-09-09_03_action_case_work_parts')
const row = async (table, key) => (await db.query(`select to_jsonb(t) as value from ${table} t where id=$1`, [key])).rows[0]?.value
let sequence = 100
async function fixture() {
  const n = sequence; sequence += 100
  const c = id(n), itemId = id(n + 1), siblingId = id(n + 2), ids = [id(n + 3), id(n + 4), id(n + 5)]
  await db.query('insert into action_cases(id,org_id,title,customer_name,property_address) values($1,$2,\'Case\',\'Customer\',\'Address\')', [c, id(1)])
  await db.query(`insert into action_case_items(id,org_id,action_case_id,title,scope,sort_order,own_labor_ready,material_price_ready,waste_solution_ready)
    values($1,$3,$4,'Roof','Original scope',100,true,true,true),($2,$3,$4,'Wall','Other scope',200,true,true,true)`, [itemId, siblingId, id(1), c])
  for (const [index, lineId] of ids.entries()) {
    await db.query(`insert into action_case_cost_lines(id,org_id,action_case_id,action_case_item_id,category,description,quantity,unit,unit_cost,
      markup_percent,quantity_basis,notes,price_source,source_url,is_verified,verified_by,verified_at,source_checked_at,sort_order,updated_by)
      values($1,$2,$3,$4,$5,$6,4,$7,100,10,'estimated','Evidence','price_book','https://example.test',true,$8,now(),now(),$9,$8)`,
    [lineId, id(1), c, index === 2 ? siblingId : itemId, index === 1 ? 'material' : 'own_labor', `Line ${index}`, index === 1 ? 'm2' : 'tim', id(2), (index + 1) * 100])
  }
  const item = () => row('action_case_items', itemId)
  const lines = () => Promise.all(ids.map((key) => row('action_case_cost_lines', key)))
  const write = async (operation, data = {}, context = {}) => (await db.query('select write_action_case_work_part($1,$2,$3,$4,$5,$6::jsonb) as result',
    [context.orgId ?? id(1), context.caseId ?? c, context.itemId ?? itemId, id(2), operation, JSON.stringify({ expectedUpdatedAt: (await item()).updated_at, ...data })])).rows[0].result
  return { c, itemId, siblingId, ids, item, lines, write }
}
let legacy, legacyLines
before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table organizations(id uuid primary key); create table profiles(id uuid primary key);
    create function is_org_member(uuid) returns boolean language sql as $$ select true $$;
    create function operational_tasks_set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at=clock_timestamp(); return new; end $$;`)
  await db.exec(migration('2026-09-08_01_action_cases_foundation').replace('create extension if not exists pgcrypto;', ''))
  await db.exec('create table action_case_attachments(id uuid primary key,org_id uuid,action_case_id uuid,action_case_item_id uuid,attachment_type text);')
  for (const name of ['2026-09-08_03_action_case_costing', '2026-09-08_04_action_case_ai_costing', '2026-09-08_05_action_case_work_quotes',
    '2026-09-08_09_action_case_grouped_requests', '2026-09-09_02_action_case_scope_attachments']) await db.exec(migration(name))
  await db.exec(`insert into organizations values('${id(1)}'),('${id(9)}'); insert into profiles values('${id(2)}');`)
  legacy = await fixture(); legacyLines = await legacy.lines()
  await db.exec(workPartsMigration)
})
after(() => db.close())

test('PGlite migration is repeatable, adds no default parts and preserves legacy costing/versions', async () => {
  assert.deepEqual(await legacy.lines(), legacyLines.map((line) => ({ ...line, work_part_id: null })))
  assert.equal((await db.query('select count(*) as n from action_case_work_parts')).rows[0].n, 0)
  const f = await fixture(), part = await f.write('save', { title: 'Roof covering', scope: 'Tiles and flashing' })
  await f.write('move_lines', { partId: part.id, costLineIds: f.ids.slice(0, 2) })
  const saved = await row('action_case_work_parts', part.id), lines = await f.lines(), item = await f.item()
  await db.exec(workPartsMigration)
  assert.deepEqual(await row('action_case_work_parts', part.id), saved)
  assert.deepEqual(await f.lines(), lines)
  assert.deepEqual(await f.item(), item)
})

test('CRUD preserves omitted scope/sort, advances item versions, and delete ungroups without deleting costs', async () => {
  const f = await fixture(), oldVersion = (await f.item()).updated_at
  const part = await f.write('save', { title: ' Roof ', scope: ' Tiles ' })
  const second = await f.write('save', { title: 'Scaffolding' })
  assert.equal((await row('action_case_work_parts', part.id)).sort_order, 100)
  assert.equal((await row('action_case_work_parts', second.id)).sort_order, 200)
  assert.notEqual((await f.item()).updated_at, oldVersion)
  await f.write('save', { partId: part.id, title: 'Covering' })
  assert.equal((await row('action_case_work_parts', part.id)).scope, 'Tiles')
  assert.equal((await row('action_case_work_parts', part.id)).sort_order, 100)
  await f.write('save', { partId: part.id, title: 'Covering', scope: null, sortOrder: 50 })
  assert.equal((await row('action_case_work_parts', part.id)).scope, null)
  assert.equal((await row('action_case_work_parts', part.id)).sort_order, 50)
  await f.write('move_lines', { partId: part.id, costLineIds: f.ids.slice(0, 2) })
  const grouped = await f.lines(), beforeMove = (await f.item()).updated_at
  await f.write('move_lines', { partId: second.id, costLineIds: [f.ids[0]] })
  assert.notEqual((await f.item()).updated_at, beforeMove)
  assert.equal((await f.lines())[0].work_part_id, second.id)
  await f.write('move_lines', { partId: null, costLineIds: [f.ids[0]] })
  await f.write('delete', { partId: part.id })
  const ungrouped = await f.lines()
  assert.equal(await row('action_case_work_parts', part.id), undefined)
  for (let n = 0; n < 2; n++) {
    assert.equal(ungrouped[n].work_part_id, null)
    for (const key of ['quantity', 'unit', 'unit_cost', 'markup_percent', 'is_verified', 'verified_at', 'description', 'sort_order']) assert.deepEqual(ungrouped[n][key], grouped[n][key])
  }
  await f.write('delete', { partId: second.id })
  assert.equal((await db.query('select count(*) n from action_case_work_parts where action_case_item_id=$1', [f.itemId])).rows[0].n, 0)
})

test('RPC and composite FKs reject cross-item/case/org associations and nonexistent parts/lines', async () => {
  const f = await fixture(), other = await fixture()
  const part = await f.write('save', { title: 'Roof' }), foreign = await other.write('save', { title: 'Other' })
  for (const context of [{ orgId: id(9) }, { caseId: other.c }, { itemId: other.itemId }]) {
    await assert.rejects(f.write('save', { title: 'Invalid' }, context), /ACTION_CASE_NOT_FOUND/)
  }
  for (const operation of ['save', 'delete', 'move_lines']) {
    await assert.rejects(f.write(operation, { title: 'Invalid', partId: foreign.id, costLineIds: [f.ids[0]] }), /ACTION_CASE_WORK_PART_NOT_FOUND/)
  }
  for (const lineId of [f.ids[2], other.ids[0], id(999999)]) {
    await assert.rejects(f.write('move_lines', { partId: part.id, costLineIds: [f.ids[0], lineId] }), /ACTION_CASE_COST_LINE_NOT_FOUND/)
    await assert.rejects(f.write('bulk_update', { costLineIds: [f.ids[0], lineId], quantity: 10 }), /ACTION_CASE_COST_LINE_NOT_FOUND/)
  }
  await assert.rejects(db.query('update action_case_cost_lines set work_part_id=$1 where id=$2', [foreign.id, f.ids[0]]), /action_case_cost_lines_work_part_fk/)
  await assert.rejects(db.query('update action_case_cost_lines set work_part_id=$1 where id=$2', [part.id, f.ids[2]]), /action_case_cost_lines_work_part_fk/)
  for (const values of [[id(9), f.c, f.itemId], [id(1), other.c, f.itemId], [id(1), f.c, other.itemId]]) {
    await assert.rejects(db.query("insert into action_case_work_parts(org_id,action_case_id,action_case_item_id,title) values($1,$2,$3,'Invalid')", values), /action_case_work_parts_(?:case|item)_fk/)
  }
  assert.equal((await f.lines())[0].work_part_id, null)
})

test('bulk costing patches selected direct rows atomically, resets verification, and recalculates totals', async () => {
  const f = await fixture(), before = await f.lines(), part = await f.write('save', { title: 'Roof' })
  await f.write('move_lines', { partId: part.id, costLineIds: f.ids.slice(0, 2) })
  await f.write('bulk_update', { costLineIds: f.ids.slice(0, 2), unitCost: 250 })
  const changed = await f.lines()
  for (let n = 0; n < 2; n++) {
    assert.equal(changed[n].unit_cost, 250)
    assert.equal(changed[n].is_verified, false)
    for (const key of ['verified_by', 'verified_at', 'source_checked_at']) assert.equal(changed[n][key], null)
    for (const key of ['quantity', 'unit', 'quantity_basis', 'notes', 'markup_percent', 'description', 'category', 'sort_order']) assert.deepEqual(changed[n][key], before[n][key])
    assert.equal(changed[n].price_source, 'manual')
    assert.equal(changed[n].source_url, null)
    assert.equal(changed[n].work_part_id, part.id)
  }
  assert.deepEqual(changed[2], before[2])
  assert.equal((await f.item()).estimated_cost, 2000)
  assert.equal((await f.item()).customer_price, 2200)
  assert.equal((await f.item()).own_labor_ready, false)
  assert.equal((await f.item()).material_price_ready, false)
  assert.equal((await f.item()).status, 'pricing_needed')
  await f.write('bulk_update', { costLineIds: [f.ids[0]], quantity: 2.5, unit: 'tim', markupPercent: 20 })
  assert.equal((await f.lines())[0].quantity_basis, 'provided')
  assert.equal((await f.lines())[0].quantity, 2.5)
  await f.write('bulk_update', { costLineIds: [f.ids[1]], quantity: 3, unit: 'm2', unitCost: 0 })
  assert.equal((await f.lines())[1].category, 'material')
  assert.equal((await f.lines())[1].unit_cost, 0)
  await f.write('bulk_update', { costLineIds: [f.ids[0]], quantity: null, unitCost: null })
  assert.equal((await f.lines())[0].quantity_basis, 'unknown')
  assert.equal((await f.item()).estimated_cost, null)
})

test('quantity/markup-only edits retain rate provenance while an entered rate becomes manual', async () => {
  const f = await fixture()
  await db.query("update action_case_cost_lines set price_source='ai_suggestion' where id=$1", [f.ids[0]])
  await f.write('bulk_update', { costLineIds: [f.ids[0]], markupPercent: 25 })
  let line = (await f.lines())[0]
  assert.equal(line.quantity_basis, 'estimated')
  assert.equal(line.price_source, 'ai_suggestion')
  assert.equal(line.source_url, 'https://example.test')
  await f.write('bulk_update', { costLineIds: [f.ids[0]], quantity: 8 })
  line = (await f.lines())[0]
  assert.equal(line.quantity_basis, 'provided')
  assert.equal(line.price_source, 'ai_suggestion')
  assert.equal(line.unit_cost, 100)
  await f.write('bulk_update', { costLineIds: [f.ids[0]], unitCost: 150 })
  line = (await f.lines())[0]
  assert.equal(line.price_source, 'manual')
  assert.equal(line.source_url, null)
  assert.equal(line.quantity_basis, 'provided')
  assert.equal(line.markup_percent, 25)
})

test('stale/missing item timestamps reject every operation and replay without partial state/audit changes', async () => {
  const f = await fixture(), part = await f.write('save', { title: 'Roof' })
  const expectedUpdatedAt = (await f.item()).updated_at
  await f.write('bulk_update', { costLineIds: [f.ids[0]], quantity: 8, expectedUpdatedAt })
  const lines = await f.lines(), item = await f.item()
  const events = async () => (await db.query('select count(*) n from action_case_events where action_case_id=$1', [f.c])).rows[0].n
  const count = await events()
  for (const operation of ['save', 'delete', 'move_lines', 'bulk_update']) {
    for (const stale of [expectedUpdatedAt, null, undefined]) {
      await assert.rejects(f.write(operation, { partId: part.id, title: 'Changed', costLineIds: f.ids.slice(0, 2), quantity: 20, expectedUpdatedAt: stale }), /ACTION_CASE_ITEM_STALE/)
    }
  }
  assert.deepEqual(await f.lines(), lines)
  assert.deepEqual(await f.item(), item)
  assert.equal(await events(), count)
  assert.equal((await row('action_case_work_parts', part.id)).title, 'Roof')
})

test('database independently rejects malformed patches and rolls back totals, membership and events', async () => {
  const f = await fixture(), part = await f.write('save', { title: 'Roof' }), lines = await f.lines(), item = await f.item()
  for (const patch of [{}, { quantity: 0 }, { quantity: -1 }, { quantity: 0.0001 }, { unitCost: false }, { unitCost: '10' },
    { unitCost: -1 }, { quantity: 1e11 }, { unitCost: 1e12 }, { markupPercent: null }, { markupPercent: 1001 },
    { unit: null }, { unit: {} }, { unit: '' }, { unit: 'x'.repeat(31) }]) {
    await assert.rejects(f.write('bulk_update', { costLineIds: f.ids.slice(0, 2), ...patch }), /ACTION_CASE_COST_LINE_INVALID/)
  }
  for (const costLineIds of [[], [f.ids[0], f.ids[0]], [null], ['bad'], Array(101).fill(f.ids[0])]) {
    await assert.rejects(f.write('move_lines', { partId: part.id, costLineIds }), /ACTION_CASE_WORK_PART_INVALID/)
  }
  for (const patch of [{ title: '' }, { title: 1 }, { scope: {} }, { sortOrder: null }, { sortOrder: 1.5 }, { sortOrder: 0 }, { sortOrder: 2147483647 }]) {
    await assert.rejects(f.write('save', { title: 'Roof', partId: part.id, ...patch }), /ACTION_CASE_WORK_PART_INVALID/)
  }
  // A valid numeric range can still overflow the existing item aggregate column.
  await assert.rejects(f.write('bulk_update', { costLineIds: f.ids.slice(0, 2), quantity: 99999999999.999, unitCost: 999999999999.99 }), /ACTION_CASE_COST_LINE_INVALID/)
  assert.deepEqual(await f.lines(), lines)
  assert.deepEqual(await f.item(), item)
})

async function selectQuote(f, covered = []) {
  const quoteId = id(sequence++)
  await db.query(`insert into action_case_work_quotes(id,org_id,action_case_id,action_case_item_id,cost_line_id,supplier_name,amount,offered_scope,
    checked,scope_snapshot,description_snapshot,covered_line_ids,materials) values($1,$2,$3,$4,$5,'UE',500,'Original scope',true,'Original scope','Line 0',$6,'included')`,
  [quoteId, id(1), f.c, f.itemId, f.ids[0], covered])
  await db.query("select write_action_case_quote($1,$2,$3,$4,$5,'select',$6::jsonb)", [id(1), f.c, f.itemId, f.ids[0], id(2), JSON.stringify({ id: quoteId })])
  return quoteId
}

test('quote-priced and covered rows cannot be bulk-edited, moved or implicitly ungrouped by deletion', async () => {
  const f = await fixture(), part = await f.write('save', { title: 'Roof' })
  await f.write('move_lines', { partId: part.id, costLineIds: f.ids.slice(0, 2) })
  await selectQuote(f, [f.ids[1]])
  const lines = await f.lines(), item = await f.item()
  for (const operation of ['bulk_update', 'move_lines']) {
    await assert.rejects(f.write(operation, { partId: null, costLineIds: [f.ids[0]], quantity: 10 }), /ACTION_CASE_COST_LINE_DIRECT_REQUIRED/)
    await assert.rejects(f.write(operation, { partId: null, costLineIds: f.ids.slice(0, 2), quantity: 10 }), /ACTION_CASE_QUOTE_COVERAGE/)
  }
  await assert.rejects(f.write('delete', { partId: part.id }), /ACTION_CASE_QUOTE_COVERAGE/)
  await assert.rejects(db.query('delete from action_case_work_parts where id=$1', [part.id]), /ACTION_CASE_(?:QUOTE_COVERAGE|COST_LINE_DIRECT_REQUIRED)/)
  await assert.rejects(db.query('update action_case_cost_lines set work_part_id=null where id=$1', [f.ids[0]]), /ACTION_CASE_COST_LINE_DIRECT_REQUIRED/)
  assert.deepEqual(await f.lines(), lines)
  assert.deepEqual(await f.item(), item)
  assert.ok(await row('action_case_work_parts', part.id))
  await db.query('delete from action_cases where id=$1', [f.c])
  assert.equal(await row('action_case_work_parts', part.id), undefined, 'parent cascades remain possible')
})

test('selected/covered prices block part content edits through RPC and SQL but not sort-only updates', async () => {
  const f = await fixture()
  const work = await f.write('save', { title: 'Work', scope: 'Install roof' })
  const material = await f.write('save', { title: 'Material', scope: 'Roof tiles' })
  await f.write('move_lines', { partId: work.id, costLineIds: [f.ids[0]] })
  await f.write('move_lines', { partId: material.id, costLineIds: [f.ids[1]] })
  const quoteId = await selectQuote(f, [f.ids[1]])
  const before = await f.lines(), quote = await row('action_case_work_quotes', quoteId)
  for (const partId of [work.id, material.id]) {
    const part = await row('action_case_work_parts', partId)
    await assert.rejects(f.write('save', { partId, title: `${part.title} changed` }), /ACTION_CASE_QUOTE_COVERAGE/)
    await assert.rejects(f.write('save', { partId, title: part.title, scope: 'Changed' }), /ACTION_CASE_QUOTE_COVERAGE/)
    await assert.rejects(f.write('save', { partId, title: part.title, scope: null }), /ACTION_CASE_QUOTE_COVERAGE/)
    await assert.rejects(db.query('update action_case_work_parts set title=$1 where id=$2', ['Changed', partId]), /ACTION_CASE_QUOTE_COVERAGE/)
    await assert.rejects(db.query('update action_case_work_parts set scope=$1 where id=$2', ['Changed', partId]), /ACTION_CASE_QUOTE_COVERAGE/)
    await f.write('save', { partId, title: part.title, scope: part.scope, sortOrder: 50 })
    assert.equal((await row('action_case_work_parts', partId)).sort_order, 50)
    await db.query('update action_case_work_parts set sort_order=75 where id=$1', [partId])
    assert.equal((await row('action_case_work_parts', partId)).sort_order, 75)
    await assert.rejects(db.query('update action_case_work_parts set action_case_item_id=$1 where id=$2', [f.siblingId, partId]), /ACTION_CASE_WORK_PART_INVALID/)
  }
  assert.deepEqual(await f.lines(), before)
  assert.deepEqual(await row('action_case_work_quotes', quoteId), quote)
  await db.query("select write_action_case_quote($1,$2,$3,$4,$5,'unselect',$6::jsonb)",
    [id(1), f.c, f.itemId, f.ids[0], id(2), JSON.stringify({ id: quoteId })])
  for (const partId of [work.id, material.id]) {
    await f.write('save', { partId, title: 'New scope', scope: 'Changed after price removal' })
    assert.equal((await row('action_case_work_parts', partId)).scope, 'Changed after price removal')
  }
})

test('all non-draft item/case statuses block every new operation without regressing the workflow', async () => {
  const f = await fixture(), part = await f.write('save', { title: 'Roof' })
  // The existing costing trigger deliberately preserves an old locked status.
  async function itemStatus(status) {
    await db.exec('alter table action_case_items disable trigger trg_action_case_item_cost_state')
    try { await db.query('update action_case_items set status=$1 where id=$2', [status, f.itemId]) }
    finally { await db.exec('alter table action_case_items enable trigger trg_action_case_item_cost_state') }
  }
  for (const status of ['offered','approved','declined','scheduled','in_progress','ready_for_review','completed','cancelled']) {
    await itemStatus(status)
    for (const operation of ['save', 'delete', 'move_lines', 'bulk_update']) {
      await assert.rejects(f.write(operation, { partId: part.id, title: 'Changed', costLineIds: [f.ids[0]], unitCost: 20 }), /ACTION_CASE_ITEM_LOCKED/)
    }
    assert.equal((await f.item()).status, status)
  }
  await itemStatus('pricing_needed')
  for (const status of ['awaiting_customer','approved','in_progress','completed','cancelled']) {
    await db.query('update action_cases set status=$1 where id=$2', [status, f.c])
    for (const operation of ['save', 'delete', 'move_lines', 'bulk_update']) {
      await assert.rejects(f.write(operation, { partId: part.id, title: 'Changed', costLineIds: [f.ids[0]], unitCost: 20 }), /ACTION_CASE_ITEM_LOCKED/)
    }
    await assert.rejects(db.query('update action_case_cost_lines set work_part_id=$1 where id=$2', [part.id, f.ids[0]]), /ACTION_CASE_ITEM_LOCKED/)
    assert.equal((await row('action_cases', f.c)).status, status)
  }
})

test('sent grouped requests and quote snapshots stay byte-for-byte unchanged while direct costing evolves', async () => {
  const f = await fixture(), requestId = id(sequence++)
  const snapshots = [{ itemId: f.itemId, costLineId: f.ids[0], itemTitle: 'Roof', scope: 'Original scope', description: 'Line 0' }]
  const requestWrite = async (op, data) => (await db.query('select write_action_case_request($1,$2,$3,$4,$5,$6::jsonb) result',
    [id(1), f.c, requestId, id(2), op, JSON.stringify(data)])).rows[0].result
  await requestWrite('save', { supplierName: 'UE', supplierEmail: 'ue@example.test', subject: 'Roof request', message: '', otherRequirements: '', body: 'Original scope', lines: snapshots, requirements: [], attachmentIds: [] })
  const claim = await requestWrite('claim_send', { expectedUpdatedAt: (await row('action_case_quote_requests', requestId)).updated_at,
    emailPayload: { to: 'ue@example.test', text: 'Original scope', idempotencyKey: 'fixed' } })
  await requestWrite('finish_send', { leaseId: claim.leaseId, success: true })
  const request = await row('action_case_quote_requests', requestId)
  const quotes = async () => (await db.query('select to_jsonb(q) value from action_case_work_quotes q where request_id=$1 order by id', [requestId])).rows.map((r) => r.value)
  const sentQuotes = await quotes()
  const part = await f.write('save', { title: 'Roof covering', scope: 'Revised internal grouping' })
  await f.write('move_lines', { partId: part.id, costLineIds: f.ids.slice(0, 2) })
  await f.write('bulk_update', { costLineIds: [f.ids[0]], quantity: 8, unitCost: 200 })
  await f.write('save', { partId: part.id, title: 'Internal title', scope: 'Internal revision' })
  await f.write('delete', { partId: part.id })
  assert.deepEqual(await row('action_case_quote_requests', requestId), request)
  assert.deepEqual(await quotes(), sentQuotes)
})

test('new RPC and parts table are service-role only, and part changes invalidate existing AI proposals', async () => {
  const result = (await db.query(`select
    has_function_privilege('authenticated','write_action_case_work_part(uuid,uuid,uuid,uuid,text,jsonb)','EXECUTE') client_rpc,
    has_function_privilege('anon','write_action_case_work_part(uuid,uuid,uuid,uuid,text,jsonb)','EXECUTE') anon_rpc,
    has_function_privilege('service_role','write_action_case_work_part(uuid,uuid,uuid,uuid,text,jsonb)','EXECUTE') server_rpc,
    has_table_privilege('authenticated','action_case_work_parts','SELECT') readable,
    has_table_privilege('authenticated','action_case_work_parts','INSERT,UPDATE,DELETE') writable,
    (select relrowsecurity from pg_class where oid='action_case_work_parts'::regclass) rls`)).rows[0]
  assert.deepEqual(result, { client_rpc: false, anon_rpc: false, server_rpc: true, readable: false, writable: false, rls: true })
  const f = await fixture(), suggestionId = id(sequence++)
  await db.query(`insert into action_case_cost_suggestions(id,org_id,action_case_id,action_case_item_id,source_updated_at,model,lines)
    select $1,org_id,action_case_id,id,updated_at,'test','[]'::jsonb from action_case_items where id=$2`, [suggestionId, f.itemId])
  await f.write('save', { title: 'Scope changed' })
  await assert.rejects(db.query("select write_action_case_costs($1,$2,$3,$4,'apply',$5::jsonb,$6)",
    [id(1), f.c, f.itemId, id(2), JSON.stringify([{ id: id(999999) }]), suggestionId]), /ACTION_CASE_AI_STALE/)
})
