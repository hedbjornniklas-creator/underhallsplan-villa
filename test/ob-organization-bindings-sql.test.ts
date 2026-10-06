import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'

const migration = readFileSync(new URL('../docs/db/2026-10-02_03_ob_organization_bindings.sql',import.meta.url),'utf8')
const OWNER = 'fe8cde81-8fa4-4fef-bd4c-1d3c5dfbb8fa'
const BBSAB = '71c056a9-aef5-42ce-872c-75952bc55795'
const OTHER_ORG = '7ea3d625-5473-46bc-a24b-52a85c1df13f'
// Deliberately independent manifest: a broader implementation allowlist must fail.
const APPROVED = [
  '1b7b0cb8-98f3-4e32-b00a-220b04656720','1f4137eb-b470-49e4-9508-54fc5be0f6c0',
  '2164d9fd-a12e-447f-9e92-bb58851fb871','35339399-291b-453c-9eba-14f7ff7b9639',
  '37dbf7e6-5618-4f46-b15a-c3afba21bdcc','408235cd-c3a4-4dd0-9e48-7fb2db8a1aaa',
  '458cc307-4920-4630-beb5-525c409e7344','4a6088cc-bdf5-4b39-9785-7f0dbdff7f26',
  '4d045972-e247-450b-b67e-742c2fe05a2a','57821648-825f-4c5e-9a10-59fe29bff224',
  '591adba5-ef38-4771-99ea-d4419b898cbd','8e177da0-d092-48ba-81c3-b3dfb94795e7',
  '950eac5a-8115-47ce-899e-62c3cdd09dc0','adb8e3c4-9944-4ca3-84fb-000e07e6d847',
  'bd0426cd-a1e7-4739-830b-0b5aa31a7f3c','c8739a4f-faee-4495-aee5-bcf8f9159cc1',
  'd3553a23-e756-4c6c-a993-402ed9287d9d','de577fb8-a95f-46e8-aa22-6827d6a01c2b',
  'ea722ab3-9f3a-4514-a50a-62e1fd412df1','eeb2b7d1-4e8a-401e-9307-e8d06519fcec',
  'f24ba8cc-080e-4d02-8d1c-81cc3b4b1c3f',
]
const SOURCE_TABLES = ['organizations','properties','inspections','assignments','ob_assignment_workflows',
  'inspection_report_links','org_members','platform_access_assignments','organization_enabled_modules']

async function fixture() {
  const db = new PGlite()
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create table organizations(id uuid primary key);
    create table properties(id uuid primary key,owner uuid);
    create table inspections(id uuid primary key,property_id uuid,inspection_family text,type text,org_id uuid,locked_at timestamptz,snapshot jsonb);
    create table assignments(id uuid primary key,inspection_id uuid,org_id uuid,assignment_type text,snapshot jsonb);
    create table ob_assignment_workflows(inspection_id uuid primary key,org_id uuid,initial_assignment_id uuid,current_assignment_id uuid,initial_snapshot jsonb);
    create table inspection_report_links(id uuid primary key,inspection_id uuid,org_id uuid,assignment_id uuid,revoked_at timestamptz,snapshot_payload jsonb,pdf_base64 text);
    create table org_members(org_id uuid,profile_id uuid,is_active boolean,is_default boolean);
    create table platform_access_assignments(id uuid primary key,scope_id uuid);
    create table organization_enabled_modules(org_id uuid,module_key text,is_active boolean);
    alter table inspections enable row level security;
    create policy untouched_owner_policy on inspections using(true);`)
  await db.query('insert into organizations values($1),($2)',[BBSAB,OTHER_ORG])
  await db.query('insert into properties values($1,$2)',[OWNER,OWNER])
  await db.query('insert into org_members values($1,$3,true,false),($2,$3,true,true)',[BBSAB,OTHER_ORG,OWNER])
  for (const id of APPROVED) await db.query("insert into inspections values($1,$2,'OB','OB',null,now(),'{\"issued\":true}')",[id,OWNER])
  return db
}
async function inspection(db: PGlite, patch: {family?: string | null; type?: string; org?: string | null} = {}) {
  const id = randomUUID()
  await db.query('insert into inspections(id,property_id,inspection_family,type,org_id) values($1,$2,$3,$4,$5)',
    [id,OWNER,patch.family===undefined ? 'OB':patch.family,patch.type??'OB',patch.org??null])
  return id
}
async function assignment(db: PGlite, inspectionId: string | null, org = OTHER_ORG, family = 'OB') {
  const id = randomUUID()
  await db.query("insert into assignments values($1,$2,$3,$4,'{\"frozen\":true}')",[id,inspectionId,org,family])
  return id
}
async function snapshot(db: PGlite) {
  return Promise.all(SOURCE_TABLES.map(async table=>(await db.query(`select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]') as rows from ${table} t`)).rows))
}
async function rejectUnchanged(db: PGlite, error: RegExp) {
  const before = await snapshot(db)
  await assert.rejects(db.exec(migration),error)
  await db.exec('rollback')
  assert.deepEqual(await snapshot(db),before)
  assert.equal((await db.query<{table_name:string|null}>("select to_regclass('public.ob_organization_bindings') as table_name")).rows[0].table_name,null)
}

test('OB foundation preserves recorded orgs, binds exactly approved legacy IDs and leaves all original rows/RLS unchanged', async t=>{
  const db=await fixture()
  try {
    const direct=await inspection(db),workflow=await inspection(db),historical=await inspection(db),
      explicit=await inspection(db,{org:OTHER_ORG}),status=await inspection(db,{family:null,type:'STATUS'}),
      canonicalSb=await inspection(db,{family:'OB',type:'SB',org:OTHER_ORG}),eb=await inspection(db,{family:'EB',type:'SB'}),
      tu=await inspection(db,{family:'TU',type:'TU'})
    await assignment(db,direct)
    await assignment(db,direct) // Multiple compatible links are not conflicts.
    await assignment(db,status,OTHER_ORG,'STATUS')
    const a=await assignment(db,null)
    await db.query("insert into ob_assignment_workflows values($1,$2,$3,$3,'{\"workflow\":true}')",[workflow,OTHER_ORG,a])
    const reportAssignment=await assignment(db,null)
    await db.query("insert into inspection_report_links values($1,$2,$3,$4,now(),'{\"frozen\":true}','private PDF')",[randomUUID(),historical,OTHER_ORG,reportAssignment])
    const before=await snapshot(db)
    const policies=(await db.query('select * from pg_policies order by policyname')).rows
    await db.exec(migration)
    assert.deepEqual(await snapshot(db),before)
    assert.deepEqual((await db.query('select * from pg_policies order by policyname')).rows,policies)
    const bindings=(await db.query<{inspection_id:string;org_id:string;attribution_source:string}>('select * from ob_organization_bindings order by inspection_id')).rows
    assert.equal(bindings.length,27)
    assert.deepEqual(bindings.filter(b=>b.attribution_source==='approved_legacy_bbsab').map(b=>b.inspection_id),[...APPROVED].sort())
    assert.ok(bindings.filter(b=>APPROVED.includes(b.inspection_id)).every(b=>b.org_id===BBSAB))
    assert.ok([direct,workflow,historical,explicit,status,canonicalSb].every(id=>bindings.some(b=>b.inspection_id===id && b.org_id===OTHER_ORG && b.attribution_source==='recorded_sources')))
    assert.ok(!bindings.some(b=>b.inspection_id===eb || b.inspection_id===tu))
    await t.test('rerun is idempotent and accepts later SAME-org evidence on an already approved binding',async()=>{
      await assignment(db,APPROVED[0],BBSAB)
      await db.exec(migration)
      assert.deepEqual((await db.query('select * from ob_organization_bindings order by inspection_id')).rows,bindings)
      assert.deepEqual((await db.query('select * from ob_organization_binding_audit order by inspection_id')).rows,bindings)
    })
    await t.test('anon/auth cannot read or write; service has SELECT only; reassignment is guarded even if UPDATE were granted',async()=>{
      for (const role of ['anon','authenticated','service_role']) {
        await db.exec(`set role ${role}`)
        try {
          if(role==='service_role') assert.equal((await db.query('select * from ob_organization_bindings')).rows.length,27)
          else await assert.rejects(db.query('select * from ob_organization_bindings'),/permission denied/)
          await assert.rejects(db.query('delete from ob_organization_bindings'),/permission denied/)
          await assert.rejects(db.query('update ob_organization_bindings set org_id=$1',[BBSAB]),/permission denied/)
          await assert.rejects(db.query('insert into ob_organization_bindings values($1,$2,$3,now())',[randomUUID(),BBSAB,'recorded_sources']),/permission denied/)
          await assert.rejects(db.query('delete from ob_organization_binding_audit'),/permission denied/)
        } finally {await db.exec('reset role')}
      }
      await db.exec('grant update on ob_organization_bindings to service_role; set role service_role')
      try {await assert.rejects(db.query('update ob_organization_bindings set org_id=$1',[BBSAB]),/OB_ORGANIZATION_BINDING_IMMUTABLE/)}
      finally {await db.exec('reset role; revoke update on ob_organization_bindings from service_role')}
      await assert.rejects(db.query('update ob_organization_binding_audit set org_id=$1',[OTHER_ORG]),/OB_ORGANIZATION_BINDING_IMMUTABLE/)
      await assert.rejects(db.query('delete from ob_organization_binding_audit'),/OB_ORGANIZATION_BINDING_IMMUTABLE/)
    })
    await t.test('existing org deletion is deliberately restricted; inspection deletion still cascades and preserves audit',async()=>{
      await assert.rejects(db.query('delete from organizations where id=$1',[BBSAB]),/foreign key/)
      await db.query('delete from inspections where id=$1',[direct])
      assert.equal((await db.query('select * from ob_organization_bindings where inspection_id=$1',[direct])).rows.length,0)
      assert.equal((await db.query('select * from ob_organization_binding_audit where inspection_id=$1',[direct])).rows.length,1)
    })
  } finally {await db.close()}
})

test('OB foundation fails closed and rolls back without guessing or touching existing data',async t=>{
  const cases: [string,(db:PGlite)=>Promise<unknown>,RegExp][] = [
    ['new unrecorded same-owner OB',db=>inspection(db),/OB_BINDING_UNAPPROVED_INSPECTION/],
    ['missing approved ID',db=>db.query('delete from inspections where id=$1',[APPROVED[0]]),/OB_BINDING_APPROVAL_DRIFT/],
    ['approved owner changed',db=>db.query('update properties set owner=$1',[randomUUID()]),/OB_BINDING_APPROVAL_DRIFT/],
    ['approved family changed to EB',db=>db.query("update inspections set inspection_family='EB' where id=$1",[APPROVED[0]]),/OB_BINDING_APPROVAL_DRIFT/],
    ['new recorded evidence on first approved fallback',db=>assignment(db,APPROVED[0],BBSAB),/OB_BINDING_APPROVAL_DRIFT/],
    ['conflicting historical report org',async db=>{const id=await inspection(db,{org:BBSAB});await db.query('insert into inspection_report_links(id,inspection_id,org_id,revoked_at) values($1,$2,$3,now())',[randomUUID(),id,OTHER_ORG])},/OB_BINDING_ORGANIZATION_CONFLICT/],
    ['wrong-family assignment not ignored',async db=>{await assignment(db,await inspection(db),BBSAB,'EB')},/OB_BINDING_RECORDED_SOURCE_REVIEW_REQUIRED/],
    ['dangling workflow pointer',async db=>{await db.query('insert into ob_assignment_workflows values($1,$2,$3,$3,null)',[await inspection(db),BBSAB,randomUUID()])},/OB_BINDING_RECORDED_SOURCE_REVIEW_REQUIRED/],
    ['workflow pointer org conflict without direct link',async db=>{const id=await inspection(db);const a=await assignment(db,null,OTHER_ORG);await db.query('insert into ob_assignment_workflows values($1,$2,$3,$3,null)',[id,BBSAB,a])},/OB_BINDING_ORGANIZATION_CONFLICT/],
    ['unknown organization evidence',async db=>{await inspection(db,{org:randomUUID()})},/OB_BINDING_ORGANIZATION_MISSING/],
    ['ambiguous type-only SB',db=>inspection(db,{family:null,type:'SB'}),/OB_BINDING_CLASSIFICATION_REVIEW_REQUIRED/],
    ['missing classification',db=>inspection(db,{family:null,type:''}),/OB_BINDING_CLASSIFICATION_REVIEW_REQUIRED/],
    ['explicit STATUS family is not canonical OB',db=>inspection(db,{family:'STATUS',type:'STATUS'}),/OB_BINDING_CLASSIFICATION_REVIEW_REQUIRED/],
    ['blank family is not missing-family fallback',db=>inspection(db,{family:'',type:'OB'}),/OB_BINDING_CLASSIFICATION_REVIEW_REQUIRED/],
    ['missing evidence column aborts',db=>db.exec('alter table assignments rename inspection_id to old_inspection_id'),/OB_BINDING_SCHEMA_REVIEW_REQUIRED/],
    ['workflow assignment linked to another inspection',async db=>{const other=await inspection(db,{org:BBSAB});const a=await assignment(db,other,BBSAB);await db.query('insert into ob_assignment_workflows values($1,$2,$3,$3,null)',[await inspection(db),BBSAB,a])},/OB_BINDING_RECORDED_SOURCE_REVIEW_REQUIRED/],
  ]
  for(const [name,arrange,error] of cases) await t.test(name,async()=>{
    const db=await fixture()
    try {await arrange(db);await rejectUnchanged(db,error)} finally {await db.close()}
  })
})

test('OB foundation refuses rerun drift and never overwrites an existing binding',async()=>{
  const db=await fixture()
  try {
    await db.exec(migration)
    const before=(await db.query('select * from ob_organization_bindings order by inspection_id')).rows
    await assignment(db,APPROVED[0],OTHER_ORG)
    await assert.rejects(db.exec(migration),/OB_BINDING_APPROVAL_DRIFT/)
    await db.exec('rollback')
    assert.deepEqual((await db.query('select * from ob_organization_bindings order by inspection_id')).rows,before)
  } finally {await db.close()}
})

test('OB foundation refuses changed recorded evidence on an existing non-allowlist binding',async()=>{
  const db=await fixture()
  try {
    const id=await inspection(db,{org:OTHER_ORG})
    await db.exec(migration)
    const before=(await db.query('select * from ob_organization_bindings order by inspection_id')).rows
    await db.query('update inspections set org_id=$1 where id=$2',[BBSAB,id])
    await assert.rejects(db.exec(migration),/OB_BINDING_EXISTING_CONFLICT/)
    await db.exec('rollback')
    assert.deepEqual((await db.query('select * from ob_organization_bindings order by inspection_id')).rows,before)
  } finally {await db.close()}
})
