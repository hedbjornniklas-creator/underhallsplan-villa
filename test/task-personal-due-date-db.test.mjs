import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite(), org = randomUUID(), otherOrg = randomUUID(), actor = randomUUID(), other = randomUUID()
const sql = name => readFileSync(new URL(`../docs/db/${name}.sql`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const foundation = sql('2026-08-20_01_operational_tasks_foundation'), recurrence = sql('2026-08-27_06_task_recurrence'), migration = sql('2026-11-09_01_personal_task_due_date')
const table = (source, name) => { const start = source.indexOf(`create table if not exists public.${name} (`); assert.ok(start >= 0); return source.slice(start, source.indexOf('\n);', start) + 3) }
const fn = name => { const start = foundation.indexOf(`create or replace function public.${name}(`); assert.ok(start >= 0); return foundation.slice(start, foundation.indexOf('\n$$;', start) + 4) }
before(async () => {
  await db.exec(`set timezone='UTC'; create role anon; create role authenticated; create role service_role;
    create schema auth; create function auth.role() returns text language sql as $$select coalesce(current_setting('test.auth_role',true),'service_role')$$;
    create table organizations(id uuid primary key); create table profiles(id uuid primary key,full_name text,email text);
    create table org_members(org_id uuid,profile_id uuid,is_active boolean);
    create table organization_contacts(id uuid primary key); create table task_access_links(id uuid primary key,task_id uuid,revoked_at timestamptz);
    create table task_messages(id uuid primary key); create table task_message_deliveries(id uuid primary key);`)
  for (const name of ['operational_tasks', 'task_events', 'task_followup_rules', 'task_automation_jobs', 'task_deadline_change_requests']) await db.exec(table(foundation, name))
  await db.exec(table(recurrence, 'task_recurrence_rules'))
  await db.exec(`alter table operational_tasks add column due_timezone text default 'Europe/Stockholm';
    alter table task_followup_rules add column initial_dispatch_pending boolean not null default false;
    create unique index fixture_job_key on task_automation_jobs(org_id,idempotency_key);`)
  await db.exec(fn('operational_task_set_updated_at_and_version'))
  await db.exec(fn('touch_operational_task_from_event'))
  await db.exec(sql('2026-10-30_02_undated_personal_tasks'))
  await db.exec(`create trigger real_version before update on operational_tasks for each row execute function operational_task_set_updated_at_and_version();
    create trigger real_followup after insert or update of status,due_at,next_followup_at,last_activity_at,archived_at on operational_tasks for each row execute function sync_operational_task_followup_job();
    create trigger real_event after insert on task_events for each row execute function touch_operational_task_from_event();`)
  await db.query('insert into organizations values($1),($2)', [org, otherOrg])
  await db.query("insert into profiles values($1,'Fiktiv person','self@example.test'),($2,'Annan','other@example.test')", [actor, other])
  await db.query('insert into org_members values($1,$2,true),($1,$3,true)', [org, actor, other])
  await db.exec(migration)
})
after(() => db.close())
const create = async () => (await db.query("select to_jsonb(create_undated_personal_task($1,$2,'Fiktiv uppgift',null,null)) task", [org, actor])).rows[0].task
const read = async id => (await db.query('select * from operational_tasks where id=$1', [id])).rows[0]
const edit = async (t, dueAt, who = actor, version = t.version, organization = org) => (await db.query('select to_jsonb(set_personal_task_due_date($1,$2,$3,$4,$5)) task', [organization, t.id, who, version, dueAt])).rows[0].task
const events = async id => (await db.query('select * from task_events where task_id=$1 order by created_at,id', [id])).rows

test('add, move earlier/later, clear, audit and status preserve the task and do not turn on reminders', async () => {
  const t = await create(), d = await edit(t, '2030-01-10T15:00:00Z')
  assert.equal(d.due_at, '2030-01-10T15:00:00+00:00'); assert.equal(d.next_followup_at, d.due_at)
  assert.equal(d.status, t.status); assert.equal(d.version, t.version + 1)
  await assert.rejects(edit(t, '2030-01-11T15:00:00Z'), /VERSION_CONFLICT/)
  const earlier = await edit(d, '2030-01-09T15:00:00Z')
  assert.equal(earlier.next_followup_at, earlier.due_at)
  const later = await edit(earlier, '2030-01-20T15:00:00Z')
  assert.equal(later.next_followup_at, earlier.next_followup_at)
  const cleared = await edit(later, null)
  assert.equal(cleared.due_at, null); assert.equal(cleared.next_followup_at, null)
  assert.equal(cleared.version, t.version + 4)
  assert.equal((await db.query('select is_active from task_followup_rules where task_id=$1', [t.id])).rows[0].is_active, false)
  assert.equal((await db.query("select count(*) n from task_automation_jobs where task_id=$1 and status='queued'", [t.id])).rows[0].n, 0)
  const changes = (await events(t.id)).filter(e => e.event_type === 'due_date_changed')
  assert.equal(changes.length, 4); assert.equal(changes[0].actor_profile_id, actor)
  assert.match(changes[0].message, /2030-01-10 16:00/)
  assert.equal(changes[0].metadata.previousDueAt, null)
  const noChange = await edit(cleared, null)
  assert.deepEqual(noChange, cleared); assert.equal((await events(t.id)).length, 5)
})
test('permissions, stale tabs, terminal/system/delegated data and SQL privileges are enforced', async () => {
  const t = await create()
  await assert.rejects(edit(t, '2030-01-10', other), /FORBIDDEN/)
  await assert.rejects(edit(t, null, actor, 0), /VERSION_REQUIRED/)
  await assert.rejects(edit(t, null, actor, 999), /CONFLICT/)
  await assert.rejects(edit(t, null, actor, t.version, otherOrg), /NOT_FOUND/)
  await assert.rejects(edit(t, 'infinity'), /DUE_REQUIRED/)
  await db.exec("set test.auth_role='authenticated'")
  await assert.rejects(edit(t, null), /FORBIDDEN/)
  await db.exec("set test.auth_role='service_role'")
  await db.query('update org_members set is_active=false where profile_id=$1', [actor])
  await assert.rejects(edit(t, null), /FORBIDDEN/)
  await db.query('update org_members set is_active=true where profile_id=$1', [actor])
  const d = await edit(t, '2030-01-10')
  for (const [change, error] of [["status='cancelled'", /TERMINAL/], ["created_source='system'", /FORBIDDEN/], ["assignee_profile_id='" + other + "'", /FORBIDDEN/]]) {
    await db.query(`update operational_tasks set ${change} where id=$1`, [d.id])
    await assert.rejects(edit(await read(d.id), '2030-01-11'), error)
    await db.query("update operational_tasks set status='assigned',created_source='manual',assignee_profile_id=$2 where id=$1", [d.id, actor])
  }
  for (const role of ['anon', 'authenticated']) assert.equal((await db.query("select has_function_privilege($1,'set_personal_task_due_date(uuid,uuid,uuid,integer,timestamptz)','execute') allowed", [role])).rows[0].allowed, false)
})
test('recurrence, pending decisions, children and status-dependent schedules are not silently changed', async () => {
  const d = await edit(await create(), '2030-01-20')
  await db.query(`insert into task_recurrence_rules(org_id,task_id,series_id,recurrence_interval,anchor_due_at,anchor_followup_at) values($1,$2,$2,'weekly',$3,$3)`, [org,d.id,d.due_at])
  await assert.rejects(edit(d, '2030-01-21'), /RECURRENCE/)
  await db.query('update task_recurrence_rules set is_active=false where task_id=$1', [d.id])
  await db.query(`insert into task_deadline_change_requests(org_id,task_id,current_due_at,requested_due_at,reason,requested_by_profile_id) values($1,$2,$3,'2030-02-01','Fiktiv begaran',$4)`, [org,d.id,d.due_at,actor])
  await assert.rejects(edit(d, '2030-01-21'), /PENDING_REQUEST/)
  await db.query("update task_deadline_change_requests set status='cancelled' where task_id=$1", [d.id])
  const child = randomUUID()
  await db.query(`insert into operational_tasks(id,org_id,root_task_id,parent_task_id,depth,issuer_profile_id,assignee_profile_id,title,due_at,next_followup_at) values($1,$2,$3,$3,1,$4,$4,'Underuppgift','2030-01-19','2030-01-18')`, [child,org,d.id,actor])
  await assert.rejects(edit(d, null), /CHILDREN/)
  await assert.rejects(edit(d, '2030-01-18'), /PARENT_DUE_BEFORE_CHILD/)
  await db.query('update operational_tasks set archived_at=now() where id=$1', [child])
  await db.query("update operational_tasks set status='waiting' where id=$1", [d.id])
  await assert.rejects(edit(await read(d.id), null), /STATUS/)
})
test('audit failure rolls date and queue changes back; migration can run again without data changes', async () => {
  const t = await create(), before = await read(t.id)
  await db.exec(`create function fail_due_audit() returns trigger language plpgsql as $$begin if new.event_type='due_date_changed' then raise exception 'TEST_AUDIT_FAILURE'; end if; return new; end$$;
    create trigger fail_due_audit before insert on task_events for each row execute function fail_due_audit();`)
  await assert.rejects(edit(t, '2030-01-10'), /TEST_AUDIT_FAILURE/)
  assert.deepEqual(await read(t.id), before)
  assert.equal((await db.query('select count(*) n from task_automation_jobs where task_id=$1', [t.id])).rows[0].n, 0)
  await db.exec('drop trigger fail_due_audit on task_events')
  await db.exec(migration)
  assert.deepEqual(await read(t.id), before)
})
