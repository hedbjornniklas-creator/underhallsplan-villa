import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
const read = (name: string) => readFileSync(new URL('../docs/db/'+name,import.meta.url),'utf8')
const migration = read('2026-09-12_09_inspection_access_hardening.sql')
const clientTables = ['buildings','building_media','inspection_conditions','inspection_control_answers',
  'inspection_control_point_answers','inspection_exterior_observations','inspection_exterior_selections',
  'inspection_interior_observations','inspection_interior_rooms','inspection_control_items',
  'inspection_images','inspection_overview_selections']
const serverTables = ['inspection_addon_orders','inspection_area_measurements','inspection_area_measurement_rows',
  'inspection_moisture_controls','inspection_moisture_control_rows','inspection_moisture_control_images','inspection_lock_events']
const allTables = [...clientTables,...serverTables]
const owner = randomUUID(), other = randomUUID(), property = randomUUID(), foreignProperty = randomUUID()
const inspection = randomUUID(), foreignInspection = randomUUID()
const building = randomUUID(), foreignBuilding = randomUUID()
const scope = (table: string) => table==='buildings'?'property_id':table==='building_media'?'building_id':'inspection_id'
const root = (table: string, foreign=false) => table==='buildings'
  ? (foreign?foreignProperty:property) : table==='building_media'
    ? (foreign?foreignBuilding:building) : (foreign?foreignInspection:inspection)
async function asRole<T>(role: 'anon'|'authenticated'|'service_role', actor: string, run:()=>Promise<T>) {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[actor])
  await db.exec('set role '+role)
  try { return await run() } finally { await db.exec('reset role') }
}
before(async()=>{
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema public,auth to anon,authenticated,service_role;
    create table properties(id uuid primary key,owner uuid not null);
    create table inspections(id uuid primary key,property_id uuid references properties(id),locked_at timestamptz);
    alter table properties enable row level security;
    alter table inspections enable row level security;
    create policy owner_all on properties for all to authenticated using(owner=auth.uid()) with check(owner=auth.uid());
    create policy inspections_by_owner on inspections for all to authenticated
      using(exists(select 1 from properties p where p.id=inspections.property_id and p.owner=auth.uid()))
      with check(exists(select 1 from properties p where p.id=inspections.property_id and p.owner=auth.uid()));
    insert into properties values('${property}','${owner}'),('${foreignProperty}','${other}');
    insert into inspections values('${inspection}','${property}',null),('${foreignInspection}','${foreignProperty}',null);
    create table ob_test_unrelated(id int primary key);
    create table unrelated_business(id int primary key);
    create schema storage;
    create table storage.buckets(id text primary key,public boolean,secret_metadata text);
    insert into storage.buckets values('inspection-images',true,'PRIVATE_BUCKET_CANARY');
    create view inspection_test_view as select * from inspections;
  `)
  for (const table of allTables) {
    const parent = table==='buildings'?'properties':table==='building_media'?'buildings':'inspections'
    await db.exec(`create table ${table}(id uuid primary key default gen_random_uuid(),${scope(table)} uuid references ${parent}(id),note text default 'original')`)
    if (table==='buildings') await db.query('insert into buildings(id,property_id) values($1,$2),($3,$4)',[building,property,foreignBuilding,foreignProperty])
    else await db.query(`insert into ${table}(${scope(table)}) values($1),($2)`,[root(table),root(table,true)])
  }
  for (const table of ['buildings','building_media','inspection_images','inspection_control_items','inspection_overview_selections']) {
    await db.exec(`alter table ${table} enable row level security;
      create policy legacy_open on ${table} for all to authenticated using(true) with check(true)`)
  }
  await db.exec('grant all on all tables in schema public to anon,authenticated,service_role')
  await db.exec('grant select(note),update(note) on inspection_images to public')
  await db.exec(read('2026-03-24_03_inspection_lock_write_guards.sql'))
})
after(()=>db.close())

test('additional preflight is read-only, returns access metadata and no stored row values',async()=>{
  await db.exec('begin read only')
  try {
    const result = await db.query<{access_preflight: {
      roles: unknown[]; functions: {signature:string; guard_definition:string|null}[];
      buckets: {id:string; public:boolean}[]; column_grants: {table_name:string;grantee:string}[];
      readable_views: {view_name:string;anon_select:boolean}[]
    }}>(read('2026-09-12_08_inspection_access_preflight.sql'))
    assert.equal(result.rows.length,1)
    const metadata=result.rows[0].access_preflight
    assert.equal(metadata.roles.length,3)
    assert.deepEqual(metadata.buckets,[{id:'inspection-images',public:true}])
    assert.ok(metadata.functions.some(f=>f.signature.includes('guard_locked_inspection_child_write') && f.guard_definition?.includes('CREATE OR REPLACE FUNCTION')))
    assert.ok(metadata.column_grants.some(g=>g.table_name==='inspection_images' && g.grantee==='PUBLIC'))
    assert.ok(metadata.readable_views.some(v=>v.view_name==='inspection_test_view' && v.anon_select))
    const serialized=JSON.stringify(metadata)
    for (const canary of ['PRIVATE_BUCKET_CANARY',owner,inspection,foreignInspection]) assert.ok(!serialized.includes(canary))
  } finally { await db.exec('rollback') }
})

test('migration requires explicit review and otherwise leaves the schema untouched',async()=>{
  await assert.rejects(db.exec(migration),/INSPECTION_ACCESS_REVIEW_REQUIRED/)
  await db.exec('rollback')
  assert.equal((await db.query<{rls: boolean}>("select relrowsecurity as rls from pg_class where oid='inspection_conditions'::regclass")).rows[0].rls,false)
})

test('migration is repeatable, preserves records and triggers, and changes only intended grants',async()=>{
  const snapshot = async()=>{
    const result: Record<string,unknown> = {}
    for (const table of allTables) result[table]=(await db.query(`select * from ${table} order by id`)).rows
    result.triggers=(await db.query('select tgname,pg_get_triggerdef(oid) as definition from pg_trigger where not tgisinternal order by tgrelid,tgname')).rows
    return result
  }
  const before = await snapshot()
  await db.exec("select set_config('app.inspection_access_hardening_approved','true',false)")
  await db.exec(migration)
  await db.exec(migration)
  assert.deepEqual(await snapshot(),before)
  for (const table of [...allTables,'properties','inspections','ob_test_unrelated']) {
    for (const role of ['anon','authenticated']) {
      assert.equal((await db.query<{allowed: boolean}>("select has_table_privilege($1,$2,'TRUNCATE,REFERENCES,TRIGGER') as allowed",[role,table])).rows[0].allowed,false)
    }
  }
  assert.equal((await db.query<{allowed: boolean}>("select has_table_privilege('anon','unrelated_business','TRUNCATE') as allowed")).rows[0].allowed,true)
})

test('anonymous table and column reads and writes are denied even with a forged subject',async()=>{
  await asRole('anon',owner,async()=>{
    for (const table of allTables) {
      await assert.rejects(db.query(`select * from ${table}`),/permission denied/)
      await assert.rejects(db.query(`insert into ${table}(${scope(table)}) values($1)`,[root(table)]),/permission denied/)
    }
    await assert.rejects(db.query('select note from inspection_images'),/permission denied/)
    await assert.rejects(db.query("update inspection_images set note='forged'"),/permission denied/)
  })
})

test('owners retain direct CRUD; other inspections and reparenting stay denied despite permissive policies',async()=>{
  await asRole('authenticated',owner,async()=>{
    for (const table of clientTables) {
      assert.equal((await db.query(`select * from ${table}`)).rows.length,1,table)
      const inserted = (await db.query<{id:string}>(`insert into ${table}(${scope(table)},note) values($1,'new') returning id`,[root(table)])).rows[0]
      await db.query(`update ${table} set note='edited' where id=$1`,[inserted.id])
      await assert.rejects(db.query(`update ${table} set ${scope(table)}=$1 where id=$2`,[root(table,true),inserted.id]),/row-level security/)
      await assert.rejects(db.query(`insert into ${table}(${scope(table)}) values($1)`,[root(table,true)]),/row-level security/)
      await assert.rejects(db.query(`insert into ${table}(${scope(table)}) values(null)`),/row-level security/)
      assert.equal((await db.query(`update ${table} set note='wrong' where ${scope(table)}=$1 returning id`,[root(table,true)])).rows.length,0)
      assert.equal((await db.query(`delete from ${table} where ${scope(table)}=$1 returning id`,[root(table,true)])).rows.length,0)
      assert.equal((await db.query(`delete from ${table} where id=$1 returning id`,[inserted.id])).rows.length,1)
    }
  })
  await asRole('authenticated',other,async()=>{
    for (const table of allTables) {
      const rows = (await db.query<Record<string,string>>(`select * from ${table}`)).rows
      assert.equal(rows.length,1,table)
      assert.equal(rows[0][scope(table)],root(table,true))
    }
  })
  await asRole('authenticated','',async()=>{
    assert.equal((await db.query('select * from inspection_images')).rows.length,0)
  })
})

test('server-managed orders, measurements and audit events are owner-readable but not browser-writable',async()=>{
  await asRole('authenticated',owner,async()=>{
    for (const table of serverTables) {
      assert.equal((await db.query(`select * from ${table}`)).rows.length,1)
      await assert.rejects(db.query(`insert into ${table}(inspection_id) values($1)`,[inspection]),/permission denied/)
      await assert.rejects(db.query(`update ${table} set note='forged'`),/permission denied/)
      await assert.rejects(db.query(`delete from ${table}`),/permission denied/)
    }
  })
})

test('service-role access survives; existing lock triggers still reject edits',async()=>{
  await asRole('service_role','',async()=>{
    for (const table of allTables) {
      assert.equal((await db.query(`select * from ${table}`)).rows.length,2)
      const created = (await db.query<{id:string}>(`insert into ${table}(${scope(table)}) values($1) returning id`,[root(table,true)])).rows[0]
      await db.query(`update ${table} set note='service' where id=$1`,[created.id])
      await db.query(`delete from ${table} where id=$1`,[created.id])
    }
  })
  await db.query('update inspections set locked_at=now() where id=$1',[inspection])
  await asRole('authenticated',owner,async()=>{
    await assert.rejects(db.query("update inspection_conditions set note='locked'"),/l\u00e5st/)
    assert.equal((await db.query('select * from inspection_conditions')).rows.length,1)
  })
  await db.query('update inspections set locked_at=null where id=$1',[inspection])
})

test('an inherited anonymous grant aborts the hardening transaction instead of reporting success',async()=>{
  await db.exec('create role unexpected_reader; grant select on inspection_images to unexpected_reader; grant unexpected_reader to anon')
  await assert.rejects(db.exec(migration),/INSPECTION_ACCESS_INHERITED_GRANT/)
  await db.exec('rollback; revoke unexpected_reader from anon')
})

test('inherited server-column writes and browser table ownership fail closed',async()=>{
  await db.exec('create role unexpected_writer; grant update(note) on inspection_lock_events to unexpected_writer; grant unexpected_writer to authenticated')
  await assert.rejects(db.exec(migration),/INSPECTION_ACCESS_INHERITED_GRANT/)
  await db.exec('rollback; revoke unexpected_writer from authenticated')
  await db.exec('alter table inspection_images owner to authenticated')
  try {
    await assert.rejects(db.exec(migration),/INSPECTION_ACCESS_UNSAFE_OWNER/)
    await db.exec('rollback')
  } finally { await db.exec('rollback; alter table inspection_images owner to postgres') }
})

test('unsafe roles or missing parent RLS abort before enabling child policies',async()=>{
  await db.exec('alter role anon bypassrls')
  try {
    await assert.rejects(db.exec(migration),/INSPECTION_ACCESS_UNSAFE_ROLE/)
    await db.exec('rollback')
  } finally { await db.exec('rollback; alter role anon nobypassrls') }
  await db.exec('alter table inspections disable row level security')
  try {
    await assert.rejects(db.exec(migration),/INSPECTION_ACCESS_PARENT_RLS_REQUIRED/)
    await db.exec('rollback')
  } finally { await db.exec('rollback; alter table inspections enable row level security') }
})
