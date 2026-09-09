import assert from 'node:assert/strict'
import { test, before, after } from 'node:test'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { PGlite } from '@electric-sql/pglite'
import * as scope from '../src/lib/action-cases/scopeAttachments.ts'

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
test('selection is explicit, many-to-many and independent from portal grants', () => {
  const files = [{ id: id(3), actionCaseItemId: id(1) }, { id: id(4), actionCaseItemId: null }]
  assert.deepEqual(scope.scopeAttachmentIds({ id: id(1) }, files), [id(3)])
  assert.deepEqual(scope.scopeAttachmentIds({ id: id(1), scopeAttachmentIds: [] }, files), [])
  assert.deepEqual(scope.defaultRequestAttachments([{ id: id(1), scopeAttachmentIds: [id(3), id(4)] }, { id: id(2), scopeAttachmentIds: [id(4)] }], files), [id(3), id(4)])
  assert.deepEqual(scope.defaultRequestAttachments([{ id: id(1), scopeAttachmentIds: [id(3), id(4), id(5)] }], [...files, { id: id(5), isQuoteDocument: true }], new Set([id(4)])), [id(3)])
  assert.deepEqual(files[1], { id: id(4), actionCaseItemId: null })
  assert.deepEqual(scope.parseScopeAttachmentIds([id(3), id(3)]), [id(3)])
  for (const value of [null, {}, [null], ['bad'], Array(51).fill(id(3))]) assert.throws(() => scope.parseScopeAttachmentIds(value))
})

test('request defaults follow work selection without undoing manual additions or opt-outs', () => {
  const update = scope.reconcileRequestAttachments
  assert.deepEqual(update([], [], ['photo', 'doc'], {}), ['photo', 'doc'])
  assert.deepEqual(update(['doc'], ['photo', 'doc'], ['photo', 'doc', 'other'], { photo: false }), ['doc', 'other'])
  assert.deepEqual(update(['photo', 'manual'], ['photo'], [], { manual: true }), ['manual'])
  assert.deepEqual(update(['photo'], ['photo'], [], { photo: true }), ['photo'])
  assert.deepEqual(update(['photo'], ['photo'], ['photo'], {}), ['photo'])
  assert.deepEqual(update([], [], ['photo'], { photo: false }), [])
})

const db = new PGlite()
const migration = readFileSync(new URL('../docs/db/2026-09-09_02_action_case_scope_attachments.sql', import.meta.url), 'utf8')
before(async () => {
  await db.exec(`create role authenticated; create role anon; create role service_role;
    create table organizations(id uuid primary key); create table profiles(id uuid primary key);
    create function is_org_member(uuid) returns boolean language sql as $$ select true $$;
    create function operational_tasks_set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at=clock_timestamp(); return new; end $$;`)
  await db.exec(readFileSync(new URL('../docs/db/2026-09-08_01_action_cases_foundation.sql', import.meta.url), 'utf8').replace('create extension if not exists pgcrypto;', ''))
  await db.exec(`create table action_case_attachments(id uuid primary key, org_id uuid not null, action_case_id uuid not null, action_case_item_id uuid, title text);
    create table action_case_attachment_grants(attachment_id uuid, participant_id uuid);
    insert into organizations values('${id(1)}'),('${id(2)}');
    insert into action_cases(id,org_id,title,customer_name,property_address) values('${id(10)}','${id(1)}','A','C','Address'),('${id(11)}','${id(1)}','B','C','Address'),('${id(12)}','${id(2)}','C','C','Address');
    insert into action_case_items(id,org_id,action_case_id,title,sort_order) values('${id(20)}','${id(1)}','${id(10)}','A',100),('${id(21)}','${id(1)}','${id(10)}','B',200);
    insert into action_case_attachments values('${id(30)}','${id(1)}','${id(10)}','${id(20)}','Photo'),('${id(31)}','${id(1)}','${id(10)}',null,'Doc'),('${id(32)}','${id(1)}','${id(11)}',null,'Wrong case'),('${id(33)}','${id(2)}','${id(12)}',null,'Wrong org');`)
  for (const name of ['03_action_case_costing', '04_action_case_ai_costing']) {
    await db.exec(readFileSync(new URL(`../docs/db/2026-09-08_${name}.sql`, import.meta.url), 'utf8'))
  }
  await db.exec(migration)
})
after(() => db.close())
const item = async (n = 20) => (await db.query('select scope_attachment_ids, updated_at::text as updated_at from action_case_items where id=$1', [id(n)])).rows[0]
const selectFiles = (files, n = 20) => db.query('update action_case_items set scope_attachment_ids=$1::uuid[] where id=$2', [files, id(n)])

test('migration retains legacy rows, enforces org/case scope and permits reuse without grants', async () => {
  assert.equal((await item()).scope_attachment_ids, null)
  for (const files of [[id(32)], [id(33)], [id(99)], [id(30), id(30)], [null]]) await assert.rejects(selectFiles(files), /ACTION_CASE_SCOPE_ATTACHMENTS_INVALID/)
  await selectFiles([id(30), id(31)])
  await selectFiles([id(30)], 21)
  assert.deepEqual((await item()).scope_attachment_ids, [id(30), id(31)])
  assert.deepEqual((await item(21)).scope_attachment_ids, [id(30)])
  assert.equal((await db.query('select * from action_case_attachment_grants')).rows.length, 0)
  assert.equal((await db.query('select action_case_item_id from action_case_attachments where id=$1', [id(30)])).rows[0].action_case_item_id, id(20))
  const before = await item()
  await db.exec(migration)
  assert.deepEqual(await item(), before, 'rerunning does not change selection or versions')
})

test('file changes and deletions invalidate affected proposals and remove dead references', async () => {
  const before = await item(), other = await item(21)
  await db.query('update action_case_attachments set title=$1 where id=$2', ['Renamed', id(30)])
  assert.notEqual(String((await item()).updated_at), String(before.updated_at))
  assert.notEqual(String((await item(21)).updated_at), String(other.updated_at))
  await db.query('delete from action_case_attachments where id=$1', [id(30)])
  assert.deepEqual((await item()).scope_attachment_ids, [id(31)])
  assert.deepEqual((await item(21)).scope_attachment_ids, [])
  await db.query('update action_case_attachments set action_case_id=$1 where id=$2', [id(11), id(31)])
  assert.deepEqual((await item()).scope_attachment_ids, [])
})

test('batch deletion cleans all references in the same statement', async () => {
  await db.query('insert into action_case_attachments(id,org_id,action_case_id) values($1,$3,$4),($2,$3,$4)', [id(40), id(41), id(1), id(10)])
  await selectFiles([id(40), id(41)])
  await db.query('delete from action_case_attachments where id=any($1::uuid[])', [[id(40), id(41)]])
  assert.deepEqual((await item()).scope_attachment_ids, [])
})

test('existing costing RPC rejects an AI suggestion after a selected file changes', async () => {
  await db.query('insert into action_case_attachments(id,org_id,action_case_id) values($1,$2,$3)', [id(50), id(1), id(10)])
  await selectFiles([id(50)])
  await db.query(`insert into action_case_cost_suggestions(id,org_id,action_case_id,action_case_item_id,source_updated_at,model,lines)
    select $1,org_id,action_case_id,id,updated_at,'test','[]'::jsonb from action_case_items where id=$2`, [id(51), id(20)])
  await db.query('update action_case_attachments set title=$1 where id=$2', ['Changed', id(50)])
  await assert.rejects(db.query('select write_action_case_costs($1,$2,$3,null,$4,$5::jsonb,$6)', [id(1), id(10), id(20), 'apply', JSON.stringify([{ id: id(52) }]), id(51)]), /ACTION_CASE_AI_STALE/)
  assert.equal((await db.query('select * from action_case_cost_lines')).rows.length, 0)
})

test('item API persists text and files atomically, with case/org scoping and optimistic concurrency', async () => {
  const code = ts.transpileModule(readFileSync(new URL('../src/lib/action-cases/server.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  function harness({ missingFile = false, stale = false, migrated = true } = {}) {
    const reads = [], writes = []
    const existing = { id: id(20), org_id: id(1), action_case_id: id(10), title: 'Before', scope: 'Before', status: 'pricing_needed', ...(migrated ? { scope_attachment_ids: null } : {}) }
    const admin = { from(table) {
      const read = { table, filters: [] }; reads.push(read)
      let operation = 'read'
      const result = () => table === 'action_case_items' ? { data: operation === 'update' ? (stale ? null : { id: id(20) }) : [existing], error: null } : { data: missingFile ? [] : [{ id: id(30) }], error: null }
      const chain = {
        select() { return chain }, eq(...filter) { read.filters.push(filter); return chain }, in(...filter) { read.filters.push(filter); return chain },
        single: async () => ({ data: existing, error: null }), maybeSingle: async () => result(),
        then: (resolve) => Promise.resolve(result()).then(resolve),
        update(patch) { operation = 'update'; writes.push({ table, patch, filters: read.filters }); return chain }, insert: async () => ({ error: null }),
      }
      return chain
    } }
    const mod = { exports: {} }
    new Function('module', 'exports', 'require', code)(mod, mod.exports, (name) => {
      if (name === '@/lib/supabase/admin') return { createSupabaseAdminClient: () => admin }
      if (name === './scopeAttachments') return scope
      return {}
    })
    return { writes, reads, save: (more = {}) => mod.exports.updateActionCaseItem({ orgId: id(1), userId: id(2) }, { itemId: id(20), expectedUpdatedAt: 'v1', title: 'Updated', scope: 'Changed', scopeAttachmentIds: [id(30)], ...more }) }
  }
  const h = harness(); await h.save()
  const update = h.writes.find((write) => write.table === 'action_case_items')
  assert.equal(update.patch.title, 'Updated'); assert.equal(update.patch.scope, 'Changed')
  assert.deepEqual(update.patch.scope_attachment_ids, [id(30)])
  assert.ok(update.filters.some(([key, value]) => key === 'updated_at' && value === 'v1'))
  assert.deepEqual(h.reads.find((read) => read.table === 'action_case_attachments').filters, [['org_id', id(1)], ['action_case_id', id(10)], ['id', [id(30)]]])
  const missing = harness({ missingFile: true }); await assert.rejects(missing.save(), /SCOPE_ATTACHMENTS_INVALID/); assert.equal(missing.writes.length, 0)
  const unmigrated = harness({ migrated: false }); await assert.rejects(unmigrated.save(), /SCHEMA_REQUIRED/); assert.equal(unmigrated.writes.length, 0)
  await assert.rejects(harness({ stale: true }).save(), /ITEM_STALE/)
  await assert.rejects(harness().save({ expectedUpdatedAt: undefined }), /ITEM_STALE/)
})
