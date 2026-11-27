import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { normalizeCalculationReserve, normalizeCostLine } from '../src/lib/action-cases/costing.ts'
import { calculateActionCaseCostTotals, costLineCustomerAmount } from '../src/lib/action-cases/domain.ts'
import { workItemSum } from '../src/lib/action-cases/workSums.ts'
import { billingCalculation } from '../src/lib/action-cases/projectPricingFlow.ts'

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const line = patch => ({ id: id(4), category: 'material', description: 'Test', unit: 'st', quantity: 1, unitCost: 1000, markupPercent: 10, reservePercent: 5, vatRate: 25, verified: false, ...patch })
test('reserve precedes contractor fee, while base cost and agreed customer prices stay separate', () => {
  for (const category of ['material', 'own_labor', 'subcontractor', 'transport', 'waste', 'other']) {
    const row = line({ category })
    assert.deepEqual(calculateActionCaseCostTotals([row]), { internalCost: 1000, customerPrice: 1155 })
    assert.deepEqual(workItemSum({ costLines: [row] }, 'excl'), { amountOre: 115500, partial: false })
    assert.equal(billingCalculation({ costLines: [row] }).grossOre, 144375)
  }
  assert.equal(calculateActionCaseCostTotals([line({ reservePercent: 0 })]).customerPrice, 1100)
  assert.equal(calculateActionCaseCostTotals([line({ unitCost: 0 })]).customerPrice, 0)
  assert.equal(calculateActionCaseCostTotals([line({ unitCost: null })]).customerPrice, null)
  assert.equal(costLineCustomerAmount(line({ unitCost: null })), null)
  assert.equal(calculateActionCaseCostTotals([line(), line({ coveredByQuoteId: id(10) })]).customerPrice, 1155)
})
test('reserve validation distinguishes omission from explicit reset and rejects invalid input', () => {
  const input = { category: 'material', description: 'Test', unit: 'st', quantity: 1, unitCost: 1000, markupPercent: 10 }
  assert.equal('reservePercent' in normalizeCostLine(input), false)
  assert.equal(normalizeCostLine({ ...input, reservePercent: '5' }).reservePercent, 5)
  assert.equal(normalizeCalculationReserve(''), 0)
  for (const reservePercent of [-1, 1001, 'NaN', Infinity, true, {}, []]) assert.throws(() => normalizeCostLine({ ...input, reservePercent }))
})

const db = new PGlite(), sql = name => readFileSync(new URL(`../docs/db/${name}.sql`, import.meta.url), 'utf8')
const migration = sql('2026-11-27_01_calculation_reserve')
before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth; create function auth.role() returns text language sql as $$select coalesce(current_setting('test.role',true),'service_role')$$;
    create table organizations(id uuid primary key); create table profiles(id uuid primary key);
    create table org_members(org_id uuid,profile_id uuid,is_active boolean);
    create function is_org_member(uuid) returns boolean language sql as $$select true$$;
    create function operational_tasks_set_updated_at() returns trigger language plpgsql as $$begin new.updated_at=clock_timestamp(); return new; end$$;
    create function contract_work_locked(uuid,uuid,uuid) returns boolean language sql as $$select coalesce(current_setting('test.locked',true),'false')='true'$$;`)
  await db.exec(sql('2026-09-08_01_action_cases_foundation').replace('create extension if not exists pgcrypto;', ''))
  await db.exec('create table action_case_attachments(id uuid primary key);')
  for (const name of ['2026-09-08_03_action_case_costing', '2026-09-08_04_action_case_ai_costing', '2026-09-08_05_action_case_work_quotes', '2026-10-01_05_action_case_lump_sum', '2026-11-02_01_action_case_calculation_autosave']) await db.exec(sql(name))
  await db.exec(`insert into organizations values('${id(1)}'); insert into profiles values('${id(2)}'),('${id(9)}'); insert into org_members values('${id(1)}','${id(2)}',true);`)
})
after(() => db.close())
let seq = 100
async function fixture() {
  const n = seq; seq += 10
  const c = id(n), i = id(n + 1), l = id(n + 2)
  await db.query("insert into action_cases(id,org_id,title,customer_name,property_address) values($1,$2,'Fictional','Test','Test')", [c, id(1)])
  await db.query("insert into action_case_items(id,org_id,action_case_id,title,scope) values($1,$2,$3,'Test','Preserved scope')", [i, id(1), c])
  await db.query("insert into action_case_cost_lines(id,org_id,action_case_id,action_case_item_id,category,description,quantity,unit,unit_cost,markup_percent,quantity_basis) values($1,$2,$3,$4,'material','Test',1,'st',1000,10,'provided')", [l, id(1), c, i])
  const item = async () => (await db.query('select to_jsonb(t) as data from action_case_items t where id=$1', [i])).rows[0].data
  const row = async () => (await db.query('select to_jsonb(t) as data from action_case_cost_lines t where id=$1', [l])).rows[0].data
  const payload = reserve => ({ id: l, create: false, ...normalizeCostLine({ ...line(), ...reserve }) })
  const save = async (data, requestId = id(seq++), stamp, actor = id(2)) => {
    const version = stamp ?? (await item()).updated_at
    return { requestId, stamp: version, result: (await db.query('select save_action_case_calculation_with_reserve($1,$2,$3,$4,$5,$6,$7,$8) as data', [id(1), c, i, actor, requestId, version, 'line', JSON.stringify(data)])).rows[0].data }
  }
  return { c, i, l, item, row, payload, save }
}
test('additive migration is repeatable and does not rewrite existing costs, totals, scope or versions', async () => {
  const f = await fixture(), originalItem = await f.item(), originalRow = await f.row()
  await db.exec(migration); await db.exec(migration)
  assert.deepEqual(await f.item(), originalItem)
  const { reserve_percent, ...rest } = await f.row()
  assert.equal(reserve_percent, 0); assert.deepEqual(rest, originalRow)
})
test('atomic save persists the reserve and returns the final recalculated version; retry writes once', async () => {
  const f = await fixture(), data = f.payload({ reservePercent: 5 })
  const saved = await f.save(data), current = await f.item()
  assert.equal(current.estimated_cost, 1000); assert.equal(current.customer_price, 1155); assert.equal(current.scope, 'Preserved scope')
  assert.equal((await f.row()).reserve_percent, 5); assert.equal(saved.result.updatedAt, current.updated_at)
  const before = await db.query('select count(*)::int as n from action_case_events where action_case_id=$1', [f.c])
  assert.deepEqual((await f.save(data, saved.requestId, saved.stamp)).result, saved.result)
  assert.deepEqual(await db.query('select count(*)::int as n from action_case_events where action_case_id=$1', [f.c]), before)
  await assert.rejects(f.save(f.payload({ reservePercent: 6 }), saved.requestId, saved.stamp), /CONFLICT/)
})
test('omitting reserve preserves it, while an explicit zero resets it', async () => {
  const f = await fixture(); await f.save(f.payload({ reservePercent: 5 }))
  const data = f.payload({ reservePercent: 5 }); delete data.reservePercent
  await f.save(data); assert.equal((await f.row()).reserve_percent, 5); assert.equal((await f.item()).customer_price, 1155)
  await f.save(f.payload({ reservePercent: 0 })); assert.equal((await f.row()).reserve_percent, 0); assert.equal((await f.item()).customer_price, 1100)
})
test('stale, unauthorized, malformed and contract-locked saves leave all data untouched', async () => {
  const f = await fixture(), before = await f.item(), row = await f.row(), valid = f.payload({ reservePercent: 5 })
  await assert.rejects(f.save(valid, id(seq++), '2000-01-01T00:00:00Z'), /STALE/)
  await assert.rejects(f.save(valid, id(seq++), undefined, id(9)), /NOT_FOUND/)
  for (const reservePercent of [-1, 1001, null, true, 'NaN', 'bad']) await assert.rejects(f.save({ ...valid, reservePercent }), /INVALID/)
  await db.exec("set test.locked='true'")
  await assert.rejects(f.save(valid), /CONTRACT_LOCKED/)
  await db.exec("set test.locked='false'")
  assert.deepEqual(await f.item(), before); assert.deepEqual(await f.row(), row)
  assert.equal((await db.query("select has_function_privilege('authenticated','public.save_action_case_calculation_with_reserve(uuid,uuid,uuid,uuid,uuid,timestamptz,text,jsonb)','execute') as allowed")).rows[0].allowed, false)
})
