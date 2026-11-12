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
    create table action_case_question_events(org_id uuid,task_id uuid);
    create function task_profile_has_module_access(uuid,uuid) returns boolean language sql as $$select exists(select 1 from org_members where org_id=$1 and profile_id=$2 and is_active and module_access)$$;`)
  for (const name of ['operational_tasks', 'task_events', 'task_followup_rules', 'task_message_deliveries', 'task_automation_jobs', 'task_deadline_change_requests']) await db.exec(table(name))
  await db.exec("alter table task_message_deliveries drop constraint task_message_deliveries_status_check;alter table task_message_deliveries add constraint task_message_deliveries_status_check check(status in ('queued','sending','sent','delivered','read','replied','failed','cancelled','ambiguous'));")
  await db.exec(`alter table operational_tasks add column due_timezone text default 'Europe/Stockholm';alter table task_followup_rules add column initial_dispatch_pending boolean default false;
    create unique index fixture_jobs on task_automation_jobs(org_id,idempotency_key);`)
  await db.exec(fn(foundation, 'operational_task_set_updated_at_and_version'))
  await db.exec(fn(foundation, 'touch_operational_task_from_event'))
  await db.exec(fn(identities, 'sync_task_recipient_grant_for_task'))
  await db.exec(fn(sql('2026-08-20_02_operational_task_initial_attachments'), 'finalize_operational_task_initial_dispatch'))
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
  assert.equal((await db.query('select is_active from task_followup_rules where task_id=$1', [t.id])).rows[0].is_active, true)
  assert.equal((await db.query("select count(*) n from task_automation_jobs where task_id=$1 and job_type='evaluate_followup' and status='queued'", [t.id])).rows[0].n, 1)
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

test('legacy linked questions remain origin-managed even when created_source is manual', async () => {
  const t = await create(true)
  await db.query('insert into action_case_question_events values($1,$2)', [org,t.id])
  await assert.rejects(edit(t, { title: 'Fel vy' }), /TASK_DETAILS_MANAGED/)
  await assert.rejects(edit(t, { assigneeContactId: contact2 }, true), /TASK_DETAILS_MANAGED/)
  assert.deepEqual(await read(t.id), t)
})

test('project question reassignment uses the task engine with question authorization and separate dispatch', async suite => {
  await db.exec(`create table action_cases(id uuid primary key,org_id uuid,manager_profile_id uuid);
    create table action_case_questions(id uuid primary key,org_id uuid,action_case_id uuid,revision integer default 1,body jsonb,updated_at timestamptz default now());
    alter table action_case_question_events add column id uuid default gen_random_uuid() unique,add column action_case_id uuid,add column question_id uuid,
      add column revision integer,add column operation text,add column actor_id uuid,add column actor_name text,add column body jsonb,add column message text,
      add column reported_by text,add column request jsonb;
    create unique index question_revisions on action_case_question_events(question_id,revision);
    create table action_case_question_participants(id uuid default gen_random_uuid(),org_id uuid,action_case_id uuid,question_id uuid,person_kind text,person_id uuid,name text,email text,
      active boolean default true,shared boolean default false,removed_at timestamptz,unique(question_id,person_kind,person_id));
    create table action_case_attachments(id uuid primary key,org_id uuid,action_case_id uuid,question_id uuid,attachment_type text,file_name text,storage_bucket text,file_path text,content_type text,file_size_bytes integer);
    create table action_case_question_files(event_id uuid,attachment_id uuid,file_name text,primary key(event_id,attachment_id));
    create table action_case_work_quotes(org_id uuid,document_id uuid);
    create table action_case_quote_requests(org_id uuid,response_document_id uuid);
    create table fixture_question_customers(org_id uuid,case_id uuid,id uuid,name text,email text);
    create function project_question_customers(uuid,uuid) returns table(id uuid,name text,email text) language sql as $$select id,name,email from fixture_question_customers where org_id=$1 and case_id=$2$$;
    create function project_question_internal_participant(uuid,uuid,uuid,uuid) returns boolean language sql as $$select exists(select 1 from action_case_question_participants p join org_members m on m.org_id=p.org_id and m.profile_id=p.person_id and m.is_active where p.org_id=$1 and p.action_case_id=$2 and p.question_id=$3 and p.person_kind='profile' and p.person_id=$4 and p.active)$$;
    alter table organization_contacts alter column id set default gen_random_uuid(),add column preferred_channel text,add column created_by uuid,add column updated_by uuid;`)
  await db.exec(table('task_attachments'))
  const migration = sql('2026-11-12_01_project_question_reassignment')
  const finalizer=(await db.query("select pg_get_functiondef('public.finalize_operational_task_initial_dispatch(uuid,uuid,uuid)'::regprocedure) value")).rows[0].value
  await db.exec(finalizer.replace(/\r?\n/g,'\r\n'))
  assert.ok((await db.query("select strpos(pg_get_functiondef('public.finalize_operational_task_initial_dispatch(uuid,uuid,uuid)'::regprocedure),chr(13)) value")).rows[0].value>0,'exercise the production CRLF definition without weakening the exact authorization guard')
  const beforeInstall = (await db.query('select to_jsonb(t) value from operational_tasks t order by id')).rows
  await db.exec(migration); await db.exec(migration)
  await db.exec(sql('2026-11-12_02_project_question_due_date')); await db.exec(sql('2026-11-12_02_project_question_due_date'))
  assert.deepEqual((await db.query('select to_jsonb(t) value from operational_tasks t order by id')).rows, beforeInstall)
  const setup = async (manager = issuer) => {
    const task = await create(true), caseId = randomUUID(), questionId = randomUUID()
    const body = { title: 'Fiktiv projektfråga', description: 'Underlag', status: 'investigating', assignee: { id: contact, kind: 'contact', name: 'Extern A', email: 'a@example.test' } }
    await db.query('insert into action_cases values($1,$2,$3)', [caseId,org,manager])
    await db.query('insert into action_case_questions(id,org_id,action_case_id,body) values($1,$2,$3,$4)', [questionId,org,caseId,JSON.stringify(body)])
    await db.query("insert into action_case_question_events(org_id,task_id,action_case_id,question_id,revision,operation,body,request) values($1,$2,$3,$4,1,'send',$5,'{}')", [org,task.id,caseId,questionId,JSON.stringify(body)])
    await db.query("insert into action_case_question_participants(org_id,action_case_id,question_id,person_kind,person_id,name,email,shared) values($1,$2,$3,'profile',$4,'Manager','manager@example.test',false),($1,$2,$3,'contact',$5,'Extern A','a@example.test',true)", [org,caseId,questionId,manager,contact])
    return { task, caseId, questionId, manager, body }
  }
  const question = async h => (await db.query('select * from action_case_questions where id=$1', [h.questionId])).rows[0]
  const request = async (h, assignee = { kind: 'contact', id: contact2 }) => ({ requestId: randomUUID(), questionId: h.questionId, taskId: h.task.id, taskVersion: (await read(h.task.id)).version, revision: (await question(h)).revision, operation: 'reassign', assignee, confirmed: true, fileIds: [] })
  const command = async (h, r, actor = h.manager, organization = org) => (await db.query('select write_project_question_assignment($1,$2,$3,$4) id', [organization,h.caseId,actor,JSON.stringify(r)])).rows[0].id
  const dispatch = async h => ({ ...await request(h), operation: 'dispatch_reassignment', assignee: undefined })
  const count = async (table, taskId) => Number((await db.query(`select count(*) n from ${table} where task_id=$1`, [taskId])).rows[0].n)

  const dueRequest = async (h, offset = 2 * 86400_000) => ({ requestId: randomUUID(), questionId: h.questionId, taskId: h.task.id, taskVersion: (await read(h.task.id)).version, revision: (await question(h)).revision, operation: 'reschedule', dueAt: new Date(new Date((await read(h.task.id)).due_at).getTime() + offset).toISOString() })
  const changeDue = async (h, r, actor = h.manager, organization = org) => (await db.query('select write_project_question_due_date($1,$2,$3,$4) id',[organization,h.caseId,actor,JSON.stringify(r)])).rows[0].id
  await suite.test('manager date edits retain recipient, links, status and question body; exact retries do not duplicate history',async()=>{
    const h=await setup(),r=await dueRequest(h),before=await read(h.task.id),savedBody=(await question(h)).body
    const links=(await db.query('select * from task_access_links where task_id=$1',[h.task.id])).rows
    await changeDue(h,r);const updated=await read(h.task.id)
    assert.equal(updated.due_at.toISOString(),r.dueAt);assert.equal(updated.status,before.status)
    assert.equal(updated.assignee_contact_id,before.assignee_contact_id);assert.equal(updated.version,before.version+1)
    assert.deepEqual((await question(h)).body,savedBody);assert.equal((await question(h)).revision,2)
    assert.deepEqual((await db.query('select * from task_access_links where task_id=$1',[h.task.id])).rows,links)
    assert.equal(await count('task_message_deliveries',h.task.id),0)
    const audit=(await db.query('select * from action_case_question_events where id=$1',[r.requestId])).rows[0]
    assert.match(audit.message,/Färdigdatum ändrades från .* till .*Stockholm/)
    assert.equal(audit.task_id,null)
    await changeDue(h,r);assert.deepEqual(await read(h.task.id),updated)
    await assert.rejects(changeDue(h,{...r,dueAt:new Date(Date.parse(r.dueAt)+86400_000).toISOString()}),/STALE/)
  })
  await suite.test('deadline-based checkpoints follow extensions, explicit earlier checkpoints stay and late checkpoints are bounded',async()=>{
    for(const variant of ['deadline','earlier','shorter']) {
      const h=await setup(),before=await read(h.task.id),oldDue=new Date(before.due_at).getTime()
      const checkpoint=new Date(oldDue-(variant==='deadline'?0:3600_000)).toISOString()
      await db.query('update operational_tasks set next_followup_at=$2 where id=$1',[h.task.id,checkpoint])
      const r=await dueRequest(h,variant==='shorter'?-2*3600_000:86400_000);await changeDue(h,r)
      const task=await read(h.task.id)
      assert.equal(task.next_followup_at.toISOString(),variant==='earlier'?checkpoint:r.dueAt)
      const jobs=(await db.query("select * from task_automation_jobs where task_id=$1 and status='queued'",[h.task.id])).rows
      assert.ok(jobs.length>0,'the real reminder trigger keeps an evaluation queued')
    }
  })
  await suite.test('date edits reject non-managers, foreign tasks, stale versions, pending requests and invalid dates without writes',async()=>{
    const h=await setup(),otherQuestion=await setup(),r=await dueRequest(h),before=await read(h.task.id)
    for(const [input,actor,organization,pattern] of [[r,recipient,org,/FORBIDDEN/],[r,issuer,randomUUID(),/NOT_FOUND|FORBIDDEN/],[{...r,taskId:otherQuestion.task.id},issuer,org,/NOT_FOUND/],[{...r,revision:99},issuer,org,/STALE/],[{...r,taskVersion:99},issuer,org,/STALE/],[{...r,dueAt:null},issuer,org,/DATES/],[{...r,dueAt:'infinity'},issuer,org,/DATES/],[{...r,assigneeContactId:contact2},issuer,org,/INVALID/]]) await assert.rejects(changeDue(h,input,actor,organization),pattern)
    assert.deepEqual(await read(h.task.id),before)
    const req=randomUUID();await db.query("insert into task_deadline_change_requests(id,org_id,task_id,requested_by_profile_id,current_due_at,requested_due_at,reason,status) values($1,$2,$3,$4,$5,$6,'Test','pending')",[req,org,h.task.id,recipient,before.due_at,r.dueAt])
    await assert.rejects(changeDue(h,await dueRequest(h)),/PENDING_REQUEST/)
    await db.query('delete from task_deadline_change_requests where id=$1',[req])
    await db.query("update action_case_questions set body=jsonb_set(body,'{status}','\"closed\"') where id=$1",[h.questionId])
    await assert.rejects(changeDue(h,await dueRequest(h)),/CLOSED/)
  })
  await suite.test('failed final date audit rolls back task version, dates and reminder queue',async()=>{
    const h=await setup(),r=await dueRequest(h),before=await read(h.task.id)
    const jobs=(await db.query('select * from task_automation_jobs where task_id=$1 order by id',[h.task.id])).rows
    await db.query("insert into action_case_question_events(org_id,question_id,revision,operation) values($1,$2,2,'update')",[org,h.questionId])
    await assert.rejects(changeDue(h,r),/unique|duplicate/)
    assert.deepEqual(await read(h.task.id),before);assert.equal((await question(h)).revision,1)
    assert.deepEqual((await db.query('select * from task_automation_jobs where task_id=$1 order by id',[h.task.id])).rows,jobs)
  })

  await suite.test('rescheduling after reassignment keeps dispatch separate and revoked old links revoked',async()=>{
    const h=await setup();await command(h,await request(h));const t=await read(h.task.id)
    await changeDue(h,await dueRequest(h));const updated=await read(h.task.id)
    assert.equal(updated.assignee_contact_id,contact2);assert.equal(updated.status,t.status)
    assert.equal((await db.query('select initial_dispatch_pending from task_followup_rules where task_id=$1',[t.id])).rows[0].initial_dispatch_pending,true)
    assert.equal((await db.query('select count(*) n from task_access_links where task_id=$1 and revoked_at is null',[t.id])).rows[0].n,0)
    assert.equal(await count('task_message_deliveries',t.id),0)
    const revision=(await question(h)).revision
    for(const role of ['anon','authenticated']) {
      await db.exec(`set role ${role}`)
      await assert.rejects(changeDue(h,{requestId:randomUUID(),questionId:h.questionId,taskId:t.id,taskVersion:updated.version,revision,operation:'reschedule',dueAt:'2030-02-01T15:00:00Z'}),/permission denied/)
      await db.exec('reset role')
    }
  })

  await suite.test('ordinary tasks retain editing permissions and separate dispatch after the shared engine migration',async()=>{
    const t=await create(), updated=await edit(t,{title:'Oförändrat vanligt flöde'})
    assert.equal(updated.title,'Oförändrat vanligt flöde'); assert.equal(updated.status,t.status)
    const changed=await edit(await read(t.id),{assigneeProfileId:other},true)
    assert.equal(changed.assignee_profile_id,other)
    await assert.rejects(edit(await read(t.id),{title:'Saknar behörighet'},false,other),/FORBIDDEN/)
    await send(await read(t.id))
    assert.equal((await db.query('select initial_dispatch_pending from task_followup_rules where task_id=$1',[t.id])).rows[0].initial_dispatch_pending,false)
  })

  await suite.test('a failed final audit rolls back the task, recipient, links and question together',async()=>{
    const h=await setup(),r=await request(h),before=await question(h)
    await db.query('insert into task_access_links(task_id) values($1)',[h.task.id])
    await db.exec(`create function fixture_reject_question_audit() returns trigger language plpgsql as $$begin raise exception 'FIXTURE_AUDIT_FAILURE';end$$;
      create trigger fixture_reject_audit before insert on action_case_question_events for each row when(new.operation='update') execute function fixture_reject_question_audit();`)
    try {await assert.rejects(command(h,r),/FIXTURE_AUDIT_FAILURE/)} finally {await db.exec('drop trigger fixture_reject_audit on action_case_question_events;drop function fixture_reject_question_audit();')}
    assert.deepEqual(await read(h.task.id),h.task);assert.deepEqual(await question(h),before)
    assert.equal((await db.query('select count(*) n from task_access_links where task_id=$1 and revoked_at is null',[h.task.id])).rows[0].n,1)
    assert.equal((await db.query('select count(*) n from action_case_question_participants where question_id=$1 and person_id=$2',[h.questionId,contact2])).rows[0].n,0)
  })

  await suite.test('external change is atomic, does not notify, retains task status/history, and retry is idempotent', async () => {
    const h = await setup(), r = await request(h), old = await question(h)
    await db.query('insert into task_access_links(task_id) values($1)', [h.task.id])
    await db.query('insert into task_recipient_activation_tokens(task_id) values($1)', [h.task.id])
    await command(h,r); await command(h,r)
    const next = await read(h.task.id), q = await question(h)
    assert.equal(q.revision, 2); assert.equal(q.body.status, old.body.status); assert.equal(q.body.assignee.id, contact2)
    for (const key of ['id','status','due_at','next_followup_at','description','title']) assert.deepEqual(next[key], h.task[key], key)
    assert.equal(next.assignee_contact_id, contact2)
    assert.equal((await db.query('select count(*) n from task_access_links where task_id=$1 and revoked_at is null', [h.task.id])).rows[0].n, 0)
    assert.equal((await db.query('select count(*) n from task_recipient_activation_tokens where task_id=$1 and revoked_at is null', [h.task.id])).rows[0].n, 0)
    assert.equal((await db.query("select count(*) n from task_events where task_id=$1 and event_type='comment'", [h.task.id])).rows[0].n, 0)
    assert.equal((await db.query("select count(*) n from task_automation_jobs where task_id=$1 and status in ('queued','processing')", [h.task.id])).rows[0].n, 0)
    const rule = (await db.query('select * from task_followup_rules where task_id=$1',[h.task.id])).rows[0]
    assert.equal(rule.initial_dispatch_pending,true); assert.equal(rule.is_active,false)
    const history = (await db.query('select * from action_case_question_events where question_id=$1 order by revision',[h.questionId])).rows
    assert.equal(history.length,2); assert.deepEqual(history[0].body,old.body); assert.match(history[1].message,/Extern A.*Extern B/)
    const previous = (await db.query('select * from action_case_question_participants where question_id=$1 and person_id=$2',[h.questionId,contact])).rows[0]
    assert.equal(previous.active,true); assert.equal(previous.shared,true)
    assert.equal((await db.query('select shared from action_case_question_participants where question_id=$1 and person_id=$2',[h.questionId,contact2])).rows[0].shared,false)
    await assert.rejects(command(h,{ ...r,requestId:randomUUID() }),/STALE/)
    await assert.rejects(edit(next,{ assigneeContactId:contact },true),/MANAGED/)
    const send = await dispatch(h); await command(h,send); await command(h,send)
    assert.equal((await db.query('select initial_dispatch_pending from task_followup_rules where task_id=$1',[h.task.id])).rows[0].initial_dispatch_pending,false)
    assert.equal((await question(h)).body.status,old.body.status)
    assert.equal((await db.query("select count(*) n from task_events where task_id=$1 and event_type='initial_dispatch_released'",[h.task.id])).rows[0].n,1)
  })
  await suite.test('the current project manager can replace and dispatch an internal recipient without impersonating the original issuer',async()=>{
    const h=await setup(other), r=await request(h,{kind:'profile',id:recipient})
    await command(h,r)
    const change=(await db.query("select * from task_events where task_id=$1 and event_type='task_recipient_changed'",[h.task.id])).rows[0]
    assert.equal(change.actor_profile_id,other)
    const send=await dispatch(h); await command(h,send); await command(h,send)
    assert.equal((await read(h.task.id)).status,h.task.status)
    assert.equal((await db.query("select count(*) n from task_events where task_id=$1 and event_type='comment'",[h.task.id])).rows[0].n,1)
    assert.equal((await db.query("select actor_profile_id from task_events where task_id=$1 and event_type='initial_dispatch_released'",[h.task.id])).rows[0].actor_profile_id,other)
  })
  await suite.test('manager, organization, question identity and both revisions are enforced before any change',async()=>{
    const h=await setup(),r=await request(h),otherQuestion=await setup(),before=await read(h.task.id)
    for(const [input,actor,organization,pattern]of [[r,other,org,/FORBIDDEN/],[r,issuer,randomUUID(),/FORBIDDEN/],[{...r,taskId:otherQuestion.task.id},issuer,org,/NOT_FOUND/],[{...r,revision:99},issuer,org,/STALE/],[{...r,taskVersion:99},issuer,org,/STALE/]]) await assert.rejects(command(h,input,actor,organization),pattern)
    assert.deepEqual(await read(h.task.id),before)
    await db.exec('set role service_role')
    await assert.rejects(db.query('select edit_operational_task_details_core($1,$2,$3,$4,$5,true,$6)',[org,h.task.id,issuer,h.task.version,JSON.stringify(changes(h.task)),h.questionId]),/permission denied/)
    await db.exec('reset role')
  })
  await suite.test('uncertain delivery and changed contact details cannot be bypassed by question reassignment/dispatch',async()=>{
    const h=await setup(),r=await request(h)
    await db.exec('alter table task_message_deliveries disable trigger all')
    const message=randomUUID();await db.query('insert into task_messages values($1)',[message])
    await db.query("insert into task_message_deliveries(org_id,task_id,message_id,channel,recipient_address,status,idempotency_key) values($1,$2,$3,'email','a@example.test','ambiguous',$4)",[org,h.task.id,message,randomUUID()])
    await assert.rejects(command(h,r),/DELIVERY_PENDING/)
    assert.equal((await question(h)).revision,1)
    await db.query("update task_message_deliveries set status='sent' where task_id=$1",[h.task.id]);await db.exec('alter table task_message_deliveries enable trigger all')
    await command(h,r)
    const send=await dispatch(h)
    await db.query("update organization_contacts set email='changed@example.test' where id=$1",[contact2])
    await assert.rejects(command(h,send),/RECIPIENT_CHANGED/)
    await db.query("update organization_contacts set email='b@example.test' where id=$1",[contact2])
  })
  await suite.test('customer reassignment reuses a private contact bridge without dispatch or duplicate identities',async()=>{
    const h=await setup(),customer=randomUUID()
    await db.query("insert into fixture_question_customers values($1,$2,$3,'Kund Test','customer@example.test')",[org,h.caseId,customer])
    const r=await request(h,{kind:'customer',id:customer});await command(h,r);await command(h,r)
    assert.equal((await question(h)).body.assignee.kind,'customer')
    const task=await read(h.task.id)
    assert.ok(task.assignee_contact_id)
    assert.equal((await db.query("select count(*) n from organization_contacts where email='customer@example.test'")).rows[0].n,1)
    assert.equal((await db.query("select count(*) n from task_events where task_id=$1 and event_type='comment'",[h.task.id])).rows[0].n,0)
  })
  await suite.test('only explicitly selected same-question documents are attached at separate dispatch',async()=>{
    const h=await setup(),otherQuestion=await setup(),file=randomUUID(),privateOther=randomUUID()
    await db.query("insert into action_case_attachments values($1,$2,$3,$4,'document','Fråga.pdf','project-question-files','own/file','application/pdf',123),($5,$2,$3,$6,'document','Privat.pdf','project-question-files','other/file','application/pdf',456)",[file,org,h.caseId,h.questionId,privateOther,otherQuestion.questionId])
    await command(h,await request(h))
    assert.equal(await count('task_attachments',h.task.id),0)
    await assert.rejects(command(h,{...await dispatch(h),fileIds:[privateOther]}),/FILES/)
    const r={...await dispatch(h),fileIds:[file]};await command(h,r);await command(h,r)
    assert.equal(await count('task_attachments',h.task.id),1)
    assert.equal((await db.query('select count(*) n from action_case_question_files where event_id=$1',[r.requestId])).rows[0].n,1)
  })
})
