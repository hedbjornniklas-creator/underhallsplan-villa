import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite(), org = randomUUID(), issuer = randomUUID(), assignee = randomUUID(), otherAdmin = randomUUID(), outsideOrg = randomUUID()
const sql = name => readFileSync(new URL(`../docs/db/${name}.sql`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')
const foundation = sql('2026-08-20_01_operational_tasks_foundation'), migration = sql('2026-10-30_01_task_manual_completion')
const table = (source, name) => { const start = source.indexOf(`create table if not exists public.${name} (`); assert.ok(start >= 0); return source.slice(start, source.indexOf('\n);', start) + 3) }
const fn = (source, name) => { const start = source.indexOf(`create or replace function public.${name}(`); assert.ok(start >= 0); return source.slice(start, source.indexOf('\n$$;', start) + 4) }

before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth; create function auth.role() returns text language sql as $$select coalesce(current_setting('test.auth_role',true),'service_role')$$;
    create table organizations(id uuid primary key); create table profiles(id uuid primary key,full_name text,email text);
    create table org_members(org_id uuid,profile_id uuid,is_active boolean,role text);
    create table organization_contacts(id uuid primary key); create table task_access_links(id uuid primary key);
    create table task_requirement_templates(id uuid primary key);`)
  for (const name of ['operational_tasks', 'task_events', 'task_attachments', 'task_requirements', 'task_deadline_change_requests']) await db.exec(table(foundation, name))
  await db.exec(table(sql('2026-08-24_02_operational_task_evidence_checklist'), 'task_completion_evidence_requirements'))
  await db.exec(table(sql('2026-08-27_06_task_recurrence'), 'task_recurrence_rules'))
  await db.exec(fn(foundation, 'operational_task_set_updated_at_and_version'))
  await db.exec(`create trigger task_version before update on operational_tasks for each row execute function operational_task_set_updated_at_and_version();`)
  await db.exec(fn(foundation, 'reject_task_event_update'))
  await db.exec(`create trigger append_only before update on task_events for each row execute function reject_task_event_update();`)
  await db.query('insert into organizations values($1),($2)', [org, outsideOrg])
  await db.query("insert into profiles values($1,'Issuer','issuer@example.test'),($2,'Recipient','recipient@example.test'),($3,'Other admin','admin@example.test')", [issuer, assignee, otherAdmin])
  await db.query("insert into org_members values($1,$2,true,'member'),($1,$3,true,'member'),($1,$4,true,'admin')", [org, issuer, assignee, otherAdmin])
  await db.exec(migration)
})
after(() => db.close())

async function fixture({ status = 'assigned', evidence = false, source = 'manual' } = {}) {
  const id = randomUUID()
  await db.query(`insert into operational_tasks(id,org_id,root_task_id,issuer_profile_id,assignee_profile_id,title,status,due_at,next_followup_at,created_source,submitted_for_review_at)
    values($1,$2,$1,$3,$4,'Fiktiv uppgift',$5,now()+interval '1 day',now()+interval '1 hour',$6,case when $5='ready_for_review' then now() end)`, [id, org, issuer, assignee, status, source])
  if (evidence) {
    await db.query("insert into task_requirements(org_id,task_id,requirement_key,label,is_required) values($1,$2,'warranty_basis','Garantiunderlag',true)", [org, id])
    await db.query("insert into task_completion_evidence_requirements(org_id,task_id,evidence_type) values($1,$2,'photo'),($1,$2,'document')", [org, id])
  }
  const state = async () => (await db.query('select * from operational_tasks where id=$1', [id])).rows[0]
  const gaps = async () => (await db.query('select operational_task_completion_gaps($1,$2) g', [org, id])).rows[0].g
  const ack = async () => { const g = await gaps(); return { requirementIds: g.requirements.map(r => r.id).sort(), evidenceTypes: g.evidenceTypes } }
  const complete = async (override = {}) => (await db.query('select complete_operational_task_manually($1,$2,$3,$4,$5,$6) result', [override.org ?? org, id, override.actor ?? issuer, override.version ?? (await state()).version, override.comment ?? 'Kontrollerat per telefon.', override.gaps === undefined ? await ack() : override.gaps])).rows[0].result
  const events = async () => (await db.query('select * from task_events where task_id=$1', [id])).rows
  return { id, state, gaps, ack, complete, events }
}

test('manual completion preserves missing evidence, issuer identity, recipient and truthful submission time', async () => {
  const f = await fixture({ evidence: true }), initial = await f.state()
  await assert.rejects(f.complete({ gaps: { requirementIds: [], evidenceTypes: [] } }), /GAPS_CHANGED/)
  const result = await f.complete()
  assert.equal(result.task.status, 'approved'); assert.equal(result.task.completion_method, 'manual')
  assert.equal(result.task.approved_by_profile_id, issuer); assert.equal(result.task.assignee_profile_id, assignee)
  assert.equal(result.task.submitted_for_review_at, null); assert.equal(result.task.version, initial.version + 1)
  const [event] = await f.events()
  assert.equal(event.actor_profile_id, issuer); assert.equal(event.actor_contact_id, null)
  assert.equal(event.from_status, 'assigned'); assert.equal(event.to_status, 'approved')
  assert.match(event.message, /Klarmarkerad manuellt/); assert.match(event.message, /Garantiunderlag/); assert.match(event.message, /Dokument, Foto/)
  assert.equal(event.metadata.gaps.requirements.length, 1)
  assert.deepEqual(event.metadata.gaps.evidenceTypes, ['document', 'photo'])
  assert.equal((await db.query('select status from task_requirements where task_id=$1', [f.id])).rows[0].status, 'pending')
  assert.equal((await db.query('select count(*) n from task_attachments where task_id=$1', [f.id])).rows[0].n, 0)
  await assert.rejects(db.query("update task_events set message='edited' where task_id=$1", [f.id]), /APPEND_ONLY/)
})

test('membership, tenant, issuer, service role, comment, status and version are enforced', async () => {
  const f = await fixture()
  for (const actor of [assignee, otherAdmin, outsideOrg]) await assert.rejects(f.complete({ actor }), /FORBIDDEN/)
  await assert.rejects(f.complete({ org: outsideOrg }), /NOT_FOUND/)
  await assert.rejects(f.complete({ comment: ' ' }), /COMMENT_REQUIRED/)
  await assert.rejects(f.complete({ comment: 'x'.repeat(4001) }), /COMMENT_REQUIRED/)
  await assert.rejects(f.complete({ version: 0 }), /VERSION_REQUIRED/)
  await assert.rejects(f.complete({ version: 900 }), /VERSION_CONFLICT/)
  await db.exec("set test.auth_role='authenticated'")
  await assert.rejects(f.complete(), /FORBIDDEN/)
  await db.exec("set test.auth_role='service_role'")
  await db.query('update org_members set is_active=false where org_id=$1 and profile_id=$2', [org, issuer])
  await assert.rejects(f.complete(), /FORBIDDEN/)
  await db.query('update org_members set is_active=true where org_id=$1 and profile_id=$2', [org, issuer])
  for (const status of ['draft', 'cancelled']) await assert.rejects((await fixture({ status })).complete(), /TRANSITION_INVALID/)
  await assert.rejects((await fixture({ source: 'system' })).complete(), /MANAGED/)
  assert.equal((await f.state()).status, 'assigned'); assert.equal((await f.events()).length, 0)
})

test('open children cannot be bypassed and failed completion is atomic', async () => {
  const f = await fixture(), child = randomUUID()
  await db.query(`insert into operational_tasks(id,org_id,parent_task_id,root_task_id,depth,issuer_profile_id,assignee_profile_id,title,due_at,next_followup_at)
    values($1,$2,$3,$3,1,$4,$5,'Fiktiv underuppgift',now()+interval '1 day',now()+interval '1 hour')`, [child, org, f.id, issuer, assignee])
  await assert.rejects(f.complete(), /CHILDREN_INCOMPLETE/)
  assert.equal((await f.state()).status, 'assigned'); assert.equal((await f.events()).length, 0)
  await db.query("update operational_tasks set status='cancelled' where id=$1", [child])
  await f.complete()
  assert.equal((await f.state()).status, 'approved')
})

test('evidence gap acknowledgement rejects newly introduced missing types even without a version bump', async () => {
  const f = await fixture(), before = await f.ack()
  await db.query("insert into task_completion_evidence_requirements(org_id,task_id,evidence_type) values($1,$2,'photo')", [org, f.id])
  await assert.rejects(f.complete({ gaps: before }), /GAPS_CHANGED/)
  await f.complete()
})

test('same request retry is idempotent, other stale requests fail, and normal review checks remain strict', async () => {
  const f = await fixture(), version = (await f.state()).version, acknowledgement = await f.ack()
  assert.equal((await f.complete()).replayed, false)
  assert.equal((await f.complete({ version, gaps: acknowledgement })).replayed, true)
  assert.equal((await f.events()).length, 1)
  await assert.rejects(f.complete({ version, comment: 'Different request' }), /VERSION_CONFLICT/)
  const normal = await fixture()
  await assert.rejects(db.query('update operational_tasks set status=\'approved\',approved_at=now(),approved_by_profile_id=$2 where id=$1', [normal.id, issuer]), /review_state_check/)
  await db.exec(migration)
  assert.equal((await f.events()).length, 1)
  for (const role of ['anon', 'authenticated']) {
    assert.equal((await db.query("select has_function_privilege($1,'complete_operational_task_manually(uuid,uuid,uuid,integer,text,jsonb)','execute') allowed", [role])).rows[0].allowed, false)
  }
})

test('pre-existing recipient submission time remains unchanged', async () => {
  const f = await fixture({ status: 'ready_for_review' }), before = await f.state()
  await f.complete()
  assert.equal((await f.state()).submitted_for_review_at.toISOString(), before.submitted_for_review_at.toISOString())
})

test('pending extensions are cancelled without moving the due date, with their ids retained in the audit', async () => {
  const f = await fixture(), before = await f.state(), request = randomUUID()
  await db.query(`insert into task_deadline_change_requests(id,org_id,task_id,requested_by_profile_id,current_due_at,requested_due_at,reason)
    values($1,$2,$3,$4,$5,$5::timestamptz+interval '1 day','Fiktiv förlängning')`, [request, org, f.id, assignee, before.due_at])
  await f.complete()
  assert.equal((await f.state()).due_at.toISOString(), before.due_at.toISOString())
  assert.equal((await db.query('select status from task_deadline_change_requests where id=$1', [request])).rows[0].status, 'cancelled')
  assert.deepEqual((await f.events())[0].metadata.cancelledDeadlineRequestIds, [request])
})

test('an event write failure rolls the task and deadline decision back together', async () => {
  const f = await fixture(), request = randomUUID(), before = await f.state()
  await db.query(`insert into task_deadline_change_requests(id,org_id,task_id,requested_by_profile_id,current_due_at,requested_due_at,reason)
    values($1,$2,$3,$4,$5,$5::timestamptz+interval '1 day','Fiktiv förlängning')`, [request, org, f.id, assignee, before.due_at])
  await db.exec(`create function fail_manual_audit() returns trigger language plpgsql as $$begin raise exception 'TEST_AUDIT_FAILURE'; end$$;
    create trigger fail_manual_audit before insert on task_events for each row when (new.metadata->>'completionMethod'='manual') execute function fail_manual_audit();`)
  await assert.rejects(f.complete(), /TEST_AUDIT_FAILURE/)
  await db.exec('drop trigger fail_manual_audit on task_events')
  assert.deepEqual(await f.state(), before)
  assert.equal((await db.query('select status from task_deadline_change_requests where id=$1', [request])).rows[0].status, 'pending')
})

test('database gaps honour legacy any/text rules and transcribed completion audio', async () => {
  const f = await fixture()
  await db.query("update operational_tasks set evidence_requirement='text' where id=$1", [f.id])
  assert.deepEqual((await f.gaps()).evidenceTypes, ['text'])
  await db.query(`insert into task_attachments(org_id,task_id,attachment_type,transcript_text,is_completion_evidence,storage_bucket,file_path,uploaded_by_profile_id)
    values($1,$2,'audio','Fiktiv redovisning',true,'fictitious','fictitious/audio.webm',$3)`, [org, f.id, assignee])
  assert.deepEqual((await f.gaps()).evidenceTypes, [])
  await db.query("update operational_tasks set evidence_requirement='any' where id=$1", [f.id])
  assert.deepEqual((await f.gaps()).evidenceTypes, [])
  await f.complete()
})

test('the real recurrence trigger and finalizer queue one external next occurrence atomically, including lost-response retry', async () => {
  const recurrence = sql('2026-08-27_06_task_recurrence')
  await db.exec('alter table operational_tasks add column due_timezone text default \'Europe/Stockholm\'')
  await db.exec(table(foundation, 'task_followup_rules'))
  await db.exec('alter table task_followup_rules add column initial_dispatch_pending boolean not null default false')
  await db.exec('create table task_messages(id uuid primary key); create table task_message_deliveries(id uuid primary key)')
  await db.exec(table(foundation, 'task_automation_jobs'))
  await db.exec('create unique index fixture_job_key on task_automation_jobs(org_id,idempotency_key)')
  await db.exec(fn(sql('2026-08-20_02_operational_task_initial_attachments'), 'finalize_operational_task_initial_dispatch'))
  // Fixture creation boundary; the recurrence calculation/trigger below is the real migration.
  await db.exec(`create function create_operational_task_with_dispatch_control(
    p_org_id uuid,p_title text,p_due_at timestamptz,p_next_followup_at timestamptz,p_primary_channel text,p_task_kind text,p_evidence_requirement text,
    p_evidence_requirements text[],p_defer_initial_dispatch boolean,p_assignee_profile_id uuid,p_assignee_contact_id uuid,
    p_description text,p_context_label text,p_fallback_channel text,p_requirements jsonb,p_actor_profile_id uuid
  ) returns operational_tasks language plpgsql as $$declare result operational_tasks; next_id uuid:=gen_random_uuid(); begin
    insert into operational_tasks(id,org_id,root_task_id,issuer_profile_id,assignee_profile_id,assignee_contact_id,title,due_at,next_followup_at)
    values(next_id,p_org_id,next_id,p_actor_profile_id,p_assignee_profile_id,p_assignee_contact_id,p_title,p_due_at,p_next_followup_at) returning * into result;
    insert into task_followup_rules(org_id,task_id,initial_dispatch_pending,is_active) values(p_org_id,next_id,p_defer_initial_dispatch,not p_defer_initial_dispatch);
    return result; end$$;`)
  await db.exec(fn(recurrence, 'generate_next_recurring_task'))
  await db.exec('create trigger real_recurrence after update of status on operational_tasks for each row execute function generate_next_recurring_task()')
  const f = await fixture(), contact = randomUUID()
  await db.query('insert into organization_contacts values($1)', [contact])
  await db.query('update operational_tasks set assignee_profile_id=null,assignee_contact_id=$2 where id=$1', [f.id, contact])
  const version = (await f.state()).version
  await db.query(`insert into task_recurrence_rules(org_id,task_id,series_id,recurrence_interval,anchor_due_at,anchor_followup_at,created_by_profile_id)
    select org_id,id,id,'weekly',due_at,next_followup_at,issuer_profile_id from operational_tasks where id=$1`, [f.id])
  const completed = await f.complete()
  const next = completed.nextTaskId
  assert.ok(next)
  assert.equal((await db.query('select count(*) n from task_automation_jobs where task_id=$1 and status=\'queued\'', [next])).rows[0].n, 1)
  assert.deepEqual((await db.query('select initial_dispatch_pending,is_active from task_followup_rules where task_id=$1', [next])).rows[0], { initial_dispatch_pending: false, is_active: true })
  assert.equal((await f.events()).filter(e => e.event_type === 'recurrence_generated').length, 1)
  assert.equal((await db.query('select count(*) n from task_recurrence_rules where series_id=$1', [f.id])).rows[0].n, 2)
  await f.complete({ version })
  assert.equal((await f.events()).filter(e => e.event_type === 'recurrence_generated').length, 1)
  assert.equal((await db.query('select count(*) n from task_recurrence_rules where series_id=$1', [f.id])).rows[0].n, 2)
  assert.equal((await db.query('select count(*) n from task_automation_jobs where task_id=$1', [next])).rows[0].n, 1)
})
