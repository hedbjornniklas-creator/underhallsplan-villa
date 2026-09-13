import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
const org=randomUUID(), actor=randomUUID(), stranger=randomUUID()
async function one(sql: string, values: unknown[] = []): Promise<Record<string, any>> {
  return (await db.query<Record<string, any>>(sql, values)).rows[0]
}
const read = (name: string) => readFileSync(new URL('../docs/db/'+name,import.meta.url),'utf8')
before(async () => {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table profiles(id uuid primary key);
    create table org_members(org_id uuid,profile_id uuid,role text,is_active boolean);
    create table properties(id uuid primary key default gen_random_uuid(),owner uuid references profiles(id));
    create table inspections(id uuid primary key default gen_random_uuid(),property_id uuid references properties(id),
      type text default 'OB',inspection_family text default 'OB',inspection_side text default 'buyer',
      locked_at timestamptz,locked_by uuid,status text default 'draft');
    create table assignments(id uuid primary key default gen_random_uuid());
    create table ob_assignment_workflows(inspection_id uuid primary key,current_assignment_id uuid);
    create table test_paused(inspection_id uuid primary key);
    create function ob_assignment_workflow_state(uuid) returns jsonb language sql as $$
      select jsonb_build_object('paused',exists(select 1 from test_paused where inspection_id=$1)) $$;
    create table settings_exterior_items(id uuid primary key default gen_random_uuid(),key text default 'fasad',label text default 'Fasad',is_active boolean default true);
    create table settings_control_points(id uuid primary key default gen_random_uuid(),title text default 'Kontroll',key text default 'test',label text,applies_to text[],is_active boolean default true);
    create table settings_control_point_outcomes(id uuid primary key default gen_random_uuid(),control_point_id uuid references settings_control_points(id),label text, is_active boolean default true);
    create table inspection_interior_rooms(id uuid primary key default gen_random_uuid(),inspection_id uuid references inspections(id),floor_label text not null,
      order_index int default 10,room_type_key text default 'hall',room_label text default 'Hall',values jsonb default '{}',note text,updated_at timestamptz default now());
    create table inspection_exterior_observations(id uuid primary key default gen_random_uuid(),inspection_id uuid references inspections(id),
      exterior_item_id uuid references settings_exterior_items(id),part_label text,values jsonb default '{}',is_free_note boolean default false,created_at timestamptz default now());
    create table inspection_control_items(id uuid primary key default gen_random_uuid(),inspection_id uuid references inspections(id),
      interior_room_id uuid references inspection_interior_rooms(id) on delete cascade,
      exterior_observation_id uuid references inspection_exterior_observations(id),control_point_id uuid references settings_control_points(id),
      selected_outcome_id uuid references settings_control_point_outcomes(id),title text not null,status text,note text,risk_text text,ftu_text text,
      sort_order int default 10,updated_at timestamptz default now(),
      constraint inspection_control_items_side_check check ((interior_room_id is not null and exterior_observation_id is null) or (interior_room_id is null and exterior_observation_id is not null)));
    create table inspection_images(id uuid primary key default gen_random_uuid(),inspection_id uuid references inspections(id),
      control_item_id uuid references inspection_control_items(id) on delete cascade,
      interior_room_id uuid references inspection_interior_rooms(id) on delete cascade,exterior_observation_id uuid references inspection_exterior_observations(id) on delete cascade,
      origin_interior_room_id uuid references inspection_interior_rooms(id) on delete set null,origin_exterior_observation_id uuid references inspection_exterior_observations(id) on delete set null,
      origin_exterior_item_id uuid references settings_exterior_items(id),origin_floor_label text,file_path text default 'test-original.jpg',
      thumbnail_file_path text default 'test-thumbnail.jpg',label text,processing_status text default 'unprocessed',ignored_at timestamptz);
    create table inspection_round_quick_notes(id uuid primary key default gen_random_uuid(),inspection_id uuid references inspections(id),
      interior_room_id uuid references inspection_interior_rooms(id) on delete cascade,exterior_observation_id uuid, note text default '');
    create table settings_overview_items(id uuid primary key,key text,is_active boolean);
    create table inspection_overview_selections(inspection_id uuid,overview_item_id uuid,values jsonb,set_index int);
    create table settings_overview_groups(id uuid primary key,overview_item_id uuid,key text,is_active boolean);
    create table settings_overview_options(group_id uuid,value text,label text,system_value text,is_active boolean);
    insert into profiles values('${actor}'),('${stranger}');
    insert into org_members values('${org}','${actor}','inspector',true),('${org}','${stranger}','inspector',true);
`)
  await db.exec(`
    create schema auth;
    create function auth.uid() returns uuid language sql as $$ select null::uuid $$;
    create table buildings(id uuid primary key default gen_random_uuid(), property_id uuid references properties(id), name text not null);
    alter table inspections add column cover_path text;
    create table inspection_conditions(id uuid primary key default gen_random_uuid(), inspection_id uuid unique references inspections(id),
      furnishing_level text, special_conditions text, building_type text, building_year text);
    alter table inspection_overview_selections add column id uuid primary key default gen_random_uuid(), add column floor_key text, add column note text;
    create table settings_interior_room_types(id uuid primary key default gen_random_uuid(),key text unique,label text,sort_order int,is_active boolean);
    create table inspection_report_links(id uuid primary key default gen_random_uuid(),inspection_id uuid, snapshot_payload jsonb);
  `)
  for (const name of ['2026-03-24_03_inspection_lock_write_guards.sql','2026-09-11_01_ob_round_mutations.sql',
    '2026-09-11_03_ob_floor_model.sql','2026-09-11_07_ob_image_note_place.sql']) await db.exec(read(name))
  await db.exec(`
    alter table inspection_overview_selections add constraint inspection_overview_selection_inspection_id_overview_item_i_key unique(inspection_id,overview_item_id,floor_key,set_index);
    create unique index inspection_overview_selections_logical_unique_idx on inspection_overview_selections(inspection_id,overview_item_id,floor_key,set_index) nulls not distinct;
    create unique index inspection_exterior_observations_unique_main on inspection_exterior_observations(inspection_id,exterior_item_id) where is_free_note=false;
  `)
  for (const name of ['2026-09-12_01_ob_building_parts.sql','2026-09-12_02_ob_building_commands.sql',
    '2026-09-12_03_ob_building_round.sql','2026-09-12_04_ob_building_cutover.sql']) {
    await db.exec(read(name)); await db.exec(read(name))
  }
  await db.exec("select set_config('request.jwt.claim.role','service_role',false)")
})
after(()=>db.close())
async function overview(id: string) {
  return (await one('select ob_building_get($1,$2,$3) as data',[id,org,actor])).data
}
async function command(id:string, operation:string, payload:Record<string,unknown>) {
  return (await one('select ob_building_command($1,$2,$3,$4,$5) as data',[id,org,actor,operation,{requestId:randomUUID(),...payload}])).data
}
async function row(id:string, partId:string, table:string, data:Record<string,unknown>, existing?:Record<string,any>) {
  return (await one('select ob_building_write_row($1,$2,$3,$4) as data',[id,org,actor,{table,partId,row:data,
    id:existing?.id??randomUUID(), revision:existing?.ob_revision, operation:existing?'update':'insert', requestId:randomUUID()}])).data
}
async function fixture() {
  const p=await one('insert into properties(owner) values($1) returning *',[actor])
  const i=await one("insert into inspections(property_id,cover_path) values($1,'original.jpg') returning *",[p.id])
  const r=await one("insert into inspection_interior_rooms(inspection_id,floor_label) values($1,'plan1') returning *",[i.id])
  const n=await one("insert into inspection_control_items(inspection_id,interior_room_id,title,note) values($1,$2,'Notering','Behall') returning *",[i.id,r.id])
  const img=await one("insert into inspection_images(inspection_id,interior_room_id,origin_interior_room_id,control_item_id) values($1,$2,$2,$3) returning *",[i.id,r.id,n.id])
  return {i,r,n,img}
}
async function activate(id:string) {
  await db.exec('update ob_building_rollout set enabled=true')
  return command(id,'activate',{name:'Huvudbyggnad',buildingId:null,confirmed:true,activationToken:(await overview(id)).activationToken})
}
async function round(id:string, partId:string, operation:string, payload:Record<string,unknown>) {
  return (await one('select ob_building_round_mutate($1,$2,$3,$4,$5,$6) as data',[id,org,actor,operation,payload,partId])).data
}
test('rollout is off; additive migrations do not enroll or change legacy records',async()=>{
  const f=await fixture()
  assert.equal((await overview(f.i.id)).available,false)
  assert.equal((await overview(f.i.id)).structure,null)
  await assert.rejects(command(f.i.id,'activate',{name:'Hus',buildingId:null,confirmed:true,activationToken:(await overview(f.i.id)).activationToken}),/OB_BUILDING_DISABLED/)
  assert.deepEqual(await one('select * from inspections where id=$1',[f.i.id]),f.i)
  assert.deepEqual(await one('select * from inspection_images where id=$1',[f.img.id]),f.img)
})
test('activation preserves identities, text, files, floors and old cover, with isolated extra buildings',async()=>{
  const f=await fixture()
  const o=await activate(f.i.id); const main=o.parts[0]
  for(const [table,old] of [['inspection_interior_rooms',f.r],['inspection_control_items',f.n],['inspection_images',f.img]] as const) {
    const actual=await one('select * from '+table+' where id=$1',[old.id])
    assert.equal(actual.building_part_id,main.id)
    for(const key of Object.keys(old).filter(k=>!['building_part_id','origin_building_part_id','ob_revision','updated_at'].includes(k))) assert.deepEqual(actual[key],old[key],key)
  }
  assert.equal(main.floor_model,null)
  const two=await command(f.i.id,'add',{name:'Garage',categoryKey:'garage',buildingId:null})
  const garage=two.parts.find((p:any)=>p.id!==main.id)
  assert.equal(garage.floor_model.levels[0].level,0)
  const room=await row(f.i.id,garage.id,'inspection_interior_rooms',{floor_label:'plan0',room_label:'Hall'})
  await assert.rejects(row(f.i.id,main.id,'inspection_control_items',{interior_room_id:room.id,title:'Fel'}),/OB_ROUND_FOREIGN/)
  assert.equal((await one('select cover_path from inspections where id=$1',[f.i.id])).cover_path,'original.jpg')
  await assert.rejects(db.query("update inspection_control_items set note='old tab' where id=$1",[f.n.id]),/OB_BUILDING_CLIENT_REQUIRED/)
  await assert.rejects(command(f.i.id,'remove',{partId:garage.id,revision:garage.revision}),/OB_BUILDING_NOT_EMPTY/)
  const changed=await row(f.i.id,garage.id,'inspection_interior_rooms',{room_label:'Studio'},room)
  assert.equal(changed.room_label,'Studio')
  await assert.rejects(row(f.i.id,garage.id,'inspection_interior_rooms',{room_label:'Stale'},room),/OB_ROUND_STALE/)
  for(const name of ['Gaststuga','Verkstad']) await command(f.i.id,'add',{name,categoryKey:'complement',buildingId:null})
  assert.equal((await overview(f.i.id)).parts.length,4)
})
test('installed overview constraint permits distinct buildings but still rejects duplicates within a building or legacy root',async()=>{
  const f = await fixture()
  const item = randomUUID()
  await db.query("insert into settings_overview_items(id,key,is_active) values($1,'test_unique',true)",[item])
  await activate(f.i.id)
  await command(f.i.id,'add',{name:'Garage',categoryKey:'garage',buildingId:null})
  const added = await command(f.i.id,'add',{name:'Guesthouse',categoryKey:'complement',buildingId:null})
  const garage = added.parts.find((part: {name: string})=>part.name==='Garage')
  const guesthouse = added.parts.find((part: {name: string})=>part.name==='Guesthouse')
  for (const floor of ['plan0', null]) {
    const selection = {overview_item_id:item,floor_key:floor,set_index:0,values:{material:'wood'}}
    const first = await row(f.i.id,garage.id,'inspection_overview_selections',selection)
    const second = await row(f.i.id,guesthouse.id,'inspection_overview_selections',selection)
    assert.notEqual(first.id,second.id)
    await assert.rejects(row(f.i.id,garage.id,'inspection_overview_selections',selection), /ob_overview_part_unique/)
    assert.equal((await one('select count(*)::int as total from inspection_overview_selections where inspection_id=$1 and floor_key is not distinct from $2',[f.i.id,floor])).total,2)
  }
  const legacy = await fixture()
  for (const floor of ['plan1', null]) {
    const values = [legacy.i.id,item,floor]
    await db.query('insert into inspection_overview_selections(inspection_id,overview_item_id,floor_key,set_index) values($1,$2,$3,0)',values)
    await assert.rejects(db.query('insert into inspection_overview_selections(inspection_id,overview_item_id,floor_key,set_index) values($1,$2,$3,0)',values),/ob_overview_legacy_unique/)
  }
  assert.equal((await one("select count(*)::int as total from pg_constraint where conname='inspection_overview_selection_inspection_id_overview_item_i_key'")).total,0)
})

test('foreign actors, changed activation previews, locked and paused roots fail closed',async()=>{
  const f=await fixture(); const preview=await overview(f.i.id)
  await db.query("update inspection_control_items set note='newer' where id=$1",[f.n.id])
  await assert.rejects(command(f.i.id,'activate',{name:'Hus',buildingId:null,confirmed:true,activationToken:preview.activationToken}),/OB_ROUND_STALE/)
  await assert.rejects(one('select ob_building_get($1,$2,$3)',[f.i.id,org,stranger]),/OB_ROUND_FORBIDDEN/)
  await db.query('insert into test_paused values($1)',[f.i.id])
  await assert.rejects(activate(f.i.id),/OB_ROUND_PAUSED/)
  await db.query('delete from test_paused where inspection_id=$1',[f.i.id])
  await db.query('update inspections set locked_at=now() where id=$1',[f.i.id])
  await assert.rejects(activate(f.i.id),/LOCKED/i)
})
test('old or stale report capture is rejected for enrolled inspections',async()=>{
  const f=await fixture(); const o=await activate(f.i.id)
  await assert.rejects(db.query('insert into inspection_report_links(inspection_id,snapshot_payload) values($1,$2)',[f.i.id,{}]),/OB_BUILDING_REPORT_STALE/)
  await db.query('insert into inspection_report_links(inspection_id,snapshot_payload) values($1,$2)',[f.i.id,{reportData:{obBuildingRevision:o.structure.revision}}])
})
test('room moves carry children, keep capture origin, and support idempotent retry',async()=>{
  const f=await fixture(); const o=await activate(f.i.id); const main=o.parts[0]
  const two=await command(f.i.id,'add',{name:'Extra',categoryKey:'garage',buildingId:null})
  const extra=two.parts.find((p:any)=>p.id!==main.id)
  const request={kind:'room',id:f.r.id,from:{floor:'plan1'},floor:'plan0',targetBuildingPartId:extra.id,requestId:randomUUID()}
  const moved=await round(f.i.id,main.id,'move',request)
  assert.equal(moved.room.building_part_id,extra.id)
  assert.deepEqual(await round(f.i.id,main.id,'move',request),moved)
  const n=await one('select * from inspection_control_items where id=$1',[f.n.id])
  const img=await one('select * from inspection_images where id=$1',[f.img.id])
  assert.equal(n.building_part_id,extra.id); assert.equal(img.building_part_id,extra.id)
  assert.equal(img.origin_building_part_id,main.id); assert.equal(img.file_path,f.img.file_path)
  await assert.rejects(row(f.i.id,main.id,'inspection_control_items',{note:'wrong scope'},n),/OB_ROUND_FOREIGN/)
  const preview=await round(f.i.id,extra.id,'remove-preview',{kind:'note',id:n.id})
  await round(f.i.id,extra.id,'remove',{kind:'note',id:n.id,token:preview.token,requestId:randomUUID()})
  const detached=await one('select * from inspection_images where id=$1',[img.id])
  assert.equal(detached.control_item_id,null); assert.equal(detached.building_part_id,extra.id)
  assert.equal(detached.origin_building_part_id,main.id); assert.equal(detached.file_path,img.file_path)
})
test('covers are part scoped, old references survive and empty-part removal preserves physical building',async()=>{
  const f=await fixture(); const o=await activate(f.i.id); const main=o.parts[0]
  const two=await command(f.i.id,'add',{name:'Extra',categoryKey:'garage',buildingId:null})
  const extra=two.parts.find((p:any)=>p.id!==main.id)
  await assert.rejects(command(f.i.id,'edit',{partId:extra.id,revision:1,coverPath:f.i.id+'/building-covers/'+main.id+'/bad.jpg'}),/OB_ROUND_INVALID/)
  const updated=await command(f.i.id,'edit',{partId:main.id,revision:1,coverPath:f.i.id+'/building-covers/'+main.id+'/new.jpg'})
  assert.equal(updated.parts.find((p:any)=>p.id===extra.id).cover_path,null)
  assert.equal((await one('select cover_path from inspections where id=$1',[f.i.id])).cover_path,'original.jpg')
  await command(f.i.id,'remove',{partId:extra.id,revision:1})
  assert.ok(await one('select id from buildings where id=$1',[extra.building_id]))
})
test('unplaced legacy photos remain claimable once; competing claims and stale writes are rejected',async()=>{
  const f=await fixture()
  const image=await one('insert into inspection_images(inspection_id) values($1) returning *',[f.i.id])
  const o=await activate(f.i.id); const main=o.parts[0]
  const fresh=await one('select * from inspection_images where id=$1',[image.id])
  assert.equal(fresh.building_part_id,null)
  const claimed=await row(f.i.id,main.id,'inspection_images',{control_item_id:f.n.id,interior_room_id:f.r.id,processing_status:'linked'},fresh)
  assert.equal(claimed.building_part_id,main.id); assert.equal(claimed.origin_building_part_id,null)
  await assert.rejects(row(f.i.id,main.id,'inspection_images',{label:'stale'},fresh),/OB_ROUND_STALE/)
})

test('cutover refuses an unexpected constraint definition without dropping it or changing rows',async()=>{
  await db.exec('alter table inspection_overview_selections add constraint inspection_overview_selection_inspection_id_overview_item_i_key unique(id)')
  const before = (await db.query('select * from inspection_overview_selections order by id')).rows
  try {
    await assert.rejects(db.exec(read('2026-09-12_04_ob_building_cutover.sql')),/OB_BUILDING_UNEXPECTED_OVERVIEW_CONSTRAINT/)
    await db.exec('rollback')
    assert.equal((await one("select pg_get_constraintdef(oid) as definition from pg_constraint where conname='inspection_overview_selection_inspection_id_overview_item_i_key'")).definition,'UNIQUE (id)')
    assert.deepEqual((await db.query('select * from inspection_overview_selections order by id')).rows,before)
  } finally {
    await db.exec('rollback; alter table inspection_overview_selections drop constraint inspection_overview_selection_inspection_id_overview_item_i_key')
  }
})

test('standalone access hardening remains compatible with building service commands and owner-scoped reads',async()=>{
  await db.exec('create table building_media(id uuid primary key default gen_random_uuid(),building_id uuid references buildings(id))')
  const extraTables = ['inspection_control_answers','inspection_control_point_answers','inspection_exterior_selections',
    'inspection_interior_observations','inspection_addon_orders','inspection_area_measurements','inspection_area_measurement_rows',
    'inspection_moisture_controls','inspection_moisture_control_rows','inspection_moisture_control_images','inspection_lock_events']
  for (const table of extraTables) await db.exec(`create table if not exists ${table}(id uuid primary key default gen_random_uuid(),inspection_id uuid references inspections(id))`)
  await db.exec(`
    alter role service_role bypassrls;
    create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth,public to authenticated,service_role;
    grant select on properties,inspections to authenticated;
    grant all on all tables in schema public to service_role;
    alter table properties enable row level security;
    alter table inspections enable row level security;
    create policy owner_all on properties for all to authenticated using(owner=auth.uid()) with check(owner=auth.uid());
    create policy inspections_owner on inspections for all to authenticated
      using(exists(select 1 from properties p where p.id=inspections.property_id and p.owner=auth.uid()))
      with check(exists(select 1 from properties p where p.id=inspections.property_id and p.owner=auth.uid()));
    select set_config('app.inspection_access_hardening_approved','true',false);
  `)
  await db.exec(read('2026-09-12_09_inspection_access_hardening.sql'))
  const f = await fixture()
  await db.exec('set role service_role')
  try {
    const activated = await activate(f.i.id)
    const main = activated.parts[0]
    const room = await row(f.i.id,main.id,'inspection_interior_rooms',{floor_label:'plan1',room_label:'Service room'})
    assert.equal(room.building_part_id,main.id)
    await command(f.i.id,'add',{name:'Garage after hardening',categoryKey:'garage',buildingId:null})
  } finally { await db.exec('reset role') }
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[actor])
  await db.exec('set role authenticated')
  try {
    assert.equal((await db.query('select * from inspection_images where inspection_id=$1',[f.i.id])).rows.length,1)
    assert.equal((await db.query('select * from ob_inspection_buildings where inspection_id=$1',[f.i.id])).rows.length,2)
    await assert.rejects(db.query('select ob_building_get($1,$2,$3)',[f.i.id,org,actor]),/permission denied/)
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[stranger])
    assert.equal((await db.query('select * from inspection_images where inspection_id=$1',[f.i.id])).rows.length,0)
    assert.equal((await db.query('select * from ob_inspection_buildings where inspection_id=$1',[f.i.id])).rows.length,0)
  } finally { await db.exec('reset role') }
})
