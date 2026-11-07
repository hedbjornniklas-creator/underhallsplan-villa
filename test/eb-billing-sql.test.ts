import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
const org = randomUUID(), otherOrg = randomUUID(), project = randomUUID(), otherProject = randomUUID()
const actor = randomUUID(), outsider = randomUUID()
const migration = readFileSync(new URL('../docs/db/2026-11-07_01_eb_inspection_billing.sql', import.meta.url), 'utf8')

before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create table organizations(id uuid primary key);
    create table profiles(id uuid primary key, full_name text);
    create table org_members(org_id uuid,profile_id uuid,is_active boolean);
    create table eb_projects(id uuid primary key,org_id uuid);
    create table inspections(id uuid primary key,status text,locked_at timestamptz);
    create table eb_inspection_details(inspection_id uuid primary key references inspections(id),org_id uuid,eb_project_id uuid,report_locked_at timestamptz);
    create table inspection_report_links(inspection_id uuid,snapshot_payload jsonb);
  `)
  await db.query('insert into organizations values ($1),($2)', [org, otherOrg])
  await db.query("insert into profiles values ($1,'Testadministratör'),($2,'Utanför organisationen')", [actor, outsider])
  await db.query('insert into org_members values ($1,$2,true),($3,$4,true)', [org, actor, otherOrg, outsider])
  await db.query('insert into eb_projects values ($1,$2),($3,$4)', [project, org, otherProject, otherOrg])
  await db.exec(migration); await db.exec(migration)
})
after(async () => { await db.close() })

async function inspection() {
  const id = randomUUID()
  await db.query("insert into inspections values ($1,'completed','2026-11-01T10:00:00Z')", [id])
  await db.query("insert into eb_inspection_details values ($1,$2,$3,'2026-11-01T10:00:00Z')", [id, org, project])
  await db.query("insert into inspection_report_links values ($1,'{\"frozen\":\"unchanged\"}')", [id])
  return id
}
async function save(id: string, flag: boolean, number: string | null, revision: number, scopeOrg = org, scopeProject = project, profile = actor) {
  const result = await db.query<{ billing: Record<string, unknown> }>('select eb_set_inspection_billing($1,$2,$3,$4,$5,$6,$7) billing',
    [scopeOrg, scopeProject, id, profile, flag, number, revision])
  return result.rows[0].billing
}

test('migration is repeatable, private and audited even when a service client is used', async () => {
  const access = (await db.query(`select
    has_table_privilege('authenticated','eb_inspection_billing','SELECT') auth_read,
    has_table_privilege('anon','eb_inspection_billing_events','SELECT') anon_read,
    has_table_privilege('service_role','eb_inspection_billing','SELECT') server_read,
    has_table_privilege('service_role','eb_inspection_billing','UPDATE') server_write,
    has_table_privilege('service_role','eb_inspection_billing_events','INSERT') server_audit,
    has_function_privilege('authenticated','eb_set_inspection_billing(uuid,uuid,uuid,uuid,boolean,text,integer)','EXECUTE') auth_rpc,
    has_function_privilege('service_role','eb_set_inspection_billing(uuid,uuid,uuid,uuid,boolean,text,integer)','EXECUTE') server_rpc`)).rows[0]
  assert.deepEqual(access, { auth_read: false, anon_read: false, server_read: true,
    server_write: false, server_audit: false, auth_rpc: false, server_rpc: true })
  assert.equal((await db.query<{ n: number }>('select count(*) n from eb_inspection_billing')).rows[0].n, 0)
})

test('marking, invoice correction and reset are independent of locks, status and frozen reports', async () => {
  const id = await inspection()
  const first = await save(id, true, ' F-101 ', 0)
  assert.equal(first.status, 'invoiced'); assert.equal(first.revision, 1)
  assert.equal(first.invoiceNumber, 'F-101'); assert.equal(first.updatedByName, 'Testadministratör')
  assert.ok(first.invoicedAt)
  const corrected = await save(id, true, 'F-102', 1)
  assert.equal(corrected.revision, 2); assert.equal(corrected.invoicedAt, first.invoicedAt)
  const reset = await save(id, false, 'F-102', 2)
  assert.equal(reset.status, 'not_invoiced'); assert.equal(reset.invoicedAt, null)
  assert.equal(reset.invoiceNumber, 'F-102'); assert.equal(reset.revision, 3)
  assert.equal((await save(id, false, null, 3)).invoiceNumber, null)
  const events = (await db.query<{ revision: number; previous_state: Record<string, unknown>; new_state: Record<string, unknown> }>(
    'select revision,previous_state,new_state from eb_inspection_billing_events where inspection_id=$1 order by revision', [id])).rows
  assert.equal(events.length, 4)
  assert.equal(events[2].previous_state.isInvoiced, true)
  assert.equal(events[2].new_state.isInvoiced, false)
  assert.equal(events[3].previous_state.invoiceNumber, 'F-102')
  const original = (await db.query<{ status: string; locked: boolean; report_locked: boolean; snapshot_payload: unknown }>(
    'select i.status,i.locked_at is not null locked,d.report_locked_at is not null report_locked,l.snapshot_payload from inspections i join eb_inspection_details d on d.inspection_id=i.id join inspection_report_links l on l.inspection_id=i.id where i.id=$1', [id])).rows[0]
  assert.deepEqual(original, { status: 'completed', locked: true, report_locked: true, snapshot_payload: { frozen: 'unchanged' } })
})

test('unchanged saves do not create rows/audit and stale revisions cannot overwrite newer writes', async () => {
  const id = await inspection()
  const empty = await save(id, false, null, 0)
  assert.equal(empty.revision, 0); assert.equal(empty.updatedAt, null)
  assert.equal((await db.query('select * from eb_inspection_billing where inspection_id=$1', [id])).rows.length, 0)
  const first = await save(id, true, null, 0)
  assert.deepEqual(await save(id, true, null, 1), first)
  await assert.rejects(save(id, false, null, 0), /EB_BILLING_CONFLICT/)
  await assert.rejects(save(id, true, null, 0), /EB_BILLING_CONFLICT/)
  assert.equal((await db.query('select * from eb_inspection_billing_events where inspection_id=$1', [id])).rows.length, 1)
})

test('scope, active membership and input validation fail closed without any audit or marker write', async () => {
  const id = await inspection()
  for (const [scopeOrg, scopeProject, profile, number, expected, message] of [
    [otherOrg, project, outsider, null, 0, /EB_INSPECTION_NOT_FOUND/],
    [org, otherProject, actor, null, 0, /EB_INSPECTION_NOT_FOUND/],
    [org, project, outsider, null, 0, /EB_BILLING_ACTOR_FORBIDDEN/],
    [org, project, actor, 'x'.repeat(101), 0, /EB_BILLING_INPUT_INVALID/],
    [org, project, actor, 'X\nY', 0, /EB_BILLING_INPUT_INVALID/],
    [org, project, actor, null, -1, /EB_BILLING_INPUT_INVALID/],
  ] as const) await assert.rejects(save(id, true, number, expected, scopeOrg, scopeProject, profile), message)
  await db.query('update org_members set is_active=false where profile_id=$1', [actor])
  await assert.rejects(save(id, true, null, 0), /EB_BILLING_ACTOR_FORBIDDEN/)
  await db.query('update org_members set is_active=true where profile_id=$1', [actor])
  assert.equal((await db.query('select * from eb_inspection_billing where inspection_id=$1', [id])).rows.length, 0)
})

test('failed audit insert rolls back the marker and revision atomically', async () => {
  const id = await inspection()
  await db.exec(`create function reject_billing_event() returns trigger language plpgsql as $$ begin raise exception 'AUDIT_TEST_FAILURE'; end $$;
    create trigger reject_billing_event before insert on eb_inspection_billing_events for each row execute function reject_billing_event();`)
  await assert.rejects(save(id, true, 'F-FAIL', 0), /AUDIT_TEST_FAILURE/)
  await db.exec('drop trigger reject_billing_event on eb_inspection_billing_events; drop function reject_billing_event();')
  assert.equal((await db.query('select * from eb_inspection_billing where inspection_id=$1', [id])).rows.length, 0)
  assert.equal((await save(id, true, 'F-OK', 0)).revision, 1)
})
