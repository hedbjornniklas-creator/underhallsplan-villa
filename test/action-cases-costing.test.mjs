import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { normalizeCostLine, parseCostSuggestions } from '../src/lib/action-cases/costing.ts'
import { actionCaseCostCoverage, calculateActionCaseCostTotals } from '../src/lib/action-cases/domain.ts'

const base = { category: 'material', description: 'Material', quantity: '', unit: 'st', unitCost: '', markupPercent: '20', verified: false }
test('unknown is distinct from a real zero price and cannot be verified', () => {
  const line = normalizeCostLine(base)
  assert.equal(line.quantity, null); assert.equal(line.unitCost, null)
  assert.deepEqual(calculateActionCaseCostTotals([line]), { internalCost: null, customerPrice: null })
  assert.deepEqual(calculateActionCaseCostTotals([]), { internalCost: null, customerPrice: null })
  const zero = normalizeCostLine({ ...base, quantity: 2, unitCost: 0, verified: true })
  assert.deepEqual(calculateActionCaseCostTotals([zero]), { internalCost: 0, customerPrice: 0 })
  assert.equal(actionCaseCostCoverage([line, zero]).missingPrice, 1)
  assert.equal(actionCaseCostCoverage([line, zero]).complete, false)
  assert.throws(() => normalizeCostLine({ ...base, verified: true }))
  for (const value of [false, [], {}, -1, Infinity, 'no']) assert.throws(() => normalizeCostLine({ ...base, quantity: value }))
  assert.throws(() => normalizeCostLine({ ...base, sourceUrl: 'javascript:alert(1)' }))
})

test('AI quantities retain their basis and invented prices are discarded', () => {
  const result = parseCostSuggestions({ lines: [{ ...base, quantity: 2, quantityBasis: 'estimated', notes: 'Preliminär arbetstid', unitCost: 123, verified: true }], warnings: [] })
  assert.equal(result.lines[0].quantityBasis, 'estimated')
  assert.equal('unitCost' in result.lines[0], false)
  assert.equal('verified' in result.lines[0], false)
  assert.throws(() => parseCostSuggestions({ lines: [{ ...base, quantity: 2, quantityBasis: 'estimated' }], warnings: [] }))
  assert.throws(() => parseCostSuggestions({ lines: Array(31).fill(base), warnings: [] }))
  assert.throws(() => parseCostSuggestions({ lines: [null], warnings: [] }))
})

const db = new PGlite()
const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const read = (name) => readFileSync(new URL(`../docs/db/${name}`, import.meta.url), 'utf8')
before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table organizations(id uuid primary key); create table profiles(id uuid primary key);
    create function is_org_member(uuid) returns boolean language sql as $$ select true $$;
    create function operational_tasks_set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at = clock_timestamp(); return new; end $$;`)
  await db.exec(read('2026-09-08_01_action_cases_foundation.sql').replace('create extension if not exists pgcrypto;', ''))
  await db.exec(read('2026-09-08_03_action_case_costing.sql'))
  await db.exec(read('2026-09-08_04_action_case_ai_costing.sql'))
  await db.exec(read('2026-09-08_04_action_case_ai_costing.sql'))
  await db.exec(`insert into organizations values('${id(1)}'),('${id(9)}'); insert into profiles values('${id(2)}');
    insert into action_cases(id,org_id,title,customer_name,property_address) values('${id(3)}','${id(1)}','Case','Customer','Address');
    insert into action_case_items(id,org_id,action_case_id,title,scope,own_labor_ready,material_price_ready,waste_solution_ready)
    values('${id(4)}','${id(1)}','${id(3)}','Work','Repair',true,true,true);`)
})
after(() => db.close())

async function write(operation, lines, suggestion = null, org = id(1)) {
  return db.query('select write_action_case_costs($1,$2,$3,$4,$5,$6::jsonb,$7)', [org, id(3), id(4), id(2), operation, JSON.stringify(lines), suggestion])
}
async function item() { return (await db.query('select * from action_case_items where id=$1', [id(4)])).rows[0] }
async function lines() { return (await db.query('select * from action_case_cost_lines order by sort_order')).rows }

test('cost writes recalculate totals; incomplete/unverified amounts block ready status', async () => {
  await write('add', [normalizeCostLine(base)])
  assert.equal((await item()).estimated_cost, null)
  assert.equal((await item()).status, 'pricing_needed')
  const line = (await lines())[0]
  await write('update', [{ ...normalizeCostLine({ ...base, quantity: 2, unitCost: 100, verified: true }), id: line.id }])
  assert.equal(Number((await item()).estimated_cost), 200)
  assert.equal(Number((await item()).customer_price), 240)
  assert.equal((await item()).status, 'ready_for_quote')
  await write('update', [{ ...normalizeCostLine({ ...base, quantity: 2, unitCost: 110 }), id: line.id }])
  assert.equal((await item()).status, 'pricing_needed')
  assert.equal((await lines())[0].verified_by, null)
  await write('delete', [{ id: line.id }])
  assert.equal((await item()).estimated_cost, null)
})

test('selected proposals append atomically and retrying does not duplicate rows', async () => {
  await write('add', [normalizeCostLine({ ...base, description: 'Existing', quantity: 1, unitCost: 50, verified: true })])
  const before = (await lines())[0]
  const source = await item()
  const proposed = [
    { id: id(6), category: 'own_labor', description: 'Work', quantity: 2, unit: 'tim', quantityBasis: 'estimated', notes: 'Estimate' },
    { id: id(7), category: 'waste', description: 'Waste', quantity: null, unit: 'kg', quantityBasis: 'unknown', notes: 'Weigh waste' },
  ]
  await db.query('insert into action_case_cost_suggestions(id,org_id,action_case_id,action_case_item_id,source_updated_at,model,lines) values($1,$2,$3,$4,$5,$6,$7)', [id(5), id(1), id(3), id(4), source.updated_at, 'mock', JSON.stringify(proposed)])
  await assert.rejects(write('apply', [{ id: id(6) }], id(5), id(9)), /ACTION_CASE_NOT_FOUND/)
  await assert.rejects(write('apply', [{ id: id(99) }], id(5)), /ACTION_CASE_COST_LINE_INVALID/)
  await write('apply', [{ id: id(6) }, { id: id(6) }], id(5))
  const after = await lines()
  assert.equal(after.length, 2)
  assert.deepEqual(after[0], before)
  assert.equal(after[1].unit_cost, null)
  assert.equal(after[1].is_verified, false)
  assert.equal(after[1].quantity_basis, 'estimated')
  await write('apply', [{ id: id(6) }], id(5))
  assert.equal((await lines()).length, 2)
  assert.equal((await item()).estimated_cost, null)
})

test('scope or cost changes invalidate older suggestions', async () => {
  const source = await item()
  const proposed = [{ id: id(11), category: 'material', description: 'New', quantity: null, unit: 'st', quantityBasis: 'unknown', notes: null }]
  await db.query('insert into action_case_cost_suggestions(id,org_id,action_case_id,action_case_item_id,source_updated_at,model,lines) values($1,$2,$3,$4,$5,$6,$7)', [id(10), id(1), id(3), id(4), source.updated_at, 'mock', JSON.stringify(proposed)])
  await db.query('update action_case_items set scope=$1 where id=$2', ['Changed work', id(4)])
  await assert.rejects(write('apply', [{ id: id(11) }], id(10)), /ACTION_CASE_AI_STALE/)
  const before = await lines()
  await assert.rejects(write('add', [normalizeCostLine(base), { ...normalizeCostLine(base), category: 'invalid' }]))
  assert.deepEqual(await lines(), before, 'failed batch rolls back all rows and totals')
})

test('RPC is not callable by an ordinary client; sent cases do not regress', async () => {
  const grants = await db.query("select has_function_privilege('authenticated','write_action_case_costs(uuid,uuid,uuid,uuid,text,jsonb,uuid)','EXECUTE') as allowed")
  assert.equal(grants.rows[0].allowed, false)
  await db.query('update action_cases set status=$1 where id=$2', ['approved', id(3)])
  await write('add', [normalizeCostLine(base)])
  assert.equal((await db.query('select status from action_cases where id=$1', [id(3)])).rows[0].status, 'approved')
})
