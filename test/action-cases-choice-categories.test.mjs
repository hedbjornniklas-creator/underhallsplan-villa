import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { categoryOptions, choiceDecisionDates, currentCategoryChoice, legacyChoiceCategories, normalizeChoiceCategories, normalizeSharedChoices } from '../src/lib/action-cases/customerPlanning.ts'

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const item = (n, title = 'Fönster') => ({ id: id(n), title, scope: 'Leverans enligt granskat underlag.', status: 'planned', budgetOre: 100000, decisionBy: '' })
const category = (n, optionIds, title = 'Fönster') => ({ id: id(n), title, specification: 'Gemensamma krav.', decisionBy: '2026-11-20', optionIds: optionIds.map(id) })

test('legacy grouping proposes one category with ordered alternatives, preserving every source field and cost ID', () => {
  const items = [{ ...item(1, 'VELFAC'), optionGroup: 'Fönster' }, { ...item(2, 'Ekstrands'), optionGroup: 'Fönster' }, item(3, 'Målning')]
  const before = JSON.stringify(items), categories = legacyChoiceCategories(items)
  assert.equal(categories.length, 2)
  assert.deepEqual(categories[0].optionIds, [id(1), id(2)])
  assert.deepEqual(categoryOptions(categories[0], items), items.slice(0, 2))
  assert.deepEqual(normalizeChoiceCategories(categories, items, true), categories)
  assert.equal(JSON.stringify(items), before)
})

test('a category owns its specification, deadline and membership; duplicate, orphaned and unknown options are rejected', () => {
  const items = [item(1), item(2)], cats = [category(10, [1, 2])]
  assert.deepEqual(normalizeChoiceCategories(cats, items, true), cats)
  for (const bad of [[category(10, [1])], [category(10, [1, 1, 2])], [category(10, [1, 2, 3])], [category(10, [1]), category(10, [2])], [{ ...cats[0], decisionBy: '2026-02-30' }]]) {
    assert.throws(() => normalizeChoiceCategories(bad, items, true), /CUSTOMER_CHOICE_INVALID/)
  }
  assert.deepEqual(normalizeChoiceCategories([category(10, [], '')], []), [category(10, [], '')])
  assert.throws(() => normalizeChoiceCategories([category(10, [], '')], [], true), /INVALID/)
})

test('public projection strips costing and stale choices are not presented as current', () => {
  const shared = normalizeSharedChoices({ revision: 1, categories: [category(10, [1, 2])], items: [{ ...item(1), internal_costing: { secret: 42 } }, item(2)], versions: { [id(10)]: id(50), private: 'secret' },
    choices: [{ categoryId: id(10), categoryVersion: id(49), optionId: id(1), revision: 1, selectedAt: '2026-10-18T12:00:00Z', private: 'secret' }], internal_costing: { secret: 42 } })
  assert.equal(currentCategoryChoice(shared, id(10)), undefined)
  assert.doesNotMatch(JSON.stringify(shared), /secret|private|internal_costing/)
  shared.choices[0].categoryVersion = id(50)
  assert.equal(currentCategoryChoice(shared, id(10)).optionId, id(1))
})

test('shared category deadlines replace duplicate alternative dates without changing stored or contractual dates', () => {
  const items = [{ ...item(1), decisionBy: '2026-12-01' }, { ...item(2), decisionBy: '2026-12-01' }, { ...item(3, 'Golv'), decisionBy: '2026-10-30' }]
  const shared = { categories: [category(10, [1, 2]), { ...category(11, [3], 'Golv'), decisionBy: '' }], items }
  const before = JSON.stringify({ items, shared })
  assert.deepEqual(choiceDecisionDates(items, shared), [{ id: id(3), title: 'Golv', decisionBy: '2026-10-30' }, { id: id(10), title: 'Fönster', decisionBy: '2026-11-20' }])
  assert.equal(choiceDecisionDates(items).length, 3)
  assert.equal(JSON.stringify({ items, shared }), before)
})

const db = new PGlite()
const sql = readFileSync(new URL('../docs/db/2026-10-18_01_customer_choice_categories.sql', import.meta.url), 'utf8')
const base = readFileSync(new URL('../docs/db/2026-09-29_04_customer_offer_planning.sql', import.meta.url), 'utf8').split('-- Contract details')[0] + '\ncommit;'
before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table organizations(id uuid primary key); create table profiles(id uuid primary key);
    create table action_cases(id uuid primary key,org_id uuid not null);
    create table action_case_participants(id uuid primary key,org_id uuid not null,action_case_id uuid not null,role text not null);
    create table action_case_access_links(id uuid primary key,org_id uuid not null,action_case_id uuid not null,participant_id uuid not null,token_hash text unique,revoked_at timestamptz,expires_at timestamptz not null);
    create table action_case_events(id uuid default gen_random_uuid(),org_id uuid,action_case_id uuid,event_type text,message text,performed_by uuid);
    create table action_case_customer_contract_drafts(action_case_id uuid primary key,body jsonb,revision integer);
    create table action_case_customer_offers(id uuid primary key,snapshot jsonb);
    create table action_case_customer_offer_drafts(action_case_id uuid primary key,body jsonb,revision integer);
    create table action_case_contract_signing_documents(id uuid primary key,snapshot jsonb,pdf_bytes text);
    insert into organizations values('${id(1)}'),('${id(9)}'); insert into profiles values('${id(2)}');`)
  await db.exec(base)
  await db.exec("alter table action_case_customer_planning add column internal_costing jsonb not null default '{}'")
  await db.exec(sql)
  await db.exec(sql)
})
after(async () => { await db.close() })
let seq = 100
async function fixture() {
  const n = seq += 30, caseId = id(n), customerId = id(n + 1), link = id(n + 2), hash = `test-hash-${n}`
  await db.query('insert into action_cases values($1,$2)', [caseId, id(1)])
  await db.query("insert into action_case_participants values($1,$2,$3,'customer'),($4,$2,$3,'subcontractor')", [customerId, id(1), caseId, id(n + 3)])
  await db.query("insert into action_case_access_links values($1,$2,$3,$4,$5,null,'2099-01-01'),($6,$2,$3,$7,$8,null,'2099-01-01')", [link, id(1), caseId, customerId, hash, id(n + 4), id(n + 3), `ue-hash-${n}`])
  const items = [item(n + 10, 'VELFAC'), item(n + 11, 'Ekstrands'), item(n + 12, 'Nordiska'), item(n + 13, 'Golv A'), item(n + 14, 'Golv B')]
  const categories = [category(n + 20, [n + 10, n + 11, n + 12]), category(n + 21, [n + 13, n + 14], 'Golv')]
  const readPlan = async () => (await db.query('select * from action_case_customer_planning where action_case_id=$1', [caseId])).rows[0]
  const write = async (operation, extras = {}) => {
    const saved = await readPlan()
    await db.query('select write_customer_planning($1,$2,$3,$4,$5)', [id(1), caseId, id(2), operation, { revision: saved?.revision ?? 0, items, categories, confirmed: true, ...extras }])
  }
  const read = async (tokenHash = hash) => (await db.query('select read_customer_choices($1) as result', [tokenHash])).rows[0].result
  const choose = async (cat, optionId, revision = 0, version) => {
    const shared = await read()
    return (await db.query('select record_customer_choice($1,$2,$3,$4,$5) as result', [hash, cat, version ?? shared.versions[cat], optionId, revision])).rows[0].result
  }
  return { n, caseId, customerId, link, hash, items, categories, write, read, choose, readPlan }
}

test('saving is private; sharing freezes categories and their alternatives without private costing', async () => {
  const f = await fixture()
  await f.write('save')
  assert.equal(await f.read(), null)
  assert.equal((await f.readPlan()).shared_categories, null)
  await f.write('share')
  const published = await f.read()
  assert.deepEqual(published.categories, f.categories)
  assert.deepEqual(published.items, f.items)
  assert.deepEqual(published.choices, [])
  assert.equal(Object.keys(published.versions).length, 2)
  await f.write('save', { items: f.items.map((i, index) => index ? i : { ...i, budgetOre: 555000 }) })
  assert.deepEqual(await f.read(), published)
  assert.doesNotMatch(JSON.stringify(published), /costing|updated_by|token|profiles|contract/)
})

test('one choice per category persists, can be changed or cleared, and retries do not duplicate history', async () => {
  const f = await fixture(); await f.write('save'); await f.write('share')
  const cat = f.categories[0].id, first = f.items[0].id, second = f.items[1].id
  await f.choose(cat, first)
  await f.choose(cat, first)
  assert.equal((await db.query('select count(*)::int n from action_case_customer_choice_history where action_case_id=$1', [f.caseId])).rows[0].n, 1)
  await assert.rejects(f.choose(cat, second, 0), /CUSTOMER_CHOICE_STALE/)
  await f.choose(cat, second, 1)
  await f.choose(f.categories[1].id, f.items[3].id)
  let shared = await f.read()
  assert.equal(shared.choices.length, 2)
  assert.equal(shared.choices.find((c) => c.categoryId === cat).optionId, second)
  await f.choose(cat, null, 2)
  shared = await f.read()
  assert.equal(shared.choices.find((c) => c.categoryId === cat).optionId, null)
  assert.equal(shared.choices.find((c) => c.categoryId === f.categories[1].id).optionId, f.items[3].id)
  assert.equal(normalizeSharedChoices(shared).choices.length, 2)
})

test('changes invalidate only the affected shared category, while preserving history and unrelated choices', async () => {
  const f = await fixture(); await f.write('save'); await f.write('share')
  const cat = f.categories[0].id
  await f.choose(cat, f.items[0].id); await f.choose(f.categories[1].id, f.items[3].id)
  const before = await f.read()
  f.items[0].budgetOre += 100
  await f.write('save'); assert.deepEqual(await f.read(), before)
  await f.write('share')
  const after = await f.read()
  assert.notEqual(after.versions[cat], before.versions[cat])
  assert.equal(after.versions[f.categories[1].id], before.versions[f.categories[1].id])
  assert.equal(currentCategoryChoice(normalizeSharedChoices(after), cat), undefined)
  assert.equal(currentCategoryChoice(normalizeSharedChoices(after), f.categories[1].id).optionId, f.items[3].id)
  await assert.rejects(f.choose(cat, f.items[1].id, 1, before.versions[cat]), /CUSTOMER_CHOICE_STALE/)
  await f.choose(cat, f.items[1].id, 1)
  assert.equal((await f.read()).choices.find((c) => c.categoryId === cat).revision, 2)
})

test('wrong category, project, tenant, revoked, expired and subcontractor links cannot record customer choices', async () => {
  const f = await fixture(), other = await fixture(); await f.write('save'); await f.write('share')
  await other.write('save'); await other.write('share')
  await assert.rejects(f.choose(f.categories[0].id, f.items[3].id), /CUSTOMER_CHOICE_INVALID/)
  await assert.rejects(f.choose(other.categories[0].id, other.items[0].id, 0, (await other.read()).versions[other.categories[0].id]), /CUSTOMER_CHOICE_STALE/)
  await assert.rejects(f.read(`ue-hash-${f.n}`), /CLOSED/)
  await db.query('update action_case_access_links set org_id=$1 where id=$2', [id(9), f.link])
  await assert.rejects(f.read(), /CLOSED/)
  await db.query('update action_case_access_links set org_id=$1,revoked_at=now() where id=$2', [id(1), f.link])
  await assert.rejects(f.read(), /CLOSED/)
  await db.query("update action_case_access_links set revoked_at=null,expires_at='2000-01-01' where id=$1", [f.link])
  await assert.rejects(f.read(), /CLOSED/)
  assert.equal((await db.query('select count(*)::int n from action_case_customer_choices where action_case_id=$1', [f.caseId])).rows[0].n, 0)
})

test('unsharing and changing the recipient cannot reactivate old customer choices', async () => {
  const f = await fixture(); await f.write('save'); await f.write('share'); await f.choose(f.categories[0].id, f.items[0].id)
  const first = await f.read()
  await f.write('unshare'); assert.equal(await f.read(), null)
  await assert.rejects(db.query('select record_customer_choice($1,$2,$3,$4,1)', [f.hash, f.categories[0].id, first.versions[f.categories[0].id], f.items[0].id]), /NOT_SHARED/)
  await f.write('share')
  assert.notEqual((await f.read()).versions[f.categories[0].id], first.versions[f.categories[0].id])
  await db.query("update action_case_customer_planning set participant_id=null,shared_items='[]' where action_case_id=$1", [f.caseId])
  const hidden = await f.readPlan()
  assert.equal(hidden.shared_categories, null); assert.deepEqual(hidden.shared_category_versions, {})
  assert.equal(await f.read(), null)
})

test('old clients cannot erase category metadata; append-only legacy imports preserve categories and costing', async () => {
  const f = await fixture(); await f.write('save')
  const before = await f.readPlan()
  await assert.rejects(f.write('save', { categories: null }), /CUSTOMER_CHOICE_INVALID/)
  const added = item(f.n + 15, 'Extra alternativ')
  await db.query('select save_customer_planning_costing($1,$2,$3,$4)', [id(1), f.caseId, id(2), { revision: before.revision, items: [...f.items, added], costing: { [added.id]: { internal: 'retained privately' } } }])
  const after = await f.readPlan()
  assert.deepEqual(after.categories.slice(0, 2), f.categories)
  assert.deepEqual(after.items, [...f.items, added])
  assert.deepEqual(after.internal_costing, { [added.id]: { internal: 'retained privately' } })
  await assert.rejects(db.query('select write_customer_planning($1,$2,$3,$4,$5)', [id(1), f.caseId, id(2), 'save', { revision: after.revision, items: f.items.slice(1) }]), /CUSTOMER_CHOICE_SCHEMA/)
})

test('reapplying the migration and reordering the item storage preserve shared versions and saved choices', async () => {
  const f = await fixture(); await f.write('save'); await f.write('share')
  const cat = f.categories[0].id
  await f.choose(cat, f.items[0].id)
  const before = await f.read()
  await db.exec(sql)
  assert.deepEqual(await f.read(), before)
  await f.write('save', { items: [...f.items].reverse() })
  await f.write('share', { items: [...f.items].reverse() })
  const after = await f.read()
  assert.deepEqual(after.versions, before.versions)
  assert.deepEqual(after.choices, before.choices)
  assert.equal(currentCategoryChoice(normalizeSharedChoices(after), cat).optionId, f.items[0].id)
})

test('a replacement customer receives no previous customer choice or usable category version', async () => {
  const f = await fixture(); await f.write('save'); await f.write('share'); await f.choose(f.categories[0].id, f.items[0].id)
  const before = await f.read(), replacement = id(f.n + 5), replacementHash = `replacement-${f.n}`
  await db.query("update action_case_participants set role='previous_customer' where id=$1", [f.customerId])
  await db.query("insert into action_case_participants values($1,$2,$3,'customer')", [replacement, id(1), f.caseId])
  await db.query("insert into action_case_access_links values($1,$2,$3,$4,$5,null,'2099-01-01')", [id(f.n + 6), id(1), f.caseId, replacement, replacementHash])
  await f.write('share')
  const after = await f.read(replacementHash)
  assert.deepEqual(after.choices, [])
  assert.notEqual(after.versions[f.categories[0].id], before.versions[f.categories[0].id])
  await assert.rejects(f.choose(f.categories[0].id, f.items[1].id, 1, before.versions[f.categories[0].id]), /CLOSED/)
  assert.equal((await db.query('select count(*)::int n from action_case_customer_choice_history where action_case_id=$1', [f.caseId])).rows[0].n, 1)
})

test('rapid actual changes are rate limited, while retries remain idempotent and a revoked link cannot write', async () => {
  const f = await fixture(); await f.write('save'); await f.write('share')
  const cat = f.categories[0].id
  for (let revision = 0; revision < 30; revision++) await f.choose(cat, f.items[revision % 2].id, revision)
  await f.choose(cat, f.items[1].id, 30)
  await assert.rejects(f.choose(cat, f.items[0].id, 30), /RATE_LIMIT/)
  assert.equal((await f.read()).choices[0].revision, 30)
  await db.query('update action_case_access_links set revoked_at=now() where id=$1', [f.link])
  await assert.rejects(db.query('select record_customer_choice($1,$2,$3,$4,30)', [f.hash, cat, (await f.readPlan()).shared_category_versions[cat], f.items[0].id]), /CLOSED/)
})

test('malformed membership and hidden fields cannot be shared; only service role may call choice functions or read history', async () => {
  const f = await fixture(); await f.write('save')
  await assert.rejects(f.write('share', { confirmed: false }), /CONFIRM/)
  await assert.rejects(f.write('save', { items: f.items.map((i) => ({ ...i, internal_costing: 'private' })) }), /INVALID/)
  await assert.rejects(f.write('save', { categories: [category(f.n + 20, [f.n + 10])] }), /INVALID/)
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set role ${role}`)
    try {
      await assert.rejects(db.query('select * from action_case_customer_choices'), /permission denied/)
      await assert.rejects(db.query('select * from action_case_customer_choice_history'), /permission denied/)
      await assert.rejects(db.query('select read_customer_choices($1)', [f.hash]), /permission denied/)
      await assert.rejects(db.query('select record_customer_choice($1,$2,$3,$4,0)', [f.hash, f.categories[0].id, id(99), f.items[0].id]), /permission denied/)
      await assert.rejects(db.query("select write_customer_planning($1,$2,$3,'unshare',$4)", [id(1), f.caseId, id(2), { revision: 1 }]), /permission denied/)
      await assert.rejects(db.query('select save_customer_planning_costing($1,$2,$3,$4)', [id(1), f.caseId, id(2), { revision: 1, items: [], costing: {} }]), /permission denied/)
    } finally { await db.exec('reset role') }
  }
})

test('category edits, customer choice, clearing and unsharing never change agreements, prices, payment plans or locked evidence', async () => {
  const f = await fixture()
  const evidence = { contract: 'DO NOT CHANGE', baseAmountOre: 123456789, terms: 'Original terms', paymentPlan: { installments: [{ amountOre: 123456789 }] } }
  await db.query('insert into action_case_customer_contract_drafts values($1,$2,199)', [f.caseId, evidence])
  await db.query('insert into action_case_customer_offer_drafts values($1,$2,45)', [f.caseId, evidence])
  await db.query('insert into action_case_customer_offers values($1,$2)', [f.caseId, evidence])
  await db.query('insert into action_case_contract_signing_documents values($1,$2,$3)', [f.caseId, evidence, 'immutable PDF bytes'])
  const tables = ['action_case_customer_contract_drafts', 'action_case_customer_offer_drafts', 'action_case_customer_offers', 'action_case_contract_signing_documents']
  const read = async () => Promise.all(tables.map(async (table) => (await db.query(`select * from ${table}`)).rows))
  const before = await read()
  await f.write('save'); await f.write('share'); await f.choose(f.categories[0].id, f.items[0].id)
  await f.choose(f.categories[0].id, f.items[1].id, 1); await f.choose(f.categories[0].id, null, 2)
  f.categories[0].title = 'Fönster ändrat'; f.items[0].budgetOre = 8000000
  await f.write('save'); await f.write('share'); await f.write('unshare')
  assert.deepEqual(await read(), before)
  assert.doesNotMatch(sql, /(?:update|insert into|delete from)\s+(?:public\.)?action_case_(?:customer_(?:offer|contract)|contract_signing)/i)
})
