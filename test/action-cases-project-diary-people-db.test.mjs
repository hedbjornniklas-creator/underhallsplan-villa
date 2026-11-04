import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
const db = new PGlite(), id = () => randomUUID(), org = id(), manager = id(), staff = id(), outsider = id(), foreignOrg = id()
const hash = c => c.repeat(64)
const body = person => ({ name: person.name, company: person.company, workDate: '2026-01-02', startTime: '07:00', endTime: '16:00', breakMinutes: 60, text: 'Fiktivt arbete.', itemId: null })
const sql = name => readFileSync(new URL(`../docs/db/${name}`, import.meta.url), 'utf8')
const unchanged = async () => (await db.query("select jsonb_build_object('projects',(select jsonb_agg(c order by id) from action_cases c),'items',(select jsonb_agg(i order by id) from action_case_items i),'other',(select jsonb_agg(s order by id) from module_sentinels s)) value")).rows[0].value
const command = async (f, operation, data = {}, options = {}) => (await db.query('select project_diary_people_command($1,$2,$3,$4,$5,$6,$7,$8) result', [options.org || org, f.caseId, options.public ? null : options.actor || manager, options.public ? f.linkId : null, options.public ? options.nonce || f.nonce : null, options.public ? options.device ?? hash('a') : null, operation, data])).rows[0].result
async function fixture() {
  const caseId = id(), item = id()
  await db.query("insert into action_cases values($1,$2,'Fiktiv dagbok',$3)", [caseId, org, manager])
  await db.query("insert into action_case_items(id,org_id,action_case_id,title) values($1,$2,$3,'Invandigt')", [item, org, caseId])
  const f = { caseId, item }
  await command(f, 'link_enable', { expectedRevision: 0 })
  return { ...f, ...(await db.query('select id as "linkId",nonce from action_case_diary_links where action_case_id=$1', [caseId])).rows[0] }
}
before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth;
    create function auth.role() returns text language sql as $$select coalesce(current_setting('request.jwt.claim.role',true),'service_role')$$;
    create table organizations(id uuid primary key); create table profiles(id uuid primary key,full_name text,email text);
    create table org_members(org_id uuid,profile_id uuid,is_active boolean);
    create table action_cases(id uuid primary key,org_id uuid,title text,manager_profile_id uuid);
    create table action_case_items(id uuid primary key,org_id uuid,action_case_id uuid,title text,status text default 'in_progress',sort_order integer default 100);
    create table module_sentinels(id text primary key,body jsonb); insert into module_sentinels values('contract','{"locked":true,"amount":250000}'),('calculation','{"cost":123,"markup":15}'),('offer','{"budget":456}');
    create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`)
  await db.query('insert into organizations values($1),($2)', [org, foreignOrg])
  await db.query("insert into profiles values($1,'Testledare','manager@example.invalid'),($2,'Kollega','staff@example.invalid'),($3,'Annan organisation','other@example.invalid')", [manager, staff, outsider])
  await db.query('insert into org_members values($1,$2,true),($1,$3,true),($4,$5,true)', [org, manager, staff, foreignOrg, outsider])
  await db.exec(sql('2026-11-04_01_project_diary.sql'))
  const legacyCase = id(), legacyId = id(), verifiedId = id()
  await db.query("insert into action_cases values($1,$2,'Historik',$3)", [legacyCase, org, manager])
  await db.query('select project_diary_command($1,$2,$3,null,null,null,\'entry\',$4)', [org, legacyCase, manager, { requestId: legacyId, requestHash: hash('a'), body: body({ name: 'Anna   Exempel', company: 'Testbygg AB' }), photoIds: [] }])
  await db.query("insert into action_case_diary_entries(id,org_id,action_case_id,owner_key,request_hash,body,actor_name,author_email,actor_method,email_verified_at,minutes,work_date) values($1,$2,$3,'session:legacy',$4,$5,'legacy@example.invalid','legacy@example.invalid','email_code','2026-01-02T06:30:00Z',480,'2026-01-02')", [verifiedId, org, legacyCase, hash('b'), body({ name: 'Erik Historik', company: 'Tidigare AB' })])
  const verified = (await db.query('select * from action_case_diary_entries where id=$1', [verifiedId])).rows[0]
  const old = (await db.query('select * from action_case_diary_entries where id=$1', [legacyId])).rows[0], others = await unchanged()
  await db.exec(sql('2026-11-04_02_project_diary_people.sql')); await db.exec(sql('2026-11-04_02_project_diary_people.sql'))
  await db.exec(sql('2026-11-04_03_project_diary_twenty_photos.sql')); await db.exec(sql('2026-11-04_03_project_diary_twenty_photos.sql'))
  const current = (await db.query('select * from action_case_diary_entries where id=$1', [legacyId])).rows[0]
  assert.equal(current.person_id, null); delete current.person_id; assert.deepEqual(current, old)
  const currentVerified = (await db.query('select * from action_case_diary_entries where id=$1', [verifiedId])).rows[0]
  assert.equal(currentVerified.person_id, null); delete currentVerified.person_id; assert.deepEqual(currentVerified, verified)
  assert.deepEqual((await db.query('select name from action_case_diary_people where action_case_id=$1 order by name', [legacyCase])).rows.map(p => p.name), ['Anna Exempel', 'Erik Historik'])
  assert.deepEqual(await unchanged(), others)
})
after(() => db.close())

test('active QR exposes only this project directory without email, session, history, contacts or costs', async () => {
  const f = await fixture(), other = await fixture()
  const p = await command(f, 'person', { name: 'Anna Exempel', company: 'Testbygg AB' }, { public: true })
  await command(other, 'person', { name: 'Hemlig Annan', company: 'Annat AB' })
  const state = (await db.query('select project_diary_people_context($1,$2) result', [f.linkId, f.nonce])).rows[0].result
  assert.deepEqual(Object.keys(state).sort(), ['items','people','project'])
  assert.deepEqual(state.people, [p]); assert.deepEqual(Object.keys(p).sort(), ['company','id','name'])
  assert.deepEqual(state.items, [{ id: f.item, title: 'Invandigt' }])
  assert.equal(JSON.stringify(state).includes('Hemlig Annan'), false)
})
test('normalized duplicates and retried creation reuse a person and never modify an existing name', async () => {
  const f = await fixture(), before = await unchanged()
  const one = await command(f, 'person', { name: ' Anna   Exempel ', company: ' Testbygg AB ' }, { public: true })
  const two = await command(f, 'person', { name: 'anna exempel', company: 'testbygg ab' }, { public: true, device: hash('b') })
  assert.deepEqual(two, one)
  await assert.rejects(db.query("update action_case_diary_people set name='Ny' where id=$1", [one.id]), /IMMUTABLE/)
  await assert.rejects(command(f, 'person', { name: '', company: 'AB' }, { public: true }), /DIARY_PERSON/)
  assert.deepEqual(await unchanged(), before)
})

test('new-person quotas limit public abuse without counting imported historical names as new requests', async () => {
  const f = await fixture()
  await db.query("insert into action_case_diary_people(org_id,action_case_id,name,company,owner_key) select $1,$2,'Historik '||n,'AB','history' from generate_series(1,100) n", [org, f.caseId])
  let first
  for (let n = 0; n < 15; n++) {
    const p = await command(f, 'person', { name: `Ny ${n}`, company: 'AB' }, { public: true })
    first ??= p
  }
  assert.deepEqual(await command(f, 'person', { name: first.name, company: first.company }, { public: true }), first)
  await assert.rejects(command(f, 'person', { name: 'Ny 16', company: 'AB' }, { public: true }), /RATE_LIMITED/)
  const daily = await fixture()
  await db.query("insert into action_case_diary_people(org_id,action_case_id,name,company,owner_key) select $1,$2,'Ny '||n,'AB','qr:other-device' from generate_series(1,100) n", [org, daily.caseId])
  await assert.rejects(command(daily, 'person', { name: 'Ny 101', company: 'AB' }, { public: true }), /RATE_LIMITED/)
  const full = await fixture()
  await db.query("insert into action_case_diary_people(org_id,action_case_id,name,company,owner_key) select $1,$2,'Historik '||n,'AB','history' from generate_series(1,500) n", [org, full.caseId])
  await assert.rejects(command(full, 'person', { name: 'Ny', company: 'AB' }), /RATE_LIMITED/)
})
test('new QR entries use a project person, remain explicitly unverified and retry without duplicates', async () => {
  const f = await fixture(), other = await fixture(), before = await unchanged()
  const p = await command(f, 'person', { name: 'Anna', company: 'Test AB' }, { public: true })
  const foreign = await command(other, 'person', { name: 'Anna', company: 'Test AB' })
  const req = { requestId: id(), requestHash: hash('b'), personId: p.id, body: body(p), photoIds: [] }
  const receipt = await command(f, 'entry', req, { public: true })
  assert.deepEqual(await command(f, 'entry', req, { public: true }), receipt)
  const entry = (await db.query('select * from action_case_diary_entries where id=$1', [req.requestId])).rows[0]
  assert.equal(entry.actor_method, 'qr_selection'); assert.equal(entry.author_email, ''); assert.equal(entry.email_verified_at, null); assert.equal(entry.person_id, p.id)
  await assert.rejects(command(f, 'entry', { ...req, requestHash: hash('c') }, { public: true }), /REQUEST_CONFLICT/)
  await assert.rejects(command(f, 'entry', { ...req, requestId: id(), personId: foreign.id }, { public: true }), /DIARY_PERSON/)
  await assert.rejects(command(f, 'entry', { ...req, requestId: id(), body: { ...body(p), name: 'Omtolkat namn' } }, { public: true }), /DIARY_INVALID/)
  await assert.rejects(command(f, 'entry', { ...req, requestId: id() }, { public: true, device: '' }), /DIARY_DEVICE/)
  assert.deepEqual(await unchanged(), before)
})
test('choosing the same person on another phone does not allow reading or attaching their photos', async () => {
  const f = await fixture(), p = await command(f, 'person', { name: 'Anna', company: 'Test AB' }), file = id()
  await command(f, 'reserve_photo', { id: file, name: 'bild.png', contentType: 'image/png', size: 100 }, { public: true })
  await assert.rejects(command(f, 'seal_photo', { id: file, sha256: hash('b') }, { public: true, device: hash('b') }), /DIARY_PHOTO/)
  await command(f, 'seal_photo', { id: file, sha256: hash('a') }, { public: true })
  const req = { requestId: id(), requestHash: hash('c'), personId: p.id, body: body(p), photoIds: [file] }
  await assert.rejects(command(f, 'entry', req, { public: true, device: hash('b') }), /DIARY_PHOTO/)
  await command(f, 'entry', req, { public: true })
  await assert.rejects(command(f, 'entry', { ...req, requestId: id() }, { public: true }), /DIARY_PHOTO/)
})
test('manager-only controls, closed QR and retired email commands cannot be bypassed', async () => {
  const f = await fixture()
  await assert.rejects(command(f, 'link_disable', { expectedRevision: 1 }, { actor: staff }), /DIARY_MANAGER/)
  await assert.rejects(command(f, 'person', { name: 'Annan', company: 'AB' }, { actor: outsider }), /DIARY_FORBIDDEN/)
  for (const operation of ['challenge','verify','correction','cleanup','link_enable']) await assert.rejects(command(f, operation, {}, { public: true }), /DIARY_FORBIDDEN/)
  await command(f, 'link_disable', { expectedRevision: 1 })
  await assert.rejects(command(f, 'person', { name: 'Anna', company: 'AB' }, { public: true }), /DIARY_NOT_FOUND/)
  await assert.rejects(db.query('select project_diary_people_context($1,$2)', [f.linkId,f.nonce]), /DIARY_NOT_FOUND/)
  await db.exec('set role service_role')
  try { await assert.rejects(db.query('select project_diary_public_context($1,$2,null)', [f.linkId,f.nonce]), /permission denied/) } finally { await db.exec('reset role') }
  await db.exec('set role anon')
  try { await assert.rejects(db.query('select * from action_case_diary_people'), /permission denied/); await assert.rejects(command(f, 'person', {}), /permission denied/) } finally { await db.exec('reset role') }
})
test('internal entry, correction and cleanup still work without touching business modules', async () => {
  const f = await fixture(), before = await unchanged(), p = await command(f, 'person', { name: 'Anna', company: 'AB' })
  const req = { requestId: id(), requestHash: hash('b'), personId: p.id, body: body(p), photoIds: [] }
  await command(f, 'entry', req, { actor: staff })
  const correction = { requestId: id(), entryId: req.requestId, text: 'Test av rattelse.' }
  await command(f, 'correction', correction)
  await assert.rejects(command(f, 'correction', { ...correction, requestId: id() }, { actor: staff }), /DIARY_MANAGER/)
  const file = id()
  await command(f, 'reserve_photo', { id: file, name: 'utkast.png', contentType: 'image/png', size: 100 })
  await db.query("update action_case_diary_uploads set expires_at=now()-interval '20 minutes' where id=$1", [file])
  assert.deepEqual((await command(f, 'cleanup')).ids, [file]); await command(f, 'cleanup_done', { ids: [file] })
  assert.deepEqual(await unchanged(), before)
})

test('twenty-photo migration preserves attachment order, ownership, retry receipts and the 8 MiB file limit', async () => {
  for (const isPublic of [true, false]) {
    const f = await fixture(), p = await command(f, 'person', { name: 'Bildtest', company: 'Test AB' }), before = await unchanged(), photos = Array.from({ length: 21 }, id)
    const options = { public: isPublic }
    await assert.rejects(command(f, 'reserve_photo', { id: id(), name: 'stor.png', contentType: 'image/png', size: 8388609 }, options), /DIARY_PHOTO/)
    for (const file of photos) {
      await command(f, 'reserve_photo', { id: file, name: 'bild.png', contentType: 'image/png', size: 100 }, options)
      await command(f, 'seal_photo', { id: file, sha256: hash('a') }, options)
    }
    const req = { requestId: id(), requestHash: hash('d'), personId: p.id, body: body(p), photoIds: photos }
    await assert.rejects(command(f, 'entry', req, options), /DIARY_PHOTO/)
    assert.equal((await db.query('select count(*) n from action_case_diary_entries where action_case_id=$1', [f.caseId])).rows[0].n, 0)
    assert.equal((await db.query("select count(*) n from action_case_diary_uploads where action_case_id=$1 and state='ready'", [f.caseId])).rows[0].n, 21)
    const accepted = { ...req, photoIds: photos.slice(0,20).reverse() }
    const receipt = await command(f, 'entry', accepted, options)
    assert.deepEqual(await command(f, 'entry', accepted, options), receipt)
    assert.deepEqual((await db.query('select id from action_case_diary_photos where entry_id=$1 order by position', [req.requestId])).rows.map(p => p.id), accepted.photoIds)
    await assert.rejects(command(f, 'entry', { ...accepted, requestId: id() }, options), /DIARY_PHOTO/)
    assert.deepEqual(await unchanged(), before)
  }
})

test('photo-limit migration refuses an unexpected server definition instead of editing a different guard', async () => {
  const original = (await db.query("select pg_get_functiondef('public.project_diary_people_command(uuid,uuid,uuid,uuid,uuid,text,text,jsonb)'::regprocedure) definition")).rows[0].definition
  assert.ok(original.includes("jsonb_array_length(p_data->'photoIds')>20"))
  await db.exec(original.replace("jsonb_array_length(p_data->'photoIds')>20", "jsonb_array_length(p_data->'photoIds')>19"))
  try { await assert.rejects(db.exec(sql('2026-11-04_03_project_diary_twenty_photos.sql')), /MIGRATION_SOURCE_MISMATCH/) }
  finally { await db.exec('rollback'); await db.exec(original) }
})
