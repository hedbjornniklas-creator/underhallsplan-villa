import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite(), id = () => randomUUID()
const org = id(), project = id(), manager = id(), outsider = id(), qid = id(), task = id()
const contact = id(), contact2 = id(), authUser = id(), authUser2 = id(), identity = id(), identity2 = id(), member = id(), managerMember = id()
const migration = readFileSync(new URL('../docs/db/2026-11-18_01_recipient_participation.sql', import.meta.url), 'utf8')
const call = (name, args) => db.query(`select ${name}(${args.map((_, i) => `$${i + 1}`).join(',')}) value`, args)
const scopes = async (user = authUser, question = qid) => (await db.query('select * from resolve_recipient_question_scope($1,$2)', [user, question])).rows
const reply = (user = authUser, question = qid, patch = {}) => call('reply_recipient_project_question', [user, question, { requestId: id(), operation: 'reply', text: 'Public reply', fileIds: [], version: 0, ...patch }])

before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth;
    create function auth.role() returns text language sql as $$select coalesce(current_setting('test.role',true),'service_role')$$;
    create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);
    create table task_recipient_identities(id uuid primary key default gen_random_uuid(),auth_user_id uuid,email_normalized text,status text);
    create table organization_contacts(id uuid primary key default gen_random_uuid(),org_id uuid,name text,email text,is_active boolean,preferred_channel text,recipient_identity_id uuid);
    create table action_cases(id uuid primary key,org_id uuid,title text,manager_profile_id uuid);
    create table action_case_questions(id uuid primary key,org_id uuid,action_case_id uuid,number int,body jsonb,revision int default 1,updated_at timestamptz default now());
    create table action_case_question_conversations(question_id uuid primary key,shared_body jsonb,shared_at timestamptz,version int default 0);
    create table action_case_question_events(id uuid primary key,org_id uuid,action_case_id uuid,question_id uuid,task_id uuid,operation text,body jsonb,actor_id uuid,actor_name text,created_at timestamptz default now());
    create table action_case_question_participants(id uuid primary key default gen_random_uuid(),org_id uuid,action_case_id uuid,question_id uuid,person_kind text,person_id uuid,name text,email text,contact_id uuid,active boolean default true,shared boolean default false,link_nonce uuid default gen_random_uuid(),link_expires_at timestamptz,joined_at timestamptz default now());
    create table action_case_question_messages(id uuid primary key,question_id uuid,participant_id uuid,operation text,actor_name text,actor_method text check(actor_method in('internal_login','personal_link')),message text default '',snapshot jsonb,request jsonb,created_at timestamptz default now());
    create table action_case_question_message_files(message_id uuid,attachment_id uuid,file_name text);
    create table action_case_question_deliveries(id uuid primary key default gen_random_uuid(),message_id uuid,participant_id uuid,link_nonce uuid,recipient_name text,recipient_email text,question_title text,body_text text,created_at timestamptz default now());
    create table action_case_attachments(id uuid primary key,org_id uuid,file_name text);
    create table operational_tasks(id uuid primary key,org_id uuid,assignee_contact_id uuid,issuer_profile_id uuid,archived_at timestamptz,status text default 'assigned');
    create table task_recipient_portal_grants(id uuid primary key default gen_random_uuid(),org_id uuid,contact_id uuid,task_id uuid,recipient_identity_id uuid,revoked_at timestamptz,revocation_reason text,granted_at timestamptz default now());
    create table task_access_links(id uuid primary key default gen_random_uuid(),org_id uuid,contact_id uuid,task_id uuid,revoked_at timestamptz,sent_at timestamptz);
    create table task_events(id uuid primary key default gen_random_uuid(),org_id uuid,task_id uuid,event_type text,metadata jsonb,created_at timestamptz default now());
    create function project_question_internal_participant(uuid,uuid,uuid,uuid) returns boolean language sql as $$select exists(select 1 from action_case_question_participants where org_id=$1 and action_case_id=$2 and question_id=$3 and person_id=$4 and person_kind='profile' and active)$$;
    create function ensure_task_recipient_identity_for_contact(uuid) returns task_recipient_identities language plpgsql as $$declare result task_recipient_identities;begin
      select i.* into result from task_recipient_identities i join organization_contacts c on c.id=$1 and c.recipient_identity_id=i.id;
      return result;
    end$$;`)
  await db.query('insert into auth.users values($1,$2,now()),($3,$4,now())', [authUser, 'one@example.invalid', authUser2, 'two@example.invalid'])
  await db.query('insert into task_recipient_identities values($1,$2,$3,$4),($5,$6,$7,$4)', [identity, authUser, 'one@example.invalid', 'active', identity2, authUser2, 'two@example.invalid'])
  await db.query('insert into organization_contacts values($1,$2,$3,$4,true,$5,$6),($7,$2,$8,$9,true,$5,$10)', [contact, org, 'One', 'one@example.invalid', 'email', identity, contact2, 'Two', 'two@example.invalid', identity2])
  await db.query('insert into action_cases values($1,$2,$3,$4)', [project, org, 'Synthetic project', manager])
  await db.query('insert into action_case_questions(id,org_id,action_case_id,number,body) values($1,$2,$3,12,$4)', [qid, org, project, { title: 'PRIVATE UNSHARED EDIT', description: 'PRIVATE NOTE', status: 'open', attachmentIds: [id()] }])
  await db.query('insert into action_case_question_conversations(question_id) values($1)', [qid])
  await db.query('insert into operational_tasks(id,org_id,assignee_contact_id,issuer_profile_id,archived_at) values($1,$2,$3,$4,null)', [task, org, contact2, manager])
  await db.query('insert into action_case_question_events(id,org_id,action_case_id,question_id,task_id,operation,body,actor_id,actor_name,created_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,now()-interval \'5 days\')', [id(), org, project, qid, task, 'send', { title: 'PUBLISHED QUESTION', description: 'Published scope', internal: 'MUST NOT COPY', attachmentIds: [id()] }, manager, 'Manager'])
  await db.query('insert into action_case_question_participants(id,org_id,action_case_id,question_id,person_kind,person_id,name,email) values($1,$2,$3,$4,$5,$6,$7,$8),($9,$2,$3,$4,$10,$11,$12,$13)', [member, org, project, qid, 'contact', contact, 'One', 'one@example.invalid', managerMember, 'profile', manager, 'Manager', 'manager@example.invalid'])
  await db.exec(migration)
})
after(() => db.close())

test('backfill publishes only the old explicit snapshot and binds participation to verified identity', async () => {
  const snapshot = (await call('project_question_published_snapshot', [qid])).rows[0].value
  assert.equal(snapshot.title, 'PUBLISHED QUESTION'); assert.equal(snapshot.description, 'Published scope')
  assert.equal('internal' in snapshot, false); assert.equal('attachmentIds' in snapshot, false)
  assert.equal((await scopes()).length, 1); assert.equal((await scopes(outsider)).length, 0)
  assert.equal((await scopes())[0].contact_id, contact)
  assert.equal((await db.query('select body from action_case_questions where id=$1', [qid])).rows[0].body.title, 'PRIVATE UNSHARED EDIT')
})

test('later participants get the complete published history without changing the private draft or sending mail', async () => {
  const before = (await db.query('select count(*) n from action_case_question_deliveries')).rows[0].n
  await db.query('insert into action_case_question_participants(org_id,action_case_id,question_id,person_kind,person_id,name,email) values($1,$2,$3,$4,$5,$6,$7)', [org, project, qid, 'contact', contact2, 'Two', 'two@example.invalid'])
  const added = (await scopes(authUser2))[0]
  assert.equal(added.shared, true); assert.ok(added.link_expires_at)
  assert.equal((await call('project_question_published_snapshot', [qid])).rows[0].value.title, 'PUBLISHED QUESTION')
  assert.equal((await db.query('select count(*) n from action_case_question_deliveries')).rows[0].n, before)
})

test('a reply is authenticated, append-only, idempotent, and cannot select an unshared file or change status', async () => {
  const request = { requestId: id(), operation: 'reply', text: 'Public answer', fileIds: [], version: 0 }
  const first = await reply(authUser, qid, request); await reply(authUser, qid, request)
  assert.equal(first.rows[0].value, request.requestId)
  assert.equal((await db.query('select count(*) n from action_case_question_messages where id=$1', [request.requestId])).rows[0].n, 1)
  assert.equal((await db.query('select actor_method from action_case_question_messages where id=$1', [request.requestId])).rows[0].actor_method, 'recipient_login')
  await assert.rejects(reply(outsider), /NOT_FOUND/)
  await assert.rejects(reply(authUser, qid, { operation: 'participants' }), /INVALID/)
  await assert.rejects(reply(authUser, qid, { fileIds: [id()] }), /FILES/)
  assert.equal((await db.query('select body from action_case_questions where id=$1', [qid])).rows[0].body.status, 'open')
})

test('resending preserves the shared snapshot, queues only the selected person and survives a retry', async () => {
  await db.exec("update action_case_question_deliveries set created_at=now()-interval '1 minute'")
  const request = id(), priorBody = (await db.query('select body from action_case_questions where id=$1', [qid])).rows[0].body
  const args = [org, project, qid, manager, member, request]
  await call('resend_project_question_link', args); await call('resend_project_question_link', args)
  const deliveries = (await db.query('select * from action_case_question_deliveries where message_id=$1', [request])).rows
  assert.equal(deliveries.length, 1); assert.equal(deliveries[0].participant_id, member)
  const audit = (await db.query('select snapshot from action_case_question_messages where id=$1', [request])).rows[0]
  assert.equal(audit.snapshot.title, 'PUBLISHED QUESTION'); assert.equal('attachmentIds' in audit.snapshot, false)
  assert.deepEqual((await db.query('select body from action_case_questions where id=$1', [qid])).rows[0].body, priorBody)
  await assert.rejects(call('resend_project_question_link', [org, project, qid, outsider, member, id()]), /FORBIDDEN/)
})

test('former task recipient keeps a read-only publication after reassignment, not a current assignee grant', async () => {
  const grant = id()
  await db.query("insert into task_recipient_portal_grants(id,org_id,contact_id,task_id,recipient_identity_id,revoked_at,revocation_reason,granted_at) values($1,$2,$3,$4,$5,now(),'task_reassigned_awaiting_dispatch',now()-interval '5 days')", [grant, org, contact, task, identity])
  await db.query("insert into task_access_links(org_id,contact_id,task_id,revoked_at,sent_at) values($1,$2,$3,now(),now()-interval '4 days')", [org, contact, task])
  await db.query("insert into task_events(org_id,task_id,event_type,metadata,created_at) values($1,$2,'task_recipient_changed',$3,now()-interval '1 second')", [org, task, { before: { assigneeContactId: contact, title: 'Originally sent task', description: 'Published only' } }])
  const rows = (await db.query('select * from resolve_recipient_task_participation($1,$2)', [authUser, task])).rows
  assert.equal(rows.length, 1); assert.equal(rows[0].snapshot.title, 'Originally sent task')
  assert.ok((await db.query('select revoked_at from task_recipient_portal_grants where id=$1', [grant])).rows[0].revoked_at)
  assert.ok((await db.query('select revoked_at from task_access_links where task_id=$1', [task])).rows[0].revoked_at)
})

test('a responsibility roundtrip without another send cannot expand the previous publication', async () => {
  await db.query("update task_access_links set revoked_at=now()-interval '1 hour' where task_id=$1", [task])
  await db.query("update task_events set created_at=(select min(revoked_at) from task_access_links where task_id=$1) where task_id=$1", [task])
  await db.query("update task_recipient_portal_grants set granted_at=now()-interval '1 minute',revoked_at=now() where task_id=$1", [task])
  await db.query("insert into task_events(org_id,task_id,event_type,metadata) values($1,$2,'task_recipient_changed',$3)", [org, task, { before: { assigneeContactId: contact, title: 'NEW PRIVATE DRAFT' } }])
  const result = (await db.query('select * from resolve_recipient_task_participation($1,$2)', [authUser, task])).rows[0]
  assert.equal(result.snapshot.title, 'Originally sent task')
  assert.ok(Date.parse(result.shared_until) < Date.now() - 50 * 60 * 1000)
})

test('resending within one assignment preserves earlier replies in that assignment', async () => {
  const before = (await db.query('select * from resolve_recipient_task_participation($1,$2)', [authUser, task])).rows[0]
  await db.query("insert into task_access_links(org_id,contact_id,task_id,revoked_at,sent_at) values($1,$2,$3,$4,now()-interval '2 days')", [org, contact, task, before.shared_until])
  const after = (await db.query('select * from resolve_recipient_task_participation($1,$2)', [authUser, task])).rows[0]
  assert.equal(after.shared_from.getTime(), before.shared_from.getTime())
  assert.equal(after.shared_until.getTime(), before.shared_until.getTime())
  assert.equal(after.snapshot.title, before.snapshot.title)
})

test('participant removal revokes every route; readding sees previous shared history but not old anonymous tokens', async () => {
  const nonce = (await scopes())[0].link_nonce
  await db.query('update action_case_question_participants set active=false,shared=false,link_nonce=gen_random_uuid() where id=$1', [member])
  assert.equal((await scopes()).length, 0)
  assert.equal((await db.query('select * from resolve_recipient_task_participation($1,$2)', [authUser, task])).rows.length, 0)
  await assert.rejects(reply(), /NOT_FOUND/)
  await db.query('update action_case_question_participants set active=true where id=$1', [member])
  assert.equal((await scopes()).length, 1); assert.notEqual((await scopes())[0].link_nonce, nonce)
})

test('unverified, disabled, email-changed and foreign-organization identities cannot read participation', async () => {
  await db.query('update auth.users set email_confirmed_at=null where id=$1', [authUser]); assert.equal((await scopes()).length, 0)
  await db.query('update auth.users set email_confirmed_at=now(),email=$2 where id=$1', [authUser, 'other@example.invalid']); assert.equal((await scopes()).length, 0)
  await db.query('update auth.users set email=$2 where id=$1', [authUser, 'one@example.invalid'])
  await db.query("update task_recipient_identities set status='disabled' where id=$1", [identity]); assert.equal((await scopes()).length, 0)
  await db.query("update task_recipient_identities set status='active' where id=$1", [identity])
  await db.query('update organization_contacts set org_id=$2 where id=$1', [contact, id()]); assert.equal((await scopes()).length, 0)
  await db.query('update organization_contacts set org_id=$2 where id=$1', [contact, org])
})

test('closed questions remain readable; normal login cannot call the service-only functions', async () => {
  await db.query("update action_case_questions set body=jsonb_set(body,'{status}','\"closed\"') where id=$1", [qid])
  assert.equal((await scopes()).length, 1); await assert.rejects(reply(), /CLOSED/)
  await db.exec("select set_config('test.role','authenticated',false)")
  await assert.rejects(scopes(), /FORBIDDEN/)
  await db.exec("select set_config('test.role','service_role',false)")
  assert.equal((await db.query("select has_function_privilege('authenticated','resolve_recipient_question_scope(uuid,uuid)','execute') value")).rows[0].value, false)
  assert.equal((await db.query("select has_function_privilege('anon','reply_recipient_project_question(uuid,uuid,jsonb)','execute') value")).rows[0].value, false)
})

test('migration can be repeated without changing question bodies or message history', async () => {
  const before = (await db.query('select body,revision from action_case_questions where id=$1', [qid])).rows[0]
  const count = (await db.query('select count(*) n from action_case_question_messages')).rows[0].n
  await db.exec(migration)
  assert.deepEqual((await db.query('select body,revision from action_case_questions where id=$1', [qid])).rows[0], before)
  assert.equal((await db.query('select count(*) n from action_case_question_messages')).rows[0].n, count)
})
