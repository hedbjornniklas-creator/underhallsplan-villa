import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID as id } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite(), org = id(), foreignOrg = id(), manager = id(), staff = id(), outsider = id()
const sql = name => readFileSync(new URL(`../docs/db/${name}`, import.meta.url), 'utf8')
const migration = '2026-11-05_01_project_diary_revisions.sql'
const body = patch => ({ name: 'Anna Test', company: 'Testbygg AB', workDate: '2026-01-02', startTime: '07:00', endTime: '16:00', breakMinutes: 0, text: 'Originalets arbete.', itemId: null, ...patch })
const hash = 'a'.repeat(64)
const revise = async (f, data, actor = manager, organization = org) => (await db.query('select revise_project_diary_entry($1,$2,$3,$4) result', [organization, f.caseId, actor, data])).rows[0].result
const edit = (f, patch = {}) => ({ entryId: f.entryId, requestId: id(), expectedRevision: 0, body: body({ text: 'Rattad text.' }), photoIds: [], ...patch })
const protectedData = async () => (await db.query("select jsonb_build_object('projects',(select jsonb_agg(c order by id) from action_cases c),'items',(select jsonb_agg(i order by id) from action_case_items i),'modules',(select jsonb_agg(m order by id) from module_sentinels m)) data")).rows[0].data
async function fixture(age = 0, method = 'qr_selection') {
  const f = { caseId: id(), entryId: id(), itemId: id(), personId: id() }
  await db.query("insert into action_cases values($1,$2,'Fiktivt projekt',$3)", [f.caseId, org, manager])
  await db.query("insert into action_case_items values($1,$2,$3,'Fiktivt moment','in_progress',100)", [f.itemId, org, f.caseId])
  await db.query("insert into action_case_diary_people(id,org_id,action_case_id,name,company,owner_key) values($1,$2,$3,'Anna Test','Testbygg AB','qr:test')", [f.personId, org, f.caseId])
  await db.query("insert into action_case_diary_entries(id,org_id,action_case_id,owner_key,request_hash,body,actor_profile_id,actor_name,author_email,actor_method,minutes,work_date,received_at,person_id) values($1,$2,$3,'qr:test',$4,$5,$6,'Anna Test','',$7,540,'2026-01-02',clock_timestamp()-($8||' hours')::interval,$9)", [f.entryId, org, f.caseId, hash, body(), method === 'internal_login' ? staff : null, method, String(age), f.personId])
  f.original = (await db.query('select * from action_case_diary_entries where id=$1', [f.entryId])).rows[0]
  return f
}
async function photo(f, owner = `profile:${manager}`, attached = false) {
  const photoId = id()
  await db.query("insert into action_case_diary_uploads(id,org_id,action_case_id,owner_key,name,content_type,size_bytes,state,sha256,entry_id) values($1,$2,$3,$4,'bild.png','image/png',100,$5,$6,$7)", [photoId, org, f.caseId, owner, attached ? 'attached' : 'ready', hash, attached ? f.entryId : null])
  if (attached) await db.query("insert into action_case_diary_photos values($1,$2,'bild.png','image/png',100,$3,1)", [photoId, f.entryId, hash])
  return photoId
}
before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth;
    create function auth.role() returns text language sql as $$select coalesce(current_setting('request.jwt.claim.role',true),'service_role')$$;
    create table organizations(id uuid primary key); create table profiles(id uuid primary key,full_name text,email text);
    create table org_members(org_id uuid,profile_id uuid,is_active boolean);
    create table action_cases(id uuid primary key,org_id uuid,title text,manager_profile_id uuid);
    create table action_case_items(id uuid primary key,org_id uuid,action_case_id uuid,title text,status text default 'in_progress',sort_order integer default 100);
    create table module_sentinels(id text primary key,body jsonb);
    insert into module_sentinels values('contract','{"locked":true,"amount":250000}'),('calculation','{"cost":123}'),('offer','{"price":456}'),('planning','{"unchanged":true}');
    create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`)
  await db.query('insert into organizations values($1),($2)', [org, foreignOrg])
  await db.query("insert into profiles values($1,'Projektledare','manager@example.invalid'),($2,'Avsandare','staff@example.invalid'),($3,'Utomstaende','other@example.invalid')", [manager, staff, outsider])
  await db.query('insert into org_members values($1,$2,true),($1,$3,true),($4,$5,true)', [org, manager, staff, foreignOrg, outsider])
  for (const file of ['2026-11-04_01_project_diary.sql','2026-11-04_02_project_diary_people.sql','2026-11-04_03_project_diary_twenty_photos.sql']) await db.exec(sql(file))
  const old = await fixture(72), before = await protectedData()
  await db.exec(sql(migration)); await db.exec(sql(migration))
  assert.deepEqual((await db.query('select * from action_case_diary_entries where id=$1', [old.entryId])).rows[0], old.original)
  assert.equal((await db.query('select count(*)::int n from action_case_diary_revisions')).rows[0].n, 0)
  assert.deepEqual(await protectedData(), before)
})
after(() => db.close())

test('manager revisions preserve the original and original receipt while current projection and history advance', async () => {
  const f = await fixture(), before = await protectedData(), originalPhoto = await photo(f, 'qr:test', true), added = await photo(f)
  const originalManifest = (await db.query('select * from action_case_diary_photos where id=$1', [originalPhoto])).rows[0]
  const request = edit(f, { body: body({ text: 'Rattat arbete.', workDate: '2026-01-03', startTime: '08:00', itemId: f.itemId }), photoIds: [added] })
  const receipt = await revise(f, request)
  assert.equal(receipt.id, request.requestId); assert.equal(receipt.revision, 1); assert.equal(receipt.minutes, 480)
  assert.equal(new Date(receipt.receivedAt).toISOString(), f.original.received_at.toISOString())
  const current = (await db.query('select * from action_case_diary_current where id=$1', [f.entryId])).rows[0]
  assert.deepEqual(current.body, f.original.body)
  assert.equal(current.current_body.text, 'Rattat arbete.'); assert.equal(current.current_item_title, 'Fiktivt moment')
  assert.deepEqual(current.current_photo_ids, [added]); assert.equal(current.revision, 1)
  const versions = (await db.query('select * from action_case_diary_revisions where entry_id=$1 order by revision', [f.entryId])).rows
  assert.deepEqual(versions.map(v => v.photo_ids), [[originalPhoto], [added]])
  assert.deepEqual(versions[0].body, f.original.body); assert.equal(versions[1].actor_profile_id, manager)
  assert.deepEqual((await db.query('select * from action_case_diary_entries where id=$1', [f.entryId])).rows[0], f.original)
  assert.deepEqual((await db.query('select * from action_case_diary_photos where id=$1', [originalPhoto])).rows[0], originalManifest)
  assert.deepEqual(await protectedData(), before)
  await db.exec(sql(migration))
  assert.deepEqual((await db.query('select * from action_case_diary_revisions where entry_id=$1 order by revision', [f.entryId])).rows, versions)
})

test('QR submitters, internal authors, other members, cross-tenant actors and inactive managers cannot edit', async () => {
  const f = await fixture(0, 'internal_login'), req = edit(f), before = await protectedData()
  for (const actor of [null, staff, outsider]) await assert.rejects(revise(f, req, actor), /DIARY_MANAGER|DIARY_FORBIDDEN/)
  await assert.rejects(revise(f, req, manager, foreignOrg), /DIARY_MANAGER|DIARY_FORBIDDEN/)
  await db.query('update org_members set is_active=false where profile_id=$1', [manager])
  await assert.rejects(revise(f, req), /DIARY_FORBIDDEN/)
  await db.query('update org_members set is_active=true where profile_id=$1', [manager])
  await db.exec("select set_config('request.jwt.claim.role','authenticated',false)")
  await assert.rejects(revise(f, req), /DIARY_FORBIDDEN/)
  await db.exec("select set_config('request.jwt.claim.role','service_role',false)")
  assert.equal((await db.query('select count(*)::int n from action_case_diary_revisions where entry_id=$1', [f.entryId])).rows[0].n, 0)
  assert.deepEqual(await protectedData(), before)
})

test('the 48-hour window uses original server receipt, not work date or a later revision', async () => {
  const fresh = await fixture(47.99)
  await revise(fresh, edit(fresh, { body: body({ workDate: '2020-01-01' }) }))
  for (const age of [48, 49, 72]) {
    const f = await fixture(age)
    await assert.rejects(revise(f, edit(f)), /EDIT_CLOSED/)
    const req = { requestId: id(), entryId: f.entryId, text: 'Senare rattelse.' }
    const r = await db.query("select project_diary_people_command($1,$2,$3,null,null,null,'correction',$4) result", [org, f.caseId, manager, req])
    assert.equal(r.rows[0].result.id, req.requestId)
  }
})

test('retries are idempotent, changed retry payloads conflict and stale edits never overwrite a newer version', async () => {
  const f = await fixture(), req = edit(f), ack = await revise(f, req)
  assert.deepEqual(await revise(f, req), ack)
  await assert.rejects(revise(f, { ...req, body: body({ text: 'Annat innehall.' }) }), /REQUEST_CONFLICT/)
  await assert.rejects(revise(f, edit(f)), /REVISION_STALE/)
  const next = edit(f, { expectedRevision: 1, body: body({ text: 'Andra versionen.' }) })
  assert.equal((await revise(f, next)).revision, 2)
  assert.deepEqual(await revise(f, req), ack)
  assert.equal((await db.query('select count(*)::int n from action_case_diary_revisions where entry_id=$1', [f.entryId])).rows[0].n, 3)
})

test('a previously committed request can still be acknowledged after the window closes without a new version', async () => {
  const f = await fixture(49), req = edit(f)
  await db.query("insert into action_case_diary_revisions(entry_id,revision,body,photo_ids,item_title,minutes,actor_name,created_at) values($1,0,$2,'{}','',540,'Anna Test',$3)", [f.entryId, f.original.body, f.original.received_at])
  await db.query("insert into action_case_diary_revisions(entry_id,revision,request_id,request_payload,body,photo_ids,item_title,minutes,actor_profile_id,actor_name,created_at) values($1,1,$2,$3,$4,'{}','',540,$5,'Projektledare',$6::timestamptz+interval '1 hour')", [f.entryId, req.requestId, req, req.body, manager, f.original.received_at])
  assert.equal((await revise(f, req)).revision, 1)
  await assert.rejects(revise(f, edit(f, { expectedRevision: 1 })), /EDIT_CLOSED/)
  assert.equal((await db.query('select count(*)::int n from action_case_diary_revisions where entry_id=$1', [f.entryId])).rows[0].n, 2)
})

test('photo selection can retain, reorder or remove old images without changing their archives', async () => {
  const f = await fixture(), one = await photo(f, 'qr:test', true), two = await photo(f)
  await revise(f, edit(f, { photoIds: [one, two] }))
  await revise(f, edit(f, { expectedRevision: 1, photoIds: [two, one] }))
  await revise(f, edit(f, { expectedRevision: 2, photoIds: [] }))
  assert.equal((await db.query('select count(*)::int n from action_case_diary_photos where entry_id=$1', [f.entryId])).rows[0].n, 2)
  assert.deepEqual((await db.query('select current_photo_ids from action_case_diary_current where id=$1', [f.entryId])).rows[0].current_photo_ids, [])
})

test('foreign, another entrys, another owners, expired, pending and duplicate photos are rejected atomically', async () => {
  const f = await fixture(), other = await fixture(), foreign = await photo(other), otherEntry = await photo(other, `profile:${manager}`, true), wrongOwner = await photo(f, `profile:${staff}`), pending = await photo(f), expired = await photo(f)
  await db.query("update action_case_diary_uploads set state='pending' where id=$1", [pending])
  await db.query("update action_case_diary_uploads set expires_at=clock_timestamp()-interval '1 second' where id=$1", [expired])
  for (const photoId of [foreign, otherEntry, wrongOwner, pending, expired, id()]) await assert.rejects(revise(f, edit(f, { photoIds: [photoId] })), /DIARY_PHOTO/)
  const own = await photo(f)
  await assert.rejects(revise(f, edit(f, { photoIds: [own, own] })), /DIARY_PHOTO/)
  await assert.rejects(revise(f, edit(f, { photoIds: Array.from({ length: 21 }, id) })), /DIARY_PHOTO/)
  assert.equal((await db.query('select count(*)::int n from action_case_diary_revisions where entry_id=$1', [f.entryId])).rows[0].n, 0)
  assert.equal((await db.query('select state from action_case_diary_uploads where id=$1', [own])).rows[0].state, 'ready')
})

test('invalid bodies, identity changes, altered break data, foreign moments and malformed revisions are rejected', async () => {
  const f = await fixture(), other = await fixture()
  for (const patch of [{ name: 'Annan' }, { company: 'Annat' }, { breakMinutes: 30 }, { text: '' }, { workDate: '2026-02-30' }, { workDate: '2099-01-01' }, { endTime: '06:00' }, { text: 'X'.repeat(6001) }, { amount: 100 }, { itemId: other.itemId }]) {
    await assert.rejects(revise(f, edit(f, { body: body(patch) })), /DIARY_INVALID|DIARY_ITEM/)
  }
  for (const value of [null, -1, 0.1, 2147483647, '0']) await assert.rejects(revise(f, edit(f, { expectedRevision: value })), /DIARY_INVALID/)
  await assert.rejects(revise(f, { ...edit(f), actor: manager }), /DIARY_INVALID/)
  const req = edit(f); delete req.body.itemId
  await assert.rejects(revise(f, req), /DIARY_INVALID/)
})

test('all original/revision manifests remain immutable and no public role can read history or invoke edits', async () => {
  const f = await fixture(); await revise(f, edit(f))
  for (const table of ['action_case_diary_entries','action_case_diary_revisions']) {
    await assert.rejects(db.query(`delete from ${table} where ${table.endsWith('entries') ? 'id' : 'entry_id'}=$1`, [f.entryId]), /IMMUTABLE/)
    await assert.rejects(db.query(`update ${table} set body='{}' where ${table.endsWith('entries') ? 'id' : 'entry_id'}=$1`, [f.entryId]), /IMMUTABLE/)
  }
  for (const role of ['anon','authenticated']) for (const table of ['action_case_diary_revisions','action_case_diary_current']) {
    assert.equal((await db.query('select has_table_privilege($1,$2,\'select\') allowed', [role, table])).rows[0].allowed, false)
    assert.equal((await db.query('select has_function_privilege($1,\'revise_project_diary_entry(uuid,uuid,uuid,jsonb)\',\'execute\') allowed', [role])).rows[0].allowed, false)
  }
  assert.equal((await db.query("select has_table_privilege('service_role','action_case_diary_revisions','insert') allowed")).rows[0].allowed, false)
})
