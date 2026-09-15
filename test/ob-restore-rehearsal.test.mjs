import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { PGlite } from '@electric-sql/pglite'
import {
  canonical, sha256, storageFailureStatus, describeRestoreSchema, collectScopedRows,
  verifyBackup, restoreRowsLocally,
} from '../scripts/lib/ob-restore-rehearsal.mjs'

const db=new PGlite()
let schema
const graph={
  'auth.users':[{id:'owner'},{id:'stranger'}],
  'public.properties':[{id:'p',owner:'owner'},{id:'other',owner:'owner'}],
  'public.inspections':[
    {id:'i',property_id:'p',primary_part:'b',revision:12,updated_at:'2026-09-14T01:02:03.456Z',payload:{saved:true}},
    {id:'unrelated',property_id:'other',primary_part:null,revision:1,updated_at:null,payload:null},
  ],
  'public.buildings':[{id:'b',inspection_id:'i'}],
  'public.rooms':[{id:'room',building_id:'b',inspection_id:'i'}],
}
const readRows=async (table,filters)=>(graph[table]??[]).filter(row=>Object.entries(filters).every(([key,value])=>row[key]===value))
const capture=()=>collectScopedRows(schema,readRows,[{table:'public.properties',filters:{id:'p'}}])

before(async ()=>{
  await db.exec(`create schema auth;
    create table auth.users(id text primary key);
    create table public.properties(id text primary key,owner text references auth.users(id));
    create table public.inspections(id text primary key,property_id text references public.properties(id),
      primary_part text, revision int,updated_at timestamptz,payload jsonb);
    create table public.buildings(id text primary key,inspection_id text references public.inspections(id),unique(id,inspection_id));
    alter table public.inspections add constraint primary_building foreign key(primary_part,id) references public.buildings(id,inspection_id);
    create table public.rooms(id text not null,building_id text,inspection_id text,
      foreign key(building_id,inspection_id) references public.buildings(id,inspection_id));
    create unique index room_id on public.rooms(id);
    create table public.nullable_key(id text unique);
    create function bump_revision() returns trigger language plpgsql as $$ begin new.revision=new.revision+1; return new; end $$;
    create trigger bump before insert on public.inspections for each row execute function bump_revision();`)
  schema=await describeRestoreSchema(db)
})
after(()=>db.close())

test('Storage denial requires a real HTTP failure, not a generic network error',()=>{
  assert.equal(storageFailureStatus({status:400,statusCode:'409'}),409)
  assert.equal(storageFailureStatus({originalError:new Response('{}',{status:400})}),400)
  assert.ok(Number.isNaN(storageFailureStatus({originalError:new TypeError('fetch failed')})))
  assert.ok(Number.isNaN(storageFailureStatus(null)))
})

test('identifies real non-null unique indexes but rejects nullable keys',()=>{
  assert.deepEqual(schema.tables.find(t=>t.name==='public.rooms').pk,['id'])
  assert.equal(schema.tables.find(t=>t.name==='public.nullable_key').pk,null)
})

test('scoped closure includes cycles and ancestors, never other inspections sharing an owner',async ()=>{
  const rows=await capture()
  assert.deepEqual(rows['auth.users'],[{id:'owner'}])
  assert.deepEqual(rows['public.properties'],[graph['public.properties'][0]])
  assert.deepEqual(rows['public.inspections'],[graph['public.inspections'][0]])
  assert.equal(rows['public.rooms'].length,1)
  const withShared=await collectScopedRows(schema,readRows,[{table:'public.properties',filters:{id:'p'}}],
    [{table:'auth.users',filters:{id:'stranger'}}])
  assert.equal(withShared['public.properties'].length,1)
  assert.equal(withShared['auth.users'].length,2)
})

test('source shape changes and missing row keys fail closed',async ()=>{
  const roots=[{table:'public.properties',filters:{id:'p'}}]
  await assert.rejects(collectScopedRows(schema,async ()=>[{id:'p',unreviewed:true}],roots),/Unreviewed source column/)
  await assert.rejects(collectScopedRows(schema,async ()=>[{owner:'owner'}],roots),/Missing unique row key/)
  assert.throws(()=>canonical({id:9007199254740992}),/Unsafe JSON integer/)
})

test('broken original FK rejects the restore and rolls back every row',async ()=>{
  const rows=await capture()
  rows['public.buildings']=[]
  await assert.rejects(restoreRowsLocally(db,schema,rows),/foreign key constraint/)
  assert.equal((await db.query('select count(*)::int n from public.properties')).rows[0].n,0)
  assert.equal((await db.query('select count(*)::int n from auth.users')).rows[0].n,0)
  assert.deepEqual((await describeRestoreSchema(db)).fks,schema.fks)
})

test('local restore preserves IDs, cycles, composite keys, revision, timestamp and JSON',async ()=>{
  const rows=await capture()
  await restoreRowsLocally(db,schema,rows)
  const inspection=(await db.query('select * from public.inspections')).rows[0]
  assert.equal(inspection.id,'i')
  assert.equal(inspection.primary_part,'b')
  assert.equal(inspection.revision,12)
  assert.equal(inspection.updated_at.toISOString(),'2026-09-14T01:02:03.456Z')
  assert.deepEqual(inspection.payload,{saved:true})
  assert.deepEqual((await describeRestoreSchema(db)).fks,schema.fks)
})

test('populated targets and remote-style database handles are refused without changes',async ()=>{
  const rows=await capture()
  await assert.rejects(restoreRowsLocally(db,schema,rows),/target must contain no properties/)
  await assert.rejects(restoreRowsLocally({query:()=>assert.fail('must not query')},schema,rows),/Only a local PGlite/)
  assert.equal((await db.query('select count(*)::int n from public.properties')).rows[0].n,1)
})

function packageFixture() {
  const inspection='11111111-1111-4111-8111-111111111111'
  const project='https://lodbgdbmfdtdzfaezblx.supabase.co'
  const image=Buffer.from('synthetic image bytes'),pdf=Buffer.from('synthetic frozen PDF')
  const file=`${inspection}/round/test.png`,pdfPath=`${inspection}/report/test.pdf`
  const rows={
    'public.inspection_images':[{file_path:file}],
    'public.inspection_report_links':[{pdf_status:'ready',pdf_sha256:sha256(pdf),
      pdf_storage_bucket:'inspection-reports',pdf_storage_path:pdfPath,
      snapshot_payload:{imageUrl:`${project}/storage/v1/object/public/inspection-images/${file}`}}],
  }
  const files=new Map([
    ['rows.json',Buffer.from(canonical(rows))],['schema/source.json',Buffer.from('schema')],
    ['schema/migration-0.sql',Buffer.from('migration')],
    ['blobs/'+sha256(image),image],['blobs/'+sha256(pdf),pdf],
  ])
  const manifest={version:1,project,inspection,consistency:'quiescent-synthetic-double-read',
    rowsSha256:sha256(files.get('rows.json')),schemaSha256:sha256(files.get('schema/source.json')),
    migrations:[{blob:'schema/migration-0.sql',sha256:sha256(files.get('schema/migration-0.sql'))}],
    assets:[{bucket:'inspection-images',path:file,sha256:sha256(image),bytes:image.length,blob:'blobs/'+sha256(image)},
      {bucket:'inspection-reports',path:pdfPath,sha256:sha256(pdf),bytes:pdf.length,blob:'blobs/'+sha256(pdf)}],
  }
  const read=async path=>{assert.ok(files.has(path),'Missing file');return files.get(path)}
  return {manifest,files,read,rows}
}

test('complete package verifies schema, migrations, rows, images and frozen PDF',async ()=>{
  const p=packageFixture()
  assert.deepEqual(await verifyBackup(p.manifest,p.read),p.rows)
})

test('damage or missing bytes in every backup file are detected',async ()=>{
  for(const path of packageFixture().files.keys()) {
    const p=packageFixture()
    p.files.set(path,Buffer.alloc(p.files.get(path).length,1))
    await assert.rejects(verifyBackup(p.manifest,p.read),/checksum mismatch/,path)
    p.files.delete(path)
    await assert.rejects(verifyBackup(p.manifest,p.read),/Missing file/,path)
  }
})

test('removing an image or PDF entry cannot make an incomplete manifest pass',async ()=>{
  for(const index of [0,1]) {
    const p=packageFixture()
    p.manifest.assets.splice(index,1)
    await assert.rejects(verifyBackup(p.manifest,p.read),/missing from manifest/)
  }
})

test('unsafe paths, foreign inspections, duplicate assets and production targets fail closed',async ()=>{
  const variants=[
    p=>{p.manifest.assets[0].path='../test'},
    p=>{p.manifest.assets[0].path=p.manifest.inspection+'/%2e%2e/test'},
    p=>{p.manifest.assets[0].path='another-inspection/test'},
    p=>{p.manifest.assets[0].blob='../private'},
    p=>{p.manifest.migrations[0].blob='../private'},
    p=>{p.manifest.assets.push(p.manifest.assets[0])},
    p=>{p.manifest.project='https://production.example.invalid'},
  ]
  for(const change of variants) {
    const p=packageFixture();change(p)
    await assert.rejects(verifyBackup(p.manifest,p.read))
  }
})

test('frozen snapshots referencing an unlisted or external asset fail coverage checks',async ()=>{
  for(const url of ['https://external.example.invalid/storage/v1/object/public/bucket/file',
    'https://lodbgdbmfdtdzfaezblx.supabase.co/storage/v1/object/public/inspection-images/missing']) {
    const p=packageFixture()
    p.rows['public.inspection_report_links'][0].snapshot_payload.imageUrl=url
    p.files.set('rows.json',Buffer.from(canonical(p.rows)))
    p.manifest.rowsSha256=sha256(p.files.get('rows.json'))
    await assert.rejects(verifyBackup(p.manifest,p.read),/outside staging|missing from backup scope/)
  }
})
