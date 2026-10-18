import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { normalizeChoiceFileRefs, normalizeSharedChoices } from '../src/lib/action-cases/customerPlanning.ts'

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const item = n => ({ id: id(n), title: 'Fönster', scope: 'Kundgranskat underlag.', status: 'deferred', budgetOre: 12300, decisionBy: '2026-11-01' })
const cat = (n, option) => ({ id: id(n), title: 'Kategori', specification: '', decisionBy: '', optionIds: [option.id] })
const base = readFileSync(new URL('../docs/db/2026-09-29_04_customer_offer_planning.sql', import.meta.url), 'utf8').split('-- Contract details')[0] + '\ncommit;'
const categoriesSql = readFileSync(new URL('../docs/db/2026-10-18_01_customer_choice_categories.sql', import.meta.url), 'utf8')
const filesSql = readFileSync(new URL('../docs/db/2026-10-18_02_customer_choice_files.sql', import.meta.url), 'utf8')
const db = new PGlite()
before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table organizations(id uuid primary key); create table profiles(id uuid primary key);
    create table action_cases(id uuid primary key,org_id uuid not null);
    create table action_case_participants(id uuid primary key,org_id uuid not null,action_case_id uuid not null,role text not null);
    create table action_case_access_links(id uuid primary key,org_id uuid not null,action_case_id uuid not null,participant_id uuid not null,token_hash text unique,revoked_at timestamptz,expires_at timestamptz not null);
    create table action_case_events(id uuid default gen_random_uuid(),org_id uuid,action_case_id uuid,event_type text,message text,performed_by uuid);
    create table action_case_attachments(id uuid primary key,org_id uuid,action_case_id uuid,content_type text,storage_bucket text,file_path text,file_name text,file_size_bytes bigint);
    create table action_case_work_quotes(org_id uuid,document_id uuid);
    create table action_case_quote_requests(org_id uuid,response_document_id uuid);
    create table action_case_attachment_grants(id uuid primary key);
    create table contract_sentinel(body jsonb);
    insert into contract_sentinel values('{"contract":"unchanged","price":12300,"paymentPlan":[12300],"pdf":"immutable"}');
    insert into organizations values('${id(1)}'),('${id(9)}'); insert into profiles values('${id(2)}');`)
  await db.exec(base)
  await db.exec("alter table action_case_customer_planning add column internal_costing jsonb not null default '{}'")
  await db.exec(categoriesSql); await db.exec(filesSql); await db.exec(filesSql)
})
after(async () => { await db.close() })
let sequence = 100
async function fixture() {
  const n = sequence += 20, caseId = id(n), participantId = id(n + 1), hash = `customer-${n}`, linkId = id(n + 2)
  const items = [item(n + 3), item(n + 4)], categories = [cat(n + 5, items[0]), cat(n + 6, items[1])]
  const refs = [{ optionId: items[0].id, fileId: id(n + 7) }]
  const manifest = { id: id(n + 8), optionId: items[0].id, sourceId: id(n + 7), fileName: 'Kundspecifikation.pdf', fileSizeBytes: 1000, sha256: 'a'.repeat(64), path: `${id(1)}/${caseId}/choices/${id(n + 8)}.pdf` }
  await db.query('insert into action_cases values($1,$2)', [caseId, id(1)])
  await db.query("insert into action_case_participants values($1,$2,$3,'customer'),($4,$2,$3,'subcontractor')", [participantId, id(1), caseId, id(n + 9)])
  await db.query("insert into action_case_access_links values($1,$2,$3,$4,$5,null,'2099-01-01'),($6,$2,$3,$7,$8,null,'2099-01-01')", [linkId, id(1), caseId, participantId, hash, id(n + 10), id(n + 9), `ue-${n}`])
  await db.query("insert into action_case_attachments values($1,$2,$3,'application/pdf','action-case-files',$4,$5,1000)", [refs[0].fileId, id(1), caseId, `${id(1)}/${caseId}/original.pdf`, manifest.fileName])
  const plan = async () => (await db.query('select * from action_case_customer_planning where action_case_id=$1', [caseId])).rows[0]
  const write = async (operation, patch = {}) => db.query('select write_customer_planning($1,$2,$3,$4,$5)', [id(1), caseId, id(2), operation, { revision: (await plan())?.revision ?? 0, items, categories, optionFiles: refs, sharedFiles: [manifest], confirmed: true, ...patch }])
  const read = async () => (await db.query('select read_customer_choices($1) as result', [hash])).rows[0].result
  const file = async (token = hash, fileId = manifest.id) => (await db.query('select read_customer_choice_file($1,$2) as result', [token, fileId])).rows[0].result
  return { n, caseId, participantId, hash, linkId, refs, manifest, items, categories, plan, write, read, file }
}

test('file references are bounded, normalized and tied to existing alternatives; public files strip private fields', () => {
  const items = [item(10)], ref = { optionId: id(10), fileId: id(11) }
  assert.deepEqual(normalizeChoiceFileRefs([{ ...ref, ignored: 'private' }], items), [ref])
  for (const bad of [null, {}, [ref, ref], [{ ...ref, optionId: id(12) }], [{ ...ref, fileId: 'wrong' }], Array(31).fill(ref)]) assert.throws(() => normalizeChoiceFileRefs(bad, items), /FILES/)
  const shared = normalizeSharedChoices({ revision: 1, categories: [cat(20, items[0])], items, versions: { [id(20)]: id(21) }, choices: [], files: [{ id: id(30), optionId: id(10), fileName: 'Kund.pdf', fileSizeBytes: 1000, path: 'private', sha256: 'secret', sourceId: 'private' }] })
  assert.doesNotMatch(JSON.stringify(shared), /private|secret|sourceId|sha256|path/)
  assert.equal(shared.files[0].fileName, 'Kund.pdf')
})

test('PDF selection stays private until explicit sharing; public projection contains no storage paths or costing', async () => {
  const f = await fixture(); await f.write('save')
  assert.equal(await f.read(), null); await assert.rejects(f.file(), /NOT_SHARED/)
  await f.write('share')
  const shared = await f.read()
  assert.deepEqual(shared.files, [{ id: f.manifest.id, optionId: f.items[0].id, fileName: f.manifest.fileName, fileSizeBytes: 1000 }])
  assert.equal((await f.file()).file.sha256, f.manifest.sha256)
  assert.doesNotMatch(JSON.stringify(shared), /sourceId|storage|sha256|path|internal_costing/)
  assert.equal((await db.query('select count(*)::int n from action_case_attachment_grants')).rows[0].n, 0)
})

test('frozen PDFs survive source deletion; unsharing and revoked links immediately block downloads', async () => {
  const f = await fixture(); await f.write('save'); await f.write('share')
  await db.query('delete from action_case_attachments where id=$1', [f.refs[0].fileId])
  assert.equal((await f.file()).file.id, f.manifest.id)
  await db.query('update action_case_access_links set revoked_at=now() where id=$1', [f.linkId])
  await assert.rejects(f.file(), /CLOSED/)
  await db.query('update action_case_access_links set revoked_at=null where id=$1', [f.linkId])
  await f.write('unshare'); await assert.rejects(f.file(), /NOT_SHARED/)
  assert.deepEqual((await f.plan()).shared_option_files, [])
})

test('wrong project, tenant, UE and expired links cannot download; recipient reset clears files', async () => {
  const f = await fixture(), other = await fixture(); await f.write('save'); await f.write('share')
  await assert.rejects(f.file(`ue-${f.n}`), /CLOSED/)
  await assert.rejects(f.file(other.hash), /NOT_SHARED/)
  await db.query('update action_case_access_links set org_id=$1 where id=$2', [id(9), f.linkId])
  await assert.rejects(f.file(), /CLOSED/)
  await db.query("update action_case_access_links set org_id=$1,expires_at='2000-01-01' where id=$2", [id(1), f.linkId])
  await assert.rejects(f.file(), /CLOSED/)
  await db.query("update action_case_customer_planning set participant_id=null,shared_items='[]' where action_case_id=$1", [f.caseId])
  assert.deepEqual((await f.plan()).shared_option_files, [])
})

test('PDF changes require a new choice only in the affected category, while private edits do not', async () => {
  const f = await fixture(); await f.write('save'); await f.write('share')
  const before = await f.read(), categoryId = f.categories[0].id
  await db.query('select record_customer_choice($1,$2,$3,$4,0)', [f.hash, categoryId, before.versions[categoryId], f.items[0].id])
  await f.write('save', { optionFiles: [] })
  assert.equal((await f.read()).versions[categoryId], before.versions[categoryId])
  await f.write('share', { optionFiles: [], sharedFiles: [] })
  const after = await f.read()
  assert.notEqual(after.versions[categoryId], before.versions[categoryId])
  assert.equal(after.versions[f.categories[1].id], before.versions[f.categories[1].id])
  assert.equal(after.choices[0].categoryVersion, before.versions[categoryId])
  await assert.rejects(f.file(), /NOT_SHARED/)
})

test('same contents preserve category versions; changed bytes invalidate the category and the old file URL', async () => {
  const f = await fixture(); await f.write('save'); await f.write('share')
  const before = await f.read()
  await f.write('share'); assert.deepEqual((await f.read()).versions, before.versions)
  const next = { ...f.manifest, id: id(f.n + 11), path: `${id(1)}/${f.caseId}/choices/${id(f.n + 11)}.pdf`, sha256: 'b'.repeat(64) }
  await f.write('share', { sharedFiles: [next] })
  assert.notEqual((await f.read()).versions[f.categories[0].id], before.versions[f.categories[0].id])
  await assert.rejects(f.file(), /NOT_SHARED/)
  assert.equal((await f.file(f.hash, next.id)).file.sha256, next.sha256)
})

test('supplier quotes, foreign sources, non-PDFs and oversized documents are rejected without changing the plan', async () => {
  for (const patch of ["content_type='image/png'", 'file_size_bytes=20000001', `org_id='${id(9)}'`, "storage_bucket='other'", "file_path='../elsewhere'"]) {
    const f = await fixture()
    await db.query(`update action_case_attachments set ${patch} where id=$1`, [f.refs[0].fileId])
    await assert.rejects(f.write('save'), /FILES/); assert.equal(await f.plan(), undefined)
  }
  for (const table of ['action_case_work_quotes', 'action_case_quote_requests']) {
    const f = await fixture(); await db.query(`insert into ${table} values($1,$2)`, [id(1), f.refs[0].fileId])
    await assert.rejects(f.write('save'), /FILES/)
  }
})

test('old clients retain references on save but cannot silently omit shared PDFs; CAS and malformed manifests roll back', async () => {
  const f = await fixture(); await f.write('save')
  await f.write('save', { optionFiles: undefined })
  assert.deepEqual((await f.plan()).option_files, f.refs)
  await assert.rejects(f.write('share', { optionFiles: undefined }), /FILE_SCHEMA/)
  for (const sharedFiles of [[], [f.manifest, f.manifest], [{ ...f.manifest, path: 'wrong' }], [{ ...f.manifest, fileSizeBytes: 999 }], [{ ...f.manifest, sha256: 'wrong' }]]) await assert.rejects(f.write('share', { sharedFiles }), /FILES/)
  await assert.rejects(f.write('share', { revision: 0 }), /STALE/)
  assert.equal(await f.read(), null)
})

test('migration reruns retain frozen copies and choices; anonymous callers cannot read or write', async () => {
  const f = await fixture(); await f.write('save'); await f.write('share')
  const before = await f.read(); await db.exec(filesSql); assert.deepEqual(await f.read(), before)
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set role ${role}`)
    try { await assert.rejects(f.file(), /permission denied/); await assert.rejects(db.query('select assert_customer_choice_file_refs($1,$2)', [[], []]), /permission denied/) }
    finally { await db.exec('reset role') }
  }
  assert.deepEqual((await db.query('select body from contract_sentinel')).rows[0].body, { contract: 'unchanged', price: 12300, paymentPlan: [12300], pdf: 'immutable' })
  assert.doesNotMatch(filesSql, /(?:update|insert into|delete from)\s+(?:public\.)?action_case_(?:customer_(?:offer|contract)|contract_signing|attachment_grants)/i)
})
