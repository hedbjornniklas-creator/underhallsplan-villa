import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
const db = new PGlite(), org = randomUUID(), otherOrg = randomUUID(), manager = randomUUID(), staff = randomUUID(), outsider = randomUUID()
const migration = readFileSync(new URL('../docs/db/2026-11-04_01_project_diary.sql', import.meta.url), 'utf8')
const hash = c => c.repeat(64), id = () => randomUUID()
const body = patch => ({ name: 'Anna Test', company: 'Testbygg AB', workDate: '2026-01-02', startTime: '07:00', endTime: '16:00', breakMinutes: 60, text: 'Fiktivt byggarbete.', itemId: null, ...patch })
const command = async (f, operation, data = {}, options = {}) => (await db.query('select project_diary_command($1,$2,$3,$4,$5,$6,$7,$8) result', [options.org || org, f.caseId, options.public ? null : options.actor || manager, options.public ? f.linkId : null, options.public ? options.nonce || f.nonce : null, options.public ? options.session || f.sessionHash || null : null, operation, data])).rows[0].result
const unchanged = async () => (await db.query('select jsonb_build_object(\'projects\',(select jsonb_agg(c order by id) from action_cases c),\'items\',(select jsonb_agg(i order by id) from action_case_items i),\'sentinels\',(select jsonb_agg(s order by id) from module_sentinels s)) data')).rows[0].data
before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth;
    create function auth.role() returns text language sql as $$select coalesce(current_setting('request.jwt.claim.role',true),'service_role')$$;
    create table organizations(id uuid primary key); create table profiles(id uuid primary key,full_name text,email text);
    create table org_members(org_id uuid,profile_id uuid,is_active boolean);
    create table action_cases(id uuid primary key,org_id uuid,title text,manager_profile_id uuid);
    create table action_case_items(id uuid primary key,org_id uuid,action_case_id uuid,title text,status text default 'in_progress',sort_order integer default 100);
    create table module_sentinels(id text primary key,body jsonb); insert into module_sentinels values('contract','{"locked":true,"amount":250000}'),('calculation','{"cost":123,"markup":15}'),('offer','{"budget":456}');
    create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`)
  await db.query('insert into organizations values($1),($2)', [org, otherOrg])
  await db.query("insert into profiles values($1,'Testledare','manager@example.invalid'),($2,'Testmedarbetare','staff@example.invalid'),($3,'Utomstaende','other@example.invalid')", [manager, staff, outsider])
  await db.query('insert into org_members values($1,$2,true),($1,$3,true),($4,$5,true)', [org, manager, staff, otherOrg, outsider])
  const before = await unchanged()
  await db.exec(migration); await db.exec(migration)
  assert.deepEqual(await unchanged(), before)
})
after(() => db.close())
async function fixture() {
  const caseId = id(), item = id()
  await db.query("insert into action_cases values($1,$2,'Fiktivt dagboksprojekt',$3)", [caseId, org, manager])
  await db.query("insert into action_case_items(id,org_id,action_case_id,title) values($1,$2,$3,'Fiktivt moment')", [item, org, caseId])
  const f = { caseId, item }
  await command(f, 'link_enable', { expectedRevision: 0 })
  Object.assign(f, (await db.query('select id as "linkId",nonce,revision from action_case_diary_links where action_case_id=$1', [caseId])).rows[0])
  return f
}
async function verified(f) {
  const challenge = id(), sessionHash = id().replaceAll('-', '').padEnd(64, 'a')
  await command(f, 'challenge', { id: challenge, email: `${challenge}@example.invalid`, browserHash: hash('a'), codeHash: hash('b'), clientHash: hash('c') }, { public: true })
  const verified = await command(f, 'verify', { id: challenge, browserHash: hash('a'), codeHash: hash('b'), sessionHash }, { public: true })
  assert.equal(verified.outcome, 'verified')
  return { ...f, sessionHash, challenge }
}
test('only the explicit manager can control QR, and all diary commands leave contract/calculation/work rows untouched', async () => {
  const f = await fixture(), before = await unchanged()
  await assert.rejects(command(f, 'link_disable', { expectedRevision: 1 }, { actor: staff }), /DIARY_MANAGER/)
  await assert.rejects(command(f, 'link_disable', { expectedRevision: 1 }, { actor: outsider }), /DIARY_FORBIDDEN/)
  await assert.rejects(command(f, 'link_disable', { expectedRevision: 0 }), /DIARY_STALE/)
  const req = { requestId: id(), requestHash: hash('a'), body: body({ itemId: f.item }), photoIds: [] }
  const receipt = await command(f, 'entry', req, { actor: staff })
  assert.equal(receipt.minutes, 480)
  assert.deepEqual(await command(f, 'entry', req, { actor: staff }), receipt)
  await assert.rejects(command(f, 'entry', { ...req, requestHash: hash('b') }, { actor: staff }), /REQUEST_CONFLICT/)
  const correction = { requestId: id(), entryId: receipt.id, text: 'Rattelse med bevarat original.' }
  await assert.rejects(command(f, 'correction', correction, { actor: staff }), /DIARY_MANAGER/)
  await command(f, 'correction', correction); await command(f, 'correction', correction)
  assert.equal((await db.query('select count(*) n from action_case_diary_corrections where entry_id=$1', [receipt.id])).rows[0].n, 1)
  await assert.rejects(db.query("update action_case_diary_entries set body='{}' where id=$1", [receipt.id]), /IMMUTABLE/)
  await assert.rejects(db.query('delete from action_case_diary_corrections where id=$1', [correction.requestId]), /IMMUTABLE/)
  assert.deepEqual(await unchanged(), before)
})
test('QR sessions reveal no project history, count bad codes durably, and replay verified codes without extending the session', async () => {
  const f = await fixture(), challenge = id()
  const context = async tokenHash => (await db.query('select project_diary_public_context($1,$2,$3) data', [f.linkId, f.nonce, tokenHash])).rows[0].data
  assert.deepEqual((await context(null)).items, [])
  assert.equal((await context(null)).session, null)
  await assert.rejects(command(f, 'entry', {}, { public: true }), /DIARY_SESSION/)
  await command(f, 'challenge', { id: challenge, email: `${challenge}@example.invalid`, browserHash: hash('a'), codeHash: hash('b'), clientHash: hash('c') }, { public: true })
  for (let n = 4; n >= 0; n--) assert.equal((await command(f, 'verify', { id: challenge, browserHash: hash('a'), codeHash: hash('x'), sessionHash: hash('d') }, { public: true })).attemptsRemaining, n)
  assert.equal((await command(f, 'verify', { id: challenge, browserHash: hash('a'), codeHash: hash('b'), sessionHash: hash('d') }, { public: true })).outcome, 'locked')
  const v = await verified(f), request = { id: v.challenge, browserHash: hash('a'), codeHash: hash('b'), sessionHash: v.sessionHash }
  const first = await command(v, 'verify', request, { public: true }), again = await command(v, 'verify', request, { public: true })
  assert.deepEqual(first, again)
  const visible = await context(v.sessionHash)
  assert.deepEqual(Object.keys(visible).sort(), ['items','project','session'])
  assert.deepEqual(visible.items, [{ id: f.item, title: 'Fiktivt moment' }])
  assert.equal(visible.session.email, `${v.challenge}@example.invalid`)
  assert.equal(visible.entries, undefined)
  await command(v, 'logout', {}, { public: true })
  assert.equal((await context(v.sessionHash)).session, null)
})
test('project-specific photo ownership, atomic attachment and append-only manifests prevent leakage or double attachment', async () => {
  const f = await verified(await fixture()), other = await verified(await fixture()), file = id(), requestId = id(), before = await unchanged()
  const photo = { id: file, name: 'test.jpg', contentType: 'image/jpeg', size: 1234 }
  await command(f, 'reserve_photo', photo, { public: true })
  await assert.rejects(command(other, 'seal_photo', { id: file, sha256: hash('a') }, { public: true }), /DIARY_PHOTO/)
  await assert.rejects(command(f, 'entry', { requestId, requestHash: hash('b'), body: body(), photoIds: [file] }, { public: true }), /DIARY_PHOTO/)
  await command(f, 'seal_photo', { id: file, sha256: hash('a') }, { public: true })
  const request = { requestId, requestHash: hash('b'), body: body(), photoIds: [file] }
  const receipt = await command(f, 'entry', request, { public: true })
  assert.deepEqual(await command(f, 'entry', request, { public: true }), receipt)
  await assert.rejects(command(f, 'entry', { ...request, requestId: id() }, { public: true }), /DIARY_PHOTO/)
  await assert.rejects(db.query("update action_case_diary_photos set name='andrad' where id=$1", [file]), /IMMUTABLE/)
  assert.equal((await db.query('select count(*) n from action_case_diary_entries where id=$1', [requestId])).rows[0].n, 1)
  assert.equal((await db.query('select body from action_case_diary_entries where id=$1', [requestId])).rows[0].body.text, request.body.text)
  assert.deepEqual(await unchanged(), before)
})
test('rotating or disabling QR revokes existing codes and sessions without changing saved diary originals', async () => {
  const f = await verified(await fixture()), before = await unchanged(), req = { requestId: id(), requestHash: hash('a'), body: body(), photoIds: [] }
  await command(f, 'entry', req, { public: true })
  await command(f, 'link_enable', { expectedRevision: 1 })
  await assert.rejects(command(f, 'entry', { ...req, requestId: id() }, { public: true }), /DIARY_NOT_FOUND/)
  await assert.rejects(db.query('select project_diary_public_context($1,$2,$3)', [f.linkId, f.nonce, f.sessionHash]), /DIARY_NOT_FOUND/)
  assert.equal((await db.query('select id from action_case_diary_entries where id=$1', [req.requestId])).rows.length, 1)
  assert.deepEqual(await unchanged(), before)
})
test('invalid times, future dates, foreign moments, anonymous SQL and expired unreferenced uploads fail closed', async () => {
  const f = await fixture(), other = await fixture(), before = await unchanged()
  for (const patch of [{ endTime: '06:00' }, { breakMinutes: 600 }, { workDate: '2099-01-01' }, { itemId: other.item }, { text: '' }]) {
    await assert.rejects(command(f, 'entry', { requestId: id(), requestHash: hash('a'), body: body(patch), photoIds: [] }), /DIARY_(INVALID|ITEM)/)
  }
  const file = id()
  await command(f, 'reserve_photo', { id: file, name: 'orphan.png', contentType: 'image/png', size: 123 })
  await db.query("update action_case_diary_uploads set expires_at=now()-interval '20 minutes' where id=$1", [file])
  const result = await command(f, 'cleanup')
  assert.deepEqual(result.ids, [file])
  await assert.rejects(command(f, 'seal_photo', { id: file, sha256: hash('a') }), /DIARY_PHOTO/)
  await db.exec('set role anon')
  try { await assert.rejects(db.query('select * from public.action_case_diary_entries'), /permission denied/); await assert.rejects(command(f, 'link_enable', { expectedRevision: 1 }), /permission denied/) }
  finally { await db.exec('reset role') }
  assert.deepEqual(await unchanged(), before)
})

test('orphan cleanup progresses past the first batch, retries storage failures, and never selects attached photos', async () => {
  const f = await fixture(), files = []
  const attached = id()
  await command(f, 'reserve_photo', { id: attached, name: 'original.png', contentType: 'image/png', size: 100 })
  await command(f, 'seal_photo', { id: attached, sha256: hash('a') })
  await command(f, 'entry', { requestId: id(), requestHash: hash('b'), body: body(), photoIds: [attached] })
  for (let i = 0; i < 12; i++) { const file = id(); files.push(file); await command(f, 'reserve_photo', { id: file, name: 'unused.png', contentType: 'image/png', size: 100 }) }
  await db.query("update action_case_diary_uploads set expires_at=now()-interval '20 minutes' where action_case_id=$1", [f.caseId])
  const first = await command(f, 'cleanup'), retry = await command(f, 'cleanup')
  assert.equal(first.ids.length, 10); assert.deepEqual(new Set(retry.ids), new Set(first.ids))
  await assert.rejects(command(f, 'cleanup_done', { ids: first.ids }, { actor: staff }), /DIARY_MANAGER/)
  await command(f, 'cleanup_done', { ids: first.ids })
  const rest = await command(f, 'cleanup'); assert.equal(rest.ids.length, 2)
  await command(f, 'cleanup_done', { ids: rest.ids })
  assert.deepEqual((await command(f, 'cleanup')).ids, [])
  await command(f, 'cleanup_done', { ids: [attached] })
  assert.deepEqual((await db.query('select state,cleaned_at from action_case_diary_uploads where id=$1', [attached])).rows[0], { state: 'attached', cleaned_at: null })
})

test('code expiry, resend quotas, browser binding and session expiry fail closed', async () => {
  const f = await fixture(), challenge = id(), email = `${id()}@example.invalid`
  const data = { id: challenge, email, browserHash: hash('a'), codeHash: hash('b'), clientHash: hash('c') }
  await command(f, 'challenge', data, { public: true })
  await assert.rejects(command(f, 'challenge', { ...data, id: id() }, { public: true }), /RATE_LIMITED/)
  assert.equal((await command(f, 'verify', { id: challenge, browserHash: hash('d'), codeHash: hash('b'), sessionHash: hash('e') }, { public: true })).outcome, 'expired')
  await db.query("update action_case_diary_challenges set expires_at=now()-interval '1 minute' where id=$1", [challenge])
  assert.equal((await command(f, 'verify', { id: challenge, browserHash: hash('a'), codeHash: hash('b'), sessionHash: hash('e') }, { public: true })).outcome, 'expired')
  const v = await verified(f)
  await db.query("update action_case_diary_sessions set expires_at=now()-interval '1 second' where id=$1", [v.challenge])
  await assert.rejects(command(v, 'entry', { requestId: id(), requestHash: hash('a'), body: body(), photoIds: [] }, { public: true }), /DIARY_SESSION/)
  assert.equal((await db.query('select count(*) n from action_case_diary_entries where action_case_id=$1', [f.caseId])).rows[0].n, 0)
})

test('photo validation and quotas are authoritative even when bypassing the form', async () => {
  const f = await fixture()
  for (const patch of [{ size: 8388609 }, { size: 0 }, { contentType: 'image/svg+xml' }, { name: '' }]) await assert.rejects(command(f, 'reserve_photo', { id: id(), name: 'photo.jpg', contentType: 'image/jpeg', size: 100, ...patch }), /DIARY_PHOTO/)
  for (let i = 0; i < 40; i++) await command(f, 'reserve_photo', { id: id(), name: 'photo.jpg', contentType: 'image/jpeg', size: 100 })
  await assert.rejects(command(f, 'reserve_photo', { id: id(), name: 'photo.jpg', contentType: 'image/jpeg', size: 100 }), /RATE_LIMITED/)
})
