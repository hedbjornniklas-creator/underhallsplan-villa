import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { createClient } from '@supabase/supabase-js'
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp'
import { validateStagingKeys } from './lib/ob-staging-app.mjs'
import { buildStagingSchema, guardBuildingMigration, REVIEW_SHA256 } from './lib/ob-staging-schema.mjs'
import { settingsTables } from './lib/ob-settings-rehearsal.mjs'
import { canonical, sha256, storageFailureStatus, describeRestoreSchema, collectScopedRows, validateObjectPath, validateAsset, requiredAssets, verifyBackup, restoreRowsLocally } from './lib/ob-restore-rehearsal.mjs'

const root=fileURLToPath(new URL('../',import.meta.url))
const folder=join(root,'.cache/ob-staging-app')
const source=JSON.parse(await readFile(join(folder,'delivery-latest.json'),'utf8'))
const fixture=JSON.parse(await readFile(join(folder,'fixtures.json'),'utf8'))
const keys=validateStagingKeys(JSON.parse(await readFile(join(folder,'keys.json'),'utf8')))
assert.equal(source.project,keys.url)
assert.equal(fixture.project,keys.url)
assert.equal(source.completed,true)
assert.notEqual(source.inspection,fixture.inspection)
assert.notEqual(source.property,fixture.property)
assert.equal(resolve(source.output,'..'),resolve(folder))
assert.match(source.output.split(/[\\/]/).pop(),/^delivery-\d+$/)
const evidence=JSON.parse(await readFile(join(source.output,'manifest.json'),'utf8'))
assert.equal(evidence.inspection,source.inspection)
assert.equal(evidence.property,source.property)
assert.equal(evidence.pdfSha256,source.pdfSha256)
const output=join(folder,'restore-'+Date.now())
const backup=join(output,'backup')
await mkdir(join(backup,'blobs'),{recursive:true})
await mkdir(join(backup,'schema'))
const run={project:keys.url,sourceInspection:source.inspection,sourceProperty:source.property,startedAt:new Date().toISOString(),
  checks:[],completed:false,remoteDatabaseWrites:false,bucket:'ob-restore-test-'+randomUUID(),output}
await writeFile(join(output,'manifest.json'),JSON.stringify(run,null,2),{flag:'wx'})
const pass=name=>{run.checks.push(name);console.log('PASS '+name)}
let bucketAttempted=false, db
const realFetch=globalThis.fetch
globalThis.fetch=async (input,options)=>{
  const url=new URL(typeof input==='string'||input instanceof URL?input:input.url)
  assert.equal(url.origin,keys.url,'Only the pinned staging project')
  const method=(options?.method??(input instanceof Request?input.method:'GET')).toUpperCase()
  if(!['GET','HEAD'].includes(method)) {
    assert.ok((url.pathname==='/storage/v1/bucket'&&method==='POST')
      ||url.pathname==='/storage/v1/bucket/'+run.bucket
      ||url.pathname==='/storage/v1/object/'+run.bucket
      ||url.pathname.startsWith('/storage/v1/object/'+run.bucket+'/'),'Remote database or source-object writes are forbidden')
    if(url.pathname==='/storage/v1/bucket') {
      const body=JSON.parse(options.body)
      assert.equal(body.id,run.bucket);assert.equal(body.public,false)
    }
  }
  const readOnly=['GET','HEAD'].includes(method)
  for(let attempt=0;;attempt++) {
    try {
      const response=await realFetch(input,options)
      if(!readOnly||attempt===2||![429,502,503,504].includes(response.status))return response
      await response.body?.cancel()
    } catch(error) {
      if(!readOnly||attempt===2||!(error instanceof TypeError))throw error
    }
    run.readRetries=(run.readRetries??0)+1
    await delay(500*(attempt+1))
  }
}
const admin=createClient(keys.url,keys.serviceKey,{auth:{persistSession:false,autoRefreshToken:false}})
const anon=createClient(keys.url,keys.anonKey,{auth:{persistSession:false,autoRefreshToken:false}})
async function checked(request) { const {data,error}=await request;assert.ok(!error,error?.message);return data }
const migrationPaths=[
  ...['01_ob_building_parts','02_ob_building_commands','03_ob_building_round','04_ob_building_cutover'].map(n=>'docs/db/2026-09-12_'+n+'.sql'),
  'docs/db/2026-09-12_09_inspection_access_hardening.sql',
  'docs/db/2026-09-12_10_inspection_rpc_media_hardening.sql',
  'scripts/sql/ob-staging-app-access.sql','scripts/sql/ob-staging-conditions-access.sql',
  'docs/db/2026-09-13_01_ob_building_purpose.sql','docs/db/2026-09-13_02_ob_building_purpose_catalogue.sql',
  'docs/db/2026-09-13_03_components_access_hardening.sql','docs/db/2026-09-13_04_component_catalogue_access.sql',
  'docs/db/2026-09-14_01_ob_settings_access.sql',
]
const schemaBytes=await readFile(join(root,'.cache/inspection-schema-export/production-schema-review.json'))
assert.equal(sha256(schemaBytes),REVIEW_SHA256)
const migrationBytes=await Promise.all(migrationPaths.map(path=>readFile(join(root,path))))
await writeFile(join(backup,'schema/source.json'),schemaBytes)
for(let i=0;i<migrationBytes.length;i++)await writeFile(join(backup,`schema/migration-${i}.sql`),migrationBytes[i])

async function newLocalDatabase(savedSchema,savedMigrations) {
  const schemaBundle=buildStagingSchema(savedSchema)
  const runtime=createRequire(join(root,'.cache/inspection-schema-export/runtime/package.json'))
  const {vector}=await import(pathToFileURL(runtime.resolve('@electric-sql/pglite-pgvector')).href)
  const local=new PGlite({extensions:{pgcrypto,uuid_ossp,vector}})
  try {
    await local.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create schema storage; create schema extensions;
      create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');
      create table storage.objects(id uuid primary key,bucket_id text,name text,owner uuid);
      create table storage.buckets(id text primary key,name text,public boolean default false);
      alter table storage.objects enable row level security;
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      create function auth.role() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claim.role',true),'') $$;
      create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
      grant usage on schema public,auth,storage to anon,authenticated,service_role;`)
    await local.exec(schemaBundle.bootstrap)
    for(const part of schemaBundle.parts)await local.exec(part.sql)
    await local.exec("set search_path=public,extensions,pg_catalog; set timezone='UTC'")
    for(let i=0;i<4;i++)await local.exec(guardBuildingMigration(savedMigrations[i].toString(),i+1))
    await local.exec(`set app.inspection_access_hardening_approved='true';
      set app.components_access_hardening_approved='true';
      set app.component_catalogue_access_approved='true';
      set app.ob_settings_access_approved='true';`)
    for(let i=4;i<savedMigrations.length;i++) {
      // Matches the sealed staging wrapper's read-only prerequisite for 03.
      if(i===10)await local.exec('grant select on public.component_types to authenticated')
      await local.exec(savedMigrations[i].toString())
    }
    return local
  } catch(error){await local.close();throw error}
}

let metadata
async function readRows(table,filters) {
  if(table==='auth.users') {
    assert.deepEqual(Object.keys(filters),['id'])
    const {user}=await checked(admin.auth.admin.getUserById(filters.id))
    assert.ok(user.email.endsWith('@example.invalid'),'Only synthetic auth dependencies')
    return [{id:user.id,email:user.email,raw_user_meta_data:{}}]
  }
  assert.ok(table.startsWith('public.')&&metadata.tables.some(t=>t.name===table))
  const data=[]
  for(let offset=0;;offset+=500) {
    let request=admin.from(table.slice(7)).select('*')
    for(const [key,value] of Object.entries(filters))request=request.eq(key,value)
    for(const key of metadata.tables.find(t=>t.name===table).pk??[])request=request.order(key)
    const page=await checked(request.range(offset,offset+499))
    data.push(...page)
    assert.ok(data.length<=10000,'Source scope limit exceeded')
    if(page.length<500)break
  }
  return data
}
const originals=['ob_inspection_buildings','ob_inspection_structure','ob_building_conditions',
  'inspection_interior_rooms','inspection_control_items','inspection_images','inspection_report_links']
async function originalSnapshot() {
  const result={}
  for(const table of originals)result[table]=await readRows('public.'+table,{inspection_id:fixture.inspection})
  return canonical(result)
}
let manifest
try {
  db=await newLocalDatabase(schemaBytes,migrationBytes)
  metadata=await describeRestoreSchema(db)
  const [property]=await readRows('public.properties',{id:source.property})
  const [inspection]=await readRows('public.inspections',{id:source.inspection})
  assert.match(property.name,/^TEST /)
  assert.equal(property.owner,fixture.owner.id)
  assert.equal(inspection.property_id,source.property)
  assert.equal(inspection.status,'completed')
  assert.ok(inspection.locked_at)
  assert.deepEqual((await readRows('public.inspections',{property_id:source.property})).map(r=>r.id),[source.inspection])
  const original=await originalSnapshot()
  const roots=[{table:'public.properties',filters:{id:source.property}},{table:'public.inspections',filters:{id:source.inspection}}]
  const shared=[...settingsTables,'settings_ob_building_categories','ob_building_rollout'].map(name=>({table:'public.'+name,filters:{}}))
  shared.push({table:'public.org_members',filters:{profile_id:fixture.owner.id,org_id:fixture.org}})
  const rows=await collectScopedRows(metadata,readRows,roots,shared)
  assert.deepEqual(rows['public.properties'].map(r=>r.id),[source.property])
  assert.deepEqual(rows['public.inspections'].map(r=>r.id),[source.inspection])
  const reports=rows['public.inspection_report_links']
  assert.ok(reports.length&&reports.every(r=>r.revoked_at&&r.pdf_status==='ready'))
  assert.ok(reports.some(r=>r.id===source.linkId&&r.pdf_sha256===source.pdfSha256))
  const rowsBytes=Buffer.from(canonical(rows))
  await writeFile(join(backup,'rows.json'),rowsBytes)
  manifest={version:1,project:keys.url,inspection:source.inspection,property:source.property,
    consistency:'quiescent-synthetic-double-read',rowsSha256:sha256(rowsBytes),assets:[],schemaSha256:REVIEW_SHA256,
    migrations:migrationPaths.map((path,i)=>({path,blob:`schema/migration-${i}.sql`,sha256:sha256(migrationBytes[i])})),
    limitations:['Auth/Storage database schemas use local stand-ins','No production export','No public live-link activation','No transactional concurrent export']}
  const objects=requiredAssets(rows,keys.url)
  for(const object of objects.values()) {
    validateObjectPath(object,source.inspection)
    const blob=await checked(admin.storage.from(object.bucket).download(object.path))
    const bytes=Buffer.from(await blob.arrayBuffer())
    const hash=sha256(bytes)
    if(object.expected)assert.equal(hash,object.expected)
    const asset={bucket:object.bucket,path:object.path,bytes:bytes.length,sha256:hash,mimeType:blob.type,blob:'blobs/'+hash}
    validateAsset(asset,source.inspection)
    await writeFile(join(backup,asset.blob),bytes)
    manifest.assets.push(asset)
  }
  assert.equal(canonical(await collectScopedRows(metadata,readRows,roots,shared)),canonical(rows),'Source changed during backup')
  await writeFile(join(backup,'manifest.json'),JSON.stringify(manifest,null,2))
  run.backupSha256=sha256(await readFile(join(backup,'manifest.json')))
  const readBackup=path=>readFile(join(backup,path))
  const restoredRows=await verifyBackup(manifest,readBackup)
  pass('Scoped rows and all frozen image/PDF bytes backed up; second read confirms stable synthetic source')
  const firstAsset=manifest.assets[0]
  await assert.rejects(verifyBackup(manifest,async path=>path===firstAsset.blob?Buffer.from('CORRUPTED'):readBackup(path)),/length mismatch|checksum mismatch/)
  await assert.rejects(verifyBackup(manifest,async path=>{if(path===firstAsset.blob)throw Error('MISSING FILE');return readBackup(path)}),/MISSING FILE/)
  await assert.rejects(verifyBackup(manifest,async path=>path==='rows.json'?Buffer.from('{}'):readBackup(path)),/checksum mismatch/)
  await assert.rejects(verifyBackup(manifest,async path=>path==='schema/source.json'?Buffer.from('{}'):readBackup(path)),/checksum mismatch/)
  await assert.rejects(verifyBackup(manifest,async path=>path===manifest.migrations[0].blob?Buffer.from('BAD SQL'):readBackup(path)),/checksum mismatch/)
  await assert.rejects(verifyBackup({...manifest,assets:manifest.assets.slice(1)},readBackup),/missing from manifest/)
  pass('Corrupt rows, files, schema and migrations, and missing files/manifest entries fail before restore')
  await db.close()
  assert.equal(sha256(await readFile(join(backup,'manifest.json'))),run.backupSha256,'Backup manifest changed')
  const savedSchema=await readBackup('schema/source.json')
  const savedMigrations=[]
  for(const migration of manifest.migrations)savedMigrations.push(await readBackup(migration.blob))
  db=await newLocalDatabase(savedSchema,savedMigrations)
  await restoreRowsLocally(db,metadata,restoredRows)
  assert.deepEqual((await describeRestoreSchema(db)).fks,metadata.fks,'FK definitions changed')
  pass('Fresh local PostgreSQL restores original IDs, fields, timestamps and revisions; original FK definitions validate')
  const state=(await db.query('select public.ob_building_get($1,$2,$3) as value',[source.inspection,fixture.org,fixture.owner.id])).rows[0].value
  assert.equal(state.parts.length,2)
  assert.equal(state.structure.inspection_id,source.inspection)
  await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role','authenticated',false)",[fixture.owner.id])
  await db.exec('set role authenticated')
  assert.equal((await db.query('select * from public.inspection_control_items where inspection_id=$1',[source.inspection])).rows.length,rows['public.inspection_control_items'].length)
  await db.exec('reset role')
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[fixture.stranger.id])
  await db.exec('set role authenticated')
  assert.equal((await db.query('select * from public.inspection_control_items where inspection_id=$1',[source.inspection])).rows.length,0)
  await db.exec('reset role')
  await assert.rejects(restoreRowsLocally(db,metadata,restoredRows),/target must contain no properties/)
  pass('Restored building reader and owner isolation work; a populated restore target is rejected')
  bucketAttempted=true
  await checked(admin.storage.createBucket(run.bucket,{public:false,fileSizeLimit:20000000}))
  assert.equal((await checked(admin.storage.getBucket(run.bucket))).public,false)
  for(const asset of manifest.assets) {
    const destination=asset.bucket+'/'+asset.path
    const bytes=await readBackup(asset.blob)
    await checked(admin.storage.from(run.bucket).upload(destination,bytes,{contentType:asset.mimeType,upsert:false}))
    const returned=Buffer.from(await (await checked(admin.storage.from(run.bucket).download(destination))).arrayBuffer())
    assert.equal(sha256(returned),asset.sha256)
    assert.equal(returned.length,asset.bytes)
    const duplicate=(await admin.storage.from(run.bucket).upload(destination,bytes,{upsert:false,contentType:asset.mimeType})).error
    assert.ok(duplicate&&[400,409].includes(storageFailureStatus(duplicate)),'Overwrite must be rejected by Storage')
    assert.match(duplicate.message,/already exists|duplicate/i)
    const denied=(await anon.storage.from(run.bucket).download(destination)).error
    assert.ok(denied&&[400,403,404].includes(storageFailureStatus(denied)),'Anonymous read must be denied by Storage')
  }
  pass('Real Storage restore to a new private test bucket preserves bytes and rejects overwrite/anonymous access')
  for(const asset of manifest.assets) {
    const sourceBytes=Buffer.from(await (await checked(admin.storage.from(asset.bucket).download(asset.path))).arrayBuffer())
    assert.equal(sha256(sourceBytes),asset.sha256,'Source file changed')
  }
  assert.equal(canonical(await collectScopedRows(metadata,readRows,roots,shared)),canonical(rows),'Source rows changed')
  assert.equal(await originalSnapshot(),original,'Original click-test fixture changed')
  pass('Source inspection, source files, revocations and the separate original click-test fixture remain unchanged')
  run.completed=true
  run.rowCounts=Object.fromEntries(Object.entries(rows).filter(([,r])=>r.length).map(([table,r])=>[table,r.length]))
  run.assetCount=manifest.assets.length
  run.fileBytes=manifest.assets.reduce((n,a)=>n+a.bytes,0)
} catch(error) {
  run.completed=false
  run.failure=error.message
  console.error('Restore rehearsal failed: '+error.message)
  process.exitCode=1
} finally {
  try { await db?.close() } catch(error) {run.closeError=error.message;run.completed=false;process.exitCode=1}
  // Only the fresh test bucket is removed. No source object or remote DB row is a write target.
  if(bucketAttempted) {
    // Also cover an ambiguous create response. Only this run's random name is used.
    for(let attempt=0;attempt<3&&!run.bucketRemoved;attempt++) {
      try {
        const bucket=await admin.storage.getBucket(run.bucket)
        if(!bucket.error) {
          const paths=manifest.assets.map(a=>a.bucket+'/'+a.path)
          if(paths.length)await checked(admin.storage.from(run.bucket).remove(paths))
          await checked(admin.storage.deleteBucket(run.bucket))
        } else assert.equal(storageFailureStatus(bucket.error),404,bucket.error.message)
        const missing=(await admin.storage.getBucket(run.bucket)).error
        assert.equal(storageFailureStatus(missing),404,'Test bucket removal must be verified')
        run.bucketRemoved=true
        delete run.cleanupError
      } catch(error){run.cleanupError=error.message;if(attempt<2)await delay(500*(attempt+1))}
    }
    if(!run.bucketRemoved){run.completed=false;process.exitCode=1}
  }
  run.completedAt=new Date().toISOString()
  await writeFile(join(output,'manifest.json'),JSON.stringify(run,null,2))
  await writeFile(join(folder,'restore-latest.json'),JSON.stringify(run,null,2))
  globalThis.fetch=realFetch
}
console.log(JSON.stringify({completed:run.completed,checks:run.checks.length,bucketRemoved:run.bucketRemoved,output}))
