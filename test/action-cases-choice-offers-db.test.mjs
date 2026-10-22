import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { choiceOfferForEditing } from '../src/lib/action-cases/choiceOffer.ts'
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const read = name => readFileSync(new URL(`../docs/db/${name}`, import.meta.url), 'utf8')
const migration = read('2026-10-22_01_customer_choice_offers.sql'), db = new PGlite()
before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table organizations(id uuid primary key); create table profiles(id uuid primary key);
    create table action_cases(id uuid primary key,org_id uuid not null);
    create table action_case_participants(id uuid primary key,org_id uuid,action_case_id uuid,role text);
    create table action_case_access_links(id uuid primary key,org_id uuid,action_case_id uuid,participant_id uuid,token_hash text unique,revoked_at timestamptz,expires_at timestamptz);
    create table action_case_events(id uuid default gen_random_uuid(),org_id uuid,action_case_id uuid,event_type text,message text,performed_by uuid);
    create table contract_sentinel(body jsonb); insert into contract_sentinel values('{"contract":"unchanged","paymentPlan":12300}');
    insert into organizations values('${id(1)}'); insert into profiles values('${id(2)}');`)
  await db.exec(read('2026-09-29_04_customer_offer_planning.sql').split('-- Contract details')[0] + '\ncommit;')
  await db.exec("alter table action_case_customer_planning add column internal_costing jsonb not null default '{}'")
  await db.exec(read('2026-10-18_01_customer_choice_categories.sql'))
  await db.exec(read('2026-10-08_04_contract_pricing.sql').split('-- Extend the existing guards')[0] + '\ncommit;')
  await db.exec(migration); await db.exec(migration)
})
after(async () => db.close())
let sequence = 100
async function fixture() {
  const n = sequence += 10, caseId = id(n)
  const item = { id: id(n + 1), title: 'Fiktivt tillval', scope: 'Fiktiv omfattning.', status: 'planned', budgetOre: 12300, decisionBy: '' }
  item.offer = choiceOfferForEditing(item)
  const category = { id: id(n + 2), title: 'Fönster', specification: '', decisionBy: '', optionIds: [item.id] }
  await db.query('insert into action_cases values($1,$2)', [caseId, id(1)])
  await db.query("insert into action_case_participants values($1,$2,$3,'customer')", [id(n + 3), id(1), caseId])
  const plan = async () => (await db.query('select * from action_case_customer_planning where action_case_id=$1', [caseId])).rows[0]
  const write = async (operation = 'save', patch = {}) => db.query('select write_customer_planning($1,$2,$3,$4,$5)', [id(1), caseId, id(2), operation, { revision: (await plan())?.revision ?? 0, confirmed: true, items: [item], categories: [category], ...patch }])
  return { n, caseId, item, category, plan, write }
}
test('terms save without agreement writes and stay private until explicit sharing', async () => {
  const f = await fixture(); await f.write()
  assert.deepEqual((await f.plan()).items, [f.item]); assert.deepEqual((await f.plan()).shared_items, [])
  await f.write('share'); assert.deepEqual((await f.plan()).shared_items, [f.item])
  const before = (await f.plan()).shared_category_versions
  f.item.offer.time = { status: 'extension', workingDays: 2, explanation: 'Leverans.' }
  await f.write(); assert.deepEqual((await f.plan()).shared_category_versions, before)
  await f.write('share'); assert.notDeepEqual((await f.plan()).shared_category_versions, before)
  assert.deepEqual((await db.query('select body from contract_sentinel')).rows[0].body, { contract: 'unchanged', paymentPlan: 12300 })
  assert.doesNotMatch(migration, /(?:update|insert into|delete from)\s+(?:public\.)?action_case_(?:customer_(?:offer|contract)|contract_signing)/i)
})
test('zero, neutral, unknown, running and mixed customer amounts are distinct', async () => {
  for (const mode of ['fixed', 'running', 'mixed']) {
    const f = await fixture(); f.item.offer.pricing.mode = mode
    if (mode !== 'fixed') f.item.budgetOre = null
    await f.write()
    assert.equal((await f.plan()).items[0].budgetOre, mode === 'fixed' ? 12300 : null)
  }
  const f = await fixture(); f.item.offer.priceNeutral = true; f.item.budgetOre = 0; await f.write()
  f.item.offer.priceNeutral = false; f.item.offer.pricing.totalOre = null; f.item.budgetOre = null; await f.write()
  assert.equal((await f.plan()).items[0].budgetOre, null)
})
test('invalid terms and inconsistent public totals are rejected transactionally', async () => {
  const f = await fixture(); await f.write(); const before = await f.plan()
  const bad = [
    { ...f.item, budgetOre: 999 }, { ...f.item, offer: null },
    ...[{ version: 2 }, { kind: 'approved' }, { priceSource: 'guess' }, { priceNeutral: 'true' }, { conditions: 'x'.repeat(6001) }, { time: { status: 'extension', workingDays: -1, explanation: '' } }, { time: { status: 'extension', workingDays: 1.5, explanation: '' } }].map(patch => ({ ...f.item, offer: { ...f.item.offer, ...patch } })),
  ]
  for (const item of bad) await assert.rejects(f.write('save', { items: [item] }), /INVALID/)
  assert.deepEqual(await f.plan(), before)
})
test('older clients cannot erase price/time terms or quantity format, but explicit deletion works', async () => {
  const f = await fixture(); await f.write()
  const { offer, ...oldItem } = f.item
  await assert.rejects(f.write('save', { items: [oldItem] }), /STALE/)
  await db.query('update action_case_customer_planning set internal_costing=$1 where action_case_id=$2', [{ [f.item.id]: { version: 3, rows: [] } }, f.caseId])
  await assert.rejects(db.query('update action_case_customer_planning set internal_costing=$1 where action_case_id=$2', [{ [f.item.id]: { version: 2, rows: [] } }, f.caseId]), /STALE/)
  await f.write('save', { items: [], categories: [] })
  assert.deepEqual((await f.plan()).items, [])
})
test('reruns retain saved terms and capability is service-only', async () => {
  const f = await fixture(); await f.write(); const before = await f.plan()
  await db.exec(migration); assert.deepEqual(await f.plan(), before)
  assert.equal((await db.query('select customer_choice_offer_schema() n')).rows[0].n, 1)
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set role ${role}`)
    try { await assert.rejects(db.query('select customer_choice_offer_schema()'), /permission denied/) }
    finally { await db.exec('reset role') }
  }
})
