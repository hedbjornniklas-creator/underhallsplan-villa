import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
// @ts-expect-error Node's strip-types test runner requires the explicit TypeScript extension.
import { getObAssignmentChanges, validateObEarlyStartReason } from '../src/lib/ob/assignmentWorkflow.ts'
import type { ObAssignmentWorkflow } from '../src/lib/ob/assignmentWorkflow'

const db = new PGlite()
const migration = readFileSync(new URL('../docs/db/2026-09-10_02_ob_early_start.sql', import.meta.url), 'utf8')
const reconciliationMigration = readFileSync(new URL('../docs/db/2026-09-12_12_ob_assignment_reconciliation.sql', import.meta.url), 'utf8')
const org = '00000000-0000-4000-8000-000000000001'
const actor = '00000000-0000-4000-8000-000000000002'
const stranger = '00000000-0000-4000-8000-000000000003'

before(async () => {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create schema extensions;
    create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
    create function auth.role() returns text language sql as $$ select current_setting('role') $$;
    create function public.is_org_member(uuid) returns boolean language sql as $$ select true $$;
    -- Hash implementation is not under test; the real token consumer is tested below.
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
  await db.exec(readFileSync(new URL('../docs/db/2026-02-20_02_assignments_core.sql', import.meta.url), 'utf8').replace(/^\uFEFF/, ''))
  await db.exec(`
    alter table public.assignments drop constraint assignments_status_check;
    alter table public.assignments add constraint assignments_status_check check(status in ('draft','sent','ordered','booked','completed','expired','cancelled'));
    alter table public.assignments add column booked_at timestamptz, add column archived_at timestamptz,
      add column archived_by uuid, add column terms_document_hash text, add column customer_address text,
      add column customer_postal_code text, add column customer_city text, add column property_municipality text,
      add column property_owner_name text, add column brf_name text, add column apartment_number text,
      add column apartment_holder_name text, add column scope_description text, add column invoice_email text;
    alter table public.assignment_links add column terms_version text;
    alter table public.assignment_acceptances add column terms_document_hash text;
    create table public.settings_addon_services(id uuid primary key default gen_random_uuid(), key text, name text, sort_order int, is_active boolean);
    create table public.profile_addon_services(org_id uuid, profile_id uuid, addon_service_id uuid, price_amount numeric, currency text, is_enabled boolean);
    create table public.assignment_addon_orders(id uuid primary key default gen_random_uuid(), assignment_id uuid references public.assignments(id),
      org_id uuid, addon_service_id uuid, addon_key text, addon_name_snapshot text, price_amount_snapshot numeric,
      currency_snapshot text, created_at timestamptz default now(), constraint assignment_addon_orders_unique_per_assignment unique(assignment_id,addon_service_id));
    create table public.inspection_addon_orders(id uuid primary key default gen_random_uuid(), inspection_id uuid references public.inspections(id),
      org_id uuid, assignment_addon_order_id uuid references public.assignment_addon_orders(id) on delete set null,
      addon_service_id uuid, addon_key text, addon_name_snapshot text, sort_order int,
      price_amount_snapshot numeric, currency_snapshot text, is_selected boolean, selected_source text);
    create table public.inspection_conditions(inspection_id uuid primary key references public.inspections(id), furnishing_level text);
    create table public.inspection_images(id uuid primary key default gen_random_uuid(), inspection_id uuid references public.inspections(id), note text);
    create table public.inspection_round_quick_notes(id uuid primary key default gen_random_uuid(), inspection_id uuid references public.inspections(id), note_text text);
    create table public.inspection_report_links(id uuid primary key default gen_random_uuid(), inspection_id uuid references public.inspections(id), revoked_at timestamptz);
    create table public.ob_property_snapshot(inspection_id uuid primary key references public.inspections(id), source_property_id uuid,
      source_property_owner uuid, source_property_created_at timestamptz, name text, address text, postal_code text,
      city text, municipality text, cadastral_id text, client_name text, owner_name text, status text,
      brf_name text, apartment_number text, apartment_holder_name text);
    insert into public.organizations values ('${org}');
    insert into public.profiles values ('${actor}'), ('${stranger}');
    insert into public.org_members values ('${org}', '${actor}', 'inspector', true), ('${org}', '${stranger}', 'inspector', true);
  `)
  const acceptSql = readFileSync(new URL('../docs/db/2026-05-27_01_tu_module_foundation.sql', import.meta.url), 'utf8')
  await db.exec(acceptSql.slice(acceptSql.indexOf('create or replace function public.consume_assignment_token(')))
  await db.exec(readFileSync(new URL('../docs/db/2026-03-24_03_inspection_lock_write_guards.sql', import.meta.url), 'utf8').replace(/^\uFEFF/, ''))
  await db.exec(migration)
  await db.exec(migration)
  await db.exec(reconciliationMigration)
  await db.exec(reconciliationMigration)
})
after(async () => { await db.close() })

async function assignment(status = 'sent') {
  const { rows } = await db.query<{ id: string }>(`insert into public.assignments(org_id,responsible_profile_id,customer_email,
    customer_name,property_address,status,last_sent_at,preferred_date,orderer_role,price_amount,accepted_at,terms_version,booked_at)
    values ($1,$2,'customer@example.test','Original customer','Test street',$3,now(),'2026-09-10','Säljare',1000,
      case when $3='booked' then now() end,case when $3='booked' then 'v1' end,case when $3='booked' then now() end) returning id`, [org,actor,status])
  const id = rows[0].id
  const token = `test-token-for-assignment-${id}`
  await db.query(`insert into public.assignment_links(assignment_id,org_id,token_hash,expires_at,terms_version)
    values($1,$2,encode(digest($3,'sha256'),'hex'),now()+interval '1 day','v1')`, [id,org,token])
  return { id, token }
}
async function start(id: string, reason: string | null = 'Customer has not replied', user = actor) {
  const { rows } = await db.query<{ value: { inspectionId: string; propertyId: string } }>(
    'select public.ob_start_assignment_inspection($1,$2,$3,$4) as value', [id,org,user,reason])
  return rows[0].value
}
async function state(id: string): Promise<ObAssignmentWorkflow>
async function state(id: string, allowUntracked: true): Promise<ObAssignmentWorkflow | null>
async function state(id: string, allowUntracked = false) {
  const { rows } = await db.query<{ value: ObAssignmentWorkflow | null }>('select public.ob_assignment_workflow_state($1) as value', [id])
  if (!allowUntracked) assert.ok(rows[0].value)
  return rows[0].value
}
async function accept(token: string, name = 'Customer approved name', addons: string[] = [], details: Record<string, unknown> = {}) {
  await db.query('select * from public.consume_assignment_token($1,$2,$3::jsonb,null,null)',
    [token,'v1',JSON.stringify({ terms_document_hash: 'a'.repeat(64), customer_name: name, addon_service_ids: addons, ...details })])
}

async function review(inspectionId: string) {
  const current = await state(inspectionId)
  await db.query('select ob_review_assignment_workflow($1,$2,$3,$4)', [inspectionId,org,actor,current.reviewToken])
}
test('reason validation and comparison keep missing approval and changed scope explicit', () => {
  assert.equal(validateObEarlyStartReason('  why  '), null)
  assert.equal(validateObEarlyStartReason('  Customer pending  '), 'Customer pending')
  assert.equal(validateObEarlyStartReason('x'.repeat(1001)), null)
  assert.deepEqual(getObAssignmentChanges({ customer_name: 'A', addons: [] }, { customer_name: 'B', addons: [] }), ['customer_name'])
})
test('early start is idempotent, records reason and preserves unapproved status', async () => {
  const a = await assignment()
  const first = await start(a.id)
  assert.deepEqual(await start(a.id), first)
  const row = (await db.query<{status:string;accepted_at:string|null;booked_at:string|null}>('select * from assignments where id=$1', [a.id])).rows[0]
  assert.equal(row.status, 'sent'); assert.equal(row.accepted_at, null); assert.equal(row.booked_at, null)
  assert.equal((await state(first.inspectionId)).canDeliver, false)
  assert.equal((await db.query<{n:number}>('select count(*)::int as n from ob_assignment_workflow_events where inspection_id=$1', [first.inspectionId])).rows[0].n, 1)
})
test('start rejects missing reason, invalid link, inactive status and another inspector without creating records', async () => {
  const a = await assignment()
  await assert.rejects(start(a.id, null), /OB_EARLY_REASON_REQUIRED/)
  await assert.rejects(start(a.id, 'A valid reason', stranger), /OB_ASSIGNMENT_FORBIDDEN/)
  await db.query('update assignment_links set expires_at=now()-interval \'1 day\' where assignment_id=$1', [a.id])
  await assert.rejects(start(a.id), /OB_APPROVAL_LINK_REQUIRED/)
  for (const status of ['draft', 'cancelled', 'expired']) {
    const other = await assignment(status)
    await assert.rejects(start(other.id), /OB_START_NOT_ALLOWED/)
  }
  assert.equal((await db.query<{inspection_id:string|null}>('select inspection_id from assignments where id=$1', [a.id])).rows[0].inspection_id, null)
})
test('late approval preserves inspection work; booking and explicit up-to-date review are required', async () => {
  const a = await assignment(); const inspection = await start(a.id)
  await db.query('insert into inspection_images(inspection_id,note) values($1,\'Existing work\')', [inspection.inspectionId])
  await assert.rejects(db.query('update inspections set status=\'completed\' where id=$1', [inspection.inspectionId]), /OB_DELIVERY_BLOCKED/)
  await assert.rejects(db.query('update inspections set locked_at=now() where id=$1', [inspection.inspectionId]), /OB_DELIVERY_BLOCKED/)
  await assert.rejects(db.query('insert into inspection_report_links(inspection_id) values($1)', [inspection.inspectionId]), /OB_DELIVERY_BLOCKED/)
  const oldState = await state(inspection.inspectionId)
  await accept(a.token)
  assert.equal((await state(inspection.inspectionId)).canDeliver, false)
  assert.equal((await db.query<{customer_name:string}>('select customer_name from inspections where id=$1', [inspection.inspectionId])).rows[0].customer_name, 'Original customer')
  await db.query('update assignments set status=\'booked\',booked_at=now() where id=$1', [a.id])
  await assert.rejects(db.query('select ob_review_assignment_workflow($1,$2,$3,$4)', [inspection.inspectionId,org,actor,oldState.reviewToken]), /OB_WORKFLOW_CHANGED/)
  const current = await state(inspection.inspectionId)
  await db.query('select ob_review_assignment_workflow($1,$2,$3,$4)', [inspection.inspectionId,org,actor,current.reviewToken])
  assert.equal((await state(inspection.inspectionId)).canDeliver, true)
  await db.query('insert into inspection_report_links(inspection_id) values($1)', [inspection.inspectionId])
  await db.query('update inspections set status=\'completed\',locked_at=now() where id=$1', [inspection.inspectionId])
})
test('reissue keeps the same inspection and event history; draft pauses writes and old token is revoked', async () => {
  const a = await assignment(); const inspection = await start(a.id)
  const result = await db.query<{ id: string }>('select ob_reissue_started_assignment($1,$2,$3) as id', [a.id,org,actor])
  const nextId = result.rows[0].id
  assert.notEqual(nextId, a.id)
  assert.equal((await state(inspection.inspectionId)).assignmentId, nextId)
  assert.equal((await state(inspection.inspectionId)).paused, true)
  await assert.rejects(accept(a.token), /assignment_cancelled/)
  await assert.rejects(db.query('insert into inspection_images(inspection_id,note) values($1,\'blocked\')', [inspection.inspectionId]), /OB_WORK_PAUSED/)
  await db.query('update assignments set status=\'sent\',last_sent_at=now() where id=$1', [nextId])
  await db.query(`insert into assignment_links(assignment_id,org_id,token_hash,expires_at,terms_version)
    values($1,$2,encode(digest('synthetic-reissued-token','sha256'),'hex'),now()+interval '1 day','v1')`, [nextId,org])
  assert.deepEqual(await start(nextId), inspection)
  await db.query('insert into inspection_images(inspection_id,note) values($1,\'resumed\')', [inspection.inspectionId])
  await db.query('update assignments set status=\'cancelled\' where id=$1', [nextId])
  await assert.rejects(db.query('update inspections set client_name=\'blocked\' where id=$1', [inspection.inspectionId]), /OB_WORK_PAUSED/)
})
test('normal booked start remains available without early-start review', async () => {
  const a = await assignment('booked'); const inspection = await start(a.id, null)
  assert.equal(await state(inspection.inspectionId, true), null)
  assert.equal((await db.query<{status:string}>('select status from assignments where id=$1', [a.id])).rows[0].status, 'completed')
})

test('failed snapshot insertion rolls back property, inspection and assignment together', async () => {
  const a = await assignment()
  const counts = async () => (await db.query('select (select count(*) from properties) as properties, (select count(*) from inspections) as inspections')).rows[0]
  const before = await counts()
  await db.exec(`create function test_snapshot_failure() returns trigger language plpgsql as $$ begin raise exception 'simulated_storage_failure'; end $$;
    create trigger test_snapshot_failure before insert on ob_property_snapshot for each row execute function test_snapshot_failure();`)
  try { await assert.rejects(start(a.id), /simulated_storage_failure/) }
  finally { await db.exec('drop trigger test_snapshot_failure on ob_property_snapshot; drop function test_snapshot_failure();') }
  assert.deepEqual(await counts(), before)
  assert.equal((await db.query<{inspection_id:string|null}>('select inspection_id from assignments where id=$1', [a.id])).rows[0].inspection_id, null)
})

test('late addon approval never overwrites inspector selections and invalidates stale reviews', async () => {
  const a = await assignment()
  const addonId = (await db.query<{id:string}>(`insert into settings_addon_services(key,name,sort_order,is_active)
    values('area_measurement','Areamatning',100,true) returning id`)).rows[0].id
  await db.query(`insert into profile_addon_services values($1,$2,$3,500,'SEK',true)`, [org,actor,addonId])
  await db.query(`insert into assignment_addon_orders(assignment_id,org_id,addon_service_id,addon_key,addon_name_snapshot,price_amount_snapshot,currency_snapshot)
    values($1,$2,$3,'area_measurement','Areamatning',500,'SEK')`, [a.id,org,addonId])
  const inspection = await start(a.id)
  await db.query(`update inspection_addon_orders set is_selected=false where inspection_id=$1`, [inspection.inspectionId])
  await accept(a.token, 'Customer', [addonId])
  const selected = (await db.query<{is_selected:boolean;assignment_addon_order_id:string|null}>('select is_selected,assignment_addon_order_id from inspection_addon_orders where inspection_id=$1', [inspection.inspectionId])).rows[0]
  assert.equal(selected.is_selected, false)
  assert.equal(selected.assignment_addon_order_id, null)
  await db.query(`update assignments set status='booked',booked_at=now() where id=$1`, [a.id])
  await review(inspection.inspectionId)
  await db.query('insert into inspection_report_links(inspection_id) values($1)', [inspection.inspectionId])
  await db.query('update assignment_addon_orders set price_amount_snapshot=600 where assignment_id=$1', [a.id])
  assert.equal((await state(inspection.inspectionId)).canDeliver, false)
  assert.ok((await db.query<{revoked_at:string|null}>('select revoked_at from inspection_report_links where inspection_id=$1', [inspection.inspectionId])).rows[0].revoked_at)
})

test('authenticated browser writes cannot forge approval, detach work or call privileged RPCs', async () => {
  const a = await assignment(); const inspection = await start(a.id)
  await db.exec(`grant usage on schema public,auth to authenticated;
    grant update on assignments to authenticated; grant select on assignments to authenticated;
    grant insert on assignment_acceptances to authenticated;`)
  await db.exec('set role authenticated')
  try {
    await assert.rejects(db.query('update assignments set inspection_id=null where id=$1', [a.id]), /OB_ASSIGNMENT_SERVER_WRITE_REQUIRED/)
    await assert.rejects(db.query('update assignments set accepted_at=now(),booked_at=now(),status=\'booked\' where id=$1', [a.id]), /OB_ASSIGNMENT_SERVER_WRITE_REQUIRED/)
    await assert.rejects(db.query(`insert into assignment_acceptances(assignment_id,org_id,accepted_at,terms_version,payload)
      values($1,$2,now(),'v1','{}')`, [a.id,org]), /OB_ASSIGNMENT_SERVER_WRITE_REQUIRED/)
    await assert.rejects(start(a.id), /permission denied for function/)
    await assert.rejects(db.query('select ob_review_assignment_workflow($1,$2,$3,$4)', [inspection.inspectionId,org,actor,'forged']), /permission denied for function/)
    await assert.rejects(db.query('delete from ob_assignment_workflows where inspection_id=$1', [inspection.inspectionId]), /permission denied/)
    await assert.rejects(accept(a.token), /permission denied for function/)
  } finally { await db.exec('reset role') }
  assert.equal((await state(inspection.inspectionId)).canDeliver, false)
})

test('pausing revokes delivered links and protects inserts, updates, deletes and moving existing work', async () => {
  const a = await assignment(); const inspection = await start(a.id)
  const other = await start((await assignment()).id)
  const imageId = (await db.query<{id:string}>(`insert into inspection_images(inspection_id,note) values($1,'work') returning id`, [inspection.inspectionId])).rows[0].id
  await accept(a.token)
  await db.query(`update assignments set status='booked',booked_at=now() where id=$1`, [a.id])
  await review(inspection.inspectionId)
  await db.query('insert into inspection_report_links(inspection_id) values($1)', [inspection.inspectionId])
  await db.query('update assignments set archived_at=now() where id=$1', [a.id])
  assert.ok((await db.query<{revoked_at:string|null}>('select revoked_at from inspection_report_links where inspection_id=$1', [inspection.inspectionId])).rows[0].revoked_at)
  await assert.rejects(db.query('update inspection_images set inspection_id=$1 where id=$2', [other.inspectionId,imageId]), /OB_INSPECTION_LINK_IMMUTABLE/)
  await assert.rejects(db.query('delete from inspection_images where id=$1', [imageId]), /OB_WORK_PAUSED/)
  await assert.rejects(db.query('update inspection_images set note=\'changed\' where id=$1', [imageId]), /OB_WORK_PAUSED/)
  await assert.rejects(db.query(`insert into inspection_round_quick_notes(inspection_id,note_text) values($1,'round note')`, [inspection.inspectionId]), /OB_WORK_PAUSED/)
  await assert.rejects(db.query('update inspections set status=\'completed\' where id=$1', [inspection.inspectionId]), /OB_WORK_PAUSED/)
})

test('reissued approval and repeated start keep history and require a new review', async () => {
  const a = await assignment(); const inspection = await start(a.id)
  await accept(a.token)
  await db.query(`update assignments set status='booked',booked_at=now() where id=$1`, [a.id])
  await review(inspection.inspectionId)
  const next = (await db.query<{id:string}>('select ob_reissue_started_assignment($1,$2,$3) as id', [a.id,org,actor])).rows[0].id
  await db.query(`update assignments set status='sent',last_sent_at=now() where id=$1`, [next])
  const token = `new-approved-assignment-token-${next}`
  await db.query(`insert into assignment_links(assignment_id,org_id,token_hash,expires_at,terms_version)
    values($1,$2,encode(digest($3,'sha256'),'hex'),now()+interval '1 day','v1')`, [next,org,token])
  await accept(token)
  assert.deepEqual(await start(next), inspection)
  assert.equal((await state(inspection.inspectionId)).canDeliver, false)
  await db.query(`update assignments set status='booked',booked_at=now() where id=$1`, [next])
  await review(inspection.inspectionId)
  assert.equal((await state(inspection.inspectionId)).canDeliver, true)
  assert.equal((await db.query<{n:number}>('select count(*)::int as n from ob_assignment_workflow_events where inspection_id=$1', [inspection.inspectionId])).rows[0].n, 4)
})

test('booking alone cannot replace the customer acceptance record; archived and locked work stays protected', async () => {
  const a = await assignment(); const inspection = await start(a.id)
  await db.query(`update assignments set status='booked',booked_at=now(),accepted_at=now(),terms_version='v1' where id=$1`, [a.id])
  await assert.rejects(review(inspection.inspectionId), /OB_APPROVAL_REQUIRED/)
  await accept(a.token)
  await db.query(`update assignments set status='booked' where id=$1`, [a.id])
  await review(inspection.inspectionId)
  await db.query('update inspections set locked_at=now() where id=$1', [inspection.inspectionId])
  await assert.rejects(db.query('select ob_reissue_started_assignment($1,$2,$3)', [a.id,org,actor]), /OB_INSPECTION_LOCKED/)
  await assert.rejects(db.query(`insert into inspection_images(inspection_id,note) values($1,'locked')`, [inspection.inspectionId]), /låst/)
})

test('a tracked inspection cannot change family or property to bypass delivery rules', async () => {
  const inspection = await start((await assignment()).id)
  await assert.rejects(db.query(`update inspections set inspection_family='TU' where id=$1`, [inspection.inspectionId]), /OB_INSPECTION_LINK_IMMUTABLE/)
  await assert.rejects(db.query(`update inspections set property_id=null where id=$1`, [inspection.inspectionId]), /OB_INSPECTION_LINK_IMMUTABLE/)
  await assert.rejects(db.query(`update assignments set assignment_type='STATUS' where inspection_id=$1`, [inspection.inspectionId]), /OB_INSPECTION_LINK_IMMUTABLE/)
})

test('only an active responsible inspector or an active organization admin may start or review', async () => {
  const a = await assignment()
  await db.query('update org_members set is_active=false where profile_id=$1', [actor])
  try { await assert.rejects(start(a.id), /OB_ASSIGNMENT_FORBIDDEN/) }
  finally { await db.query('update org_members set is_active=true where profile_id=$1', [actor]) }
  await db.query('update org_members set role=\'admin\' where profile_id=$1', [stranger])
  try { assert.ok((await start(a.id, 'Admin approved early start', stranger)).inspectionId) }
  finally { await db.query('update org_members set role=\'inspector\' where profile_id=$1', [stranger]) }
  await assert.rejects(db.query('select ob_start_assignment_inspection($1,$2,$3,$4)', [a.id,'00000000-0000-4000-8000-000000000099',actor,'reason']), /ASSIGNMENT_NOT_FOUND/)
})

test('expiry of the pending approval link pauses ongoing work without deleting it', async () => {
  const a = await assignment(); const inspection = await start(a.id)
  await db.query(`insert into inspection_images(inspection_id,note) values($1,'preserved')`, [inspection.inspectionId])
  await db.query(`update assignment_links set expires_at=now()-interval '1 day' where assignment_id=$1`, [a.id])
  assert.equal((await state(inspection.inspectionId)).paused, true)
  await assert.rejects(db.query(`insert into inspection_round_quick_notes(inspection_id,note_text) values($1,'paused')`, [inspection.inspectionId]), /OB_WORK_PAUSED/)
  assert.equal((await db.query<{note:string}>('select note from inspection_images where inspection_id=$1', [inspection.inspectionId])).rows[0].note, 'preserved')
})

type ReconciliationState = ObAssignmentWorkflow & {
  inspectionSnapshot: Record<string, unknown> | null
  reconciliationToken: string | null
  inspectionLocked: boolean
}

type ReconciliationAuditSnapshot = {
  _reconciliation: {
    selectedFields: string[]
    before: Record<string, unknown>
    after: Record<string, unknown>
  }
}

async function reconciliationState(inspectionId: string) {
  return await state(inspectionId) as ReconciliationState
}

async function reconcile(inspectionId: string, fields: string[] | null, options: {
  state?: ReconciliationState; user?: string; organization?: string
} = {}) {
  const current = options.state ?? await reconciliationState(inspectionId)
  return (await db.query<{value: ReconciliationState}>(
    'select public.ob_reconcile_assignment_workflow($1,$2,$3,$4,$5,$6::text[]) as value',
    [inspectionId, options.organization ?? org, options.user ?? actor, current.reviewToken, current.reconciliationToken, fields]
  )).rows[0].value
}

async function approvedEarly() {
  const a = await assignment()
  const inspection = await start(a.id)
  await accept(a.token, 'Rasmus', [], { customer_phone: '0701234567' })
  await db.query(`update assignments set status='booked',booked_at=now() where id=$1`, [a.id])
  return { a, inspection }
}

test('reconciliation copies an approved phone into Grunddata and keeps all nonselected work', async () => {
  const { a, inspection } = await approvedEarly()
  await db.query(`update inspections set customer_name='Inspector corrected name',customer_email='inspector@example.test',
    client_name='Inspector corrected name',client_contact='inspector@example.test',scope='Keep inspection scope' where id=$1`, [inspection.inspectionId])
  await db.query(`insert into inspection_images(inspection_id,note) values($1,'Keep photograph')`, [inspection.inspectionId])
  await db.query(`insert into inspection_round_quick_notes(inspection_id,note_text) values($1,'Keep note')`, [inspection.inspectionId])
  const previous = await reconciliationState(inspection.inspectionId)
  assert.equal(previous.currentSnapshot.customer_phone, '0701234567')
  assert.equal(previous.inspectionSnapshot?.customer_phone, null)
  assert.equal(previous.inspectionSnapshot?.customer_name, 'Inspector corrected name')
  assert.ok(previous.reconciliationToken)
  assert.equal(previous.inspectionLocked, false)
  const after = await reconcile(inspection.inspectionId, ['customer_phone'], { state: previous })
  assert.equal(after.needsReview, false)
  assert.equal(after.canDeliver, true)
  assert.equal(after.inspectionSnapshot?.customer_phone, '0701234567')
  assert.equal(after.reviewToken, previous.reviewToken)
  assert.notEqual(after.reconciliationToken, previous.reconciliationToken)
  const row = (await db.query<Record<string, unknown>>('select * from inspections where id=$1', [inspection.inspectionId])).rows[0]
  assert.equal(row.customer_name, 'Inspector corrected name')
  assert.equal(row.customer_email, 'inspector@example.test')
  assert.equal(row.client_name, 'Inspector corrected name')
  assert.equal(row.client_contact, '0701234567 | inspector@example.test')
  assert.equal(row.scope, 'Keep inspection scope')
  assert.equal((await db.query<{note:string}>('select note from inspection_images where inspection_id=$1', [inspection.inspectionId])).rows[0].note, 'Keep photograph')
  assert.equal((await db.query<{note_text:string}>('select note_text from inspection_round_quick_notes where inspection_id=$1', [inspection.inspectionId])).rows[0].note_text, 'Keep note')
  assert.equal((await db.query<{customer_name:string}>('select customer_name from assignments where id=$1', [a.id])).rows[0].customer_name, 'Rasmus')
  const event = (await db.query<{snapshot: ReconciliationAuditSnapshot}>('select snapshot from ob_assignment_workflow_events where inspection_id=$1 and event_type=\'reviewed\'', [inspection.inspectionId])).rows[0].snapshot
  assert.deepEqual(event._reconciliation.selectedFields, ['customer_phone'])
  assert.equal(event._reconciliation.before.customer_phone, null)
  assert.equal(event._reconciliation.after.customer_phone, '0701234567')
})

test('reconciliation checks the displayed inspection token and assignment token separately', async () => {
  const { a, inspection } = await approvedEarly()
  const previous = await reconciliationState(inspection.inspectionId)
  await db.query(`update inspections set customer_phone='Inspector phone' where id=$1`, [inspection.inspectionId])
  await assert.rejects(reconcile(inspection.inspectionId, ['customer_phone'], { state: previous }), /OB_RECONCILIATION_CHANGED/)
  assert.equal((await reconciliationState(inspection.inspectionId)).inspectionSnapshot?.customer_phone, 'Inspector phone')
  const contactState = await reconciliationState(inspection.inspectionId)
  await db.query(`update inspections set client_contact='concurrent legacy edit' where id=$1`, [inspection.inspectionId])
  await assert.rejects(reconcile(inspection.inspectionId, ['customer_phone'], { state: contactState }), /OB_RECONCILIATION_CHANGED/)
  const assignmentState = await reconciliationState(inspection.inspectionId)
  await db.query(`update assignments set customer_phone='0709876543' where id=$1`, [a.id])
  await assert.rejects(reconcile(inspection.inspectionId, ['customer_phone'], { state: assignmentState }), /OB_WORKFLOW_CHANGED/)
  assert.equal((await reconciliationState(inspection.inspectionId)).needsReview, true)
  const applied = await reconcile(inspection.inspectionId, ['customer_phone'])
  assert.equal(applied.inspectionSnapshot?.customer_phone, '0709876543')
})

test('reconciliation locks and checks the local property snapshot and never updates the shared property', async () => {
  const { a, inspection } = await approvedEarly()
  const propertyBefore = (await db.query('select * from properties where id=$1', [inspection.propertyId])).rows[0]
  await db.query(`update assignments set property_address='Approved address',property_postal_code='12345',
    property_city='Approved city',property_municipality='Approved municipality',property_owner_name='Approved owner',
    cadastral_id='APPROVED 1:2',brf_name='Approved BRF',apartment_number='1234',apartment_holder_name='Approved holder'
    where id=$1`, [a.id])
  const previous = await reconciliationState(inspection.inspectionId)
  await db.query(`update ob_property_snapshot set cadastral_id='Inspector identity' where inspection_id=$1`, [inspection.inspectionId])
  await assert.rejects(reconcile(inspection.inspectionId, ['property_city'], { state: previous }), /OB_RECONCILIATION_CHANGED/)
  const fields = ['property_address','property_postal_code','property_city','property_municipality','property_owner_name',
    'brf_name','apartment_number','apartment_holder_name']
  const after = await reconcile(inspection.inspectionId, fields)
  for (const key of fields) assert.equal(after.inspectionSnapshot?.[key], after.currentSnapshot[key])
  assert.equal(after.inspectionSnapshot?.cadastral_id, 'Inspector identity')
  assert.deepEqual((await db.query('select * from properties where id=$1', [inspection.propertyId])).rows[0], propertyBefore)
})

test('selected contact, address, date and role fields import, synchronize aliases and adapt the number atomically', async () => {
  const { a, inspection } = await approvedEarly()
  const numberBefore = (await db.query<{assignment_number:string}>('select assignment_number from inspections where id=$1', [inspection.inspectionId])).rows[0].assignment_number
  await db.query(`update assignments set customer_email='rasmus@example.test',customer_address='Customer street',
    customer_postal_code='98765',customer_city='Customer city',preferred_date='2026-09-12',preferred_time='11:30',
    orderer_role='Lägenhet',cadastral_id='APPROVED 3:4' where id=$1`, [a.id])
  const fields = ['customer_name','customer_email','customer_address','customer_postal_code','customer_city','preferred_date','preferred_time','orderer_role','cadastral_id']
  const after = await reconcile(inspection.inspectionId, fields)
  for (const key of fields.filter(key => key !== 'orderer_role')) assert.equal(after.inspectionSnapshot?.[key], after.currentSnapshot[key])
  assert.equal(after.inspectionSnapshot?.orderer_role, 'apartment')
  const row = (await db.query<{assignment_number:string;client_name:string;client_contact:string;customer_phone:string|null}>(
    'select assignment_number,client_name,client_contact,customer_phone from inspections where id=$1', [inspection.inspectionId])).rows[0]
  assert.notEqual(row.assignment_number, numberBefore)
  assert.match(row.assignment_number, /^2026-0912-\d{2,}$/)
  assert.equal(after.inspectionSnapshot?.assignment_number, row.assignment_number)
  assert.equal(row.client_name, 'Rasmus')
  assert.equal(row.client_contact, 'rasmus@example.test')
  assert.equal(row.customer_phone, null)
})

test('previous acknowledgement can be reopened and a missing phone imported; inspector edits do not invalidate approval', async () => {
  const { inspection } = await approvedEarly()
  await review(inspection.inspectionId)
  const previous = await reconciliationState(inspection.inspectionId)
  assert.equal(previous.needsReview, false)
  assert.equal(previous.inspectionSnapshot?.customer_phone, null)
  const after = await reconcile(inspection.inspectionId, ['customer_phone'], { state: previous })
  assert.equal(after.inspectionSnapshot?.customer_phone, '0701234567')
  await assert.rejects(reconcile(inspection.inspectionId, ['customer_phone'], { state: previous }), /OB_RECONCILIATION_CHANGED/)
  const eventCount = async () => (await db.query<{count:number}>(
    'select count(*)::int as count from ob_assignment_workflow_events where inspection_id=$1', [inspection.inspectionId])).rows[0].count
  const beforeReplayCount = await eventCount()
  await reconcile(inspection.inspectionId, ['customer_phone'], { state: after })
  assert.equal(await eventCount(), beforeReplayCount)
  await db.query(`update inspections set customer_name='Later inspector correction' where id=$1`, [inspection.inspectionId])
  assert.equal((await reconciliationState(inspection.inspectionId)).needsReview, false)
  assert.equal((await reconciliationState(inspection.inspectionId)).canDeliver, true)
})

test('explicit keep-my-values review is atomic and does not copy any customer fields', async () => {
  const { inspection } = await approvedEarly()
  const before = (await db.query('select * from inspections where id=$1', [inspection.inspectionId])).rows[0]
  const after = await reconcile(inspection.inspectionId, [])
  assert.equal(after.needsReview, false)
  assert.equal(after.inspectionSnapshot?.customer_phone, null)
  assert.deepEqual((await db.query('select * from inspections where id=$1', [inspection.inspectionId])).rows[0], before)
  const event = (await db.query<{snapshot: ReconciliationAuditSnapshot}>(`select snapshot from ob_assignment_workflow_events
    where inspection_id=$1 and event_type='reviewed'`, [inspection.inspectionId])).rows[0].snapshot
  assert.deepEqual(event._reconciliation.selectedFields, [])
  assert.deepEqual(event._reconciliation.before, event._reconciliation.after)
})

test('synchronizing a stale legacy contact returns a fresh token and is audited even if the structured phone matches', async () => {
  const { inspection } = await approvedEarly()
  await reconcile(inspection.inspectionId, ['customer_phone'])
  await db.query(`update inspections set client_contact='stale legacy contact' where id=$1`, [inspection.inspectionId])
  const before = await reconciliationState(inspection.inspectionId)
  const countBefore = (await db.query<{count:number}>(
    'select count(*)::int as count from ob_assignment_workflow_events where inspection_id=$1', [inspection.inspectionId])).rows[0].count
  const after = await reconcile(inspection.inspectionId, ['customer_phone'], { state: before })
  assert.deepEqual(after.inspectionSnapshot, before.inspectionSnapshot)
  assert.notEqual(after.reconciliationToken, before.reconciliationToken)
  assert.equal(after.reconciliationToken, (await reconciliationState(inspection.inspectionId)).reconciliationToken)
  assert.equal((await db.query<{count:number}>(
    'select count(*)::int as count from ob_assignment_workflow_events where inspection_id=$1', [inspection.inspectionId])).rows[0].count, countBefore + 1)
})

test('reconciliation rejects unsupported and empty source fields without acknowledging or partially importing', async () => {
  const { a, inspection } = await approvedEarly()
  for (const fields of [null, ['invoice_name'], ['customer_phone','scope_description'], ['price_amount'], ['addons'], ['terms_version'], ['unexpected']]) {
    await assert.rejects(reconcile(inspection.inspectionId, fields), /OB_RECONCILIATION_INVALID_FIELDS/)
  }
  await assert.rejects(reconcile(inspection.inspectionId, ['customer_phone','property_owner_name']), /OB_RECONCILIATION_FIELD_EMPTY/)
  await db.query(`update assignments set customer_phone='   ' where id=$1`, [a.id])
  await assert.rejects(reconcile(inspection.inspectionId, ['customer_phone']), /OB_RECONCILIATION_FIELD_EMPTY/)
  assert.equal((await reconciliationState(inspection.inspectionId)).needsReview, true)
  assert.equal((await reconciliationState(inspection.inspectionId)).inspectionSnapshot?.customer_phone, null)
})

test('any failed audit write rolls back the imported inspection and property fields together', async () => {
  const { a, inspection } = await approvedEarly()
  await db.query(`update assignments set property_city='New city' where id=$1`, [a.id])
  const previous = await reconciliationState(inspection.inspectionId)
  await db.exec(`create function test_reconciliation_failure() returns trigger language plpgsql as $$
    begin if new.event_type='reviewed' then raise exception 'simulated_audit_failure'; end if; return new; end $$;
    create trigger test_reconciliation_failure before insert on ob_assignment_workflow_events
      for each row execute function test_reconciliation_failure();`)
  try { await assert.rejects(reconcile(inspection.inspectionId, ['customer_phone','property_city']), /simulated_audit_failure/) }
  finally { await db.exec('drop trigger test_reconciliation_failure on ob_assignment_workflow_events; drop function test_reconciliation_failure();') }
  assert.deepEqual(await reconciliationState(inspection.inspectionId), previous)
})

test('reconciliation requires the current accepted and booked assignment and a real local snapshot', async () => {
  const a = await assignment(); const inspection = await start(a.id)
  await assert.rejects(reconcile(inspection.inspectionId, []), /OB_APPROVAL_REQUIRED/)
  await accept(a.token)
  await assert.rejects(reconcile(inspection.inspectionId, []), /OB_APPROVAL_REQUIRED/)
  await db.query(`update assignments set status='booked',booked_at=now() where id=$1`, [a.id])
  await db.query('delete from ob_property_snapshot where inspection_id=$1', [inspection.inspectionId])
  assert.equal((await reconciliationState(inspection.inspectionId)).inspectionSnapshot, null)
  assert.equal((await reconciliationState(inspection.inspectionId)).reconciliationToken, null)
  await assert.rejects(reconcile(inspection.inspectionId, []), /OB_RECONCILIATION_SNAPSHOT_MISSING/)
  const other = await approvedEarly()
  await db.query(`update assignments set archived_at=now() where id=$1`, [other.a.id])
  await assert.rejects(reconcile(other.inspection.inspectionId, []), /OB_APPROVAL_REQUIRED/)
})

test('reconciliation is restricted to the responsible inspector or an active admin and is not browser-callable', async () => {
  const { inspection } = await approvedEarly()
  await assert.rejects(reconcile(inspection.inspectionId, ['customer_phone'], { user: stranger }), /OB_ASSIGNMENT_FORBIDDEN/)
  await assert.rejects(reconcile(inspection.inspectionId, ['customer_phone'], { organization: '00000000-0000-4000-8000-000000000099' }), /ASSIGNMENT_NOT_FOUND/)
  await db.query('update org_members set is_active=false where profile_id=$1', [actor])
  try { await assert.rejects(reconcile(inspection.inspectionId, []), /OB_ASSIGNMENT_FORBIDDEN/) }
  finally { await db.query('update org_members set is_active=true where profile_id=$1', [actor]) }
  const previous = await reconciliationState(inspection.inspectionId)
  for (const role of ['anon','authenticated']) {
    await db.exec(`set role ${role}`)
    try {
      await assert.rejects(reconcile(inspection.inspectionId, ['customer_phone'], { state: previous }), /permission denied for function/)
      await assert.rejects(db.query('select ob_assignment_inspection_snapshot($1)', [inspection.inspectionId]), /permission denied for function/)
    } finally { await db.exec('reset role') }
  }
  await db.query(`update org_members set role='admin' where profile_id=$1`, [stranger])
  try { assert.equal((await reconcile(inspection.inspectionId, ['customer_phone'], { user: stranger })).inspectionSnapshot?.customer_phone, '0701234567') }
  finally { await db.query(`update org_members set role='inspector' where profile_id=$1`, [stranger]) }
})

test('locked or finalized inspections reject reconciliation even when no fields are selected', async () => {
  for (const patch of ['locked_at=now()', "status='completed'"]) {
    const { inspection } = await approvedEarly()
    await review(inspection.inspectionId)
    const previous = await reconciliationState(inspection.inspectionId)
    await db.query(`update inspections set ${patch} where id=$1`, [inspection.inspectionId])
    assert.equal((await reconciliationState(inspection.inspectionId)).inspectionLocked, true)
    await assert.rejects(reconcile(inspection.inspectionId, ['customer_phone'], { state: previous }), /OB_INSPECTION_LOCKED/)
    await assert.rejects(reconcile(inspection.inspectionId, []), /OB_INSPECTION_LOCKED/)
    assert.equal((await reconciliationState(inspection.inspectionId)).inspectionSnapshot?.customer_phone, null)
  }
})

test('comparison shows effective legacy Grunddata values instead of apparently empty storage fields', async () => {
  const { a, inspection } = await approvedEarly()
  await db.query(`update inspections set customer_name=null,customer_email=null,customer_phone=null,
    customer_address=null,customer_postal_code=null,customer_city=null,inspection_side=null,
    client_name='  Legacy displayed name  ',client_contact='0701112233 | LEGACY@EXAMPLE.TEST' where id=$1`, [inspection.inspectionId])
  await db.query(`update assignments set customer_address='Approved customer address',customer_postal_code='12345',
    customer_city='Approved customer city',orderer_role='Lägenhet',brf_name='Approved association',
    apartment_number='1201',apartment_holder_name='Approved holder' where id=$1`, [a.id])
  await db.query(`update properties set address='Shared displayed address',postal_code='99999',city='Shared city',
    municipality='Shared municipality',owner_name='Shared owner',cadastral_id='SHARED 1:1' where id=$1`, [inspection.propertyId])
  await db.query(`update ob_property_snapshot set address=null,postal_code=null,city=null,municipality=null,
    owner_name=null,cadastral_id=null,brf_name=null,apartment_number=null,apartment_holder_name=null where inspection_id=$1`, [inspection.inspectionId])
  const before = await reconciliationState(inspection.inspectionId)
  assert.equal(before.inspectionSnapshot?.customer_name, 'Legacy displayed name')
  assert.equal(before.inspectionSnapshot?.customer_email, 'legacy@example.test')
  assert.equal(before.inspectionSnapshot?.customer_phone, '0701112233')
  assert.equal(before.inspectionSnapshot?.customer_address, 'Approved customer address')
  assert.equal(before.inspectionSnapshot?.customer_postal_code, '12345')
  assert.equal(before.inspectionSnapshot?.customer_city, 'Approved customer city')
  assert.equal(before.inspectionSnapshot?.property_address, 'Shared displayed address')
  assert.equal(before.inspectionSnapshot?.property_postal_code, '99999')
  assert.equal(before.inspectionSnapshot?.property_city, 'Shared city')
  assert.equal(before.inspectionSnapshot?.property_municipality, 'Shared municipality')
  assert.equal(before.inspectionSnapshot?.property_owner_name, 'Shared owner')
  assert.equal(before.inspectionSnapshot?.cadastral_id, 'SHARED 1:1')
  assert.equal(before.inspectionSnapshot?.brf_name, 'Approved association')
  assert.equal(before.inspectionSnapshot?.apartment_number, '1201')
  assert.equal(before.inspectionSnapshot?.apartment_holder_name, 'Approved holder')
  assert.equal(before.inspectionSnapshot?.orderer_role, 'apartment')
  const after = await reconcile(inspection.inspectionId, ['customer_phone'], { state: before })
  assert.deepEqual(after.inspectionSnapshot, { ...before.inspectionSnapshot, customer_phone: '0701234567' })
  const stored = (await db.query<Record<string,unknown>>('select * from inspections where id=$1', [inspection.inspectionId])).rows[0]
  assert.equal(stored.client_name, '  Legacy displayed name  ')
  assert.equal(stored.client_contact, '0701234567 | legacy@example.test')
  assert.equal(stored.customer_email, 'legacy@example.test')
  assert.equal(stored.customer_address, 'Approved customer address')
  const audit = (await db.query<{value:{preservedCustomerFallback:boolean;storedCustomerBefore:Record<string,unknown>;storedCustomerAfter:Record<string,unknown>}}>(
    `select snapshot->'_reconciliation' as value from ob_assignment_workflow_events where inspection_id=$1 and event_type='reviewed'`, [inspection.inspectionId])).rows[0].value
  assert.equal(audit.preservedCustomerFallback, true)
  assert.equal(audit.storedCustomerBefore.customer_email, null)
  assert.equal(audit.storedCustomerAfter.customer_email, 'legacy@example.test')
})

test('phone/email import retains the unselected effective legacy contact without filling unrelated structured fields', async () => {
  for (const selected of ['customer_phone', 'customer_email']) {
    const { a, inspection } = await approvedEarly()
    await db.query(`update assignments set customer_email='new@example.test' where id=$1`, [a.id])
    // Nonempty structured name means the assignment fallback block is inactive.
    await db.query(`update inspections set customer_email=null,customer_phone=null,
      client_contact='0701112233 | OLD@EXAMPLE.TEST' where id=$1`, [inspection.inspectionId])
    const before = await reconciliationState(inspection.inspectionId)
    const after = await reconcile(inspection.inspectionId, [selected], { state: before })
    const untouched = selected === 'customer_phone' ? 'customer_email' : 'customer_phone'
    assert.equal(after.inspectionSnapshot?.[untouched], before.inspectionSnapshot?.[untouched])
    const stored = (await db.query<Record<string,unknown>>('select customer_email,customer_phone,client_contact from inspections where id=$1', [inspection.inspectionId])).rows[0]
    assert.equal(stored[untouched], null)
    assert.equal(stored.client_contact, selected === 'customer_phone' ? '0701234567 | old@example.test' : '0701112233 | new@example.test')
  }
})

test('shared property fallback changes invalidate the displayed token without allowing shared property writes', async () => {
  const { inspection } = await approvedEarly()
  await db.query(`update ob_property_snapshot set address=null where inspection_id=$1`, [inspection.inspectionId])
  await db.query(`update properties set address='Displayed old address' where id=$1`, [inspection.propertyId])
  const before = await reconciliationState(inspection.inspectionId)
  assert.equal(before.inspectionSnapshot?.property_address, 'Displayed old address')
  await db.query(`update properties set address='Changed in another view' where id=$1`, [inspection.propertyId])
  await assert.rejects(reconcile(inspection.inspectionId, ['property_address'], { state: before }), /OB_RECONCILIATION_CHANGED/)
  const after = await reconcile(inspection.inspectionId, ['property_address'])
  assert.equal(after.inspectionSnapshot?.property_address, 'Test street')
  assert.equal((await db.query<{address:string}>('select address from properties where id=$1', [inspection.propertyId])).rows[0].address, 'Changed in another view')
})

test('date import uses the normal per-day number sequence and keeps an already matching identifier', async () => {
  const { a, inspection } = await approvedEarly()
  await db.query(`insert into inspections(property_id,type,inspection_family,date,assignment_number,status)
    values($1,'OB','OB','2026-10-15','2026-1015-07','draft')`, [inspection.propertyId])
  await db.query(`update assignments set preferred_date='2026-10-15' where id=$1`, [a.id])
  const after = await reconcile(inspection.inspectionId, ['preferred_date'])
  assert.equal(after.inspectionSnapshot?.preferred_date, '2026-10-15')
  assert.equal(after.inspectionSnapshot?.assignment_number, '2026-1015-08')
  assert.equal((await reconcile(inspection.inspectionId, ['preferred_date'])).inspectionSnapshot?.assignment_number, '2026-1015-08')
  const previous = await reconciliationState(inspection.inspectionId)
  await db.query(`update inspections set assignment_number='2026-1015-09' where id=$1`, [inspection.inspectionId])
  await assert.rejects(reconcile(inspection.inspectionId, ['customer_phone'], { state: previous }), /OB_RECONCILIATION_CHANGED/)
})
