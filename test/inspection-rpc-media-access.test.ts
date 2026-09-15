import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const db=new PGlite()
const read=(name:string)=>readFileSync(new URL('../docs/db/'+name,import.meta.url),'utf8')
const migration=read('2026-09-12_10_inspection_rpc_media_hardening.sql')
const owner=randomUUID(),other=randomUUID(),property=randomUUID(),foreignProperty=randomUUID()
const inspection=randomUUID(),foreignInspection=randomUUID(),org=randomUUID(),project=randomUUID()
const calls:[string,unknown[]][]=[
  ['ensure_inspection_default_other_room_and_points($1)',[foreignInspection]],
  ['lock_eb_inspection_report($1,$2,$3,$4)',[org,project,foreignInspection,owner]],
  ['unlock_eb_inspection_report($1,$2,$3,$4,$5)',[org,project,foreignInspection,'Synthetic test reason',owner]],
  ['unlock_tu_investigation_report($1,$2,$3,$4)',[org,inspection,'Synthetic test reason',owner]],
]
async function asRole<T>(role:'anon'|'authenticated'|'service_role',actor:string,run:()=>Promise<T>) {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[actor])
  await db.exec('set role '+role)
  try {return await run()} finally {await db.exec('reset role')}
}
before(async()=>{
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema storage;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    grant usage on schema public,auth,storage to anon,authenticated,service_role;
    create table profiles(id uuid primary key);
    insert into profiles values('${owner}'),('${other}');
    create table properties(id uuid primary key,owner uuid,name text default 'Synthetic property');
    create table buildings(id uuid primary key,property_id uuid references properties(id));
    create table building_media(id uuid primary key,building_id uuid references buildings(id));
    create table inspections(id uuid primary key,property_id uuid references properties(id),status text default 'draft',locked_at timestamptz,locked_by uuid);
    alter table properties enable row level security; alter table inspections enable row level security;
    create policy properties_owner on properties for all to authenticated using(owner=auth.uid()) with check(owner=auth.uid());
    create policy inspections_owner on inspections for all to authenticated
      using(exists(select 1 from properties p where p.id=inspections.property_id and p.owner=auth.uid()))
      with check(exists(select 1 from properties p where p.id=inspections.property_id and p.owner=auth.uid()));
    insert into properties(id,owner) values('${property}','${owner}'),('${foreignProperty}','${other}');
    insert into inspections(id,property_id) values('${inspection}','${property}'),('${foreignInspection}','${foreignProperty}');
    create table eb_inspection_details(inspection_id uuid primary key,org_id uuid,eb_project_id uuid,report_locked_at timestamptz);
    create table technical_investigation_details(inspection_id uuid primary key,org_id uuid,report_locked_at timestamptz,report_locked_by uuid);
    insert into eb_inspection_details values('${foreignInspection}','${org}','${project}',null);
    insert into technical_investigation_details values('${inspection}','${org}',null,null);
    create table settings_interior_room_types(id uuid primary key,key text,label text,is_active boolean,sort_order int,created_at timestamptz);
    create table settings_control_points(id uuid primary key,key text,title text,label text,scope text,is_active boolean,sort_order int,trigger_room_types jsonb);
    create table storage.buckets(id text primary key,public boolean);
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text not null,metadata jsonb default '{}',unique(bucket_id,name));
    insert into storage.buckets values('inspection-images',true),('property-media',true),('eb-project-attachments',false);
    insert into storage.objects(bucket_id,name) values
      ('inspection-images','${inspection}/round/original.jpg'),('inspection-images','${foreignInspection}/round/other.jpg'),
      ('property-media','${property}/cover.jpg'),('property-media','${foreignProperty}/cover.jpg'),
      ('property-media','profiles/${owner}/avatar.png'),('property-media','profiles/${other}/avatar.png'),
      ('eb-project-attachments','server-document.pdf');
    alter table storage.objects enable row level security;
    create policy old_image_all on storage.objects for all to authenticated using(bucket_id='inspection-images') with check(bucket_id='inspection-images');
    create policy old_public_read on storage.objects for select to public using(bucket_id in ('inspection-images','property-media'));
    create policy old_property_insert on storage.objects for insert to authenticated with check(bucket_id='property-media');
    create policy old_property_update on storage.objects for update to authenticated using(bucket_id='property-media') with check(bucket_id='property-media');
    create policy other_bucket_read on storage.objects for select to authenticated using(bucket_id='eb-project-attachments');
  `)
  for(const table of ['inspection_conditions','inspection_control_answers','inspection_control_point_answers',
    'inspection_exterior_observations','inspection_exterior_selections','inspection_interior_observations',
    'inspection_interior_rooms','inspection_control_items','inspection_images','inspection_overview_selections',
    'inspection_addon_orders','inspection_area_measurements','inspection_area_measurement_rows',
    'inspection_moisture_controls','inspection_moisture_control_rows','inspection_moisture_control_images','inspection_lock_events']) {
    await db.exec(`create table ${table}(id uuid primary key default gen_random_uuid(),inspection_id uuid references inspections(id),note text)`)
  }
  await db.exec(`
    alter table inspection_interior_rooms add column floor_label text,add column room_type_key text,add column room_label text,
      add column order_index int,add column values jsonb,add column created_at timestamptz default now();
    alter table inspection_control_items add column interior_room_id uuid,add column control_point_id uuid,add column title text,
      add column status text,add column sort_order int,add column selected_outcome_id uuid;
    alter table inspection_lock_events add column org_id uuid,add column action text,add column reason text,add column performed_by uuid;
    grant all on all tables in schema public to anon,authenticated,service_role;
    grant all on all tables in schema storage to anon,authenticated,service_role;
  `)
  for(const file of ['2026-03-24_03_inspection_lock_write_guards.sql','2026-02-25_02_insida_default_other_room_guard.sql',
    '2026-06-08_02_eb_report_locking.sql','2026-06-09_02_eb_report_unlocking_keep_links.sql','2026-06-09_01_tu_report_unlocking.sql']) await db.exec(read(file))
  await db.exec("select set_config('app.inspection_access_hardening_approved','true',false)")
  await db.exec(read('2026-09-12_09_inspection_access_hardening.sql'))
})
after(()=>db.close())

test('table hardening alone does not stop the reviewed legacy anonymous RPC bypass',async()=>{
  await db.exec('begin')
  try {
    await asRole('anon','',async()=>{
      await db.query('select '+calls[1][0],calls[1][1])
      await db.query('select '+calls[2][0],calls[2][1])
      await db.query('select '+calls[0][0],calls[0][1])
    })
    assert.equal((await db.query('select * from inspection_lock_events')).rows.length,1)
    assert.equal((await db.query('select * from inspection_interior_rooms')).rows.length,1)
  } finally {await db.exec('rollback')}
})

test('media/RPC hardening is gated, repeatable and preserves all records, public flags and function bodies',async()=>{
  await db.exec("select set_config('app.inspection_access_hardening_approved','false',false)")
  await assert.rejects(db.exec(migration),/INSPECTION_ACCESS_REVIEW_REQUIRED/)
  await db.exec("rollback; select set_config('app.inspection_access_hardening_approved','true',false)")
  const snapshot=async()=>({
    objects:(await db.query('select * from storage.objects order by id')).rows,
    buckets:(await db.query('select * from storage.buckets order by id')).rows,
    inspections:(await db.query('select * from inspections order by id')).rows,
    definitions:(await db.query("select oid::regprocedure::text as signature,pg_get_functiondef(oid) as definition from pg_proc where pronamespace='public'::regnamespace and prokind='f' order by oid")).rows,
  })
  const before=await snapshot()
  await db.exec(migration); await db.exec(migration)
  assert.deepEqual(await snapshot(),before)
})

test('anonymous and authenticated direct RPC calls fail before legacy bodies execute',async()=>{
  for(const role of ['anon','authenticated'] as const) await asRole(role,owner,async()=>{
    for(const [call,params] of calls) await assert.rejects(db.query('select '+call,params),/permission denied for function/)
  })
  assert.equal((await db.query('select * from inspection_lock_events')).rows.length,0)
})

test('service RPC lock/unlock and automatic initialization still work',async()=>{
  await asRole('service_role','',async()=>{
    await db.query('select '+calls[1][0],calls[1][1])
    await db.query('select '+calls[2][0],calls[2][1])
    await db.query('update inspections set locked_at=now() where id=$1',[inspection])
    await db.query('select '+calls[3][0],calls[3][1])
    await db.query('select '+calls[0][0],calls[0][1])
  })
  await asRole('authenticated',owner,async()=>{
    const id=randomUUID()
    await db.query('insert into inspections(id,property_id) values($1,$2)',[id,property])
    const rooms=(await db.query<{room_type_key:string}>('select * from inspection_interior_rooms where inspection_id=$1',[id])).rows
    assert.equal(rooms.length,1)
    assert.equal(rooms[0].room_type_key,'ovrigt')
  })
})

test('object listing is owner-scoped while public bucket flags and unrelated bucket rules remain unchanged',async()=>{
  await asRole('anon','',async()=>assert.equal((await db.query('select * from storage.objects')).rows.length,0))
  await asRole('authenticated',owner,async()=>{
    const names=(await db.query<{name:string}>('select name from storage.objects order by name')).rows.map(row=>row.name)
    assert.deepEqual(new Set(names),new Set([`${inspection}/round/original.jpg`,`${property}/cover.jpg`,`profiles/${owner}/avatar.png`,'server-document.pdf']))
  })
  await asRole('service_role','',async()=>assert.equal((await db.query('select * from storage.objects')).rows.length,7))
})

test('owner uploads/upserts work; foreign paths, replacements, moves and deletes are denied',async()=>{
  await asRole('authenticated',owner,async()=>{
    const allowed:[string,string][]=[['inspection-images',`${inspection}/round/new.jpg`],['inspection-images',`${inspection}/building-covers/part/new.jpg`],
      ['property-media',`${property}/cover.jpg`],['property-media',`${property}/building/gallery/new.jpg`],['property-media',`profiles/${owner}/avatar.png`]]
    for(const [bucket,path] of allowed) {
      await db.query("insert into storage.objects(bucket_id,name,metadata) values($1,$2,'{\"version\":1}') on conflict(bucket_id,name) do update set metadata=excluded.metadata",[bucket,path])
    }
    for(const [bucket,path] of [['inspection-images',`${foreignInspection}/round/other.jpg`],['property-media',`${foreignProperty}/cover.jpg`],
      ['property-media',`profiles/${other}/avatar.png`],['inspection-images','invalid/new.jpg'],['inspection-images',`${inspection}/../other.jpg`],
      ['property-media','profiles/no-user/new.jpg'],['property-media','org-profile/server-owned.jpg']]) {
      await assert.rejects(db.query('insert into storage.objects(bucket_id,name) values($1,$2) on conflict(bucket_id,name) do update set metadata=excluded.metadata',[bucket,path]),/row-level security/)
      assert.equal((await db.query('update storage.objects set metadata=\'{}\' where bucket_id=$1 and name=$2 returning id',[bucket,path])).rows.length,0)
      assert.equal((await db.query('delete from storage.objects where bucket_id=$1 and name=$2 returning id',[bucket,path])).rows.length,0)
    }
    await assert.rejects(db.query('update storage.objects set name=$1 where bucket_id=$2 and name=$3',[`${foreignInspection}/stolen.jpg`,'inspection-images',`${inspection}/round/new.jpg`]),/row-level security/)
    assert.equal((await db.query('delete from storage.objects where bucket_id=$1 and name=$2 returning id',['inspection-images',`${inspection}/round/new.jpg`])).rows.length,1)
  })
})

test('server-owned EB/TU upload paths remain available only through the service client',async()=>{
  await asRole('service_role','',async()=>{
    for(const [bucket,path] of [['inspection-images',`${foreignInspection}/eb-notes/note/photo.jpg`],['property-media','org-profile/server-owned.jpg']]) {
      await db.query('insert into storage.objects(bucket_id,name) values($1,$2)',[bucket,path])
      await db.query('delete from storage.objects where bucket_id=$1 and name=$2',[bucket,path])
    }
  })
})

test('missing table boundary and inherited function access stop the migration',async()=>{
  await db.exec('begin; drop policy inspection_access_boundary on building_media')
  await assert.rejects(db.exec(migration),/INSPECTION_ACCESS_TABLE_HARDENING_REQUIRED/)
  await db.exec('rollback')
  await db.exec('create role unexpected_rpc; grant execute on function lock_eb_inspection_report(uuid,uuid,uuid,uuid) to unexpected_rpc; grant unexpected_rpc to anon')
  try {
    await assert.rejects(db.exec(migration),/INSPECTION_ACCESS_INHERITED_EXECUTE/)
    await db.exec('rollback')
  } finally {await db.exec('rollback; revoke unexpected_rpc from anon')}
})

test('unknown RPC definitions abort without removing the existing Storage boundary',async()=>{
  await db.exec('begin; drop function unlock_tu_investigation_report(uuid,uuid,text,uuid)')
  await db.exec("create function unlock_tu_investigation_report(uuid,uuid,text,uuid) returns text language sql as $$select 'changed'$$; commit")
  const before=(await db.query("select pg_get_expr(polqual,polrelid) as definition from pg_policy where polname='inspection_media_owner_boundary'")).rows
  await assert.rejects(db.exec(migration),/INSPECTION_ACCESS_UNREVIEWED_FUNCTION/)
  await db.exec('rollback')
  assert.deepEqual((await db.query("select pg_get_expr(polqual,polrelid) as definition from pg_policy where polname='inspection_media_owner_boundary'")).rows,before)
})
