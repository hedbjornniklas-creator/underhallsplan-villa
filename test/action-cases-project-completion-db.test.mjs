import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID as id } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite(), org = id(), foreign = id(), manager = id(), staff = id(), outsider = id()
const migration = readFileSync(new URL('../docs/db/2026-11-07_01_project_completion_and_invoice_basis.sql', import.meta.url), 'utf8')
const request = (operation, patch = {}) => ({ operation, requestId: id(), revision: 0, ...patch })
const write = async (caseId, req, actor = manager, organization = org) => (await db.query('select write_project_administration($1,$2,$3,$4) result', [organization, caseId, actor, req])).rows[0].result
const basis = (patch = {}) => ({ version: 1, title: 'Fakturaunderlag', date: '2026-11-07', period: '', issuer: 'Test AB', recipient: 'Testkund', note: '', lines: [{ id: id(), description: 'Testarbete', quantity: 10, unit: 'tim', unitPriceOre: 60000, vatRate: 25 }], ...patch })
async function fixture(status = 'in_progress') { const caseId = id(); await db.query('insert into action_cases(id,org_id,title,status,manager_profile_id) values($1,$2,$3,$4,$5)', [caseId, org, 'Testprojekt', status, manager]); return caseId }
const sentinels = async () => (await db.query('select * from module_sentinels order by id')).rows
before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth;
    create function auth.role() returns text language sql as $$select coalesce(current_setting('request.jwt.claim.role',true),'service_role')$$;
    create table organizations(id uuid primary key); create table profiles(id uuid primary key,full_name text,email text);
    create table org_members(org_id uuid,profile_id uuid,is_active boolean);
    create table action_cases(id uuid primary key,org_id uuid,title text,status text,manager_profile_id uuid,updated_by uuid);
    create table action_case_questions(id uuid primary key,org_id uuid,action_case_id uuid,body jsonb);
    create table module_sentinels(id text primary key,body jsonb);
    insert into module_sentinels values('contract','{"locked":true,"price":1234}'),('calculation','{"cost":42}'),('payment_plan','{"unchanged":true}');`)
  await db.query('insert into organizations values($1),($2)', [org, foreign])
  await db.query("insert into profiles values($1,'Manager','manager@example.invalid'),($2,'Staff','staff@example.invalid'),($3,'Other','other@example.invalid')", [manager, staff, outsider])
  await db.query('insert into org_members values($1,$2,true),($1,$3,true),($4,$5,true)', [org, manager, staff, foreign, outsider])
  const old = await fixture('completed'), before = await sentinels()
  await db.exec(migration); await db.exec(migration)
  assert.deepEqual(await sentinels(), before)
  assert.equal((await db.query('select count(*)::int n from action_case_completion')).rows[0].n, 0)
  assert.equal((await db.query('select status from action_cases where id=$1', [old])).rows[0].status, 'completed')
})
after(() => db.close())
test('close requires both manual flags and no open, investigating or answered questions', async () => {
  const c = await fixture(), unchanged = await sentinels()
  await assert.rejects(write(c, request('complete', { confirmed: true })), /INCOMPLETE/)
  await write(c, request('flags', { workComplete: true, invoiced: true }))
  const q = id()
  await db.query('insert into action_case_questions values($1,$2,$3,$4)', [q, org, c, { status: 'open' }])
  for (const status of ['open', 'investigating', 'answered']) {
    await db.query('update action_case_questions set body=$2 where id=$1', [q, { status }])
    await assert.rejects(write(c, request('complete', { confirmed: true, revision: 1 })), /OPEN_QUESTIONS/)
  }
  await db.query('update action_case_questions set body=$2 where id=$1', [q, { status: 'closed' }])
  const req = request('complete', { confirmed: true, revision: 1 }), result = await write(c, req)
  assert.equal(result.status, 'completed'); assert.equal(result.revision, 2)
  assert.deepEqual(await write(c, req), result)
  assert.deepEqual(await sentinels(), unchanged)
  await assert.rejects(db.query('update action_case_questions set body=$2 where id=$1', [q, { status: 'open' }]), /PROJECT_CLOSED/)
  await assert.rejects(db.query('insert into action_case_questions values($1,$2,$3,$4)', [id(), org, c, { status: 'open' }]), /PROJECT_CLOSED/)
  await assert.rejects(write(c, request('save_basis', { id: id(), body: basis() })), /CLOSED/)
  const reopened = await write(c, request('reopen', { revision: 2, confirmed: true }))
  assert.equal(reopened.status, 'in_progress')
  const flags = (await db.query('select * from action_case_completion where action_case_id=$1', [c])).rows[0]
  assert.equal(flags.work_complete, false); assert.equal(flags.invoiced, false); assert.equal(flags.completed_at, null)
  await db.query('update action_case_questions set body=$2 where id=$1', [q, { status: 'open' }])
  assert.deepEqual(await sentinels(), unchanged)
})
test('manager-only and tenant checks are authoritative, including direct old status routes', async () => {
  const c = await fixture(), req = request('flags', { workComplete: true, invoiced: true })
  for (const actor of [staff, outsider, null]) await assert.rejects(write(c, req, actor), /MANAGER|FORBIDDEN/)
  await assert.rejects(write(c, req, outsider, foreign), /NOT_FOUND/)
  await db.query('update org_members set is_active=false where profile_id=$1', [manager])
  await assert.rejects(write(c, req), /FORBIDDEN/)
  await db.query('update org_members set is_active=true where profile_id=$1', [manager])
  await assert.rejects(db.query("update action_cases set status='completed' where id=$1", [c]), /MANAGER/)
  await assert.rejects(fixture('completed'), /INCOMPLETE/)
  await db.exec("select set_config('request.jwt.claim.role','authenticated',false)")
  await assert.rejects(write(c, req), /FORBIDDEN/)
  await db.exec("select set_config('request.jwt.claim.role','service_role',false)")
})
test('flags and basis CAS, retries and immutable events preserve saved state', async () => {
  const c = await fixture(), docId = id(), b = basis(), req = request('save_basis', { id: docId, body: b })
  const result = await write(c, req, staff); assert.equal(result.revision, 1)
  assert.deepEqual(await write(c, req, staff), result)
  await assert.rejects(write(c, { ...req, body: { ...b, title: 'Changed retry' } }, staff), /STALE/)
  await assert.rejects(write(c, request('save_basis', { id: docId, body: b })), /STALE/)
  const other = await fixture()
  await assert.rejects(write(other, request('save_basis', { id: docId, revision: 1, body: b })), /NOT_FOUND/)
  await write(c, request('save_basis', { id: docId, revision: 1, body: { ...b, note: 'Version two' } }))
  assert.equal((await db.query('select revision from action_case_invoice_basis where id=$1', [docId])).rows[0].revision, 2)
  await assert.rejects(db.query("update action_case_administration_events set actor_name='Changed' where id=$1", [req.requestId]), /IMMUTABLE/)
  await assert.rejects(db.query('delete from action_case_administration_events where id=$1', [req.requestId]), /IMMUTABLE/)
})
test('basis validation accepts incomplete drafts and zero, rejects invalid, duplicate and unbounded rows atomically', async () => {
  const c = await fixture(), b = basis()
  for (const patch of [{ quantity: -1 }, { quantity: 1.00001 }, { unitPriceOre: 0.5 }, { vatRate: 26 }, { quantity: 1e6, unitPriceOre: 1e12 }]) {
    await assert.rejects(write(c, request('save_basis', { id: id(), body: { ...b, lines: [{ ...b.lines[0], ...patch }] } })), /INVALID/)
  }
  await assert.rejects(write(c, request('save_basis', { id: id(), body: { ...b, lines: [b.lines[0], b.lines[0]] } })), /INVALID/)
  for (const date of ['2026-02-30', 'invalid']) await assert.rejects(write(c, request('save_basis', { id: id(), body: { ...b, date } })), /INVALID/)
  for (const unitPriceOre of [null, 0]) assert.equal((await write(c, request('save_basis', { id: id(), body: { ...b, lines: [{ ...b.lines[0], unitPriceOre }] } }))).revision, 1)
  assert.equal((await db.query('select count(*)::int n from action_case_invoice_basis where action_case_id=$1', [c])).rows[0].n, 2)
})
test('unprivileged roles cannot read private basis/history or invoke write RPC', async () => {
  await db.exec('set role authenticated')
  for (const table of ['action_case_completion', 'action_case_invoice_basis', 'action_case_administration_events']) await assert.rejects(db.query(`select * from ${table}`), /permission denied/)
  await assert.rejects(write(id(), request('complete')), /permission denied/)
  await db.exec('reset role')
})
