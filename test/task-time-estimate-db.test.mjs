import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite(), org = randomUUID(), anotherOrg = randomUUID(), issuer = randomUUID(), assignee = randomUUID(), admin = randomUUID()
const sql = name => readFileSync(new URL(`../docs/db/${name}.sql`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const foundation = sql('2026-08-20_01_operational_tasks_foundation'), migration = sql('2026-10-30_04_task_time_estimates')
const table = (source, name) => { const start = source.indexOf(`create table if not exists public.${name} (`); assert.ok(start >= 0, name); return source.slice(start, source.indexOf('\n);', start) + 3) }
const fn = (source, name) => { const start = source.indexOf(`create or replace function public.${name}(`); assert.ok(start >= 0, name); return source.slice(start, source.indexOf('\n$$;', start) + 4) }

before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth; create function auth.role() returns text language sql as $$select coalesce(current_setting('test.auth_role',true),'service_role')$$;
    create function auth.uid() returns uuid language sql as $$select null::uuid$$;
    create function has_operational_task_module_access(uuid) returns boolean language sql as $$select false$$;
    create function task_access_link_covers(uuid,uuid,uuid) returns boolean language sql as $$select false$$;
    create table organizations(id uuid primary key); create table profiles(id uuid primary key,full_name text,email text);
    create table org_members(org_id uuid,profile_id uuid,is_active boolean,role text);
    create table organization_contacts(id uuid primary key,org_id uuid,is_active boolean,name text);
    create table task_access_links(id uuid primary key,org_id uuid,task_id uuid,root_task_id uuid,contact_id uuid,scope text,role text,expires_at timestamptz,revoked_at timestamptz);
    create table task_requirement_templates(id uuid primary key); create table task_ai_runs(id uuid primary key);
    create table task_messages(id uuid primary key); create table task_message_deliveries(id uuid primary key);
    create table task_organization_settings(org_id uuid,max_subtask_depth integer,max_open_children_per_task integer,max_active_descendants integer);`)
  for (const name of ['operational_tasks', 'task_events', 'task_attachments', 'task_requirements', 'task_ai_suggestions', 'task_followup_rules', 'task_automation_jobs']) await db.exec(table(foundation, name))
  const evidence = sql('2026-08-24_02_operational_task_evidence_checklist'), recurrence = sql('2026-08-27_06_task_recurrence')
  await db.exec(table(evidence, 'task_completion_evidence_requirements'))
  await db.exec(table(recurrence, 'task_recurrence_rules'))
  await db.exec(`alter table operational_tasks add column due_timezone text default 'Europe/Stockholm';
    alter table task_followup_rules add column initial_dispatch_pending boolean not null default false;
    create unique index fixture_job_key on task_automation_jobs(org_id,idempotency_key);`)
  await db.exec(fn(foundation, 'operational_task_set_updated_at_and_version'))
  await db.exec(fn(foundation, 'validate_task_scoped_record'))
  await db.exec(fn(foundation, 'create_operational_task'))
  await db.exec(fn(sql('2026-08-20_02_operational_task_initial_attachments'), 'create_operational_task_with_dispatch_control'))
  await db.exec(fn(evidence, 'create_operational_task_with_dispatch_control'))
  await db.exec(fn(recurrence, 'create_operational_task_with_recurrence'))
  await db.exec(sql('2026-10-30_02_undated_personal_tasks'))
  await db.exec(`create trigger task_version before update on operational_tasks for each row execute function operational_task_set_updated_at_and_version();
    create trigger task_followup after insert or update of status,due_at,next_followup_at,last_activity_at,archived_at
    on operational_tasks for each row execute function sync_operational_task_followup_job();`)
  await db.query('insert into organizations values($1),($2)', [org, anotherOrg])
  for (const [id, role] of [[issuer, 'member'], [assignee, 'member'], [admin, 'admin']]) {
    await db.query("insert into profiles values($1,'Fiktiv person','fiktiv@example.test')", [id])
    await db.query('insert into org_members values($1,$2,true,$3)', [org, id, role])
  }
  await db.exec(migration)
})
after(() => db.close())

const create = async (minutes = 5, dated = false, patch = {}) => {
  const args = { p_title: 'Fiktiv uppskattad uppgift', p_description: 'Ingen verklig uppgift', p_context_label: null,
    p_due_at: '2030-01-10T12:00:00Z', p_next_followup_at: '2030-01-09T12:00:00Z', p_primary_channel: 'email',
    p_task_kind: 'simple', p_evidence_requirement: 'optional', p_evidence_requirements: [], p_requirements: [],
    p_assignee_profile_id: assignee, p_defer_initial_dispatch: false, ...patch }
  return (await db.query('select to_jsonb(create_task_with_time_estimate($1,$2,$3,$4,$5)) task', [org, issuer, minutes, !dated, args])).rows[0].task
}
const edit = async (t, minutes, version = 0, actor = issuer, taskVersion = t.version, organization = org) =>
  (await db.query('select to_jsonb(set_task_time_estimate($1,$2,$3,$4,$5,$6)) estimate', [organization,t.id,actor,taskVersion,version,minutes])).rows[0].estimate
const snapshot = async id => Object.fromEntries(await Promise.all(['operational_tasks','task_events','task_followup_rules','task_automation_jobs'].map(async name => [name,(await db.query(`select to_jsonb(t) value from ${name} t where ${name === 'operational_tasks' ? 'id' : 'task_id'}=$1 order by id`, [id])).rows])))

test('atomic undated and dated creation use the real creators, evidence checklist and follow-up rules', async () => {
  const own = await create(5)
  assert.equal(own.due_at, null); assert.equal(own.next_followup_at, null)
  assert.equal(own.assignee_profile_id, issuer)
  assert.equal((await db.query('select estimated_minutes from task_time_estimates where task_id=$1', [own.id])).rows[0].estimated_minutes, 5)
  assert.equal((await db.query('select count(*) n from task_automation_jobs where task_id=$1', [own.id])).rows[0].n, 0)
  const dated = await create(15, true, { p_evidence_requirement: 'document', p_evidence_requirements: ['document'], p_recurrence_interval: 'weekly' })
  assert.equal(dated.assignee_profile_id, assignee)
  assert.equal(dated.issuer_profile_id, issuer)
  assert.equal((await db.query('select evidence_type from task_completion_evidence_requirements where task_id=$1', [dated.id])).rows[0].evidence_type, 'document')
  assert.equal((await db.query('select recurrence_interval from task_recurrence_rules where task_id=$1', [dated.id])).rows[0].recurrence_interval, 'weekly')
  assert.equal((await db.query("select count(*) n from task_automation_jobs where task_id=$1 and status='queued'", [dated.id])).rows[0].n, 1)
})

test('editing and clearing touch only estimate storage, not version, activity, audit or dispatch', async () => {
  const t = await create(10, true), before = await snapshot(t.id)
  const e = await edit(t, 30, 1, assignee)
  assert.equal(e.estimated_minutes, 30); assert.equal(e.version, 2); assert.equal(e.updated_by, assignee)
  assert.deepEqual(await snapshot(t.id), before)
  const cleared = await edit(t, null, 2)
  assert.equal(cleared.estimated_minutes, null); assert.equal(cleared.version, 3)
  const same = await edit(t, null, 3)
  assert.deepEqual(same, cleared)
  assert.deepEqual(await snapshot(t.id), before)
})

test('the first estimate, stale edits, invalid values, tenant and participant permissions are enforced', async () => {
  const t = await create()
  for (const minutes of [0,-1,10081]) await assert.rejects(edit(t,minutes,1), /ESTIMATE_INVALID/)
  await assert.rejects(edit(t,10,0), /ESTIMATE_CONFLICT/)
  await assert.rejects(edit(t,10,1,issuer,999), /VERSION_CONFLICT/)
  await assert.rejects(edit(t,10,1,admin), /FORBIDDEN/)
  await assert.rejects(edit(t,10,1,issuer,t.version,anotherOrg), /NOT_FOUND/)
  await db.query('update org_members set is_active=false where profile_id=$1', [issuer])
  await assert.rejects(edit(t,10,1), /FORBIDDEN/)
  await db.query('update org_members set is_active=true where profile_id=$1', [issuer])
  await db.exec("set test.auth_role='authenticated'")
  await assert.rejects(edit(t,10,1), /FORBIDDEN/)
  await assert.rejects(create(), /FORBIDDEN/)
  await db.exec("set test.auth_role='service_role'")
  await db.query("update operational_tasks set status='cancelled' where id=$1", [t.id])
  await assert.rejects(edit(t,10,1), /TERMINAL/)
  const legacy = (await db.query("select to_jsonb(create_undated_personal_task($1,$2,'Utan tid',null,null)) task", [org,issuer])).rows[0].task
  await edit(legacy,null)
  assert.equal((await db.query('select count(*) n from task_time_estimates where task_id=$1', [legacy.id])).rows[0].n, 0)
  assert.equal((await edit(legacy,7)).version, 1)
})

test('creation rolls back all original writes when the estimate cannot be saved', async () => {
  const counts = async () => (await db.query(`select (select count(*) from operational_tasks) tasks,(select count(*) from task_events) events,
    (select count(*) from task_followup_rules) rules,(select count(*) from task_automation_jobs) jobs,(select count(*) from task_time_estimates) estimates`)).rows[0]
  const before = await counts()
  await db.exec(`create function fail_estimate() returns trigger language plpgsql as $$begin raise exception 'TEST_ESTIMATE_FAILURE'; end$$;
    create trigger fail_estimate before insert on task_time_estimates for each row execute function fail_estimate();`)
  await assert.rejects(create(), /TEST_ESTIMATE_FAILURE/)
  await assert.rejects(create(10,true), /TEST_ESTIMATE_FAILURE/)
  await db.exec('drop trigger fail_estimate on task_time_estimates')
  assert.deepEqual(await counts(), before)
})

test('migration is rerunnable without changing tasks and ordinary roles have no estimate access', async () => {
  const t = await create(), before = await snapshot(t.id)
  await db.exec(migration)
  assert.deepEqual(await snapshot(t.id), before)
  await assert.rejects(db.query('update task_time_estimates set org_id=$2 where task_id=$1', [t.id,anotherOrg]), /ORG_MISMATCH/)
  for (const role of ['anon','authenticated']) {
    assert.equal((await db.query("select has_table_privilege($1,'task_time_estimates','select') allowed", [role])).rows[0].allowed, false)
    for (const signature of ['set_task_time_estimate(uuid,uuid,uuid,integer,integer,integer)','create_task_with_time_estimate(uuid,uuid,integer,boolean,jsonb)'])
      assert.equal((await db.query('select has_function_privilege($1,$2,\'execute\') allowed', [role,signature])).rows[0].allowed, false)
  }
})
