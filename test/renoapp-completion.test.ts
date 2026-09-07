import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
// @ts-expect-error Node's strip-types runner requires the TypeScript extension.
import { selectCompletionItems, completionMessage, type CompletionItem } from '../src/lib/renoapp/completion.ts'

const db = new PGlite()
const docType = randomUUID(), role = randomUUID(), otherRole = randomUUID()
const migration = readFileSync(new URL('../docs/db/2026-09-07_03_renoapp_completion_rounds.sql', import.meta.url), 'utf8')
const items: CompletionItem[] = [
  { id: `document:${docType}`, category: 'document', label: 'Drawing', correction: false },
  { id: `participant:${role}`, category: 'participant', label: 'Plumber', correction: false },
]

before(async () => {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table renovation_cases(id uuid primary key, status text not null, applicant_contact_id uuid,
      description text, updated_at timestamptz default now());
    create table renovation_document_types(id uuid primary key, label text);
    create table renoapp_participant_roles(id uuid primary key, label text);
    create table renovation_case_messages(id uuid primary key default gen_random_uuid(),
      case_id uuid references renovation_cases on delete cascade, type text, author_role text,
      author_profile_id uuid, author_contact_id uuid, message text, metadata jsonb, created_at timestamptz default now());
    create table renoapp_case_requirement_decisions(case_id uuid references renovation_cases on delete cascade,
      document_type_id uuid, participant_role_id uuid, decision text);
    create table renoapp_case_participants(id uuid primary key default gen_random_uuid(),
      case_id uuid references renovation_cases on delete cascade, participant_role_id uuid references renoapp_participant_roles,
      company_name text, org_number text, contact_name text, email text, phone text, certification_reference text,
      has_verified_authorization boolean, accepts_responsibility boolean, unique(case_id,participant_role_id));
    create table case_access_links(case_id uuid references renovation_cases on delete cascade, token_hash text unique,
      revoked_at timestamptz, expires_at timestamptz, scope text default 'answer_questions');
    create table renovation_case_documents(id uuid primary key default gen_random_uuid(),
      case_id uuid references renovation_cases on delete cascade, document_type_id uuid, participant_role_id uuid);
  `)
  await db.query('insert into renovation_document_types values($1,$2)', [docType, 'Drawing'])
  await db.query('insert into renoapp_participant_roles values($1,$2),($3,$4)', [role, 'Plumber', otherRole, 'Builder'])
  await db.exec(migration)
})
after(async () => { await db.close() })

async function fixture() {
  const id = randomUUID(), token = randomUUID()
  await db.query("insert into renovation_cases(id,status,description) values($1,'draft','Original renovation')", [id])
  const document = (await db.query<{ id: string }>('insert into renovation_case_documents(case_id,document_type_id) values($1,$2) returning id', [id, docType])).rows[0].id
  await db.query("update renovation_cases set status='review' where id=$1", [id])
  await db.query("insert into case_access_links(case_id,token_hash,revoked_at,expires_at) values($1,$2,null,now()+interval '14 days')", [id, token])
  await db.query("insert into renoapp_case_requirement_decisions values($1,$2,null,'requested'),($1,null,$3,'requested')", [id, docType, role])
  await db.query("insert into renoapp_case_participants(case_id,participant_role_id,company_name) values($1,$2,'Original plumber'),($1,$3,'Original builder')", [id, role, otherRole])
  return { id, token, document }
}
async function publish(id: string, previous: string | null = null, selected = items.map(item => item.id), requestId = randomUUID(), requestedItems = items, status = 'review') {
  await db.query('select renoapp_publish_completion($1,$2,$3,$4,$5,$6,$7,$8)',
    [id, requestId, previous, status, randomUUID(), JSON.stringify(requestedItems), JSON.stringify(selected), completionMessage(requestedItems, 'Please complete')])
  return requestId
}
const participant = (companyName = 'New plumber', confirmed = true) => ({ participantRoleId: role, companyName,
  hasVerifiedAuthorization: confirmed, acceptsResponsibility: confirmed })
async function save(id: string, token: string, request: string, revision = 0, submit = false, participants = [participant()], reply = 'Saved reply') {
  return (await db.query<{ result: { revision: number; submitted: boolean } }>('select renoapp_save_completion($1,$2,$3,$4,$5,$6,$7) result',
    [id, request, token, revision, JSON.stringify(participants), reply, submit])).rows[0].result
}

test('only missing requested items and explicitly requested corrections are sent', () => {
  const rows = [
    { ...items[0], checked: true, requirementDecision: 'requested' as const },
    { ...items[1], checked: false, requirementDecision: 'requested' as const },
    { ...items[0], id: 'document:ignored', checked: false, requirementDecision: 'not_requested' as const },
  ]
  assert.deepEqual(selectCompletionItems(rows).map(item => item.id), [items[1].id])
  const selected = selectCompletionItems(rows, [items[0].id])
  assert.equal(selected[0].correction, true)
  assert.match(completionMessage(selected, 'Explain here'), /Explain here/)
  assert.equal(completionMessage([], '  '), '')
})

test('publication is atomic, repeatable and separate from later board edits', async () => {
  const f = await fixture(), requestId = await publish(f.id)
  await publish(f.id, null, undefined, requestId)
  assert.equal((await db.query('select id from renovation_case_messages where case_id=$1', [f.id])).rows.length, 1)
  await db.query("update renoapp_case_requirement_decisions set decision='not_requested' where case_id=$1", [f.id])
  const round = (await db.query<{ items: CompletionItem[] }>('select items from renoapp_completion_requests where id=$1', [requestId])).rows[0]
  assert.deepEqual(round.items, items)
  assert.equal((await save(f.id, f.token, requestId)).revision, 1)
})

test('autosave keeps final participants unchanged; submit preserves base fields, earlier documents and other roles', async () => {
  const f = await fixture(), round = await publish(f.id)
  const saved = await save(f.id, f.token, round, 0, false, [participant('Partially typed', false)])
  assert.equal(saved.revision, 1)
  assert.equal((await db.query<{ company_name: string }>('select company_name from renoapp_case_participants where case_id=$1 and participant_role_id=$2', [f.id, role])).rows[0].company_name, 'Original plumber')
  assert.deepEqual((await db.query<{ draft: unknown }>('select draft from renoapp_completion_requests where id=$1', [round])).rows[0].draft,
    { participantEntries: [participant('Partially typed', false)], replyMessage: 'Saved reply' })
  await assert.rejects(save(f.id, f.token, round, 1, true, [participant('Missing confirmations', false)]), /PARTICIPANT_CONFIRMATION_REQUIRED/)
  assert.equal((await save(f.id, f.token, round, 1, true)).submitted, true)
  assert.deepEqual((await db.query('select status,description from renovation_cases where id=$1', [f.id])).rows[0], { status: 'review', description: 'Original renovation' })
  const companies = (await db.query<{ company_name: string }>('select company_name from renoapp_case_participants where case_id=$1', [f.id])).rows.map(row => row.company_name).sort()
  assert.deepEqual(companies, ['New plumber', 'Original builder'])
  assert.equal((await db.query('select id from renovation_case_documents where id=$1', [f.document])).rows.length, 1)
  await assert.rejects(save(f.id, f.token, round, 2, true), /COMPLETION_CHANGED/)
})

test('new rounds reuse the case and preserve previous data while rejecting stale tabs', async () => {
  const f = await fixture(), first = await publish(f.id)
  await save(f.id, f.token, first, 0, true)
  const second = await publish(f.id, first)
  await assert.rejects(save(f.id, f.token, first, 1), /COMPLETION_CHANGED/)
  await save(f.id, f.token, second, 0, false, [participant('Second round draft')], 'Second reply')
  await assert.rejects(save(f.id, f.token, second, 0), /COMPLETION_DRAFT_CHANGED/)
  const third = await publish(f.id, second, undefined, undefined, items, 'need_info')
  assert.deepEqual((await db.query<{ draft: unknown }>('select draft from renoapp_completion_requests where id=$1', [third])).rows[0].draft,
    { participantEntries: [participant('Second round draft')], replyMessage: 'Second reply' })
  await assert.rejects(publish(f.id, second, undefined, undefined, items, 'need_info'), /COMPLETION_CHANGED/)
})

test('expired/revoked tokens and unrequested company edits cannot save or submit', async () => {
  const f = await fixture(), round = await publish(f.id)
  await assert.rejects(save(f.id, f.token, round, 0, false, [{ ...participant(), participantRoleId: otherRole }]), /COMPLETION_BASE_FIELDS_LOCKED/)
  await db.query("update case_access_links set scope='read' where token_hash=$1", [f.token])
  await assert.rejects(save(f.id, f.token, round), /DRAFT_LINK_INVALID/)
  await db.query("update case_access_links set scope='answer_questions' where token_hash=$1", [f.token])
  await db.query("update case_access_links set expires_at=now()-interval '1 day' where token_hash=$1", [f.token])
  await assert.rejects(save(f.id, f.token, round), /DRAFT_LINK_INVALID/)
  await db.query("update case_access_links set expires_at=now()+interval '14 days',revoked_at=now() where token_hash=$1", [f.token])
  await assert.rejects(save(f.id, f.token, round), /DRAFT_LINK_INVALID/)
})

test('document guards use the sent round; submitted files cannot be removed', async () => {
  const f = await fixture(), round = await publish(f.id)
  await assert.rejects(db.query('delete from renovation_case_documents where id=$1', [f.document]), /COMPLETION_PREVIOUS_DOCUMENT/)
  await db.query("update renoapp_case_requirement_decisions set decision='not_requested' where case_id=$1", [f.id])
  const uploaded = (await db.query<{ id: string }>('insert into renovation_case_documents(case_id,document_type_id,completion_request_id) values($1,$2,$3) returning id', [f.id, docType, round])).rows[0].id
  await db.query('delete from renovation_case_documents where id=$1', [uploaded])
  await assert.rejects(db.query('insert into renovation_case_documents(case_id,participant_role_id,completion_request_id) values($1,$2,$3)', [f.id, otherRole, round]), /COMPLETION_CHANGED/)
  await db.query('insert into renovation_case_documents(case_id,document_type_id,completion_request_id) values($1,$2,$3)', [f.id, docType, round])
  await save(f.id, f.token, round, 0, true)
  await assert.rejects(db.query('insert into renovation_case_documents(case_id,document_type_id) values($1,$2)', [f.id, docType]), /COMPLETION_CHANGED/)
  await db.query('delete from renovation_cases where id=$1', [f.id])
  assert.equal((await db.query('select id from renovation_case_documents where case_id=$1', [f.id])).rows.length, 0)
})

test('stale board choices and failed participant inserts roll back the entire transition', async () => {
  const f = await fixture()
  await assert.rejects(publish(f.id, null, []), /COMPLETION_REQUIREMENTS_CHANGED/)
  assert.equal((await db.query('select id from renoapp_completion_requests where case_id=$1', [f.id])).rows.length, 0)
  const round = await publish(f.id)
  await db.exec("alter table renoapp_case_participants add constraint test_company_failure check(company_name <> 'Fail insert')")
  try {
    await assert.rejects(save(f.id, f.token, round, 0, true, [participant('Fail insert')]), /test_company_failure/)
    assert.equal((await db.query<{ status: string }>('select status from renovation_cases where id=$1', [f.id])).rows[0].status, 'need_info')
    assert.equal((await db.query<{ revision: number }>('select revision from renoapp_completion_requests where id=$1', [round])).rows[0].revision, 0)
    assert.equal((await db.query<{ company_name: string }>('select company_name from renoapp_case_participants where case_id=$1 and participant_role_id=$2', [f.id, role])).rows[0].company_name, 'Original plumber')
  } finally { await db.exec('alter table renoapp_case_participants drop constraint test_company_failure') }
})

test('migration backfills the latest legacy request once and remains rerunnable', async () => {
  const f = await fixture(), older = randomUUID(), latest = randomUUID()
  await db.query("update renovation_cases set status='need_info' where id=$1", [f.id])
  await db.query("insert into renovation_case_messages(id,case_id,type,message,created_at) values($1,$2,'request_for_info','Old',now()-interval '1 day'),($3,$2,'request_for_info','Latest',now())", [older, f.id, latest])
  await db.exec(migration)
  await db.exec(migration)
  assert.deepEqual((await db.query('select id,message,submitted_at from renoapp_completion_requests where case_id=$1', [f.id])).rows,
    [{ id: latest, message: 'Latest', submitted_at: null }])
})
