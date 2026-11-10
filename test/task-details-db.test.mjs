import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
const db = new PGlite(), org = randomUUID(), issuer = randomUUID(), recipient = randomUUID(), other = randomUUID(), contact = randomUUID(), contact2 = randomUUID(), identity = randomUUID(), identity2 = randomUUID()
const sql = name => readFileSync(new URL(`../docs/db/${name}.sql`, import.meta.url), 'utf8').replace(/\r/g, '')
const foundation = sql('2026-08-20_01_operational_tasks_foundation'), identities = sql('2026-08-22_01_task_recipient_portal_identity'), migration = sql('2026-11-10_01_task_details_editing')
const table = name => { const start = foundation.indexOf(`create table if not exists public.${name} (`); assert.ok(start >= 0); return foundation.slice(start, foundation.indexOf('\n);', start) + 3) }
const fn = (source, name) => { const start = source.indexOf(`create or replace function public.${name}(`); assert.ok(start >= 0); return source.slice(start, source.indexOf('\n$$;', start) + 4) }
before(async () => {
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;
    create function auth.role() returns text language sql as $$select coalesce(current_setting('test.auth_role',true),'service_role')$$;
    create table organizations(id uuid primary key);create table profiles(id uuid primary key,full_name text,email text);
    create table org_members(org_id uuid,profile_id uuid,is_active boolean,role text default 'member',module_access boolean default true);
    create table organization_contacts(id uuid primary key,org_id uuid,name text,email text,phone text,whatsapp_number text,is_active boolean,recipient_identity_id uuid);
    create table task_access_links(id uuid primary key default gen_random_uuid(),task_id uuid,revoked_at timestamptz);
    create table task_messages(id uuid primary key);
    create table task_recipient_identities(id uuid primary key,status text);
    create table task_recipient_portal_grants(recipient_identity_id uuid,org_id uuid,contact_id uuid,task_id uuid,grant_role text,revoked_at timestamptz,revocation_reason text,granted_at timestamptz default now(),updated_at timestamptz,unique(task_id,recipient_identity_id,contact_id));
    create table task_recipient_activation_tokens(task_id uuid,consumed_at timestamptz,revoked_at timestamptz);
    create table task_recurrence_rules(task_id uuid,is_active boolean);
    create function task_profile_has_module_access(uuid,uuid) returns boolean language sql as $$select exists(select 1 from org_members where org_id=$1 and profile_id=$2 and is_active and module_access)$$;`)
  for (const name of ['operational_tasks', 'task_events', 'task_followup_rules', 'task_message_deliveries', 'task_automation_jobs', 'task_deadline_change_requests']) await db.exec(table(name))
  await db.exec("alter table task_message_deliveries drop constraint task_message_deliveries_status_check;alter table task_message_deliveries add constraint task_message_deliveries_status_check check(status in ('queued','sending','sent','delivered','read','replied','failed','cancelled','ambiguous'));")
  await db.exec(`alter table operational_tasks add column due_timezone text default 'Europe/Stockholm';alter table task_followup_rules add column initial_dispatch_pending boolean default false;
    create unique index fixture_jobs on task_automation_jobs(org_id,idempotency_key);`)
  await db.exec(fn(foundation, 'operational_task_set_updated_at_and_version'))
  await db.exec(fn(foundation, 'touch_operational_task_from_event'))
  await db.exec(fn(identities, 'sync_task_recipient_grant_for_task'))
  await db.exec(sql('2026-10-30_02_undated_personal_tasks'))
  await db.exec(`create trigger real_version before update on operational_tasks for each row execute function operational_task_set_updated_at_and_version();
    create trigger real_event after insert on task_events for each row execute function touch_operational_task_from_event();
    create trigger real_grants after insert or update of assignee_contact_id on operational_tasks for each row execute function sync_task_recipient_grant_for_task();
    create trigger real_followup after insert or update of status,due_at,next_followup_at,last_activity_at,archived_at on operational_tasks for each row execute function sync_operational_task_followup_job();`)
  await db.query('insert into organizations values($1)', [org])
  await db.query("insert into profiles values($1,'Anna Exempel','anna@example.test'),($2,'Bo Exempel','bo@example.test'),($3,'Cia Exempel','cia@example.test')", [issuer, recipient, other])
  await db.query('insert into org_members(org_id,profile_id,is_active) values($1,$2,true),($1,$3,true),($1,$4,true)', [org,issuer,recipient,other])
  await db.query("insert into task_recipient_identities values($1,'active'),($2,'active')", [identity, identity2])
  await db.query("insert into organization_contacts values($1,$2,'Extern A','a@example.test',null,null,true,$3),($4,$2,'Extern B','b@example.test',null,null,true,$5)", [contact,org,identity,contact2,identity2])
  await db.exec(migration)
})
after(() => db.close())
const read = async id => (await db.query('select * from operational_tasks where id=$1', [id])).rows[0]
const create = async (external = false) => { const id = randomUUID(); await db.query(`insert into operational_tasks(id,org_id,root_task_id,issuer_profile_id,assignee_profile_id,assignee_contact_id,title,description,context_label,status,due_at,next_followup_at,created_source) values($1,$2,$1,$3,$4,$5,'Fiktiv uppgift','Omfattning','Testprojekt','in_progress','2030-01-20','2030-01-19','manual')`, [id,org,issuer,external ? null : recipient,external ? contact : null]); return read(id) }
const changes = t => ({ title: t.title, description: t.description, contextLabel: t.context_label, assigneeProfileId: t.assignee_profile_id, assigneeContactId: t.assignee_contact_id, dueAt: t.due_at, nextFollowupAt: t.next_followup_at, primaryChannel: t.primary_channel, fallbackChannel: t.fallback_channel })
const edit = async (t, patch = {}, confirm = false, actor = issuer, organization = org) => (await db.query('select to_jsonb(edit_operational_task_details($1,$2,$3,$4,$5,$6)) task', [organization,t.id,actor,t.version,JSON.stringify({ ...changes(t), ...patch }),confirm])).rows[0].task
const send = async (t, actor = issuer) => (await db.query('select dispatch_internal_task_reassignment($1,$2,$3) sent', [org,t.id,actor])).rows[0].sent

test('metadata edits preserve status, identity, requirements and no-op version; audit records before and after', async () => {
  const t = await create(), updated = await edit(t, { title: 'Ny rubrik', description: 'Ny beskrivning' })
  assert.equal(updated.status, t.status); assert.equal(updated.assignee_profile_id, t.assignee_profile_id); assert.equal(updated.version, t.version + 1)
  assert.deepEqual(await edit(updated), updated)
  const e = (await db.query("select * from task_events where task_id=$1 and event_type='task_details_changed'", [t.id])).rows[0]
  assert.equal(e.metadata.before.title, t.title); assert.equal(e.metadata.after.title, 'Ny rubrik'); assert.equal(e.actor_profile_id, issuer)
  assert.equal((await db.query("select count(*) n from task_events where task_id=$1 and event_type='comment'", [t.id])).rows[0].n, 0)
})
test('external reassignment revokes old credentials and defers even the trigger-created new portal grant', async () => {
  const t = await create(true)
  await db.query('insert into task_access_links(task_id) values($1)', [t.id])
  await db.query('insert into task_recipient_activation_tokens(task_id) values($1)', [t.id])
  await assert.rejects(edit(t, { assigneeContactId: contact2 }), /CONFIRM_RECIPIENT/)
  const updated = await edit(t, { assigneeContactId: contact2 }, true)
  assert.equal(updated.status, t.status); assert.equal(updated.assignee_contact_id, contact2)
  assert.equal((await db.query('select count(*) n from task_access_links where task_id=$1 and revoked_at is null', [t.id])).rows[0].n, 0)
  assert.equal((await db.query('select count(*) n from task_recipient_portal_grants where task_id=$1 and revoked_at is null', [t.id])).rows[0].n, 0)
  assert.equal((await db.query('select count(*) n from task_recipient_activation_tokens where task_id=$1 and revoked_at is null', [t.id])).rows[0].n, 0)
  const rule = (await db.query('select * from task_followup_rules where task_id=$1', [t.id])).rows[0]
  assert.equal(rule.is_active, false); assert.equal(rule.initial_dispatch_pending, true)
  assert.equal((await db.query("select count(*) n from task_automation_jobs where task_id=$1 and status in ('queued','processing','failed')", [t.id])).rows[0].n, 0)
  assert.equal((await db.query("select count(*) n from task_events where task_id=$1 and event_type='comment'", [t.id])).rows[0].n, 0)
})
test('internal reassignment notifies only after explicit send, retries are idempotent, status stays in progress', async () => {
  const t = await create(), u = await edit(t, { assigneeProfileId: other }, true)
  assert.equal((await db.query("select count(*) n from task_events where task_id=$1 and event_type='comment'", [t.id])).rows[0].n, 0)
  assert.equal(await send(u), true); assert.equal(await send(u), true)
  const messages = (await db.query("select * from task_events where task_id=$1 and event_type='comment'", [t.id])).rows
  assert.equal(messages.length, 1); assert.ok(messages[0].metadata.reassignmentEventId)
  const latest = await read(t.id); assert.equal(latest.status, 'in_progress'); assert.equal(latest.version, u.version)
  assert.equal((await db.query('select initial_dispatch_pending from task_followup_rules where task_id=$1', [t.id])).rows[0].initial_dispatch_pending, false)
})
test('stale writes, wrong tenant, non-issuer, managed/closed tasks and invalid schedules are rejected', async () => {
  const t = await create()
  await assert.rejects(edit(t, { title: 'Otillaten' }, false, recipient), /FORBIDDEN/)
  await assert.rejects(edit(t, {}, false, issuer, randomUUID()), /NOT_FOUND/)
  await assert.rejects(edit({ ...t, version: 999 }, {}), /VERSION_CONFLICT/)
  await assert.rejects(edit(t, { status: 'approved' }), /INPUT_INVALID/)
  await assert.rejects(edit(t, { dueAt: null, nextFollowupAt: null }), /DUE_REQUIRED/)
  await assert.rejects(edit(t, { nextFollowupAt: '2031-01-01' }), /FOLLOWUP_INVALID/)
  await db.query("update operational_tasks set created_source='system' where id=$1", [t.id])
  await assert.rejects(edit(await read(t.id), { title: 'x' }), /MANAGED/)
  await db.query("update operational_tasks set created_source='manual',status='cancelled' where id=$1", [t.id])
  await assert.rejects(edit(await read(t.id), { title: 'x' }), /TERMINAL/)
  for (const role of ['anon', 'authenticated']) assert.equal((await db.query("select has_function_privilege($1,'edit_operational_task_details(uuid,uuid,uuid,integer,jsonb,boolean)','execute') allowed", [role])).rows[0].allowed, false)
})
test('an audit failure rolls back reassignment and access revocation; migration is rerunnable without data writes', async () => {
  const t = await create(true)
  await db.query('insert into task_access_links(task_id) values($1)', [t.id])
  await db.exec("create function fail_details_audit() returns trigger language plpgsql as $$begin if new.event_type='task_recipient_changed' then raise exception 'TEST_AUDIT_FAILURE'; end if;return new;end$$;create trigger fail_details_audit before insert on task_events for each row execute function fail_details_audit();")
  await assert.rejects(edit(t, { assigneeContactId: contact2 }, true), /TEST_AUDIT_FAILURE/)
  assert.deepEqual(await read(t.id), t)
  assert.equal((await db.query('select count(*) n from task_access_links where task_id=$1 and revoked_at is null', [t.id])).rows[0].n, 1)
  await db.exec('drop trigger fail_details_audit on task_events')
  const before = (await db.query('select * from operational_tasks order by id')).rows
  await db.exec(migration)
  assert.deepEqual((await db.query('select * from operational_tasks order by id')).rows, before)
})

test('module access, hierarchy, pending decisions and recurrence remain enforced', async () => {
  let t = await create()
  await db.query('update org_members set module_access=false where profile_id=$1', [issuer])
  await assert.rejects(edit(t, { title: 'x' }), /FORBIDDEN/)
  await assert.rejects(send(t), /FORBIDDEN/)
  await db.query('update org_members set module_access=true where profile_id=$1', [issuer])
  await db.query('update org_members set module_access=false where profile_id=$1', [other])
  await assert.rejects(edit(t, { assigneeProfileId: other }, true), /TASK_ACCESS_REQUIRED/)
  await db.query('update org_members set module_access=true where profile_id=$1', [other])
  await db.query('insert into task_recurrence_rules values($1,true)', [t.id])
  await assert.rejects(edit(t, { dueAt: '2030-02-01' }), /RECURRENCE/)
  await edit(t, { title: 'Text kan fortfarande redigeras' })
  t = await create()
  const child = await create()
  await db.query('update operational_tasks set parent_task_id=$1,root_task_id=$1,depth=1 where id=$2', [t.id,child.id])
  await assert.rejects(edit(await read(child.id), { dueAt: '2030-02-01' }), /CHILD_AFTER_PARENT/)
  await assert.rejects(edit(t, { dueAt: '2030-01-19' }), /PARENT_DUE_BEFORE_CHILD/)
  await db.query("insert into task_deadline_change_requests(org_id,task_id,requested_by_profile_id,current_due_at,requested_due_at,reason) values($1,$2,$3,'2030-01-20','2030-02-01','Fiktivt skäl')", [org,t.id,recipient])
  await assert.rejects(edit(t, { assigneeProfileId: other }, true), /PENDING_REQUEST/)
  const saved = await edit(t, { description: 'Ofarlig textredigering' })
  assert.equal(saved.status, t.status)
})

test('an in-flight or uncertain delivery cannot be cancelled by a recipient change', async () => {
  const t = await create()
  // Simulate a delivery whose provider outcome has not yet been reconciled.
  await db.exec('alter table task_message_deliveries disable trigger all')
  const message = randomUUID()
  await db.query('insert into task_messages values($1)', [message])
  await db.query("insert into task_message_deliveries(org_id,task_id,message_id,channel,recipient_address,status,idempotency_key) values($1,$2,$3,'email','bo@example.test','sending',$4)", [org,t.id,message,randomUUID()])
  await assert.rejects(edit(t, { assigneeProfileId: other }, true), /DELIVERY_PENDING/)
  assert.deepEqual(await read(t.id), t)
  await db.query("update task_message_deliveries set status='ambiguous' where task_id=$1", [t.id])
  await assert.rejects(edit(t, { assigneeProfileId: other }, true), /DELIVERY_PENDING/)
  await db.exec('alter table task_message_deliveries enable trigger all')
})
