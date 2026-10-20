import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { customerSections, defaultCustomerVisibility, projectCustomerPortal, visibilityMutation } from '../src/lib/action-cases/customerSharing.ts'
import { published } from './fixtures/customer-offer-data.ts'

const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const org=id(1), project=id(2), manager=id(3), staff=id(4), foreign=id(5)
function fixture() {
  const offer=published();offer.snapshot.introduction='AVTALSHEMLIGHET';offer.snapshot.schedule='AVTALSTIDER';offer.snapshot.paymentTerms='BETALVILLKOR'
  return {accessState:'open',participant:{id:id(6),name:'Kund',role:'customer'},customerOffers:{enabled:true,offers:[offer],plannedItems:[{title:'VALHEMLIGHET',id:id(7)}],plannedChoices:{categories:[{title:'VALHEMLIGHET'}]}},actionCase:{id:project,title:'Projekt',propertyAddress:'Adress',description:null,status:'preparing',items:[],attachments:[{id:id(8),fileName:'FILHEMLIGHET'}],schedule:[{id:id(9),title:'TIDPLANHEMLIGHET'}]}}
}
test('all 32 visibility combinations project only allowed sections and never rewrite a shared contract',()=>{
  for(let mask=0;mask<32;mask++) {
    const source=fixture(),before=JSON.stringify(source),tabs=Object.fromEntries(customerSections.map((s,i)=>[s.key,Boolean(mask&(1<<i))]))
    const result=projectCustomerPortal(source,{tabs,revision:1,updatedAt:'2026-10-20T08:00:00Z',updatedBy:manager})
    const json=JSON.stringify(result)
    assert.equal(result.customerOffers.offers.length,tabs.contract?1:0)
    assert.equal(json.includes('AVTALSHEMLIGHET'),tabs.contract)
    assert.equal(json.includes('VALHEMLIGHET'),tabs.choices)
    assert.equal(json.includes('FILHEMLIGHET'),tabs.files)
    assert.equal(json.includes('TIDPLANHEMLIGHET'),tabs.schedule)
    assert.equal(Boolean(result.sharedPayment),tabs.payments)
    assert.equal(Boolean(result.sharedContractSchedule),tabs.schedule)
    assert.equal(JSON.stringify(source),before)
    if(tabs.contract) assert.deepEqual(result.customerOffers.offers[0],source.customerOffers.offers[0])
    assert.equal(result.sharing.updatedBy,undefined)
  }
})
test('legacy pages retain their content until settings are deliberately saved; old projections cannot leak disabled sections',()=>{
  const portal=fixture();portal.customerOffers={enabled:false,offers:[]};portal.actionCase.description='LEGACY';portal.actionCase.items=[{id:id(10),title:'Legacy arbete'}]
  const before=JSON.stringify(portal)
  const result=projectCustomerPortal(portal,{tabs:defaultCustomerVisibility(),revision:0})
  assert.equal(result.customerOffers.enabled,false);assert.deepEqual(result.actionCase.items,portal.actionCase.items)
  const managed=projectCustomerPortal(portal,{tabs:defaultCustomerVisibility(),revision:1})
  assert.equal(managed.customerOffers.enabled,true);assert.deepEqual(managed.actionCase.items,[])
  const first=projectCustomerPortal(fixture(),{tabs:defaultCustomerVisibility(),revision:1})
  const hidden=projectCustomerPortal(first,{tabs:{...defaultCustomerVisibility(),payments:false,schedule:false},revision:2})
  assert.equal(hidden.sharedPayment,undefined);assert.equal(hidden.sharedContractSchedule,undefined)
  assert.equal(JSON.stringify(portal),before)
})
test('visibility writes are single boolean patches with stable retry identity, never a payload of contract data',()=>{
  const input={requestId:randomUUID(),revision:0,section:'contract',visible:false,contractDraft:{text:'ignore'}}
  assert.deepEqual(visibilityMutation(input),{requestId:input.requestId,revision:0,section:'contract',visible:false})
  for(const patch of [{section:'work'},{section:'questions'},{visible:'false'},{visible:null},{revision:-1},{revision:2147483647},{revision:1.2},{requestId:'bad'}]) assert.throws(()=>visibilityMutation({...input,...patch}),/SHARING_INVALID/)
})

const db=new PGlite()
before(async()=>{
  await db.exec(`create role anon;create role authenticated;create role service_role;
    create schema auth;create function auth.role() returns text language sql as $$select coalesce(current_setting('test.role',true),'service_role')$$;
    create table profiles(id uuid primary key,full_name text,email text);
    create table org_members(org_id uuid,profile_id uuid,is_active boolean);
    create table action_cases(id uuid primary key,org_id uuid,manager_profile_id uuid,unique(org_id,id));
    create table frozen_contracts(id uuid primary key,body jsonb);
    create function protect_project_question_history() returns trigger language plpgsql as $$begin raise exception 'IMMUTABLE';end$$;
    insert into profiles values('${manager}','Testansvarig','manager@example.invalid'),('${staff}','Medarbetare','staff@example.invalid');
    insert into org_members values('${org}','${manager}',true),('${org}','${staff}',true);
    insert into action_cases values('${project}','${org}','${manager}');
    insert into frozen_contracts values('${project}','{"locked":true,"price":198144300,"text":"Original"}');`)
  await db.exec(readFileSync(new URL('../docs/db/2026-10-20_01_project_customer_sharing.sql',import.meta.url),'utf8'))
})
after(()=>db.close())
const patch=(revision,section,visible)=>({requestId:randomUUID(),revision,section,visible})
const write=(data,actor=manager,organization=org)=>db.query('select set_project_customer_visibility($1,$2,$3,$4)',[organization,project,actor,data])
test('only the active project manager may change sharing; migration does not initialize or alter existing projects/contracts',async()=>{
  assert.equal((await db.query('select count(*)::int n from action_case_customer_visibility')).rows[0].n,0)
  await assert.rejects(write(patch(0,'contract',false),staff),/FORBIDDEN/)
  await assert.rejects(write(patch(0,'contract',false),manager,foreign),/NOT_FOUND/)
  await db.query('update org_members set is_active=false where profile_id=$1',[manager])
  await assert.rejects(write(patch(0,'contract',false)),/FORBIDDEN/)
  await db.query('update org_members set is_active=true where profile_id=$1',[manager])
  await db.exec("set test.role='authenticated'");await assert.rejects(write(patch(0,'contract',false)),/FORBIDDEN/);await db.exec("set test.role='service_role'")
})
test('single-field saves preserve other fields; retries, conflicts, history and role transfers remain scoped',async()=>{
  const frozen=(await db.query('select * from frozen_contracts')).rows
  const p=patch(0,'contract',false);await write(p);await write(p)
  let saved=(await db.query('select * from action_case_customer_visibility')).rows[0]
  assert.equal(saved.revision,1);assert.equal(saved.contract,false);assert.equal(saved.choices,true)
  await assert.rejects(write({...p,visible:true}),/STALE/)
  await assert.rejects(write(patch(0,'files',false)),/STALE/)
  await write(patch(1,'files',false))
  saved=(await db.query('select * from action_case_customer_visibility')).rows[0]
  assert.equal(saved.contract,false);assert.equal(saved.files,false);assert.equal(saved.payments,true)
  assert.equal((await db.query('select count(*)::int n from action_case_customer_visibility_events')).rows[0].n,2)
  const audit=(await db.query('select * from action_case_customer_visibility_events order by revision')).rows
  assert.equal(audit[0].before_tabs.contract,true);assert.equal(audit[0].tabs.contract,false);assert.equal(audit[0].actor_name,'Testansvarig')
  await assert.rejects(db.exec('delete from action_case_customer_visibility_events'),/IMMUTABLE/)
  await db.query('update action_cases set manager_profile_id=$1',[staff])
  await assert.rejects(write(patch(2,'schedule',false)),/FORBIDDEN/)
  await write(patch(2,'schedule',false),staff)
  assert.deepEqual((await db.query('select * from frozen_contracts')).rows,frozen)
})
test('visibility tables and writer cannot be used directly by browser/anonymous roles',async()=>{
  for(const role of ['anon','authenticated']) {
    const grants=(await db.query("select has_function_privilege($1,'set_project_customer_visibility(uuid,uuid,uuid,jsonb)','execute') fn,has_table_privilege($1,'action_case_customer_visibility','select,insert,update,delete') tab",[role])).rows[0]
    assert.deepEqual(grants,{fn:false,tab:false})
  }
})
