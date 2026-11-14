import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID as id } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite(), org = id(), otherOrg = id(), actor = id(), coworker = id(), outsider = id()
const migration = readFileSync(new URL('../docs/db/2026-11-14_02_work_instructions.sql', import.meta.url), 'utf8')
const write = async (f, data, who = actor, organization = org) => (await db.query('select write_work_instructions($1,$2,$3,$4,$5) result', [organization, f.caseId, f.itemId, who, data])).rows[0].result
const request = (patch = {}) => ({ requestId: id(), revision: 0, body: { text: 'Fiktiv monteringsinstruktion.', files: [] }, ...patch })
const snapshot = async () => (await db.query("select jsonb_build_object('projects',(select jsonb_agg(p order by id) from action_cases p),'work',(select jsonb_agg(i order by id) from action_case_items i),'business',(select jsonb_agg(s order by id) from business_sentinels s)) data")).rows[0].data
async function fixture(locked = true, status = 'in_progress', organization = org) {
  const f = { caseId: id(), itemId: id(), fileId: id(), diaryEntryId: id(), photoId: id(), privateFileId: id() }
  await db.query('insert into action_cases values($1,$2,$3)', [f.caseId, organization, status])
  await db.query("insert into action_case_items values($1,$2,$3,$4,'Oförändrad omfattning',12345,'2026-11-14T08:00:00Z')", [f.itemId, organization, f.caseId, locked])
  await db.query("insert into action_case_attachments values($1,$2,$3,null,'Monteringsanvisning.pdf','application/pdf',123),($4,$2,$3,$5,'Privat fråga.pdf','application/pdf',321)", [f.fileId, organization, f.caseId, f.privateFileId, id()])
  await db.query('insert into action_case_diary_entries values($1,$2,$3)', [f.diaryEntryId, organization, f.caseId])
  await db.query("insert into action_case_diary_photos values($1,$2,'Detaljbild.jpg','image/jpeg',100)", [f.photoId, f.diaryEntryId])
  return f
}
before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth;
    create function auth.role() returns text language sql as $$select coalesce(current_setting('request.jwt.claim.role',true),'service_role')$$;
    create table organizations(id uuid primary key); create table profiles(id uuid primary key,full_name text,email text);
    create table org_members(org_id uuid,profile_id uuid,is_active boolean);
    create table action_cases(id uuid primary key,org_id uuid,status text);
    create table action_case_items(id uuid primary key,org_id uuid,action_case_id uuid references action_cases(id) on delete cascade,locked boolean,scope text,customer_price numeric,updated_at timestamptz);
    create function locked_work_guard() returns trigger language plpgsql as $$begin if old.locked then raise exception 'ACTION_CASE_CONTRACT_LOCKED'; end if; return new; end$$;
    create trigger locked_work before update on action_case_items for each row execute function locked_work_guard();
    create table action_case_attachments(id uuid primary key,org_id uuid,action_case_id uuid,question_id uuid,file_name text,content_type text,file_size_bytes bigint);
    create table action_case_diary_entries(id uuid primary key,org_id uuid,action_case_id uuid);
    create table action_case_diary_photos(id uuid primary key,entry_id uuid references action_case_diary_entries(id),name text,content_type text,size_bytes bigint);
    create table business_sentinels(id text primary key,body jsonb);
    insert into business_sentinels values('lockedContract','{"locked":true,"price":250000}'),('calculation','{"cost":19000}'),('offer','{"scope":"unchanged"}'),('planning','{"unchanged":true}');`)
  await db.query('insert into organizations values($1),($2)', [org, otherOrg])
  await db.query("insert into profiles values($1,'Testledare','test@example.invalid'),($2,'Kollega','colleague@example.invalid'),($3,'Annan','other@example.invalid')", [actor,coworker,outsider])
  await db.query('insert into org_members values($1,$2,true),($1,$3,true),($4,$5,true)', [org,actor,coworker,otherOrg,outsider])
  const before = await snapshot()
  await db.exec(migration); await db.exec(migration)
  assert.deepEqual(await snapshot(), before)
})
after(() => db.close())

test('instructions remain editable on locked work without changing scope, cost, prices, timestamps or contract snapshots', async () => {
  const f = await fixture(), before = await snapshot()
  await assert.rejects(db.query("update action_case_items set scope='Forbidden' where id=$1", [f.itemId]), /CONTRACT_LOCKED/)
  const data = request({ body: { text: 'Läggning enligt separat monteringsanvisning.', files: [{ source: 'project', id: f.fileId }, { source: 'diary', id: f.photoId }] } })
  const receipt = await write(f, data)
  assert.equal(receipt.requestId, data.requestId); assert.equal(receipt.revision, 1)
  assert.deepEqual((await db.query('select attachment_id,diary_photo_id,file_name from action_case_instruction_files where item_id=$1 order by position', [f.itemId])).rows, [
    { attachment_id: f.fileId, diary_photo_id: null, file_name: 'Monteringsanvisning.pdf' }, { attachment_id: null, diary_photo_id: f.photoId, file_name: 'Detaljbild.jpg' }])
  assert.deepEqual(await snapshot(), before)
  await assert.rejects(db.query("update action_case_items set scope='Still forbidden' where id=$1", [f.itemId]), /CONTRACT_LOCKED/)
  await db.exec(migration)
  assert.deepEqual(await write(f, data), receipt)
  assert.deepEqual(await snapshot(), before)
})

test('exact retries acknowledge their original version; stale tabs, changed retry payloads and other actors cannot overwrite it', async () => {
  const f = await fixture(), first = request(), receipt = await write(f, first)
  assert.deepEqual(await write(f, first), receipt)
  await assert.rejects(write(f, request()), /STALE/)
  await assert.rejects(write(f, { ...first, body: { text: 'Different', files: [] } }), /REQUEST_CONFLICT/)
  await assert.rejects(write(f, first, coworker), /REQUEST_CONFLICT/)
  const next = request({ revision: 1, body: { text: 'Ny instruktion', files: [] } })
  assert.equal((await write(f, next, coworker)).revision, 2)
  assert.deepEqual(await write(f, first), receipt)
  assert.deepEqual((await db.query('select body from action_case_instruction_versions where item_id=$1 order by revision', [f.itemId])).rows.map(row => row.body.text), [first.body.text, 'Ny instruktion'])
})

test('history keeps removed attachments and their original names; originals cannot be deleted through normal file management', async () => {
  const f = await fixture()
  await write(f, request({ body: { text: '', files: [{ source: 'project', id: f.fileId }, { source: 'diary', id: f.photoId }] } }))
  await write(f, request({ revision: 1, body: { text: '', files: [] } }))
  assert.equal((await db.query('select count(*)::int n from action_case_instruction_files where item_id=$1', [f.itemId])).rows[0].n, 2)
  await assert.rejects(db.query('delete from action_case_attachments where id=$1', [f.fileId]), /foreign key/)
  await assert.rejects(db.query('delete from action_case_diary_photos where id=$1', [f.photoId]), /foreign key/)
  await db.query("update action_case_attachments set file_name='Later name.pdf' where id=$1", [f.fileId])
  assert.equal((await db.query('select file_name from action_case_instruction_files where attachment_id=$1', [f.fileId])).rows[0].file_name, 'Monteringsanvisning.pdf')
  await assert.rejects(db.query("update action_case_instruction_versions set body='{}' where item_id=$1", [f.itemId]), /IMMUTABLE/)
  await assert.rejects(db.query('delete from action_case_instruction_files where item_id=$1', [f.itemId]), /IMMUTABLE/)
})

test('tenant membership, project/item binding and private question files are validated independently of contract locks', async () => {
  const f = await fixture(), other = await fixture(false, 'in_progress', otherOrg), neighbor = await fixture()
  for (const who of [null, outsider]) await assert.rejects(write(f, request(), who), /FORBIDDEN/)
  await assert.rejects(write(f, request(), actor, otherOrg), /NOT_FOUND|FORBIDDEN/)
  await assert.rejects(write({ ...f, itemId: neighbor.itemId }, request()), /NOT_FOUND/)
  for (const file of [{ source: 'project', id: f.privateFileId }, { source: 'project', id: other.fileId }, { source: 'diary', id: other.photoId }, { source: 'project', id: id() }]) {
    await assert.rejects(write(f, request({ body: { text: 'No leak', files: [file] } })), /FILES/)
  }
  assert.equal((await db.query('select count(*)::int n from action_case_instruction_versions where item_id=$1', [f.itemId])).rows[0].n, 0)
  await db.query('update org_members set is_active=false where profile_id=$1', [actor])
  await assert.rejects(write(f, request()), /FORBIDDEN/)
  await db.query('update org_members set is_active=true where profile_id=$1', [actor])
  for (const role of ['anon','authenticated']) {
    await db.exec(`set role ${role}`)
    try { await assert.rejects(db.query('select * from action_case_instruction_versions'), /permission denied/); await assert.rejects(write(f, request()), /permission denied/) }
    finally { await db.exec('reset role') }
  }
})

test('closed projects stay read-only, while old committed retries may still obtain a receipt', async () => {
  const f = await fixture(), req = request(), receipt = await write(f, req)
  await db.query("update action_cases set status='completed' where id=$1", [f.caseId])
  assert.deepEqual(await write(f, req), receipt)
  await assert.rejects(write(f, request({ revision: 1 })), /CLOSED/)
})

test('malformed input and duplicate files roll back atomically; removing an unlocked moment retains the project originals', async () => {
  const f = await fixture(false), file = { source: 'project', id: f.fileId }
  for (const req of [request({ body: { text: 'x', files: [file,file] } }), request({ body: { text: 'x'.repeat(12001), files: [] } }), request({ revision: -1 }), request({ body: { text: '', files: [], scope: 'No' } }), request({ body: { text: 'x', files: [{ source: 'external', id: f.fileId }] } })]) await assert.rejects(write(f, req), /INVALID|FILES/)
  assert.equal((await db.query('select count(*)::int n from action_case_instruction_versions where item_id=$1', [f.itemId])).rows[0].n, 0)
  await write(f, request({ body: { text: 'x', files: [file] } }))
  await db.query('delete from action_case_items where id=$1', [f.itemId])
  assert.equal((await db.query('select count(*)::int n from action_case_instruction_versions where item_id=$1', [f.itemId])).rows[0].n, 0)
  assert.equal((await db.query('select count(*)::int n from action_case_attachments where id=$1', [f.fileId])).rows[0].n, 1)
})

test('an unlocked project can still be deleted and service credentials cannot rewrite instruction history directly', async () => {
  const f = await fixture(false)
  await write(f, request({ body: { text: 'Fiktiv historik', files: [{ source: 'project', id: f.fileId }] } }))
  await db.exec('set role service_role')
  try {
    await assert.rejects(db.query("update action_case_instruction_versions set body='{}' where item_id=$1", [f.itemId]), /permission denied/)
    await assert.rejects(db.query('delete from action_case_instruction_files where item_id=$1', [f.itemId]), /permission denied/)
  } finally { await db.exec('reset role') }
  await db.query('delete from action_cases where id=$1', [f.caseId])
  assert.equal((await db.query('select count(*)::int n from action_case_instruction_versions where item_id=$1', [f.itemId])).rows[0].n, 0)
})
