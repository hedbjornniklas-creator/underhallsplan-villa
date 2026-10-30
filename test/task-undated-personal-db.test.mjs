import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite(), org = randomUUID(), actor = randomUUID(), other = randomUUID()
const sql = name => readFileSync(new URL(`../docs/db/${name}.sql`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const foundation = sql('2026-08-20_01_operational_tasks_foundation'), migration = sql('2026-10-30_02_undated_personal_tasks')
const table = name => { const start = foundation.indexOf(`create table if not exists public.${name} (`); assert.ok(start >= 0); return foundation.slice(start, foundation.indexOf('\n);', start) + 3) }
before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth; create function auth.role() returns text language sql as $$select coalesce(current_setting('test.auth_role',true),'service_role')$$;
    create table organizations(id uuid primary key); create table profiles(id uuid primary key,full_name text,email text);
    create table org_members(org_id uuid,profile_id uuid,is_active boolean);
    create table organization_contacts(id uuid primary key); create table task_access_links(id uuid primary key,task_id uuid,revoked_at timestamptz);
    create table task_messages(id uuid primary key); create table task_message_deliveries(id uuid primary key);`)
  for (const name of ['operational_tasks', 'task_events', 'task_followup_rules', 'task_automation_jobs']) await db.exec(table(name))
  await db.exec(`alter table task_followup_rules add column initial_dispatch_pending boolean not null default false;
    create unique index fixture_job_key on task_automation_jobs(org_id,idempotency_key);`)
  await db.exec(migration)
  await db.exec(`create trigger real_followup after insert or update of status,due_at,next_followup_at,last_activity_at,archived_at
    on operational_tasks for each row execute function sync_operational_task_followup_job();`)
  await db.query('insert into organizations values($1)', [org])
  await db.query("insert into profiles values($1,'Fiktiv anvandare','self@example.test'),($2,'Annan','other@example.test')", [actor, other])
  await db.query('insert into org_members values($1,$2,true)', [org, actor])
})
after(() => db.close())
const create = async (who = actor) => (await db.query("select to_jsonb(create_undated_personal_task($1,$2,'Fiktiv odaterad uppgift',null,null)) task", [org, who])).rows[0].task

test('atomic creation preserves real actor, null dates and audit, without reminders or pending dispatch', async () => {
  const task = await create()
  assert.equal(task.due_at, null); assert.equal(task.next_followup_at, null)
  assert.equal(task.status, 'assigned'); assert.equal(task.primary_channel, 'email')
  assert.equal(task.issuer_profile_id, actor); assert.equal(task.assignee_profile_id, actor)
  const [event] = (await db.query('select * from task_events where task_id=$1', [task.id])).rows
  assert.equal(event.actor_profile_id, actor); assert.equal(event.metadata.undatedPersonalTask, true)
  assert.equal((await db.query('select count(*) n from task_automation_jobs where task_id=$1', [task.id])).rows[0].n, 0)
  assert.deepEqual((await db.query('select is_active,initial_dispatch_pending from task_followup_rules where task_id=$1', [task.id])).rows[0], { is_active: false, initial_dispatch_pending: false })
  await db.query("update operational_tasks set status='in_progress' where id=$1", [task.id])
  assert.equal((await db.query('select count(*) n from task_automation_jobs where task_id=$1', [task.id])).rows[0].n, 0)
})

test('only active members through service role may create a personal task', async () => {
  await assert.rejects(create(other), /FORBIDDEN/)
  await db.exec("set test.auth_role='authenticated'")
  await assert.rejects(create(), /FORBIDDEN/)
  await db.exec("set test.auth_role='service_role'")
  for (const role of ['anon', 'authenticated']) assert.equal((await db.query("select has_function_privilege($1,'create_undated_personal_task(uuid,uuid,text,text,text)','execute') allowed", [role])).rows[0].allowed, false)
})

test('table constraint rejects delegated, partial, non-simple and system undated data', async () => {
  const task = await create()
  for (const update of ["assignee_profile_id='"+other+"'", "next_followup_at=now()", "due_at=now()", "task_kind='warranty'", "created_source='system'"]) {
    await assert.rejects(db.query(`update operational_tasks set ${update} where id=$1`, [task.id]), /schedule_check/)
  }
})

test('dated task insertion retains the normal assignment job', async () => {
  const id = randomUUID()
  await db.query(`insert into operational_tasks(id,org_id,root_task_id,issuer_profile_id,assignee_profile_id,title,due_at,next_followup_at)
    values($1,$2,$1,$3,$4,'Fiktiv daterad uppgift',now()+interval '7 days',now()+interval '2 days')`, [id, org, actor, other])
  assert.equal((await db.query('select count(*) n from task_automation_jobs where task_id=$1 and status=\'queued\'', [id])).rows[0].n, 1)
})

test('audit failure rolls creation back, and the migration is rerunnable without rewriting tasks', async () => {
  const count = async () => (await db.query('select count(*) n from operational_tasks')).rows[0].n
  const before = await count()
  await db.exec(`create function fail_audit() returns trigger language plpgsql as $$begin raise exception 'TEST_AUDIT_FAILURE'; end$$;
    create trigger fail_audit before insert on task_events for each row execute function fail_audit();`)
  await assert.rejects(create(), /TEST_AUDIT_FAILURE/)
  assert.equal(await count(), before)
  await db.exec('drop trigger fail_audit on task_events')
  await db.exec(migration)
  assert.equal(await count(), before)
})
