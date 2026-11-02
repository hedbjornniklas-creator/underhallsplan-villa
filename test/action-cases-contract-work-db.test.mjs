import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { emptyCustomerOffer, normalizeCustomerOffer } from '../src/lib/action-cases/customerOffers.ts'

const db = new PGlite(), org = randomUUID(), actor = randomUUID(), manager = randomUUID()
const read = name => readFileSync(new URL(`../docs/db/${name}.sql`, import.meta.url), 'utf8').replace('create extension if not exists pgcrypto;', '')
const linkMigration = '2026-10-29_01_contract_work_link', taskMigration = '2026-10-29_02_contract_signed_copy_task'
let legacy, legacyDocument, legacyBefore
before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table organizations(id uuid primary key); create table profiles(id uuid primary key);
    create table org_members(org_id uuid,profile_id uuid,role text,is_active boolean);
    create table properties(id uuid primary key default gen_random_uuid(),owner uuid,name text,municipality text,cadastral_id text,address text,postal_code text,city text);
    create table organization_contacts(id uuid primary key);
    create function is_org_member(uuid) returns boolean language sql as $$select true$$;
    create function is_valid_swedish_organization_number(text) returns boolean language sql as $$select true$$;
    create function operational_tasks_set_updated_at() returns trigger language plpgsql as $$begin new.updated_at=clock_timestamp(); return new; end$$;
    create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`)
  for (const name of ['2026-09-08_01_action_cases_foundation','2026-09-08_02_action_case_files_and_participants','2026-09-08_03_action_case_costing',
    '2026-09-08_04_action_case_ai_costing','2026-09-08_05_action_case_work_quotes','2026-09-08_09_action_case_grouped_requests',
    '2026-09-09_02_action_case_scope_attachments','2026-09-09_03_action_case_work_parts','2026-09-09_04_action_case_package_pricing','2026-09-10_05_organization_customers',
    '2026-09-29_01_action_case_customer_offers','2026-09-29_02_customer_offer_pricing','2026-09-29_03_customer_offer_internal_costing',
    '2026-09-29_04_customer_offer_planning','2026-10-01_02_customer_contract_choices','2026-10-01_03_customer_payment_plan',
    '2026-10-01_04_action_case_schedule','2026-10-01_05_action_case_lump_sum','2026-10-05_01_action_case_scope_notes',
    '2026-10-06_01_action_case_scope_conditions','2026-10-06_01_action_case_organization_customer','2026-10-07_02_action_case_property',
    '2026-10-07_03_contract_assignment_documents','2026-10-08_01_independent_customer_contract','2026-10-08_02_contract_other_agreements',
    '2026-10-08_03_contract_advice_fields','2026-10-08_04_contract_pricing','2026-10-10_01_contract_change_pricing',
    '2026-10-10_02_payment_plan_automation','2026-10-10_03_optional_final_payment','2026-10-11_01_contract_site_facilities',
    '2026-10-11_02_contract_signing_documents','2026-10-11_03_optional_contract_locking','2026-10-11_04_contract_signing_delivery']) await db.exec(read(name))
  await db.exec(`alter table action_cases add column manager_profile_id uuid references profiles(id); create table task_access_links(id uuid primary key);`)
  const taskSql=read('2026-08-20_01_operational_tasks_foundation')
  // Use the production table constraints, including approval and actor shape.
  for (const table of ['operational_tasks','task_events']) {
    const start=taskSql.indexOf(`create table if not exists public.${table} (`)
    await db.exec(taskSql.slice(start,taskSql.indexOf(');',start)+2))
  }
  await db.query('insert into organizations values($1)', [org])
  await db.query('insert into profiles values($1),($2)', [actor,manager])
  await db.query("insert into org_members values($1,$2,'admin',true),($1,$3,'member',true)", [org,actor,manager])
  legacy=await fixture()
  const old=await legacy.state(); old.body.items[0].scopeExclusions='Avtalad avgransning som saknas i projektet'
  await legacy.save(old.body)
  legacyDocument=(await legacy.freeze()).document
  legacyBefore={draft:await legacy.state(),work:(await db.query('select * from action_case_items where id=$1',[legacy.item])).rows[0],document:(await db.query('select * from action_case_contract_signing_documents where id=$1',[legacyDocument])).rows[0]}
  await db.exec(read(linkMigration)); await db.exec(read(taskMigration))
})
after(() => db.close())

let calculationInstalled = false
async function calculationFixture() {
  if (!calculationInstalled) {
    await db.exec(`create schema if not exists auth;
      create or replace function auth.role() returns text language sql as $$select coalesce(current_setting('request.jwt.claim.role',true),'service_role')$$;`)
    await db.exec(read('2026-10-19_02_action_case_cost_completion'))
    await db.exec(read('2026-11-02_01_action_case_calculation_autosave'))
    await db.exec(read('2026-11-02_01_action_case_calculation_autosave'))
    calculationInstalled = true
  }
  const f = await fixture()
  const version = async () => (await db.query('select updated_at::text stamp from action_case_items where id=$1', [f.item])).rows[0].stamp
  const write = async (operation, data, options = {}) => (await db.query('select save_action_case_calculation($1,$2,$3,$4,$5,$6,$7,$8) result',
    [options.org ?? org, f.project, f.item, options.actor ?? actor, options.requestId ?? randomUUID(), options.version ?? await version(), operation, data])).rows[0].result
  return { ...f, version, write }
}

test('background calculation saves create exactly one row and replay atomically with the original microsecond version', async () => {
  const f = await calculationFixture(), id = randomUUID(), requestId = randomUUID(), version = await f.version(), before = await f.state()
  const data = { id, create: true, category: 'material', description: 'Gratis testprodukt', quantity: 2, unit: 'st', unitCost: 0, markupPercent: 15, priceSource: 'manual', quantityBasis: 'provided', verified: false }
  const first = await f.write('line', data, { requestId, version })
  const replay = await f.write('line', data, { requestId, version })
  assert.deepEqual(first, replay)
  assert.equal((await db.query('select count(*) n from action_case_cost_lines where id=$1', [id])).rows[0].n, 1)
  assert.equal((await db.query("select count(*) n from action_case_events where action_case_item_id=$1 and event_type='calculation_saved'", [f.item])).rows[0].n, 1)
  await assert.rejects(f.write('line', { ...data, unitCost: 1 }, { requestId, version }), /REQUEST_CONFLICT/)
  await assert.rejects(f.write('line', { ...data, create: false, unitCost: 1 }, { version }), /ITEM_STALE/)
  const saved = (await db.query('select quantity,unit_cost from action_case_cost_lines where id=$1', [id])).rows[0]
  assert.equal(Number(saved.unit_cost), 0)
  assert.deepEqual(await f.state(), before, 'internal costs cannot change the contract price or revision')
})

test('calculation writers retain null instead of inventing zero, and Klar never replays stale prices', async () => {
  const f = await calculationFixture()
  const data = { id: f.line, create: false, category: 'material', description: 'Testprodukt', quantity: 1, unit: 'st', unitCost: null, markupPercent: 0, priceSource: 'manual', quantityBasis: 'provided', verified: false }
  await f.write('line', data)
  assert.equal((await db.query('select unit_cost from action_case_cost_lines where id=$1', [f.line])).rows[0].unit_cost, null)
  await assert.rejects(f.write('complete', { id: f.line, complete: true }), /COST_LINE_INVALID/)
  await f.write('line', { ...data, unitCost: 123 })
  await f.write('complete', { id: f.line, complete: true })
  const completed = (await db.query('select unit_cost,is_verified from action_case_cost_lines where id=$1', [f.line])).rows[0]
  assert.equal(Number(completed.unit_cost), 123); assert.equal(completed.is_verified, true)
  await f.write('complete', { id: f.line, complete: false })
  await f.write('delete_line', { id: f.line })
  assert.equal((await db.query('select count(*) n from action_case_cost_lines where id=$1', [f.line])).rows[0].n, 0)
})

test('work-part creation returns its stable ID and lump-sum saves preserve underlying rows and contract prices', async () => {
  const f = await calculationFixture(), version = await f.version(), requestId = randomUUID(), before = await f.state()
  const data = { operation: 'save', partId: null, title: 'Snickeri', scope: 'Testomfattning' }
  const first = await f.write('work_part', data, { requestId, version })
  assert.ok(first.partId)
  assert.deepEqual(await f.write('work_part', data, { requestId, version }), first)
  await f.write('work_part', { ...data, partId: first.partId, title: 'Snickeri och dörrar' })
  assert.equal((await db.query('select count(*) n from action_case_work_parts where action_case_item_id=$1', [f.item])).rows[0].n, 1)
  await f.write('lump_sum', { lumpSum: { customerPrice: 0, internalCost: null, vatRate: 25, verified: false } })
  await assert.rejects(f.write('line', { id: f.line, create: false }), /ITEM_LOCKED/)
  await f.write('lump_sum', { lumpSum: null })
  assert.equal((await db.query('select count(*) n from action_case_cost_lines where id=$1', [f.line])).rows[0].n, 1)
  assert.deepEqual(await f.state(), before)
})

test('background saves reject foreign actors, tenants, browser roles and all mutations on a frozen contract', async () => {
  const f = await calculationFixture(), unknown = randomUUID()
  await assert.rejects(f.write('delete_line', { id: f.line }, { actor: unknown }), /NOT_FOUND/)
  await assert.rejects(f.write('delete_line', { id: f.line }, { org: unknown }), /NOT_FOUND/)
  await db.exec("set request.jwt.claim.role='authenticated'")
  await assert.rejects(f.write('delete_line', { id: f.line }), /NOT_FOUND/)
  await db.exec("set request.jwt.claim.role='service_role'")
  await f.freeze()
  const before = await f.state(), rows = (await db.query('select * from action_case_cost_lines where action_case_item_id=$1', [f.item])).rows
  for (const operation of ['line','delete_line','complete','work_part','markup','lump_sum']) await assert.rejects(f.write(operation, { id: f.line }), /CONTRACT_LOCKED/)
  assert.deepEqual(await f.state(), before)
  assert.deepEqual((await db.query('select * from action_case_cost_lines where action_case_item_id=$1', [f.item])).rows, rows)
})

test('quote markup autosaves through the quote writer, while other rows and contract prices remain unchanged', async () => {
  const f = await calculationFixture(), quoteLine = randomUUID(), before = await f.state()
  await db.query("insert into action_case_cost_lines(id,org_id,action_case_id,action_case_item_id,category,description,unit,pricing_method) values($1,$2,$3,$4,'own_labor','Testoffert','tim','quotes')", [quoteLine,org,f.project,f.item])
  await f.write('markup', { id: quoteLine, markupPercent: 18 })
  assert.equal(Number((await db.query('select markup_percent from action_case_cost_lines where id=$1',[quoteLine])).rows[0].markup_percent), 18)
  assert.equal(Number((await db.query('select markup_percent from action_case_cost_lines where id=$1',[f.line])).rows[0].markup_percent), 25)
  assert.deepEqual(await f.state(), before)
})

async function fixture() {
  const project = randomUUID(), item = randomUUID(), line = randomUUID(), part = randomUUID()
  await db.query("insert into action_cases(id,org_id,title,property_address,customer_name,manager_profile_id) values($1,$2,'Fiktivt projekt','Testgatan','Test',$3)", [project,org,manager])
  await db.query("insert into action_case_items(id,org_id,action_case_id,title,scope,scope_conditions,scope_exclusions,scope_advice,updated_by) values($1,$2,$3,'Grund','Ursprunglig omfattning','','','',$4)", [item,org,project,actor])
  await db.query("insert into action_case_cost_lines(id,org_id,action_case_id,action_case_item_id,category,description,quantity,unit,unit_cost,markup_percent,vat_rate) values($1,$2,$3,$4,'material','Fiktiv produkt',1,'st',80,25,25)", [line,org,project,item])
  const draft = normalizeCustomerOffer({ ...emptyCustomerOffer('Fiktivt avtal'), contractForm: 'custom', signingMethod: 'external', baseAmountOre: 10000,
    items: [{ id: part, sourceItemId: item, title: 'Grund', scope: 'Ursprunglig omfattning', scopeConditions:'',scopeExclusions:'',scopeAdvice:'', kind: 'included', amountOre: null }],
    contractPricing: {version:1,mode:'fixed',basis:'rows',split:'combined',display:'priced',totalOre:null,labourOre:null,materialOre:null,
      rows:[{id:randomUUID(),sourceItemId:item,title:'Grund',kind:'fixed',amountOre:10000,labourOre:null,materialOre:null}],
      running:{hourlyOre:null,managementOre:null,markupPercent:null,approximateOre:null}} })
  const state = async () => (await db.query('select * from action_case_customer_contract_drafts where action_case_id=$1',[project])).rows[0]
  const save = async (body, revision) => db.query("select write_customer_contract($1,$2,$3,'save',$4)",[org,project,actor,{body,revision:revision??(await state())?.revision??0}])
  await save(draft)
  const info = async () => (await db.query('select get_contract_work_links($1,$2,$3) result',[org,actor,project])).rows[0].result.links[item]
  const freeze = async () => {
    const current = await state(), document = randomUUID()
    const payload = {id:document,version:1,revision:current.revision,confirmed:true,createdAt:new Date().toISOString(),
      snapshot:{...current.body,projectTitle:'Fiktivt projekt',propertyAddress:'Testgatan',customerName:'',customerEmail:'',issuerName:'',replyEmail:''},
      files:[],pdfPath:`${org}/${project}/signing/${document}/contract.pdf`,pdfSize:1000,pdfSha256:'a'.repeat(64)}
    await db.query("select write_contract_signing_document($1,$2,$3,'freeze',$4)",[org,project,actor,payload])
    return {document,payload}
  }
  return { project,item,line,part,draft,state,save,info,freeze }
}

test('running offer and hour range persist through the real independent writer without editing linked or frozen contracts', async () => {
  const f = await fixture(), frozen = await f.freeze(), contractBefore = await f.state()
  const workBefore = (await db.query('select * from action_case_items where id=$1', [f.item])).rows[0]
  const documentBefore = (await db.query('select * from action_case_contract_signing_documents where id=$1', [frozen.document])).rows[0]
  await db.exec(read('2026-10-30_03_offer_hour_estimate'))
  const body = normalizeCustomerOffer({ ...f.draft, offerHourEstimate: { version: 1, minHours: 80, maxHours: 100 },
    contractPricing: { ...f.draft.contractPricing, mode: 'running', running: { hourlyOre: 75000, managementOre: null, markupPercent: null, approximateOre: null } } })
  const save = (revision, value) => db.query("select write_customer_offer($1,$2,$3,'save',$4)", [org, f.project, actor, { revision, body: value }])
  await save(0, body)
  const saved = (await db.query('select * from action_case_customer_offer_drafts where action_case_id=$1', [f.project])).rows[0]
  assert.equal(saved.body.baseAmountOre, null)
  assert.deepEqual(saved.body.offerHourEstimate, body.offerHourEstimate)
  assert.equal(saved.body.contractPricing.running.hourlyOre, 75000)
  await save(1, { ...body, offerHourEstimate: { ...body.offerHourEstimate, maxHours: 110 } })
  await assert.rejects(save(1, body), /CUSTOMER_OFFER_STALE/)
  assert.deepEqual(await f.state(), contractBefore)
  assert.deepEqual((await db.query('select * from action_case_items where id=$1', [f.item])).rows[0], workBefore)
  assert.deepEqual((await db.query('select * from action_case_contract_signing_documents where id=$1', [frozen.document])).rows[0], documentBefore)
})

test('linked scope is synchronized atomically both ways with revision conflicts, never offer/planning writes', async () => {
  const f = await fixture(), current = await f.state()
  await db.query("update action_case_items set scope='Ny projekttext',scope_exclusions='Berg ingar inte',updated_by=$2 where id=$1",[f.item,actor])
  const next = await f.state()
  assert.equal(next.revision,current.revision+1)
  assert.equal(next.body.items[0].scope,'Ny projekttext')
  assert.equal(next.body.items[0].scopeExclusions,'Berg ingar inte')
  await assert.rejects(f.save(current.body,current.revision),/STALE/)
  next.body.items[0].scopeConditions='Avtalad forutsattning'
  await f.save(next.body)
  assert.equal((await db.query('select scope_conditions from action_case_items where id=$1',[f.item])).rows[0].scope_conditions,'Avtalad forutsattning')
  assert.deepEqual((await f.info()).differences,[])
  assert.equal((await db.query('select count(*) n from action_case_customer_offer_drafts where action_case_id=$1',[f.project])).rows[0].n,0)
})

test('linked titles have one value and competing title edits roll back', async () => {
  const f = await fixture(), d = await f.state()
  d.body.contractPricing.rows[0].title='Ny rubrik'
  await f.save(d.body)
  assert.equal((await f.state()).body.items[0].title,'Ny rubrik')
  assert.equal((await db.query('select title from action_case_items where id=$1',[f.item])).rows[0].title,'Ny rubrik')
  const next=await f.state(); next.body.items[0].title='A'; next.body.contractPricing.rows[0].title='B'
  await assert.rejects(f.save(next.body),/LINK_CONFLICT/)
})

test('agreed prices are canonical in the contract, including zero and missing, without changing the internal calculation', async () => {
  const f = await fixture(), before=(await db.query('select * from action_case_cost_lines where id=$1',[f.line])).rows[0]
  for (const amountOre of [12345,0,null]) {
    const d=await f.state()
    await db.query('select write_contract_work_price($1,$2,$3,$4,$5,$6)',[org,f.project,actor,f.item,d.revision,{amountOre,labourOre:null,materialOre:null}])
    assert.equal((await f.info()).price.amountOre,amountOre)
    assert.equal((await f.state()).body.baseAmountOre,amountOre)
    assert.deepEqual((await db.query('select * from action_case_cost_lines where id=$1',[f.line])).rows[0],before)
  }
  const d=await f.state(); d.body.contractPricing.mode='running'; d.body.baseAmountOre=null
  await f.save(d.body)
  assert.equal((await f.info()).price.editable,false)
  await assert.rejects(db.query('select write_contract_work_price($1,$2,$3,$4,$5,$6)',[org,f.project,actor,f.item,(await f.state()).revision,{amountOre:100,labourOre:null,materialOre:null}]),/INVALID/)
})

test('freeze locks scope, calculation, membership and deletion, preserving the exact document and draft', async () => {
  const f=await fixture(), {document}=await f.freeze()
  const before=(await db.query('select * from action_case_contract_signing_documents where id=$1',[document])).rows[0], draft=await f.state()
  assert.equal((await f.info()).locked,true)
  for (const [sql,params] of [
    ["update action_case_items set scope='Andrad' where id=$1",[f.item]],
    ['delete from action_case_items where id=$1',[f.item]],
    ['update action_case_cost_lines set unit_cost=1 where id=$1',[f.line]],
    ['delete from action_case_cost_lines where id=$1',[f.line]],
    ["insert into action_case_cost_lines(org_id,action_case_id,action_case_item_id,category,description,quantity,unit,unit_cost) values($1,$2,$3,'material','Ny',1,'st',5)",[org,f.project,f.item]],
    ["insert into action_case_work_parts(org_id,action_case_id,action_case_item_id,title) values($1,$2,$3,'Ny del')",[org,f.project,f.item]],
  ]) await assert.rejects(db.query(sql,params),/CONTRACT_LOCKED/)
  await assert.rejects(f.save({...draft.body,title:'Andrat'}),/LOCKED/)
  assert.deepEqual(await f.state(),draft)
  assert.deepEqual((await db.query('select * from action_case_contract_signing_documents where id=$1',[document])).rows[0],before)
  await db.query("insert into action_case_items(org_id,action_case_id,title,scope,sort_order) values($1,$2,'Fristaende tillagg','Separat',200)",[org,f.project])
})

test('one internal upload task is created for the manager and completed only by signed-copy registration', async () => {
  const f=await fixture(), {document}=await f.freeze()
  const task=async()=>(await db.query('select t.* from operational_tasks t join action_case_contract_upload_tasks l on l.task_id=t.id where l.document_id=$1',[document])).rows[0]
  assert.equal((await task()).assignee_profile_id,manager)
  assert.equal((await task()).primary_channel,'in_app')
  const tid=(await task()).id
  await db.query('select ensure_contract_upload_task($1)',[document]); assert.equal((await task()).id,tid)
  const d=await f.state(), signedCopy={path:`${org}/${f.project}/signing/${document}/signed/${randomUUID()}.pdf`,sha256:'b'.repeat(64),fileName:'Signerad.pdf',fileSizeBytes:1000}
  await db.query("select write_contract_signing_delivery($1,$2,$3,'register_signed',$4)",[org,f.project,actor,{id:document,revision:d.revision,confirmed:true,signedCopy}])
  assert.equal((await task()).status,'approved')
  assert.equal((await f.info()).locked,true)
  await assert.rejects(db.query("select write_contract_signing_document($1,$2,$3,'new_draft',$4)",[org,f.project,actor,{id:document,revision:d.revision,confirmed:true,unsignedConfirmed:true}]),/ACCEPTED/)
})

test('migration reruns preserve existing frozen mismatches and create no duplicate tasks or scope changes', async () => {
  const f=await fixture(), {document}=await f.freeze()
  const before=(await db.query('select snapshot,pdf_sha256,files from action_case_contract_signing_documents where id=$1',[document])).rows[0]
  const work=(await db.query('select * from action_case_items where id=$1',[f.item])).rows[0]
  const taskCount=(await db.query('select count(*) n from action_case_contract_upload_tasks')).rows[0].n
  await db.exec(read(linkMigration)); await db.exec(read(taskMigration))
  assert.deepEqual((await db.query('select snapshot,pdf_sha256,files from action_case_contract_signing_documents where id=$1',[document])).rows[0],before)
  assert.deepEqual((await db.query('select * from action_case_items where id=$1',[f.item])).rows[0],work)
  assert.equal((await db.query('select count(*) n from action_case_contract_upload_tasks')).rows[0].n,taskCount)
  await assert.rejects(db.query('select get_contract_work_links($1,$2,$3)',[org,randomUUID(),f.project]),/NOT_FOUND/)
  assert.equal((await db.query("select has_function_privilege('authenticated','get_contract_work_links(uuid,uuid,uuid)','EXECUTE') allowed")).rows[0].allowed,false)
  assert.deepEqual({draft:await legacy.state(),work:(await db.query('select * from action_case_items where id=$1',[legacy.item])).rows[0],document:(await db.query('select * from action_case_contract_signing_documents where id=$1',[legacyDocument])).rows[0]},legacyBefore)
  assert.deepEqual((await legacy.info()).differences,['scopeExclusions'])
  assert.equal((await db.query('select count(*) n from action_case_contract_upload_tasks where document_id=$1',[legacyDocument])).rows[0].n,1)
})

test('separate and mixed fixed prices keep labour/material and totals exact; total-based prices are not invented per work item',async()=>{
  const f=await fixture(), d=await f.state()
  d.body.contractPricing.split='separate'
  d.body.contractPricing.rows[0]={...d.body.contractPricing.rows[0],labourOre:6000,materialOre:4000}
  await f.save(d.body)
  await db.query('select write_contract_work_price($1,$2,$3,$4,$5,$6)',[org,f.project,actor,f.item,(await f.state()).revision,{amountOre:null,labourOre:1000,materialOre:0}])
  assert.equal((await f.info()).price.amountOre,1000)
  assert.equal((await f.state()).body.baseAmountOre,1000)
  const next=await f.state(); next.body.contractPricing.mode='mixed'; await f.save(next.body)
  assert.equal((await f.info()).price.editable,true)
  const total=await f.state(); total.body.contractPricing.basis='total'; total.body.contractPricing.totalOre=100000; total.body.contractPricing.labourOre=100000; total.body.contractPricing.materialOre=0; total.body.baseAmountOre=100000; await f.save(total.body)
  assert.equal((await f.info()).price.editable,false)
  assert.equal((await f.info()).price.amountOre,null)
})

test('invalid price payloads, stale tabs, wrong tenant and wrong source never write any value',async()=>{
  const f=await fixture(), before=await f.state()
  for(const price of [null,[],{}, {amountOre:'free',labourOre:null,materialOre:null}, {amountOre:-1,labourOre:null,materialOre:null}, {amountOre:1.5,labourOre:null,materialOre:null}])
    await assert.rejects(db.query('select write_contract_work_price($1,$2,$3,$4,$5,$6)',[org,f.project,actor,f.item,before.revision,price]),/INVALID/)
  await assert.rejects(db.query('select write_contract_work_price($1,$2,$3,$4,$5,$6)',[org,f.project,actor,f.item,before.revision-1,{amountOre:1,labourOre:null,materialOre:null}]),/STALE/)
  await assert.rejects(db.query('select write_contract_work_price($1,$2,$3,$4,$5,$6)',[randomUUID(),f.project,actor,f.item,before.revision,{amountOre:1,labourOre:null,materialOre:null}]),/NOT_FOUND/)
  await assert.rejects(db.query('select write_contract_work_price($1,$2,$3,$4,$5,$6)',[org,f.project,actor,randomUUID(),before.revision,{amountOre:1,labourOre:null,materialOre:null}]),/NOT_FOUND/)
  assert.deepEqual(await f.state(),before)
})

test('unsigned release requires attestation, cancels its upload task and reopens linked moments without rewriting the old snapshot',async()=>{
  const f=await fixture(), {document}=await f.freeze(), d=await f.state()
  const frozen=(await db.query('select snapshot,pdf_sha256,files from action_case_contract_signing_documents where id=$1',[document])).rows[0]
  await assert.rejects(db.query("select write_contract_signing_document($1,$2,$3,'new_draft',$4)",[org,f.project,actor,{id:document,revision:d.revision,confirmed:true}]),/UNSIGNED_CONFIRM/)
  await db.query("select write_contract_signing_document($1,$2,$3,'new_draft',$4)",[org,f.project,actor,{id:document,revision:d.revision,confirmed:true,unsignedConfirmed:true}])
  assert.equal((await f.info()).locked,false)
  assert.equal((await db.query('select t.status from operational_tasks t join action_case_contract_upload_tasks l on l.task_id=t.id where document_id=$1',[document])).rows[0].status,'cancelled')
  await db.query("update action_case_items set scope='Nytt utkast' where id=$1",[f.item])
  assert.equal((await f.state()).body.items[0].scope,'Nytt utkast')
  assert.deepEqual((await db.query('select snapshot,pdf_sha256,files from action_case_contract_signing_documents where id=$1',[document])).rows[0],frozen)
})

test('published and accepted snapshots protect work even without a paper-signing version',async()=>{
  for(const status of ['published','accepted']){
    const f=await fixture(), customer=randomUUID(), d=await f.state()
    d.body.signingMethod='email_code'
    await db.query("insert into action_case_participants(id,org_id,action_case_id,role,name,email) values($1,$2,$3,'customer','Fiktiv','test@example.invalid')",[customer,org,f.project])
    await db.query("insert into action_case_customer_offers(id,org_id,action_case_id,participant_id,version,draft_revision,contract_revision,snapshot,status,email_payload,published_by) values($1,$2,$3,$4,1,1,$5,$6,$7,'{}',$8)",[randomUUID(),org,f.project,customer,d.revision,d.body,status,actor])
    assert.equal((await f.info()).locked,true)
    await assert.rejects(db.query('update action_case_cost_lines set unit_cost=200 where id=$1',[f.line]),/CONTRACT_LOCKED/)
    await assert.rejects(db.query("update action_case_items set scope='Andrat' where id=$1",[f.item]),/CONTRACT_LOCKED/)
  }
})

test('locked scope attachments cannot be replaced, moved or removed, and unlinked project documents remain usable',async()=>{
  const f=await fixture(), file=randomUUID()
  await db.query("insert into action_case_attachments(id,org_id,action_case_id,attachment_type,file_name,content_type,file_size_bytes,storage_bucket,file_path) values($1,$2,$3,'document','Test.pdf','application/pdf',100,'action-case-files','test.pdf')",[file,org,f.project])
  await db.query('update action_case_items set scope_attachment_ids=array[$2::uuid] where id=$1',[f.item,file])
  await f.freeze()
  await assert.rejects(db.query("update action_case_attachments set file_path='replacement.pdf' where id=$1",[file]),/CONTRACT_LOCKED/)
  await assert.rejects(db.query('delete from action_case_attachments where id=$1',[file]),/CONTRACT_LOCKED/)
  await assert.rejects(db.query("insert into action_case_attachments(org_id,action_case_id,action_case_item_id,attachment_type,file_name,content_type,file_size_bytes,storage_bucket,file_path) values($1,$2,$3,'document','New.pdf','application/pdf',100,'action-case-files','new.pdf')",[org,f.project,f.item]),/CONTRACT_LOCKED/)
  await db.query("insert into action_case_attachments(org_id,action_case_id,attachment_type,file_name,content_type,file_size_bytes,storage_bucket,file_path) values($1,$2,'document','Project.pdf','application/pdf',100,'action-case-files','project.pdf')",[org,f.project])
})

test('upload task falls back to the locker when no project manager exists and registration is idempotent',async()=>{
  const f=await fixture(); await db.query('update action_cases set manager_profile_id=null where id=$1',[f.project])
  const {document}=await f.freeze()
  assert.equal((await db.query('select t.assignee_profile_id from operational_tasks t join action_case_contract_upload_tasks l on l.task_id=t.id where l.document_id=$1',[document])).rows[0].assignee_profile_id,actor)
  const signedCopy={path:`${org}/${f.project}/signing/${document}/signed/${randomUUID()}.pdf`,sha256:'b'.repeat(64),fileName:'Signerad.pdf',fileSizeBytes:1000}
  for(let i=0;i<2;i++) await db.query("select write_contract_signing_delivery($1,$2,$3,'register_signed',$4)",[org,f.project,actor,{id:document,revision:(await f.state()).revision,confirmed:true,signedCopy}])
  assert.equal((await db.query("select count(*) n from task_events e join action_case_contract_upload_tasks l on l.task_id=e.task_id where l.document_id=$1 and e.event_type='task_approved'",[document])).rows[0].n,1)
})

const scopeLinkMigration = '2026-11-02_02_offer_work_scope_link'
async function linkedOffer(f) {
  const offerState = async () => (await db.query('select * from action_case_customer_offer_drafts where action_case_id=$1', [f.project])).rows[0]
  const saveOffer = async (body, revision) => db.query("select write_customer_offer($1,$2,$3,'save',$4)",
    [org, f.project, actor, { body: normalizeCustomerOffer(body), revision: revision ?? (await offerState())?.revision ?? 0 }])
  const body = structuredClone(f.draft)
  body.baseAmountOre = 25000; body.contractPricing.rows[0].amountOre = 25000
  await saveOffer(body)
  return { ...f, offerState, saveOffer }
}
function withoutWorkText(body) {
  const result = structuredClone(body)
  for (const item of result.items) for (const key of ['title','scope','scopeConditions','scopeExclusions','scopeAdvice']) delete item[key]
  for (const row of result.contractPricing?.rows ?? []) delete row.title
  return result
}

test('installing offer scope sync is additive and preserves old frozen mismatches, work and signed evidence exactly', async () => {
  const f = await linkedOffer(await fixture()), offer = await f.offerState()
  offer.body.items[0].scope = 'Gammal fristaende offerttext'
  await f.saveOffer(offer.body)
  const frozen = await f.freeze()
  const snapshot = async () => ({ work: (await db.query('select * from action_case_items where id=$1',[f.item])).rows[0],
    contract: await f.state(), offer: await f.offerState(), document: (await db.query('select * from action_case_contract_signing_documents where id=$1',[frozen.document])).rows[0] })
  const before = await snapshot()
  await db.exec(read(scopeLinkMigration)); await db.exec(read(scopeLinkMigration))
  assert.deepEqual(await snapshot(), before)
  const priceOnly = structuredClone(before.offer.body); priceOnly.contractPricing.rows[0].amountOre = 35000; priceOnly.baseAmountOre = 35000
  await f.saveOffer(priceOnly)
  const after = await snapshot()
  assert.deepEqual(after.contract, before.contract); assert.deepEqual(after.work, before.work); assert.deepEqual(after.document, before.document)
  assert.equal(after.offer.body.items[0].scope, 'Gammal fristaende offerttext')
})

test('offer, work and contract share only changed work fields with one offer revision and no price or planning writes', async () => {
  const f = await linkedOffer(await fixture()), offer = await f.offerState(), contract = await f.state()
  const costs = (await db.query('select * from action_case_cost_lines where id=$1',[f.line])).rows
  const next = structuredClone(offer.body)
  Object.assign(next.items[0], { title: 'Gemensam rubrik', scope: 'Ny omfattning fran offerten', scopeConditions: 'Fri passage', scopeExclusions: 'Malning ingar inte', scopeAdvice: 'Samordna arbetet' })
  await f.saveOffer(next, offer.revision)
  assert.equal((await f.offerState()).revision, offer.revision + 1, 'the offer cannot echo a second revision into itself')
  const work = (await db.query('select * from action_case_items where id=$1',[f.item])).rows[0]
  assert.equal(work.title, next.items[0].title); assert.equal(work.scope, next.items[0].scope)
  assert.equal(work.scope_conditions, 'Fri passage'); assert.equal(work.scope_exclusions, 'Malning ingar inte'); assert.equal(work.scope_advice, 'Samordna arbetet')
  assert.equal((await f.state()).body.items[0].scope, next.items[0].scope)
  assert.deepEqual(withoutWorkText((await f.state()).body), withoutWorkText(contract.body))
  assert.deepEqual(withoutWorkText((await f.offerState()).body), withoutWorkText(offer.body))
  assert.deepEqual((await db.query('select * from action_case_cost_lines where id=$1',[f.line])).rows, costs)
  assert.equal((await db.query('select count(*) n from action_case_customer_planning where action_case_id=$1',[f.project])).rows[0].n, 0)
  const current = await f.state(), previousOffer = await f.offerState()
  current.body.items[0].scopeExclusions = 'Ny avgransning fran avtalet'; await f.save(current.body)
  assert.equal((await f.offerState()).body.items[0].scopeExclusions, 'Ny avgransning fran avtalet')
  assert.equal((await f.offerState()).revision, previousOffer.revision + 1)
  await assert.rejects(f.saveOffer(previousOffer.body, previousOffer.revision), /STALE/)
  await db.query("update action_case_items set scope='Ny projektomfattning' where id=$1", [f.item])
  assert.equal((await f.offerState()).body.items[0].scope, 'Ny projektomfattning')
  assert.equal((await f.state()).body.items[0].scope, 'Ny projektomfattning')
})

test('work and offer stay linked before a contract exists; explicit clearing is shared but missing legacy fields are preserved', async () => {
  const f = await fixture()
  await db.query('delete from action_case_customer_contract_drafts where action_case_id=$1', [f.project])
  await db.query("update action_case_items set scope_conditions='Befintliga forutsattningar' where id=$1", [f.item])
  delete f.draft.items[0].scopeConditions
  const g = await linkedOffer(f)
  assert.equal((await g.offerState()).body.items[0].scopeConditions, 'Befintliga forutsattningar')
  const first = await g.offerState(), next = structuredClone(first.body)
  delete next.items[0].scopeConditions
  await g.saveOffer(next)
  assert.equal((await g.offerState()).body.items[0].scopeConditions, 'Befintliga forutsattningar')
  const clear = (await g.offerState()).body; clear.items[0].scopeConditions = ''; await g.saveOffer(clear)
  assert.equal((await db.query('select scope_conditions from action_case_items where id=$1',[f.item])).rows[0].scope_conditions, '')
  await db.query("update action_case_items set scope='Omfattning utan avtal' where id=$1", [f.item])
  assert.equal((await g.offerState()).body.items[0].scope, 'Omfattning utan avtal')
  assert.equal(await g.state(), undefined)
})

test('locked work rejects shared offer text edits atomically while independent offer prices remain editable', async () => {
  const f = await linkedOffer(await fixture()), frozen = await f.freeze(), before = await f.state()
  const document = (await db.query('select * from action_case_contract_signing_documents where id=$1',[frozen.document])).rows[0]
  const original = await f.offerState()
  for (const key of ['title','scope','scopeConditions','scopeExclusions','scopeAdvice']) {
    const changed = structuredClone(original.body); changed.items[0][key] = 'Far inte andra last omfattning'
    await assert.rejects(f.saveOffer(changed, original.revision), /CONTRACT_LOCKED/)
    assert.deepEqual(await f.offerState(), original)
  }
  const price = structuredClone(original.body); price.baseAmountOre = 50000; price.contractPricing.rows[0].amountOre = 50000
  await f.saveOffer(price)
  assert.deepEqual(await f.state(), before)
  assert.deepEqual((await db.query('select * from action_case_contract_signing_documents where id=$1',[frozen.document])).rows[0], document)
})

test('manual rows, legacy options, foreign source IDs and other projects never acquire shared scope by their names', async () => {
  const f = await linkedOffer(await fixture()), other = await fixture(), workBefore = (await db.query('select * from action_case_items where id=$1',[other.item])).rows[0]
  const next = (await f.offerState()).body
  next.items.push({ id: randomUUID(), title: 'Grund', scope: 'Manuell omfattning', kind: 'included', amountOre: null })
  next.items.push({ id: randomUUID(), sourceItemId: other.item, title: 'Grund', scope: 'Annan projekttext', kind: 'excluded', amountOre: null })
  await f.saveOffer(next)
  assert.deepEqual((await db.query('select * from action_case_items where id=$1',[other.item])).rows[0], workBefore)
  const option = (await f.offerState()).body; option.items[0].kind = 'option'; option.items[0].scope = 'Fristaende gammalt tillval'
  await f.saveOffer(option)
  await db.query("update action_case_items set scope='Endast grundarbetet' where id=$1", [f.item])
  assert.equal((await f.offerState()).body.items[0].scope, 'Fristaende gammalt tillval')
  assert.equal((await f.state()).body.items[0].scope, 'Endast grundarbetet')
})

test('offer scope migration reruns preserve all documents and deny browser execution of trigger helpers', async () => {
  const before = (await db.query('select * from action_case_contract_signing_documents order by id')).rows
  await db.exec(read(scopeLinkMigration))
  assert.deepEqual((await db.query('select * from action_case_contract_signing_documents order by id')).rows, before)
  for (const fn of ['prepare_offer_work_scope()','sync_offer_work_from_item()','sync_offer_work_to_item()']) {
    assert.equal((await db.query("select has_function_privilege('authenticated',$1,'EXECUTE') allowed",[fn])).rows[0].allowed, false)
    assert.equal((await db.query("select has_function_privilege('anon',$1,'EXECUTE') allowed",[fn])).rows[0].allowed, false)
  }
})

test('shared work titles support running offers without price rows and retain their rates without inventing a fixed price', async () => {
  const f=await linkedOffer(await fixture()), body=(await f.offerState()).body
  body.baseAmountOre=null
  body.contractPricing={...body.contractPricing,mode:'running',basis:'total',rows:[],totalOre:null,
    running:{hourlyOre:75000,managementOre:null,markupPercent:15,approximateOre:null}}
  await f.saveOffer(body)
  await db.query("update action_case_items set title='Gemensam lopande omfattning' where id=$1",[f.item])
  const offer=(await f.offerState()).body
  assert.equal(offer.items[0].title,'Gemensam lopande omfattning')
  assert.deepEqual(offer.contractPricing.rows,[])
  assert.equal(offer.contractPricing.running.hourlyOre,75000)
  assert.equal(offer.baseAmountOre,null)
})
