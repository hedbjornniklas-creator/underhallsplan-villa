import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { emptyQuestion, questionMutation } from '../src/lib/action-cases/projectQuestions.ts'

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const org=id(1), actor=id(2), caseId=id(3), other=id(9), contact=id(5), original=id(7)
const body=()=>({...emptyQuestion(),title:'Golvvärme på sommaren',description:'Kan golvvärmen köras under sommaren?',source:'Byggmöte',meetingDate:'2026-10-18'})
const mutation=(questionId,revision,operation,extra={})=>({questionId,revision,operation,requestId:randomUUID(),fileIds:[],text:'',reportedBy:'',...extra})
test('questions require no dates until an explicitly confirmed send; malformed dates and actor-supplied names are rejected/stripped',()=>{
  const create=questionMutation(mutation(id(20),0,'create',{body:body()}));assert.equal(create.dueAt,null)
  for(const extra of [{},{confirmed:true},{confirmed:true,dueAt:'bad',followupAt:'bad'},{confirmed:true,dueAt:'2026-11-01T10:00:00Z',followupAt:'2026-11-02T10:00:00Z'}])assert.throws(()=>questionMutation(mutation(id(20),1,'send',extra)),/DATES/)
  assert.throws(()=>questionMutation(mutation(id(20),1,'send',{confirmed:true,dueAt:'2026-02-30T10:00:00Z',followupAt:'2026-02-28T10:00:00Z'})),/DATES/)
  for(const date of ['2026-02-30','2026-13-01','0000-01-01'])assert.throws(()=>questionMutation(mutation(id(20),0,'create',{body:{...body(),meetingDate:date}})),/INVALID/)
  assert.equal(questionMutation(mutation(id(20),0,'create',{body:{...body(),assignee:{id:actor,kind:'profile',name:'spoof'}}})).body.assignee.name,'')
  for(const patch of [{fileIds:[original,original]},{fileIds:[other.repeat(2)]},{revision:-1},{operation:'delete'},{body:{...body(),title:''}}])assert.throws(()=>questionMutation({...mutation(id(20),0,'create',{body:body()}),...patch}),/INVALID/)
})

const db=new PGlite()
before(async()=>{
  await db.exec(`create role anon;create role authenticated;create role service_role;
    create schema auth;create function auth.role() returns text language sql as $$select coalesce(current_setting('test.role',true),'service_role')$$;
    create table organizations(id uuid primary key);create table profiles(id uuid primary key,full_name text,email text);
    create table org_members(org_id uuid,profile_id uuid,is_active boolean,role text);
    create table organization_contacts(id uuid primary key,org_id uuid,name text,is_active boolean,email text);
    create table action_cases(id uuid primary key,org_id uuid,title text,updated_at timestamptz default now());
    create table action_case_attachments(id uuid primary key,org_id uuid,action_case_id uuid,file_name text,storage_bucket text,file_path text,content_type text,file_size_bytes bigint,attachment_type text);
    create table operational_tasks(id uuid primary key,org_id uuid,title text,description text,status text,due_at timestamptz,next_followup_at timestamptz,archived_at timestamptz);
    create table task_attachments(id uuid primary key default gen_random_uuid(),org_id uuid,task_id uuid references operational_tasks(id),attachment_type text,file_name text,storage_bucket text,file_path text,content_type text,file_size_bytes bigint,is_completion_evidence boolean,uploaded_by_profile_id uuid);
    create table action_case_work_quotes(org_id uuid,action_case_id uuid,document_id uuid);
    create table action_case_quote_requests(org_id uuid,action_case_id uuid,response_document_id uuid);
    create table test_outbox(task_id uuid unique references operational_tasks(id));
    create function create_operational_task_with_recurrence(p_org_id uuid,p_title text,p_due_at timestamptz,p_next_followup_at timestamptz,p_primary_channel text,p_task_kind text,p_evidence_requirement text,p_evidence_requirements text[],p_defer_initial_dispatch boolean,p_recurrence_interval text default null,p_assignee_profile_id uuid default null,p_assignee_contact_id uuid default null,p_parent_task_id uuid default null,p_expected_parent_version integer default null,p_description text default null,p_context_label text default null,p_fallback_channel text default null,p_requirements jsonb default '[]',p_actor_profile_id uuid default null,p_actor_contact_id uuid default null,p_actor_access_link_id uuid default null,p_source_ai_suggestion_id uuid default null)
    returns operational_tasks language plpgsql as $$declare r operational_tasks;begin
      if not p_defer_initial_dispatch or p_primary_channel<>'email' or p_task_kind<>'general' then raise exception 'wrong pipeline';end if;
      if p_due_at is null or p_next_followup_at is null or p_next_followup_at>p_due_at then raise exception 'task dates';end if;
      insert into operational_tasks values(gen_random_uuid(),p_org_id,p_title,p_description,'assigned',p_due_at,p_next_followup_at,null) returning * into r;return r;end$$;
    create function finalize_operational_task_initial_dispatch(p_org_id uuid,p_task_id uuid,p_actor_profile_id uuid) returns void language plpgsql as $$begin
      if current_setting('test.fail_dispatch',true)='yes' then raise exception 'dispatch failed';end if;
      insert into test_outbox values(p_task_id) on conflict do nothing;end$$;
    insert into organizations values('${org}'),('${other}');insert into profiles values('${actor}','Testledare','test@example.invalid');
    insert into org_members values('${org}','${actor}',true,'admin');insert into organization_contacts values('${contact}','${org}','VVS Test',true,'vvs@example.invalid');
    insert into action_cases(id,org_id,title) values('${caseId}','${org}','Fiktivt projekt');
    insert into action_case_attachments values('${original}','${org}','${caseId}','Ritning.pdf','action-case-files','original.pdf','application/pdf',120,'document');`)
  await db.exec(readFileSync(new URL('../docs/db/2026-10-19_01_project_questions.sql',import.meta.url),'utf8'))
})
after(()=>db.close())
const write=(v,o=org,c=caseId,a=actor)=>db.query('select mutate_project_question($1,$2,$3,$4::jsonb)',[o,c,a,JSON.stringify(questionMutation(v))])
const row=async q=>(await db.query('select * from action_case_questions where id=$1',[q])).rows[0]
const count=async table=>Number((await db.query(`select count(*) n from ${table}`)).rows[0].n)
test('create, assign, answer, correct, conclude and close preserve original snapshots and timestamps; stale writes fail',async()=>{
  const q=id(21), create=mutation(q,0,'create',{body:body(),fileIds:[original]})
  await write(create);await write(create);assert.equal((await row(q)).revision,1)
  await write(mutation(q,1,'update',{body:{...body(),description:'Förtydligad fråga',assignee:{id:contact,kind:'contact',name:'fake'}}}))
  assert.equal((await row(q)).body.assignee.name,'VVS Test')
  await assert.rejects(write(mutation(q,1,'update',{body:body()})),/STALE/)
  await write(mutation(q,2,'answer',{text:'Ja enligt muntligt besked',reportedBy:'VVS-montören'}))
  await write(mutation(q,3,'note',{text:'Behöver verifieras mot systemets driftläge'}))
  await write(mutation(q,4,'conclusion',{text:'Inväntar tekniskt underlag'}))
  await write(mutation(q,5,'close',{text:'Frågan hanterad'}))
  await assert.rejects(write(mutation(q,6,'note',{text:'Tyst ändring'})),/CLOSED/)
  await write(mutation(q,6,'reopen',{text:'Nytt underlag inkom'}))
  const events=(await db.query('select * from action_case_question_events where question_id=$1 order by revision',[q])).rows
  assert.equal(events.length,7);assert.equal(events[0].body.description,body().description)
  assert.equal(events[2].reported_by,'VVS-montören');assert.equal(events[2].actor_name,'Testledare')
  assert.equal(events[6].body.status,'open');assert.equal(events[6].body.conclusion,'Inväntar tekniskt underlag')
  assert.ok(events.every(e=>e.created_at));assert.equal((await row(q)).revision,7)
  await assert.rejects(db.query('update action_case_question_events set message=$1 where question_id=$2',['replace',q]),/IMMUTABLE/)
  await assert.rejects(db.query('delete from action_case_question_events where question_id=$1',[q]),/IMMUTABLE/)
  await assert.rejects(db.query('delete from action_case_attachments where id=$1',[original]),/foreign key/)
  await assert.rejects(db.query('update action_case_attachments set file_path=$1 where id=$2',['replace.pdf',original]),/IMMUTABLE/)
})
test('tenant, actor, assignee and file boundaries are enforced; anonymous SQL cannot execute',async()=>{
  await assert.rejects(write(mutation(id(22),0,'create',{body:body()}),other),/FORBIDDEN/)
  await assert.rejects(write(mutation(id(22),0,'create',{body:body()}),org,other),/NOT_FOUND/)
  await assert.rejects(write(mutation(id(22),0,'create',{body:{...body(),assignee:{id:other,kind:'contact',name:'spoof'}}})),/ASSIGNEE/)
  await assert.rejects(write(mutation(id(22),0,'create',{body:body(),fileIds:[other]})),/FILES/)
  await db.exec("set test.role='authenticated'")
  await assert.rejects(write(mutation(id(22),0,'create',{body:body()})),/FORBIDDEN/)
  await db.exec("set test.role='service_role'")
  await db.exec('set role authenticated')
  await assert.rejects(db.query('select * from action_case_questions'),/permission denied/)
  await db.exec('reset role')
})
test('send atomically creates one task, freezes selected material and queues existing dispatch; retries never duplicate',async()=>{
  const q=id(23), before=(await db.query('select * from action_cases')).rows
  await write(mutation(q,0,'create',{body:{...body(),assignee:{id:contact,kind:'contact',name:''}}}))
  await write(mutation(q,1,'note',{text:'INTERN KALKYL - ska inte skickas'}))
  const send=mutation(q,2,'send',{confirmed:true,dueAt:'2026-11-01T12:00:00Z',followupAt:'2026-10-29T12:00:00Z',fileIds:[original]})
  await write(send);await write(send)
  assert.equal(await count('operational_tasks'),1);assert.equal(await count('test_outbox'),1);assert.equal(await count('task_attachments'),1)
  const task=(await db.query('select * from operational_tasks')).rows[0]
  assert.equal(task.description.includes('INTERN KALKYL'),false);assert.ok(task.description.includes(body().description))
  await assert.rejects(write(mutation(q,3,'send',{...send,requestId:randomUUID(),revision:3})),/TASK_OPEN/)
  await assert.rejects(write(mutation(q,3,'close',{text:'Annars fortsätter uppgiftens påminnelser'})),/TASK_OPEN/)
  await assert.rejects(write({...send,text:'changed'}),/STALE/)
  await assert.rejects(write(mutation(q,3,'update',{body:{...body(),assignee:{id:actor,kind:'profile',name:''}}})),/TASK_OPEN/)
  await write(mutation(q,3,'update',{body:{...body(),description:'Ny intern text',assignee:{id:contact,kind:'contact',name:''}}}))
  assert.equal((await db.query('select description from operational_tasks')).rows[0].description,task.description)
  assert.deepEqual((await db.query('select * from action_cases')).rows,before)
})
test('failed dispatch rolls the task, copied file metadata and question revision back together',async()=>{
  const q=id(24);await write(mutation(q,0,'create',{body:{...body(),assignee:{id:contact,kind:'contact',name:''}}}))
  const n=await count('operational_tasks');await db.exec("set test.fail_dispatch='yes'")
  await assert.rejects(write(mutation(q,1,'send',{confirmed:true,dueAt:'2026-11-01T12:00:00Z',followupAt:'2026-10-29T12:00:00Z',fileIds:[original]})),/dispatch failed/)
  assert.equal((await row(q)).revision,1);assert.equal(await count('operational_tasks'),n)
  await db.exec("set test.fail_dispatch='no'")
})
test('private quote files and changed recipient details block dispatch before creating a task',async()=>{
  const q=id(25);await write(mutation(q,0,'create',{body:{...body(),assignee:{id:contact,kind:'contact',name:''}}}))
  const send=mutation(q,1,'send',{confirmed:true,dueAt:'2026-11-01T12:00:00Z',followupAt:'2026-10-29T12:00:00Z',fileIds:[original]})
  const n=await count('operational_tasks')
  await db.query('insert into action_case_work_quotes values($1,$2,$3)',[org,caseId,original])
  await assert.rejects(write(send),/FILES/)
  await db.query('delete from action_case_work_quotes')
  await db.query('update organization_contacts set email=$1 where id=$2',['changed@example.invalid',contact])
  await assert.rejects(write(send),/RECIPIENT_CHANGED/)
  assert.equal(await count('operational_tasks'),n);assert.equal((await row(q)).revision,1)
})
