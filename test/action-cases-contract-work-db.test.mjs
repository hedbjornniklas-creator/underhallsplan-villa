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
