import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID, createHmac, timingSafeEqual } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import ts from 'typescript'
import { emptyQuestion, questionAssigneeOptions, questionMutation, questionUuid } from '../src/lib/action-cases/projectQuestions.ts'

const dialogueModule = { exports: {} }
new Function('require', 'module', 'exports', ts.transpileModule(readFileSync(new URL('../src/lib/action-cases/questionDialogue.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(() => ({ questionUuid }), dialogueModule, dialogueModule.exports)
const { dialogueMutation } = dialogueModule.exports
const linkModule = { exports: {} }
new Function('require', 'module', 'exports', ts.transpileModule(readFileSync(new URL('../src/lib/action-cases/questionDialogueLinks.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(key => key === 'node:crypto' ? { createHmac, timingSafeEqual } : { questionUuid }, linkModule, linkModule.exports)
const { parseQuestionLink, questionLinkToken } = linkModule.exports

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
    create schema storage;create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);insert into storage.buckets values('action-case-files','action-case-files',false,26214400,array['application/pdf']);
    create table organizations(id uuid primary key);create table profiles(id uuid primary key,full_name text,email text);
    create table org_members(org_id uuid,profile_id uuid,is_active boolean,role text);
    create table organization_contacts(id uuid primary key default gen_random_uuid(),org_id uuid,name text,is_active boolean,email text,phone text,preferred_channel text,created_by uuid,updated_by uuid);
    create table action_cases(id uuid primary key,org_id uuid,title text,updated_at timestamptz default now(),customer_name text,customer_email text,customer_phone text);
    create table action_case_events(org_id uuid,action_case_id uuid,event_type text,message text,performed_by uuid);
    create table action_case_participants(id uuid primary key,org_id uuid,action_case_id uuid,role text,name text,email text,phone text);
    create table action_case_customer_contract_drafts(org_id uuid,action_case_id uuid,body jsonb);
    create table action_case_attachments(id uuid primary key,org_id uuid,action_case_id uuid,file_name text,storage_bucket text,file_path text,content_type text,file_size_bytes bigint,attachment_type text);
    create table operational_tasks(id uuid primary key,org_id uuid,title text,description text,status text,due_at timestamptz,next_followup_at timestamptz,archived_at timestamptz,assignee_contact_id uuid);
    create table task_attachments(id uuid primary key default gen_random_uuid(),org_id uuid,task_id uuid references operational_tasks(id),attachment_type text,file_name text,storage_bucket text,file_path text,content_type text,file_size_bytes bigint,is_completion_evidence boolean,uploaded_by_profile_id uuid);
    create table action_case_work_quotes(org_id uuid,action_case_id uuid,document_id uuid);
    create table action_case_quote_requests(org_id uuid,action_case_id uuid,response_document_id uuid);
    create table test_outbox(task_id uuid unique references operational_tasks(id));
    create function create_operational_task_with_recurrence(p_org_id uuid,p_title text,p_due_at timestamptz,p_next_followup_at timestamptz,p_primary_channel text,p_task_kind text,p_evidence_requirement text,p_evidence_requirements text[],p_defer_initial_dispatch boolean,p_recurrence_interval text default null,p_assignee_profile_id uuid default null,p_assignee_contact_id uuid default null,p_parent_task_id uuid default null,p_expected_parent_version integer default null,p_description text default null,p_context_label text default null,p_fallback_channel text default null,p_requirements jsonb default '[]',p_actor_profile_id uuid default null,p_actor_contact_id uuid default null,p_actor_access_link_id uuid default null,p_source_ai_suggestion_id uuid default null)
    returns operational_tasks language plpgsql as $$declare r operational_tasks;begin
      if not p_defer_initial_dispatch or p_primary_channel<>'email' or p_task_kind<>'general' then raise exception 'wrong pipeline';end if;
      if p_due_at is null or p_next_followup_at is null or p_next_followup_at>p_due_at then raise exception 'task dates';end if;
      insert into operational_tasks values(gen_random_uuid(),p_org_id,p_title,p_description,'assigned',p_due_at,p_next_followup_at,null,p_assignee_contact_id) returning * into r;return r;end$$;
    create function finalize_operational_task_initial_dispatch(p_org_id uuid,p_task_id uuid,p_actor_profile_id uuid) returns void language plpgsql as $$begin
      if current_setting('test.fail_dispatch',true)='yes' then raise exception 'dispatch failed';end if;
      insert into test_outbox values(p_task_id) on conflict do nothing;end$$;
    insert into organizations values('${org}'),('${other}');insert into profiles values('${actor}','Testledare','test@example.invalid');
    insert into org_members values('${org}','${actor}',true,'admin');insert into organization_contacts(id,org_id,name,is_active,email) values('${contact}','${org}','VVS Test',true,'vvs@example.invalid');
    insert into action_cases(id,org_id,title) values('${caseId}','${org}','Fiktivt projekt');
    insert into action_case_attachments values('${original}','${org}','${caseId}','Ritning.pdf','action-case-files','original.pdf','application/pdf',120,'document');`)
  await db.exec(readFileSync(new URL('../docs/db/2026-10-19_01_project_questions.sql',import.meta.url),'utf8'))
  await db.exec(readFileSync(new URL('../docs/db/2026-10-19_03_project_question_customers.sql',import.meta.url),'utf8'))
  await db.exec(readFileSync(new URL('../docs/db/2026-10-19_04_project_question_dialogue.sql',import.meta.url),'utf8'))
  await db.exec(readFileSync(new URL('../docs/db/2026-10-19_05_project_question_participants.sql',import.meta.url),'utf8'))
  await db.query('select set_project_manager($1,$2,$3,$3,null)',[org,caseId,actor])
})
after(()=>db.close())
const write=(v,o=org,c=caseId,a=actor)=>db.query('select mutate_project_question($1,$2,$3,$4::jsonb)',[o,c,a,JSON.stringify(questionMutation(v))])
const row=async q=>(await db.query('select * from action_case_questions where id=$1',[q])).rows[0]
const count=async table=>Number((await db.query(`select count(*) n from ${table}`)).rows[0].n)
const dialogue=(q,version,operation,extra={})=>dialogueMutation({requestId:randomUUID(),version,operation,...extra})
const chat=(q,request,user=actor,member=null,nonce=null)=>db.query('select mutate_project_question_dialogue($1,$2,$3,$4,$5,$6,$7)',[org,caseId,q,user,member,nonce,request])
const version=async q=>(await db.query('select version from action_case_question_conversations where question_id=$1',[q])).rows[0].version
const member=async(q,person)=>(await db.query('select * from action_case_question_participants where question_id=$1 and person_id=$2',[q,person])).rows[0]
const canRead=async(q,user)=>(await db.query('select project_question_internal_participant($1,$2,$3,$4) ok',[org,caseId,q,user])).rows[0].ok
test('create, assign, answer and close preserve original snapshots; replies do not resolve the question',async()=>{
  const q=id(21), create=mutation(q,0,'create',{body:body(),fileIds:[original]})
  await write(create);await write(create);assert.equal((await row(q)).revision,1)
  await write(mutation(q,1,'update',{body:{...body(),description:'Förtydligad fråga',assignee:{id:contact,kind:'contact',name:'fake'}}}))
  assert.equal((await row(q)).body.assignee.name,'VVS Test')
  await assert.rejects(write(mutation(q,1,'update',{body:body()})),/STALE/)
  await write(mutation(q,2,'answer',{text:'Ja enligt muntligt besked',reportedBy:'VVS-montören'}))
  assert.equal((await row(q)).body.status,'open')
  await write(mutation(q,3,'note',{text:'Behöver verifieras mot systemets driftläge'}))
  assert.throws(()=>questionMutation(mutation(q,4,'conclusion',{text:'Inte en funktion'})),/INVALID/)
  await write(mutation(q,4,'close',{text:'Frågan hanterad'}))
  await assert.rejects(write(mutation(q,5,'note',{text:'Tyst ändring'})),/CLOSED/)
  await write(mutation(q,5,'reopen',{text:'Nytt underlag inkom'}))
  const events=(await db.query('select * from action_case_question_events where question_id=$1 order by revision',[q])).rows
  assert.equal(events.length,6);assert.equal(events[0].body.description,body().description)
  assert.equal(events[2].reported_by,'VVS-montören');assert.equal(events[2].actor_name,'Testledare')
  assert.equal(events[5].body.status,'open');assert.ok(events.every(e=>!('conclusion' in e.body)))
  assert.ok(events.every(e=>e.created_at));assert.equal((await row(q)).revision,6)
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

test('customer choices deduplicate matching contacts but preserve a saved contact and two people sharing one email', () => {
  const customer = { id: id(60), kind: 'customer', name: 'Nina Test', email: 'nina@example.invalid' }
  const contact = { ...customer, kind: 'contact', id: id(61), name: ' NINA TEST ', email: 'NINA@example.invalid' }
  const partner = { ...customer, id: id(62), name: 'Thomas Test' }
  assert.deepEqual(questionAssigneeOptions([contact, partner, customer], null), [customer, partner])
  assert.deepEqual(questionAssigneeOptions([customer, partner, contact], contact), [contact, partner])
  assert.equal(questionMutation(mutation(id(63), 0, 'create', { body: { ...body(), assignee: { ...customer, name: 'spoof' } } })).body.assignee.name, '')
})

const customerCase = id(80)
const customerPeople = async () => (await db.query('select * from project_question_customers($1,$2)', [org, customerCase])).rows
test('customer directory reuses project and contract names without duplicates, identifiers, writes or invitations', async () => {
  await db.query('insert into action_cases(id,org_id,title,customer_name,customer_email) values($1,$2,$3,$4,$5)', [customerCase, org, 'Fiktivt kundprojekt', 'Nina Test', 'nina@example.invalid'])
  await db.query('select set_project_manager($1,$2,$3,$3,null)',[org,customerCase,actor])
  await db.query('insert into action_case_participants values($1,$2,$3,$4,$5,$6,$7)', [id(81), org, customerCase, 'customer', 'Nina Test', 'NINA@example.invalid', null])
  await db.query('insert into action_case_customer_contract_drafts values($1,$2,$3)', [org, customerCase, { contractParties: { customers: [{ name: 'Nina Test', personalNumber: 'PRIVATE' }, { name: 'Thomas Test', personalNumber: 'PRIVATE' }], email: 'nina@example.invalid', mobile: '' } }])
  const before = await count('organization_contacts'), tasks = await count('operational_tasks')
  const people = await customerPeople()
  assert.deepEqual(people.map(p => p.name), ['Nina Test', 'Thomas Test'])
  assert.notEqual(people[0].id, people[1].id)
  assert.deepEqual(Object.keys(people[0]).sort(), ['email', 'id', 'name', 'phone'])
  assert.deepEqual(await customerPeople(), people)
  assert.equal(await count('organization_contacts'), before); assert.equal(await count('operational_tasks'), tasks)
  await assert.rejects(db.query('select * from project_question_customers($1,$2)', [other, customerCase]), /NOT_FOUND/)
  await db.exec('set role authenticated')
  await assert.rejects(db.query('select * from project_question_customers($1,$2)', [org, customerCase]), /permission denied/)
  await db.exec('reset role')
})

test('customer assignment stays internal and confirmed dispatch reuses the existing task pipeline atomically', async () => {
  const person = (await customerPeople())[1], q = id(82), contacts = await count('organization_contacts'), tasks = await count('operational_tasks')
  const contractBefore = (await db.query('select * from action_case_customer_contract_drafts')).rows
  const projectsBefore = (await db.query('select * from action_cases')).rows
  await write(mutation(q, 0, 'create', { body: { ...body(), assignee: { ...person, kind: 'customer', name: 'spoof', email: 'attacker@example.invalid' } } }), org, customerCase)
  assert.equal((await row(q)).body.assignee.name, person.name)
  assert.equal((await row(q)).body.assignee.email, person.email)
  assert.equal(await count('organization_contacts'), contacts); assert.equal(await count('operational_tasks'), tasks)
  const send = mutation(q, 1, 'send', { confirmed: true, dueAt: '2026-11-01T12:00:00Z', followupAt: '2026-10-29T12:00:00Z' })
  await db.exec("set test.fail_dispatch='yes'")
  await assert.rejects(write(send, org, customerCase), /dispatch failed/)
  assert.equal(await count('organization_contacts'), contacts); assert.equal((await row(q)).revision, 1)
  await db.exec("set test.fail_dispatch='no'")
  await write(send, org, customerCase); await write(send, org, customerCase)
  assert.equal(await count('operational_tasks'), tasks + 1); assert.equal(await count('organization_contacts'), contacts + 1)
  const recipient = (await db.query('select * from organization_contacts where name=$1', [person.name])).rows[0]
  const task = (await db.query('select * from operational_tasks where assignee_contact_id=$1', [recipient.id])).rows[0]
  assert.equal(task.description, `${body().description}\n\nBakgrund: ${body().source}\nMötesdatum: ${body().meetingDate}`)
  assert.equal((await row(q)).body.assignee.kind, 'customer')
  assert.deepEqual((await db.query('select * from action_case_customer_contract_drafts')).rows, contractBefore)
  assert.deepEqual((await db.query('select * from action_cases')).rows, projectsBefore)
  const next = id(83)
  await write(mutation(next, 0, 'create', { body: { ...body(), assignee: { ...person, kind: 'customer' } } }), org, customerCase)
  await write({ ...send, questionId: next, requestId: randomUUID() }, org, customerCase)
  assert.equal(await count('organization_contacts'), contacts + 1)
})

test('customer changes and disabled contacts cannot be bypassed to dispatch a saved question', async () => {
  const person = (await customerPeople())[0], q = id(84)
  await write(mutation(q, 0, 'create', { body: { ...body(), assignee: { ...person, kind: 'customer' } } }), org, customerCase)
  const send = mutation(q, 1, 'send', { confirmed: true, dueAt: '2026-11-01T12:00:00Z', followupAt: '2026-10-29T12:00:00Z' })
  const n = await count('operational_tasks')
  await db.query('insert into organization_contacts(org_id,name,email,is_active) values($1,$2,$3,false)', [org, person.name, person.email])
  await assert.rejects(write(send, org, customerCase), /ASSIGNEE/)
  assert.equal(await count('operational_tasks'), n)
  await db.query('delete from action_case_participants where action_case_id=$1', [customerCase])
  await db.query("update action_case_customer_contract_drafts set body=jsonb_set(body,'{contractParties,email}','\"changed@example.invalid\"') where action_case_id=$1", [customerCase])
  await assert.rejects(write(send, org, customerCase), /RECIPIENT_CHANGED/)
  const original = (await db.query('select body from action_case_question_events where question_id=$1 and revision=1', [q])).rows[0].body
  assert.equal(original.assignee.email, person.email)
  assert.equal((await row(q)).revision, 1)
})

test('a customer without email can be assigned internally but cannot be sent a question or reused across projects', async () => {
  const project = id(85), q = id(86), contacts = await count('organization_contacts')
  await db.query('insert into action_cases(id,org_id,title,customer_name) values($1,$2,$3,$4)', [project, org, 'Fiktiv reservkund', 'Beställare utan e-post'])
  await db.query('select set_project_manager($1,$2,$3,$3,null)',[org,project,actor])
  const person = (await db.query('select * from project_question_customers($1,$2)', [org, project])).rows[0]
  await write(mutation(q, 0, 'create', { body: { ...body(), assignee: { ...person, kind: 'customer' } } }), org, project)
  assert.equal((await row(q)).body.assignee.email, null)
  assert.equal(await count('organization_contacts'), contacts)
  await assert.rejects(write(mutation(q, 1, 'send', { confirmed: true, dueAt: '2026-11-01T12:00:00Z', followupAt: '2026-10-29T12:00:00Z' }), org, project), /RECIPIENT_CHANGED/)
  await assert.rejects(write(mutation(id(87), 0, 'create', { body: { ...body(), assignee: { ...person, kind: 'customer' } } }), org, customerCase), /ASSIGNEE/)
})

test('only the explicit project manager may manage participants; unrelated staff cannot read or mutate a question',async()=>{
  const staff=id(101), outsider=id(102), q=id(103)
  await db.query("insert into profiles values($1,'Intern deltagare','staff@example.invalid'),($2,'Annan medarbetare','other@example.invalid')",[staff,outsider])
  await db.query("insert into org_members values($1,$2,true,'inspector'),($1,$3,true,'inspector')",[org,staff,outsider])
  await write(mutation(q,0,'create',{body:body()}))
  assert.equal(await canRead(q,outsider),false)
  await assert.rejects(write(mutation(q,1,'note',{text:'Unauthorized'}),org,caseId,outsider),/NOT_FOUND/)
  await assert.rejects(db.query('select set_project_manager($1,$2,$3,$3,$4)',[org,caseId,staff,actor]),/MANAGER_FORBIDDEN/)
  const add=dialogue(q,0,'participants',{participants:[{kind:'profile',id:staff}]})
  await chat(q,add);await chat(q,add)
  assert.equal(await version(q),1);assert.equal(await canRead(q,staff),true)
  await assert.rejects(chat(q,dialogue(q,1,'participants',{participants:[{kind:'profile',id:outsider}]}),staff),/FORBIDDEN/)
  await assert.rejects(write(mutation(q,1,'update',{body:{...body(),assignee:{id:outsider,kind:'profile',name:''}}}),org,caseId,staff),/PARTICIPANT_REQUIRED/)
  await chat(q,dialogue(q,1,'participants',{participants:[]}))
  assert.equal(await canRead(q,staff),false)
  await assert.rejects(write(mutation(q,1,'note',{text:'Removed'}),org,caseId,staff),/NOT_FOUND/)
  await assert.rejects(chat(q,dialogue(q,1,'participants',{participants:[{kind:'profile',id:outsider}]})),/STALE/)
  await db.exec("set test.role='authenticated'")
  await assert.rejects(db.query('update action_cases set manager_profile_id=$1 where id=$2',[staff,caseId]),/MANAGER_FORBIDDEN/)
  await db.exec("set test.role='service_role'")
})

test('shared discussion excludes internal notes, supports many participants, preserves snapshots and revokes old links',async()=>{
  const q=id(110), first=id(111), late=id(112), staff=id(101)
  await db.query("insert into organization_contacts(id,org_id,name,email,is_active) values($1,$3,'Kund Ett','one@example.invalid',true),($2,$3,'Kund Två','two@example.invalid',true)",[first,late,org])
  await write(mutation(q,0,'create',{body:body()}))
  await write(mutation(q,1,'note',{text:'ENDAST INTERNT'}))
  const refs=[{kind:'contact',id:first},{kind:'profile',id:staff}]
  await chat(q,dialogue(q,0,'participants',{participants:refs}))
  const before=await member(q,first)
  assert.equal(before.shared,false);assert.equal(await count('action_case_question_deliveries'),0)
  const share=dialogue(q,1,'share',{confirmed:true,fileIds:[original]})
  await assert.rejects(chat(q,share,staff),/FORBIDDEN/)
  await chat(q,share);await chat(q,share)
  const invited=await member(q,first)
  assert.equal(invited.shared,true);assert.equal(await count('action_case_question_deliveries'),2)
  const externalReply=dialogue(q,2,'reply',{text:'Ett svar från beställaren'})
  await chat(q,externalReply,null,invited.id,invited.link_nonce);await chat(q,externalReply,null,invited.id,invited.link_nonce)
  await chat(q,dialogue(q,2,'reply',{text:'Vi återkommer med underlag.'}),staff)
  assert.equal((await row(q)).body.status,'open')
  const shared=(await db.query('select * from action_case_question_messages where question_id=$1 order by created_at,id',[q])).rows
  assert.equal(shared.filter(m=>m.operation==='reply').length,2)
  assert.equal(JSON.stringify(shared).includes('ENDAST INTERNT'),false)
  assert.equal(shared.find(m=>m.id===share.requestId).snapshot.description,body().description)
  await assert.rejects(db.query('update action_case_question_messages set message=$1 where id=$2',['rewrite',share.requestId]),/IMMUTABLE/)
  await chat(q,dialogue(q,await version(q),'participants',{participants:[...refs,{kind:'contact',id:late}]}))
  const newcomer=await member(q,late)
  await assert.rejects(chat(q,dialogue(q,await version(q),'reply',{text:'Not invited yet'}),null,newcomer.id,newcomer.link_nonce),/NOT_FOUND/)
  await chat(q,dialogue(q,await version(q),'share',{confirmed:true}))
  const reloaded=await member(q,late)
  await chat(q,dialogue(q,0,'reply',{text:'Ny deltagare kan svara.'}),null,reloaded.id,reloaded.link_nonce)
  await chat(q,dialogue(q,await version(q),'participants',{participants:[{kind:'contact',id:late},{kind:'profile',id:staff}]}))
  await assert.rejects(chat(q,dialogue(q,0,'reply',{text:'Old link'}),null,invited.id,invited.link_nonce),/NOT_FOUND/)
  assert.notEqual((await member(q,first)).link_nonce,invited.link_nonce)
  const deliveries=(await db.query('select * from action_case_question_deliveries where message_id in(select id from action_case_question_messages where question_id=$1)',[q])).rows
  assert.ok(deliveries.every(d=>!d.body_text.includes('underlag.')&&!d.body_text.includes('ENDAST INTERNT')))
})

test('manager transfer revokes automatic manager membership but preserves explicit participation and administrator appointment checks',async()=>{
  const staff=id(101), q=id(120)
  await write(mutation(q,0,'create',{body:body()}),org,caseId,staff)
  assert.equal((await member(q,actor)).added_as_manager,true)
  await db.query('select set_project_manager($1,$2,$3,$4,$3)',[org,caseId,actor,staff])
  assert.equal(await canRead(q,actor),false);assert.equal(await canRead(q,staff),true)
  await assert.rejects(chat(q,dialogue(q,0,'participants',{participants:[]})),/NOT_FOUND/)
  await chat(q,dialogue(q,0,'participants',{participants:[]}),staff)
  await assert.rejects(db.query('select set_project_manager($1,$2,$3,$3,$3)',[org,caseId,actor]),/MANAGER_STALE/)
  await db.query('select set_project_manager($1,$2,$3,$3,$4)',[org,caseId,actor,staff])
  assert.equal(await canRead(q,actor),true);assert.equal(await canRead(q,staff),true)
})

test('personal question links are purpose-bound, unforgeable, key-specific and use the persisted revocation nonce',()=>{
  const key='test-only-secret-'.repeat(4), token=questionLinkToken(id(130),id(131),key)
  assert.deepEqual(parseQuestionLink(token,key),{participantId:id(130),nonce:id(131)})
  for(const bad of [token.replace(id(130),id(132)),token.replace(id(131),id(133)),`${token.slice(0,-1)}!`,'bad'])assert.throws(()=>parseQuestionLink(bad,key),/NOT_FOUND/)
  assert.throws(()=>parseQuestionLink(token,key+'changed'),/NOT_FOUND/)
  assert.throws(()=>dialogueMutation({operation:'participants',version:0,requestId:randomUUID(),participants:[{id:id(1),kind:'profile'},{id:id(1),kind:'profile'}]}),/INVALID/)
})

test('sharing rejects stale recipient details, deduplicates one person and prevents cross-question private files',async()=>{
  const q=id(140), otherQuestion=id(141), first=id(142), copy=id(143), file=id(144)
  await db.query("insert into organization_contacts(id,org_id,name,email,is_active) values($1,$3,'Samma Person','same@example.invalid',true),($2,$3,'Samma Person','same@example.invalid',true)",[first,copy,org])
  await write(mutation(q,0,'create',{body:body()}));await write(mutation(otherQuestion,0,'create',{body:body()}))
  await chat(q,dialogue(q,0,'participants',{participants:[{kind:'contact',id:first},{kind:'contact',id:copy}]}))
  assert.equal((await db.query("select count(*)::int n from action_case_question_participants where question_id=$1 and active and person_kind='contact'",[q])).rows[0].n,1)
  await db.query('update organization_contacts set email=$1 where id=$2',['changed@example.invalid',first])
  await assert.rejects(chat(q,dialogue(q,1,'share',{confirmed:true})),/ASSIGNEE/)
  assert.equal((await member(q,first)).shared,false)
  await db.query('update organization_contacts set email=$1 where id=$2',['same@example.invalid',first])
  await db.query("insert into action_case_attachments(id,org_id,action_case_id,file_name,storage_bucket,file_path,content_type,file_size_bytes,attachment_type,question_id) values($1,$2,$3,'Privat.pdf','project-question-files','private.pdf','application/pdf',120,'document',$4)",[file,org,caseId,otherQuestion])
  await assert.rejects(chat(q,dialogue(q,1,'share',{confirmed:true,fileIds:[file]})),/FILES/)
  await assert.rejects(write(mutation(q,1,'note',{text:'Wrong scope',fileIds:[file]})),/FILES/)
  await chat(q,dialogue(q,1,'share',{confirmed:true}))
  const claimed=(await db.query('select * from claim_project_question_delivery($1)',[q])).rows[0]
  assert.equal(claimed.attempts,1)
  assert.equal((await db.query('select * from claim_project_question_delivery($1)',[q])).rows.length,0)
  await db.query('select finish_project_question_delivery($1,$2,null)',[claimed.id,claimed.attempts])
  assert.equal((await db.query('select * from claim_project_question_delivery($1)',[q])).rows.length,0)
  await db.query("update action_case_question_deliveries set claimed_until=now()-interval '1 second' where id=$1",[claimed.id])
  const retry=(await db.query('select * from claim_project_question_delivery($1)',[q])).rows[0]
  assert.equal(retry.id,claimed.id);assert.equal(retry.attempts,2)
  await db.query('select finish_project_question_delivery($1,$2,$3)',[claimed.id,1,'stale-provider'])
  assert.equal((await db.query('select status from action_case_question_deliveries where id=$1',[claimed.id])).rows[0].status,'sending')
  await chat(q,dialogue(q,await version(q),'participants',{participants:[]}))
  await db.query('select * from claim_project_question_delivery($1)',[q])
  assert.equal((await db.query('select status from action_case_question_deliveries where id=$1',[claimed.id])).rows[0].status,'cancelled')
})
