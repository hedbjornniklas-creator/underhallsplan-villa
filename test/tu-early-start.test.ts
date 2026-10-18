import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
// @ts-expect-error Node strip-types requires the explicit extension.
import { validateTuEarlyStart } from '../src/lib/tu/assignmentWorkflow.ts'
import type { TuAssignmentWorkflow } from '../src/lib/tu/assignmentWorkflow'

const db = new PGlite()
const sql = (file: string) => readFileSync(new URL('../docs/db/' + file, import.meta.url), 'utf8').replace(/^\uFEFF/, '')
const migration = sql('2026-10-15_02_tu_early_start.sql')
const org = '00000000-0000-4000-8000-000000000001'
const actor = '00000000-0000-4000-8000-000000000002'
const stranger = '00000000-0000-4000-8000-000000000003'
const template = { key: 'moisture_damage_investigation', documentTitle: 'Test', projectType: 'Test', title: 'Test', version: 1, authoringMode: 'ai_assisted', workflowProfile: 'investigation' }
const draft = { sections: [{ title: 'Original text', body: 'Keep this' }] }

before(async () => {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create schema extensions;
    create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
    create function auth.role() returns text language sql as $$ select current_setting('role') $$;
    create function public.is_org_member(uuid) returns boolean language sql as $$ select true $$;
    create function public.digest(text,text) returns bytea language sql as $$ select convert_to(md5($1), 'UTF8') $$;
    create table public.profiles (id uuid primary key);
    create table public.organizations (id uuid primary key);
    create table public.org_members (org_id uuid, profile_id uuid, role text, is_active boolean);
    create table public.properties (id uuid primary key default gen_random_uuid(), owner uuid, name text,
      status text, address text, postal_code text, city text, municipality text, cadastral_id text,
      client_name text, owner_name text, created_at timestamptz default now());
    create table public.inspections (id uuid primary key default gen_random_uuid(), property_id uuid references public.properties(id),
      type text, inspection_family text, inspection_variant text, status text, inspection_side text,
      date date, inspection_time time, client_name text, client_contact text, customer_name text,
      customer_email text, customer_phone text, customer_address text, customer_postal_code text,
      customer_city text, assignment_number text, assignment_confirmation_delivered_date date, scope text,
      locked_at timestamptz, locked_by uuid);
  `)
  await db.exec(sql('2026-02-20_02_assignments_core.sql'))
  await db.exec(`
    alter table assignments drop constraint assignments_status_check;
    alter table assignments drop constraint assignments_type_check;
    alter table assignments add constraint assignments_type_check check(assignment_type in ('OB','STATUS','UHP','EB','TU'));
    alter table assignments add constraint assignments_status_check check(status in ('draft','sent','ordered','booked','completed','expired','cancelled'));
    alter table assignments add column assignment_details jsonb default '{}'::jsonb, add column booked_at timestamptz, add column archived_at timestamptz,
      add column archived_by uuid, add column terms_document_hash text, add column customer_address text,
      add column customer_postal_code text, add column customer_city text, add column property_municipality text,
      add column property_owner_name text, add column brf_name text, add column apartment_number text,
      add column apartment_holder_name text, add column scope_description text, add column invoice_email text;
    alter table assignment_links add column terms_version text;
    alter table assignment_acceptances add column terms_document_hash text;
    create table settings_addon_services(id uuid primary key default gen_random_uuid(), key text, name text, sort_order int, is_active boolean);
    create table profile_addon_services(org_id uuid, profile_id uuid, addon_service_id uuid, price_amount numeric, currency text, is_enabled boolean);
    create table assignment_addon_orders(id uuid primary key default gen_random_uuid(), assignment_id uuid references assignments(id),
      org_id uuid, addon_service_id uuid, addon_key text, addon_name_snapshot text, price_amount_snapshot numeric,
      currency_snapshot text, created_at timestamptz default now(), constraint assignment_addon_orders_unique_per_assignment unique(assignment_id,addon_service_id));
    create table inspection_addon_orders(id uuid primary key default gen_random_uuid(), inspection_id uuid references inspections(id),
      org_id uuid, assignment_addon_order_id uuid references assignment_addon_orders(id) on delete set null,
      addon_service_id uuid, addon_key text, addon_name_snapshot text, sort_order int,
      price_amount_snapshot numeric, currency_snapshot text, is_selected boolean, selected_source text);
    create table inspection_conditions(inspection_id uuid primary key references inspections(id), furnishing_level text);
    create table inspection_report_links(id uuid primary key default gen_random_uuid(), inspection_id uuid references inspections(id), revoked_at timestamptz);
    create table ob_property_snapshot(inspection_id uuid primary key references inspections(id), source_property_id uuid,
      source_property_owner uuid, source_property_created_at timestamptz, name text, address text, postal_code text,
      city text, municipality text, cadastral_id text, client_name text, owner_name text, status text,
      brf_name text, apartment_number text, apartment_holder_name text);
    create table technical_investigation_details(inspection_id uuid primary key references inspections(id),org_id uuid,inspector_profile_id uuid,
      assignment_id uuid references assignments(id),property_id uuid,title text,project_type text,report_template_key text,report_template_title text,
      report_template_version int,report_template_applied_at timestamptz,report_authoring_mode text,report_workflow_profile text,
      property_object_type text,scope_description text,brf_name text,apartment_number text,apartment_holder_name text,invoice_email text,
      background text,report_draft jsonb,report_draft_updated_at timestamptz,created_by uuid,updated_by uuid,updated_at timestamptz,report_locked_at timestamptz);
    create table tu_observations(id uuid primary key default gen_random_uuid(),inspection_id uuid references inspections(id),note text);
    create table tu_measurements(id uuid primary key default gen_random_uuid(),inspection_id uuid references inspections(id),value numeric);
    create table technical_investigation_images(id uuid primary key default gen_random_uuid(),inspection_id uuid references inspections(id),caption text);
    create table tu_report_revisions(id uuid primary key default gen_random_uuid(),inspection_id uuid references inspections(id));
    insert into organizations values ('${org}');
    insert into profiles values ('${actor}'), ('${stranger}');
    insert into org_members values ('${org}','${actor}','inspector',true), ('${org}','${stranger}','inspector',true);
  `)
  const acceptSql = sql('2026-05-27_01_tu_module_foundation.sql')
  await db.exec(acceptSql.slice(acceptSql.indexOf('create or replace function public.consume_assignment_token(')))
  await db.exec(sql('2026-03-24_03_inspection_lock_write_guards.sql'))
  await db.exec(`create trigger trg_guard_locked_inspection_write before update or delete on tu_observations
    for each row execute function guard_locked_inspection_child_write();`)
  await db.exec(sql('2026-09-10_02_ob_early_start.sql'))
  await db.exec(migration)
  await db.exec(migration)
})
after(async () => { await db.close() })

async function assignment(status = 'sent') {
  const { rows } = await db.query<{id:string}>(`insert into assignments(org_id,responsible_profile_id,customer_email,customer_name,property_address,
    status,last_sent_at,preferred_date,orderer_role,price_amount,assignment_type)
    values($1,$2,'customer@example.test','Original','Test street',$3,now(),'2026-10-15','Kund',1000,'TU') returning id`,[org,actor,status])
  const id = rows[0].id
  const token = 'test-token-for-' + id
  await db.query(`insert into assignment_links(assignment_id,org_id,token_hash,expires_at,terms_version)
    values($1,$2,encode(digest($3,'sha256'),'hex'),now()+interval '1 day','v1')`,[id,org,token])
  return {id,token}
}
async function start(id:string, reason: string|null = 'Customer has not replied', user = actor, organization = org) {
  const {rows} = await db.query<{value:{inspectionId:string;propertyId:string}}>(`select tu_start_assignment_investigation($1,$2,$3,
    (select updated_at from assignments where id=$1),$4::jsonb,'villa',$5::jsonb,$6) as value`,[id,organization,user,JSON.stringify(template),JSON.stringify(draft),reason])
  return rows[0].value
}
async function state(id:string) {
  return (await db.query<{value:TuAssignmentWorkflow}>('select tu_assignment_workflow_state($1,$2) as value',[id,org])).rows[0].value
}
async function accept(token:string) {
  await db.query('select * from consume_assignment_token($1,$2,$3::jsonb,null,null)',
    [token,'v1',JSON.stringify({terms_document_hash:'a'.repeat(64),customer_name:'Approved name',addon_service_ids:[]})])
}
async function book(id:string) { await db.query("update assignments set status='booked',booked_at=now() where id=$1",[id]) }
async function review(id:string, token?:string) {
  return (await db.query<{value:TuAssignmentWorkflow}>('select tu_review_assignment_workflow($1,$2,$3,$4) as value',[id,org,actor,token ?? (await state(id)).reviewToken])).rows[0].value
}

test('early start requires explicit acknowledgement and a bounded reason', () => {
  assert.equal(validateTuEarlyStart(undefined,undefined), null)
  for (const [reason,confirmed] of [[null,true],['short',false],['abc',true],['x'.repeat(1001),true]]) {
    assert.throws(() => validateTuEarlyStart(reason,confirmed),/TU_EARLY_REASON_REQUIRED/)
  }
  assert.equal(validateTuEarlyStart('  Client pending  ',true),'Client pending')
})
test('atomic early start preserves unapproved status and retries open the same investigation', async () => {
  const a=await assignment(); const first=await start(a.id)
  assert.deepEqual(await start(a.id),first)
  assert.equal((await state(first.inspectionId)).canDeliver,false)
  const row=(await db.query<{status:string;accepted_at:null;booked_at:null}>('select * from assignments where id=$1',[a.id])).rows[0]
  assert.equal(row.status,'sent'); assert.equal(row.accepted_at,null); assert.equal(row.booked_at,null)
  assert.equal((await db.query<{n:number}>('select count(*)::int n from tu_assignment_workflow_events where inspection_id=$1',[first.inspectionId])).rows[0].n,1)
})
test('invalid status, missing reason, foreign org, other inspector and expired link cannot start', async () => {
  const a=await assignment()
  await assert.rejects(start(a.id,null),/TU_EARLY_REASON_REQUIRED/)
  await assert.rejects(start(a.id,'Valid reason',stranger),/TU_ASSIGNMENT_FORBIDDEN/)
  await assert.rejects(start(a.id,'Valid reason',actor,stranger),/TU_ASSIGNMENT_NOT_FOUND/)
  await db.query("update assignment_links set expires_at=now()-interval '1 day' where assignment_id=$1",[a.id])
  await assert.rejects(start(a.id),/TU_APPROVAL_LINK_REQUIRED/)
  for(const status of ['draft','cancelled','expired']) await assert.rejects(start((await assignment(status)).id),/TU_START_NOT_ALLOWED/)
  assert.equal((await db.query<{inspection_id:null}>('select inspection_id from assignments where id=$1',[a.id])).rows[0].inspection_id,null)
})
test('customer approval preserves notes, measurements, images and report; booking plus comparison are required',async()=>{
  const a=await assignment(); const i=await start(a.id)
  await db.query("insert into tu_observations(inspection_id,note) values($1,'Keep note')",[i.inspectionId])
  await db.query("insert into tu_measurements(inspection_id,value) values($1,19.5)",[i.inspectionId])
  await db.query("insert into technical_investigation_images(inspection_id,caption) values($1,'Keep image')",[i.inspectionId])
  for(const statement of [
    "update inspections set locked_at=now() where id=$1", "update inspections set status='completed' where id=$1",
    'update technical_investigation_details set report_locked_at=now() where inspection_id=$1',
    'insert into inspection_report_links(inspection_id) values($1)', 'insert into tu_report_revisions(inspection_id) values($1)'
  ]) await assert.rejects(db.query(statement,[i.inspectionId]),/TU_DELIVERY_BLOCKED/)
  await assert.rejects(review(i.inspectionId),/TU_APPROVAL_REQUIRED/)
  await accept(a.token)
  assert.equal((await state(i.inspectionId)).acceptedAt !== null,true)
  await assert.rejects(review(i.inspectionId),/TU_APPROVAL_REQUIRED/)
  await book(a.id)
  const previous=await state(i.inspectionId)
  await db.query("update technical_investigation_details set report_draft=$2::jsonb where inspection_id=$1",[i.inspectionId,JSON.stringify({sections:[{body:'Edited manually'}]})])
  await assert.rejects(review(i.inspectionId,previous.reviewToken),/TU_WORKFLOW_CHANGED/)
  assert.equal((await review(i.inspectionId)).canDeliver,true)
  assert.equal((await db.query<{customer_name:string}>('select customer_name from inspections where id=$1',[i.inspectionId])).rows[0].customer_name,'Original')
  assert.deepEqual((await db.query<{report_draft:unknown}>('select report_draft from technical_investigation_details where inspection_id=$1',[i.inspectionId])).rows[0].report_draft,{sections:[{body:'Edited manually'}]})
  assert.equal((await db.query<{note:string}>('select note from tu_observations where inspection_id=$1',[i.inspectionId])).rows[0].note,'Keep note')
  await db.query('insert into inspection_report_links(inspection_id) values($1)',[i.inspectionId])
  await db.query('update inspections set locked_at=now() where id=$1',[i.inspectionId])
  await assert.rejects(db.query("update tu_observations set note='Forbidden' where inspection_id=$1",[i.inspectionId]),/låst/)
})
test('new confirmation retains the investigation, pauses draft work, and requires fresh approval',async()=>{
  const a=await assignment(); const i=await start(a.id)
  await db.query("insert into tu_observations(inspection_id,note) values($1,'Retained')",[i.inspectionId])
  const replacement=(await db.query<{id:string}>(`select tu_reissue_started_assignment($1,$2,$3,(select updated_at from assignments where id=$1)) as id`,[a.id,org,actor])).rows[0].id
  assert.equal((await state(i.inspectionId)).assignmentId,replacement)
  assert.equal((await state(i.inspectionId)).paused,true)
  await assert.rejects(db.query("insert into tu_observations(inspection_id,note) values($1,'Blocked')",[i.inspectionId]),/TU_WORK_PAUSED/)
  await assert.rejects(accept(a.token),/revoked|invalid|expired|LINK|TOKEN/i)
  await db.query("update assignments set status='sent',last_sent_at=now() where id=$1",[replacement])
  const token='replacement-token-'+replacement
  await db.query(`insert into assignment_links(assignment_id,org_id,token_hash,expires_at,terms_version)
    values($1,$2,encode(digest($3,'sha256'),'hex'),now()+interval '1 day','v1')`,[replacement,org,token])
  assert.equal((await state(i.inspectionId)).paused,false)
  assert.deepEqual(await start(replacement),i)
  await accept(token); await book(replacement); await review(i.inspectionId)
  assert.equal((await state(i.inspectionId)).canDeliver,true)
  assert.equal((await db.query<{note:string}>('select note from tu_observations where inspection_id=$1',[i.inspectionId])).rows[0].note,'Retained')
})
test('normal approved start does not create an early-start workflow',async()=>{
  const a=await assignment(); await accept(a.token)
  const i=await start(a.id,null)
  assert.equal(await state(i.inspectionId),null)
  assert.equal((await db.query<{status:string}>('select status from assignments where id=$1',[a.id])).rows[0].status,'completed')
})
test('browser roles cannot call workflow mutations, fake approval, or change protected links',async()=>{
  const a=await assignment(); const i=await start(a.id)
  await assert.rejects(db.query("update inspections set inspection_family='OB' where id=$1",[i.inspectionId]),/TU_WORKFLOW_LINK_IMMUTABLE/)
  for(const role of ['anon','authenticated']) {
    await db.exec('set role '+role)
    try { await assert.rejects(start(a.id),/permission denied/); await assert.rejects(review(i.inspectionId,'a'.repeat(32)),/permission denied/) }
    finally { await db.exec('reset role') }
  }
  await db.exec('grant select, update on assignments to authenticated; grant select, insert on assignment_acceptances to authenticated;')
  await db.exec('set role authenticated')
  try {
    await assert.rejects(db.query("update assignments set accepted_at=now(),terms_version='fake' where id=$1",[a.id]),/TU_WORKFLOW_SERVER_WRITE_REQUIRED/)
    await assert.rejects(db.query("update assignments set inspection_id=null where id=$1",[a.id]),/TU_WORKFLOW_SERVER_WRITE_REQUIRED/)
  } finally { await db.exec('reset role') }
})

test('expired approval link pauses work and a refreshed link resumes it without approval',async()=>{
  const a=await assignment(); const i=await start(a.id)
  await db.query("update assignment_links set expires_at=now()-interval '1 day' where assignment_id=$1",[a.id])
  assert.equal((await state(i.inspectionId)).paused,true)
  await assert.rejects(db.query('insert into tu_measurements(inspection_id,value) values($1,20)',[i.inspectionId]),/TU_WORK_PAUSED/)
  await db.query("update assignment_links set expires_at=now()+interval '1 day' where assignment_id=$1",[a.id])
  assert.equal((await state(i.inspectionId)).paused,false)
  assert.equal((await state(i.inspectionId)).canDeliver,false)
})

test('changed confirmation invalidates reconciliation and revokes previously published links',async()=>{
  const a=await assignment(); const i=await start(a.id); await accept(a.token); await book(a.id); await review(i.inspectionId)
  await db.query('insert into inspection_report_links(inspection_id) values($1)',[i.inspectionId])
  await db.query("update assignments set scope_description='Changed scope' where id=$1",[a.id])
  assert.equal((await state(i.inspectionId)).needsReview,true)
  assert.equal((await state(i.inspectionId)).canDeliver,false)
  assert.ok((await db.query<{revoked_at:string}>('select revoked_at from inspection_report_links where inspection_id=$1',[i.inspectionId])).rows[0].revoked_at)
})

test('creation failure rolls back the entire start and can be retried',async()=>{
  const a=await assignment()
  await db.exec(`create function test_fail_tu_detail() returns trigger language plpgsql as $$ begin raise exception 'test_failure'; end $$;
    create trigger test_fail_tu_detail before insert on technical_investigation_details for each row execute function test_fail_tu_detail();`)
  const before=(await db.query('select count(*) from inspections')).rows
  try { await assert.rejects(start(a.id),/test_failure/) }
  finally { await db.exec('drop trigger test_fail_tu_detail on technical_investigation_details; drop function test_fail_tu_detail();') }
  assert.deepEqual((await db.query('select count(*) from inspections')).rows,before)
  assert.equal((await db.query<{inspection_id:null}>('select inspection_id from assignments where id=$1',[a.id])).rows[0].inspection_id,null)
  assert.ok((await start(a.id)).inspectionId)
})

test('reapplying the migration leaves locked reports and existing approvals untouched',async()=>{
  const before=(await db.query('select id,status,accepted_at,inspection_id from assignments order by id')).rows
  const reports=(await db.query('select inspection_id,report_draft from technical_investigation_details order by inspection_id')).rows
  await db.exec(migration)
  assert.deepEqual((await db.query('select id,status,accepted_at,inspection_id from assignments order by id')).rows,before)
  assert.deepEqual((await db.query('select inspection_id,report_draft from technical_investigation_details order by inspection_id')).rows,reports)
})
