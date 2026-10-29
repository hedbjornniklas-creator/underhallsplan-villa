import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { PGlite } from '@electric-sql/pglite'
import { costCompletionPayload } from '../src/lib/action-cases/costCompletion.ts'

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const stamp = '2026-10-19T08:00:00.123456Z'
const body = { caseId: id(3), itemId: id(4), costLineId: id(5), expectedUpdatedAt: stamp, complete: true }
function load(path, deps) {
  const output = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const m = { exports: {} }
  new Function('require', 'module', 'exports', output)(name => { assert.ok(name in deps, name); return deps[name] }, m, m.exports)
  return m.exports
}
test('completion accepts only an explicit boolean and exact scoped identities/version, never a price patch', () => {
  assert.deepEqual(costCompletionPayload({ ...body, unitCost: 1, quantity: 999, orgId: id(9), userId: id(9) }), body)
  for (const complete of [undefined, null, 'true', 1]) assert.throws(() => costCompletionPayload({ ...body, complete }))
  for (const field of ['caseId', 'itemId', 'costLineId']) assert.throws(() => costCompletionPayload({ ...body, [field]: '../other' }))
  for (const expectedUpdatedAt of ['', undefined, 'yesterday']) assert.throws(() => costCompletionPayload({ ...body, expectedUpdatedAt }), /STALE/)
})
test('server uses only the dedicated completion RPC, with session organization and actor', async () => {
  const calls = []
  const server = load('../src/lib/action-cases/costCompletionServer.ts', { 'server-only': {}, './costCompletion': { costCompletionPayload },
    '@/lib/supabase/admin': { createSupabaseAdminClient: () => ({ async rpc(...args) { calls.push(args); return { error: null } } }) } })
  await server.setCostLineComplete({ orgId: id(1), userId: id(2) }, { ...body, unitCost: 1 })
  assert.deepEqual(calls, [['set_action_case_cost_complete', { p_org_id: id(1), p_user_id: id(2), p_case_id: id(3), p_item_id: id(4), p_line_id: id(5), p_expected_updated_at: stamp, p_complete: true }]])
  await assert.rejects(server.setCostLineComplete({ orgId: id(1), userId: id(2) }, { ...body, complete: 'yes' }))
  assert.equal(calls.length, 1)
})

test('completion API requires Uppdrag access and returns conflicts without replaying prices', async () => {
  for (const failure of [null, 'UNAUTHORIZED', 'MODULE_ACCESS_REQUIRED', 'ACTION_CASE_ITEM_STALE', 'ACTION_CASES_SCHEMA_REQUIRED']) {
    const calls=[]
    const unused = Object.fromEntries(['server','costingAiServer','costingAiAlerts','quotesServer','quoteRequestsServer','workPartsServer','quotePackagesServer','rfqDeliveryServer','scopeDraft'].map(name => [`@/lib/action-cases/${name}`,{}]))
    const route = load('../src/app/api/action-cases/route.ts', { ...unused,
      'next/server': {NextResponse:{json:(data,init)=>Response.json(data,init)}},
      '@/lib/assignments/server': {requireOrgContext:async()=>{if(failure==='UNAUTHORIZED')throw Error(failure);return {orgId:id(1),userId:id(2)}}},
      '@/lib/access/server': {requireModuleAccess:async access=>{assert.equal(access.moduleKey,'tasks');if(failure==='MODULE_ACCESS_REQUIRED')throw Error(failure)}},
      '@/lib/action-cases/server': {getActionCaseWorkspace:async()=>({cases:[]})},
      '@/lib/action-cases/contractWorkServer': {assertContractWorkMutation:async()=>{}},
      '@/lib/action-cases/costCompletionServer': {setCostLineComplete:async(ctx,payload)=>{calls.push({ctx,payload:costCompletionPayload(payload)});if(failure)throw Error(failure)}}
    })
    const res = await route.POST(new Request('https://example.test/api/action-cases',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'set_cost_line_complete',payload:{...body,unitCost:1}})}))
    assert.equal(res.status,({UNAUTHORIZED:401,MODULE_ACCESS_REQUIRED:403,ACTION_CASE_ITEM_STALE:409,ACTION_CASES_SCHEMA_REQUIRED:503})[failure]??200)
    assert.equal(calls.length,['UNAUTHORIZED','MODULE_ACCESS_REQUIRED'].includes(failure)?0:1)
    if(calls.length)assert.deepEqual(calls[0],{ctx:{orgId:id(1),userId:id(2)},payload:body})
  }
})

const db = new PGlite()
const sql = name => readFileSync(new URL(`../docs/db/${name}.sql`, import.meta.url), 'utf8')
const migration = sql('2026-10-19_02_action_case_cost_completion')
before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth; create function auth.role() returns text language sql as $$ select coalesce(current_setting('test.auth_role',true),'service_role') $$;
    create table organizations(id uuid primary key); create table profiles(id uuid primary key);
    create table org_members(org_id uuid,profile_id uuid,is_active boolean);
    create function is_org_member(uuid) returns boolean language sql as $$ select true $$;
    create function operational_tasks_set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at=clock_timestamp(); return new; end $$;`)
  await db.exec(sql('2026-09-08_01_action_cases_foundation').replace('create extension if not exists pgcrypto;', ''))
  await db.exec('create table action_case_attachments(id uuid primary key);')
  for (const name of ['2026-09-08_03_action_case_costing','2026-09-08_04_action_case_ai_costing','2026-09-08_05_action_case_work_quotes','2026-10-01_05_action_case_lump_sum']) await db.exec(sql(name))
  await db.exec(`create table action_case_quote_packages(anchor_line_id uuid,state text);
    create table action_case_customer_contract_drafts(id uuid primary key,body jsonb);
    create table action_case_customer_offers(id uuid primary key,body jsonb);
    insert into action_case_customer_contract_drafts values('${id(50)}','{"contractPrice":12345,"scope":"Frozen customer text"}');
    insert into action_case_customer_offers values('${id(51)}','{"acceptedPrice":12345,"signed":true}');
    insert into organizations values('${id(1)}'),('${id(9)}'); insert into profiles values('${id(2)}'),('${id(8)}');
    insert into org_members values('${id(1)}','${id(2)}',true),('${id(1)}','${id(8)}',false);`)
  await db.exec(migration)
})
after(() => db.close())
let seq = 100
async function fixture({ cost = 64000, quantity = 1 } = {}) {
  const n = seq; seq += 10
  const c = id(n), i = id(n+1), l = id(n+2)
  await db.query("insert into action_cases(id,org_id,title,customer_name,property_address) values($1,$2,'Fictitious case','Test','Test')", [c,id(1)])
  await db.query("insert into action_case_items(id,org_id,action_case_id,title,scope,own_labor_ready,material_price_ready,waste_solution_ready) values($1,$2,$3,'Plaster','Fictitious scope',true,true,true)", [i,id(1),c])
  await db.query("insert into action_case_cost_lines(id,org_id,action_case_id,action_case_item_id,category,description,quantity,unit,unit_cost,markup_percent,quantity_basis,notes) values($1,$2,$3,$4,'other','Plaster',$5,'paket',$6,17.16,$7,'Saved original evidence')", [l,id(1),c,i,quantity,cost,quantity===null?'unknown':'estimated'])
  const item = async () => (await db.query('select to_jsonb(t) as value from action_case_items t where id=$1',[i])).rows[0].value
  const line = async () => (await db.query('select to_jsonb(t) as value from action_case_cost_lines t where id=$1',[l])).rows[0].value
  const version = async () => (await item()).updated_at
  const complete = async (value, context={}) => db.query('select set_action_case_cost_complete($1,$2,$3,$4,$5,$6,$7)', [context.orgId??id(1),context.caseId??c,context.itemId??i,context.userId??id(2),context.lineId??l,context.version??await version(),value])
  return {c,i,l,item,line,version,complete}
}
const commercial = row => Object.fromEntries(Object.entries(row).filter(([key]) => !['is_verified','verified_by','verified_at','source_checked_at','updated_by','updated_at'].includes(key)))

test('migration is repeatable; marking and reopening never change money, scope, evidence or contracts', async () => {
  const f = await fixture(), original = commercial(await f.line()), priced = await f.item()
  const contracts = await db.query('select * from action_case_customer_contract_drafts')
  const offers = await db.query('select * from action_case_customer_offers')
  await db.exec(migration)
  assert.deepEqual(commercial(await f.line()), original)
  const firstVersion = await f.version()
  await f.complete(true)
  assert.equal((await f.line()).is_verified,true)
  assert.equal((await f.item()).status,'ready_for_quote')
  const eventCount = () => db.query("select count(*)::int as n from action_case_events where action_case_item_id=$1 and event_type='cost_line_completion'",[f.i])
  await f.complete(true,{version:firstVersion})
  assert.equal((await eventCount()).rows[0].n,1)
  await assert.rejects(f.complete(false,{version:firstVersion}),/ITEM_STALE/)
  await f.complete(false)
  assert.equal((await f.line()).is_verified,false)
  assert.deepEqual(commercial(await f.line()),original)
  assert.equal((await f.item()).customer_price,priced.customer_price)
  assert.equal((await f.item()).estimated_cost,priced.estimated_cost)
  assert.equal((await f.item()).scope,priced.scope)
  assert.deepEqual(await db.query('select * from action_case_customer_contract_drafts'),contracts)
  assert.deepEqual(await db.query('select * from action_case_customer_offers'),offers)
})
test('zero is a price, missing amount or quantity cannot be marked done', async () => {
  const zero = await fixture({cost:0}); await zero.complete(true)
  assert.equal((await zero.line()).is_verified,true)
  for (const input of [{cost:null},{quantity:null}]) {
    const f=await fixture(input), before=await f.line()
    await assert.rejects(f.complete(true),/COST_LINE_INVALID/)
    assert.deepEqual(await f.line(),before)
  }
})
test('concurrent price changes reject an old completion instead of overwriting the newer amount', async () => {
  const f=await fixture(), oldVersion=await f.version()
  await db.query('update action_case_cost_lines set unit_cost=70000 where id=$1',[f.l])
  await assert.rejects(f.complete(true,{version:oldVersion}),/ITEM_STALE/)
  assert.equal(Number((await f.line()).unit_cost),70000)
  assert.equal((await f.line()).is_verified,false)
})
test('tenant, actor, project, line and terminal-state boundaries are checked before a completion write', async () => {
  const f=await fixture(), other=await fixture(), before=await f.line()
  for (const context of [{orgId:id(9)},{userId:id(8)},{caseId:other.c},{itemId:other.i},{lineId:other.l}]) await assert.rejects(f.complete(true,context),/NOT_FOUND/)
  assert.deepEqual(await f.line(),before)
  // Production publication sets terminal state outside the ordinary costing trigger.
  await db.exec('alter table action_case_items disable trigger trg_action_case_item_cost_state')
  try { await db.query("update action_case_items set status='offered' where id=$1",[f.i]) }
  finally { await db.exec('alter table action_case_items enable trigger trg_action_case_item_cost_state') }
  assert.equal((await f.item()).status,'offered')
  await assert.rejects(f.complete(true),/ITEM_LOCKED/)
  const g=await fixture(); await db.query("update action_cases set status='approved' where id=$1",[g.c])
  await assert.rejects(g.complete(true),/ITEM_LOCKED/)
})
test('quote-derived rows and active package anchors cannot be rewritten using Klar', async () => {
  const f=await fixture()
  await db.query("insert into action_case_quote_packages values($1,'active')",[f.l])
  await assert.rejects(f.complete(true),/DIRECT_REQUIRED/)
  const q=await fixture()
  await db.query("update action_case_cost_lines set category='own_labor',pricing_method='quotes' where id=$1",[q.l])
  await assert.rejects(q.complete(true),/DIRECT_REQUIRED/)
})
test('ordinary clients cannot call the completion RPC; a wrong service role also fails', async () => {
  for (const role of ['anon','authenticated']) {
    const {rows}=await db.query("select has_function_privilege($1,'set_action_case_cost_complete(uuid,uuid,uuid,uuid,uuid,timestamptz,boolean)','EXECUTE') as allowed",[role])
    assert.equal(rows[0].allowed,false)
  }
  const f=await fixture(); await db.exec("set test.auth_role='authenticated'")
  await assert.rejects(f.complete(true),/NOT_FOUND/)
  await db.exec("set test.auth_role='service_role'")
})
