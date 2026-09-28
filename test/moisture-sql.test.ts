import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const db=new PGlite()
const org=randomUUID(), otherOrg=randomUUID(), actor=randomUUID(), coworker=randomUUID(), stranger=randomUUID()
const property=randomUUID(), foreignProperty=randomUUID(), building=randomUUID(), foreignBuilding=randomUUID(), customer=randomUUID(), foreignCustomer=randomUUID()
const migration=readFileSync(new URL('../docs/db/2026-09-28_02_moisture_foundation.sql',import.meta.url),'utf8')
before(async()=>{
  await db.exec(`
    create role anon;create role authenticated;create role service_role;
    create table profiles(id uuid primary key);
    create table organizations(id uuid primary key);
    create table org_members(org_id uuid,profile_id uuid,is_active boolean,primary key(org_id,profile_id));
    create table properties(id uuid primary key default gen_random_uuid(),owner uuid,name text,address text,cadastral_id text,municipality text,postal_code text,city text,owner_name text);
    create table buildings(id uuid primary key default gen_random_uuid(),property_id uuid references properties(id),name text);
    create table organization_customers(id uuid primary key,org_id uuid,name text,customer_number bigint,is_active boolean,unique(org_id,id));
    create table platform_products(id uuid primary key default gen_random_uuid(),key text);
    create table platform_modules(id uuid primary key default gen_random_uuid(),product_id uuid,key text,label text,description text,is_active boolean,sort_order integer,unique(product_id,key));
    insert into platform_products(key) values('dashboard');
    insert into organizations values('${org}'),('${otherOrg}');
    insert into profiles values('${actor}'),('${coworker}'),('${stranger}');
    insert into org_members values('${org}','${actor}',true),('${org}','${coworker}',true),('${otherOrg}','${actor}',true),('${otherOrg}','${stranger}',true);
    insert into properties(id,owner,name) values('${property}','${actor}','Eget objekt'),('${foreignProperty}','${stranger}','Annans objekt');
    insert into buildings values('${building}','${property}','Eget hus'),('${foreignBuilding}','${foreignProperty}','Annat hus');
    insert into organization_customers values('${customer}','${org}','Rätt kund',1001,true),('${foreignCustomer}','${otherOrg}','Annan kund',1001,true);
  `)
  await db.exec(migration)
  await db.exec(migration)
})
after(()=>db.close())
const input=(id=randomUUID())=>({projectId:id,title:'Fuktinventering',description:null,scopes:['inventory'],pricingMode:'undecided',customerId:customer,
  property:{mode:'existing',id:property},buildingIds:[building],newBuildings:[] as string[]})
async function write(payload:Record<string,unknown>,operation='create',user=actor,organization=org,id=payload.projectId){
  return (await db.query<{result:Record<string,unknown>}>('select moisture_project_write($1,$2,$3,$4,$5::jsonb) result',[organization,user,id,operation,JSON.stringify(payload)])).rows[0].result
}
async function read(id:string|null=null,user=actor,organization=org){
  return (await db.query<{result:unknown}>('select moisture_projects_read($1,$2,$3) result',[organization,user,id])).rows[0].result
}
async function options(user=actor,organization=org){
  return (await db.query<{result:{properties:Array<{id:string;buildings:unknown[]}>;customers:Array<{id:string}>}}>('select moisture_options_read($1,$2) result',[organization,user])).rows[0].result
}
async function counts(){return(await db.query('select (select count(*)::int from properties) properties,(select count(*)::int from buildings) buildings,(select count(*)::int from moisture_projects) projects')).rows[0]}

test('repeatable migration creates an independent module and denies browser reads/writes/RPCs',async()=>{
  assert.deepEqual((await db.query('select key from platform_modules')).rows,[{key:'moisture_safety'}])
  const privileges=(await db.query(`select
    has_table_privilege('authenticated','moisture_projects','insert') write,
    has_table_privilege('authenticated','moisture_projects','select') read,
    has_function_privilege('authenticated','moisture_project_write(uuid,uuid,uuid,text,jsonb)','execute') rpc,
    has_function_privilege('service_role','moisture_project_write(uuid,uuid,uuid,text,jsonb)','execute') service_rpc,
    (select relrowsecurity from pg_class where oid='moisture_projects'::regclass) rls`)).rows[0]
  assert.deepEqual(privileges,{write:false,read:false,rpc:false,service_rpc:true,rls:true})
})

test('options and writes cannot use another owner property, customer org or property building',async()=>{
  assert.deepEqual((await options()).properties.map(x=>x.id),[property])
  assert.deepEqual((await options()).customers.map(x=>x.id),[customer])
  const start=await counts()
  await assert.rejects(write({...input(),customerId:foreignCustomer}),/MOISTURE_CUSTOMER_INVALID/)
  await assert.rejects(write({...input(),property:{mode:'existing',id:foreignProperty},buildingIds:[]}),/MOISTURE_PROPERTY_INVALID/)
  await assert.rejects(write({...input(),buildingIds:[foreignBuilding]}),/MOISTURE_BUILDING_INVALID/)
  assert.deepEqual(await counts(),start)
})

test('create is idempotent for the same actor, org and payload; conflicting retries cannot mutate it',async()=>{
  const payload={...input(),newBuildings:['Garage']}
  const created=await write(payload)
  const start=await counts()
  assert.equal(created.revision,1)
  assert.equal((created.buildings as unknown[]).length,2)
  assert.deepEqual(await write(payload),created)
  assert.deepEqual(await counts(),start)
  await assert.rejects(write({...payload,title:'Changed'}),/MOISTURE_CREATE_CONFLICT/)
  await assert.rejects(write(payload,'create',coworker),/MOISTURE_CREATE_CONFLICT/)
  await assert.rejects(write(payload,'create',actor,otherOrg),/MOISTURE_CREATE_CONFLICT/)
  assert.deepEqual(await read(payload.projectId),created)
  // Explicit project relation allows teammates to use the same property's buildings.
  assert.ok((await options(coworker)).properties.some(p=>p.id===property))
})

test('new property and buildings are one transaction and access owner is not the legal owner',async()=>{
  const payload={...input(),property:{mode:'new',name:'Ny fastighet',address:'Gatan 1',cadastralId:'Test 1:2',municipality:'Test',postalCode:'12345',city:'Ort'},buildingIds:[],newBuildings:['Hus','']}
  const start=await counts()
  await assert.rejects(write(payload),/MOISTURE_INVALID_INPUT/)
  assert.deepEqual(await counts(),start)
  const created=await write({...payload,newBuildings:['Hus']})
  const prop=(await db.query<{owner:string;owner_name:null}>('select owner,owner_name from properties where id=$1',[created.propertyId])).rows[0]
  assert.deepEqual(prop,{owner:actor,owner_name:null})
  assert.equal((created.buildings as unknown[]).length,1)
})

test('update checks revision, preserves property identity and rolls back failed building changes',async()=>{
  const payload=input(),created=await write(payload)
  const {projectId,property:ignored,...fields}=payload
  void ignored
  const next=await write({...fields,revision:1,title:'Reviderat',newBuildings:['Tillbyggnad']},'update',actor,org,projectId)
  assert.equal(next.revision,2)
  assert.equal(next.propertyId,created.propertyId)
  const start=await counts()
  await assert.rejects(write({...fields,revision:1,title:'Stale',newBuildings:['Duplicate']},'update',actor,org,projectId),/MOISTURE_CONFLICT/)
  await assert.rejects(write({...fields,revision:2,buildingIds:[foreignBuilding]},'update',actor,org,projectId),/MOISTURE_BUILDING_INVALID/)
  await assert.rejects(write({...fields,revision:2,property:{mode:'existing',id:foreignProperty}},'update',actor,org,projectId),/MOISTURE_INVALID_INPUT/)
  assert.deepEqual(await counts(),start)
  assert.deepEqual(await read(projectId),next)
})

test('database relationships cannot drift and inactive customers can only remain on their existing project',async()=>{
  const payload=input()
  await write(payload)
  await assert.rejects(db.query('update buildings set property_id=$1 where id=$2',[foreignProperty,building]),/foreign key/)
  await db.query('update organization_customers set is_active=false where id=$1',[customer])
  assert.deepEqual((await options()).customers,[])
  await assert.rejects(write(input()),/MOISTURE_CUSTOMER_INVALID/)
  const {projectId,property:ignored,...fields}=payload
  void ignored
  assert.equal((await write({...fields,revision:1,title:'Endast rubriken'},'update',actor,org,projectId)).revision,2)
  await db.query('update organization_customers set is_active=true where id=$1',[customer])
})

test('revoked membership denies reads, options and idempotent retries, without cross-org disclosure',async()=>{
  const payload=input()
  await write(payload)
  await assert.rejects(read(payload.projectId,actor,otherOrg),/MOISTURE_NOT_FOUND/)
  await assert.rejects(read(null,stranger,org),/MOISTURE_FORBIDDEN/)
  await db.query('update org_members set is_active=false where org_id=$1 and profile_id=$2',[org,actor])
  await assert.rejects(read(payload.projectId),/MOISTURE_FORBIDDEN/)
  await assert.rejects(options(),/MOISTURE_FORBIDDEN/)
  await assert.rejects(write(payload),/MOISTURE_FORBIDDEN/)
  await db.query('update org_members set is_active=true where org_id=$1 and profile_id=$2',[org,actor])
})
