import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'

const sql = (file: string) => readFileSync(new URL(`../docs/db/${file}`, import.meta.url), 'utf8').replace(/^\uFEFF/u, '')
const migration = sql('2026-11-10_01_tu_investigation_billing.sql')
const db = new PGlite()
const org = randomUUID(), otherOrg = randomUUID(), actor = randomUUID(), colleague = randomUUID()
type Billing = { status: string; invoiceNumber: string | null; invoicedAt: string | null; revision: number;
  updatedAt: string | null; updatedByName: string | null }

async function role<T>(name: 'authenticated' | 'anon' | 'service_role', callback: () => Promise<T>) {
  await db.exec(`set role ${name}`)
  try { return await callback() } finally { await db.exec('reset role') }
}
async function grant(profile = actor, target: string | null = org, module = 'technical_investigations', active = true,
  expires: string | null = null, source = 'organization_administration') {
  return (await db.query<{ id: string }>(`insert into platform_access_assignments
    (profile_id,product_id,module_id,scope_type,scope_id,is_active,expires_at,source_system)
    select $1,p.id,m.id,$2,$3,$4,$5,$6 from platform_products p join platform_modules m on m.product_id=p.id
    where p.key='dashboard' and m.key=$7 returning id`, [profile, target ? 'organization' : 'global', target, active, expires, source, module])).rows[0].id
}
async function member(legacyAdmin = false, name = 'Annan medlem') {
  const id = randomUUID()
  await db.query('insert into profiles(id,full_name,is_admin) values($1,$2,$3)', [id, name, legacyAdmin])
  await db.query("insert into org_members(org_id,profile_id,role,is_active) values($1,$2,'inspector',true),($3,$2,'inspector',true)", [org, id, otherOrg])
  return id
}
async function investigation(target = org, locked = false, family = 'TU') {
  const id = randomUUID()
  await db.query('insert into inspections(id,inspection_family,type,status) values($1,$2,$2,$3)', [id, family, locked ? 'completed' : 'ongoing'])
  await db.query("insert into technical_investigation_details(inspection_id,org_id,created_by,report_draft,report_locked_at) values($1,$2,$3,'{\"original\":\"frozen-report\"}',$4)",
    [id, target, actor, locked ? '2026-11-01T10:00:00Z' : null])
  if (locked) await db.query("update inspections set locked_at='2026-11-01T10:00:00Z',locked_by=$2 where id=$1", [id, actor])
  await db.query("insert into inspection_report_links(inspection_id,snapshot_payload) values($1,'{\"published\":\"unchanged\"}')", [id])
  return id
}
async function save(id: string, flag: boolean, number: string | null, revision: number, target = org, profile = actor) {
  return role('service_role', async () => (await db.query<{ value: Billing }>(
    'select tu_set_investigation_billing($1,$2,$3,$4,$5,$6) value', [target, id, profile, flag, number, revision],
  )).rows[0].value)
}

before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid',true),'')::uuid $$;
    create table profiles(id uuid primary key,full_name text,is_admin boolean default false);
    create table organizations(id uuid primary key);
    create table org_members(org_id uuid references organizations(id),profile_id uuid references profiles(id),role text,is_active boolean,
      primary key(org_id,profile_id));
    create table properties(id uuid primary key);
    create table assignments(id uuid primary key);
    create table inspections(id uuid primary key,inspection_family text,type text,status text,locked_at timestamptz,locked_by uuid,updated_at timestamptz);
    create table inspection_report_links(id uuid primary key default gen_random_uuid(),inspection_id uuid,snapshot_payload jsonb);
    create table platform_products(id uuid primary key default gen_random_uuid(),key text unique);
    create table platform_modules(id uuid primary key default gen_random_uuid(),product_id uuid references platform_products(id),key text);
    create table platform_access_assignments(id uuid primary key default gen_random_uuid(),profile_id uuid references profiles(id),product_id uuid references platform_products(id),
      module_id uuid references platform_modules(id),scope_type text,scope_id text,is_active boolean,expires_at timestamptz,source_system text);
    create table organization_enabled_modules(org_id uuid,module_key text,is_active boolean,primary key(org_id,module_key));
    insert into platform_products(key) values('dashboard');
    insert into platform_modules(product_id,key) select id,'technical_investigations' from platform_products;
    insert into platform_modules(product_id,key) select id,'inspections' from platform_products;
    insert into platform_modules(product_id,key) select id,'admin' from platform_products;`)
  const orgFoundation = sql('2026-02-20_01_assignments_org_foundation.sql')
  await db.exec(orgFoundation.slice(orgFoundation.indexOf('create or replace function public.is_org_member('),
    orgFoundation.indexOf('-- Seed:')))
  const foundation = sql('2026-05-27_01_tu_module_foundation.sql')
  await db.exec(foundation.slice(foundation.indexOf('create table if not exists public.technical_investigation_details'),
    foundation.indexOf('create or replace function public.consume_assignment_token(')))
  await db.exec(sql('2026-03-24_03_inspection_lock_write_guards.sql'))
  await db.exec(sql('2026-05-30_02_tu_report_lock_guards.sql'))
  await db.query('insert into organizations values($1),($2)', [org, otherOrg])
  await db.query("insert into profiles(id,full_name,is_admin) values($1,'Testutredare',false),($2,'Behörig kollega',false)", [actor, colleague])
  await db.query("insert into org_members values($1,$2,'inspector',true),($3,$2,'inspector',true),($1,$4,'inspector',true)", [org, actor, otherOrg, colleague])
  await grant(); await grant(actor, otherOrg); await grant(colleague)
  await db.exec(migration); await db.exec(migration)
})
after(async () => { await db.close() })

test('TU billing migration is repeatable, all tables are private and service writes must use the audited RPC', async () => {
  const privileges = (await db.query(`select
    has_table_privilege('authenticated','tu_investigation_billing','SELECT') client_read,
    has_table_privilege('anon','tu_investigation_billing_events','SELECT') anon_read,
    has_table_privilege('service_role','tu_investigation_billing','SELECT') service_read,
    has_table_privilege('service_role','tu_investigation_billing','UPDATE') service_write,
    has_table_privilege('service_role','tu_investigation_billing_events','INSERT') service_audit,
    has_function_privilege('authenticated','tu_set_investigation_billing(uuid,uuid,uuid,boolean,text,integer)','EXECUTE') client_rpc,
    has_function_privilege('service_role','tu_set_investigation_billing(uuid,uuid,uuid,boolean,text,integer)','EXECUTE') service_rpc,
    has_function_privilege('service_role','tu_billing_actor_has_access(uuid,uuid)','EXECUTE') private_helper`)).rows[0]
  assert.deepEqual(privileges, { client_read: false, anon_read: false, service_read: true, service_write: false,
    service_audit: false, client_rpc: false, service_rpc: true, private_helper: false })
  assert.equal((await db.query<{ count: number }>('select count(*) count from tu_investigation_billing')).rows[0].count, 0)
  await assert.rejects(role('authenticated', () => db.query('select * from tu_investigation_billing')), /permission denied/)
  await assert.rejects(role('service_role', () => db.query('delete from tu_investigation_billing')), /permission denied/)
})

test('locked reports remain byte-for-byte unchanged while a different authorized TU org member marks/corrects/resets invoicing', async () => {
  const id = await investigation(org, true)
  const original = (await db.query(`select to_jsonb(d) detail,to_jsonb(i) inspection,l.snapshot_payload from technical_investigation_details d
    join inspections i on i.id=d.inspection_id join inspection_report_links l on l.inspection_id=i.id where i.id=$1`, [id])).rows
  const first = await save(id, true, ' F-101 ', 0, org, colleague)
  assert.equal(first.status, 'invoiced'); assert.equal(first.invoiceNumber, 'F-101'); assert.equal(first.revision, 1)
  assert.equal(first.updatedByName, 'Behörig kollega'); assert.ok(first.invoicedAt)
  const corrected = await save(id, true, 'F-102', 1)
  assert.equal(corrected.invoicedAt, first.invoicedAt); assert.equal(corrected.revision, 2)
  const reset = await save(id, false, 'F-102', 2)
  assert.equal(reset.status, 'not_invoiced'); assert.equal(reset.invoicedAt, null); assert.equal(reset.invoiceNumber, 'F-102')
  assert.equal((await save(id, false, null, 3)).invoiceNumber, null)
  const events = (await db.query<{ previous_state: { isInvoiced: boolean }; new_state: { isInvoiced: boolean } }>(
    'select previous_state,new_state from tu_investigation_billing_events where inspection_id=$1 order by revision', [id])).rows
  assert.equal(events.length, 4); assert.equal(events[2].previous_state.isInvoiced, true); assert.equal(events[2].new_state.isInvoiced, false)
  assert.deepEqual((await db.query(`select to_jsonb(d) detail,to_jsonb(i) inspection,l.snapshot_payload from technical_investigation_details d
    join inspections i on i.id=d.inspection_id join inspection_report_links l on l.inspection_id=i.id where i.id=$1`, [id])).rows, original)
  await assert.rejects(db.query("update technical_investigation_details set title='cannot change report' where inspection_id=$1", [id]), /låst/i)
})

test('no-op and stale revisions preserve current data; billing audit failure rolls back the complete transaction', async () => {
  const id = await investigation()
  const empty = await save(id, false, null, 0)
  assert.equal(empty.revision, 0); assert.equal(empty.updatedAt, null)
  assert.equal((await db.query('select * from tu_investigation_billing where inspection_id=$1', [id])).rows.length, 0)
  const first = await save(id, true, 'F-1', 0)
  assert.deepEqual(await save(id, true, 'F-1', 1), first)
  await assert.rejects(save(id, false, null, 0), /TU_BILLING_CONFLICT/)
  await db.exec(`create function reject_tu_billing_audit() returns trigger language plpgsql as $$ begin raise exception 'TEST_AUDIT_FAILURE'; end $$;
    create trigger reject_tu_billing_audit before insert on tu_investigation_billing_events for each row execute function reject_tu_billing_audit();`)
  await assert.rejects(save(id, false, 'F-2', 1), /TEST_AUDIT_FAILURE/)
  await db.exec('drop trigger reject_tu_billing_audit on tu_investigation_billing_events; drop function reject_tu_billing_audit();')
  assert.deepEqual(await save(id, true, 'F-1', 1), first)
  assert.equal((await db.query('select * from tu_investigation_billing_events where inspection_id=$1', [id])).rows.length, 1)
  assert.equal((await save(id, false, 'F-1', 1)).revision, 2)
})

test('RPC refuses foreign org/family, missing membership, unrelated/other-org/expired grants and invalid input', async () => {
  const id = await investigation(), foreign = await investigation(otherOrg), otherFamily = await investigation(org, false, 'EB')
  await assert.rejects(save(foreign, true, null, 0), /TU_INVESTIGATION_NOT_FOUND/)
  await assert.rejects(save(id, true, null, 0, otherOrg), /TU_INVESTIGATION_NOT_FOUND/)
  await assert.rejects(save(otherFamily, true, null, 0), /TU_INVESTIGATION_NOT_FOUND/)
  const profile = await member(true)
  const grantId = await grant(profile, org, 'admin')
  await assert.rejects(save(id, true, null, 0, org, profile), /TU_BILLING_ACTOR_FORBIDDEN/)
  await db.query('delete from platform_access_assignments where id=$1', [grantId])
  const otherGrant = await grant(profile, otherOrg)
  await assert.rejects(save(id, true, null, 0, org, profile), /TU_BILLING_ACTOR_FORBIDDEN/)
  await db.query('update platform_access_assignments set expires_at=$2 where id=$1', [otherGrant, '2000-01-01T00:00:00Z'])
  await assert.rejects(save(id, true, null, 0, org, profile), /TU_BILLING_ACTOR_FORBIDDEN/)
  await db.query('update org_members set is_active=false where profile_id=$1 and org_id=$2', [actor, org])
  await assert.rejects(save(id, true, null, 0), /TU_BILLING_ACTOR_FORBIDDEN/)
  await db.query('update org_members set is_active=true where profile_id=$1 and org_id=$2', [actor, org])
  for (const [number, revision] of [['x'.repeat(101), 0], ['F\n1', 0], [null, -1]] as const) {
    await assert.rejects(save(id, true, number, revision), /TU_BILLING_INPUT_INVALID/)
  }
})

test('managed entitlement requires scoped TU grant; unmanaged global and narrow legacy admin access match existing TU rules', async () => {
  const id = await investigation()
  const globalUser = await member()
  await grant(globalUser, null, 'technical_investigations', true, null, 'legacy_import')
  assert.equal((await save(id, true, null, 0, org, globalUser)).revision, 1)
  await db.query("insert into organization_enabled_modules values($1,'technical_investigations',true)", [org])
  await assert.rejects(save(id, false, null, 1, org, globalUser), /TU_BILLING_ACTOR_FORBIDDEN/)
  await grant(globalUser)
  assert.equal((await save(id, false, null, 1, org, globalUser)).revision, 2)
  await db.query("update organization_enabled_modules set is_active=false where org_id=$1 and module_key='technical_investigations'", [org])
  await assert.rejects(save(id, true, null, 2), /TU_BILLING_ACTOR_FORBIDDEN/)
  await db.query("delete from organization_enabled_modules where org_id=$1 and module_key='technical_investigations'", [org])
  const legacy = await member(true)
  assert.equal((await save(id, true, null, 2, org, legacy)).revision, 3)
  await grant(legacy, org, 'technical_investigations', false)
  await assert.rejects(save(id, false, null, 3, org, legacy), /TU_BILLING_ACTOR_FORBIDDEN/)
})
