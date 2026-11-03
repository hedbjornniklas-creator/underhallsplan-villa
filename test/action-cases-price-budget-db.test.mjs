import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const a = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', b = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const read = name => readFileSync(new URL(`../docs/db/${name}`, import.meta.url), 'utf8')
const migration = read('2026-11-03_01_running_price_budget.sql')
const db = new PGlite()
const body = () => ({ pricingMode: 'total', baseAmountOre: null, items: [{ kind: 'included', amountOre: null }],
  contractPricing: { version: 1, mode: 'running', basis: 'rows', split: 'combined', display: 'priced', totalOre: null, labourOre: null, materialOre: null,
    rows: [{ id: a, title: 'Plattsättning', kind: 'running', amountOre: null, labourOre: null, materialOre: null }],
    running: { hourlyOre: 75000, managementOre: null, markupPercent: 15, approximateOre: null },
    budget: { version: 1, rows: [{ id: a, amountOre: 10000000 }], assumptions: 'Fiktiva antaganden.', reviewTerms: 'Samråd vid risk för överskridande.' } } })
before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table action_case_customer_offer_drafts(id integer primary key, body jsonb);
    create table action_case_customer_contract_drafts(id integer primary key, body jsonb);
    create table action_case_contract_signing_documents(id integer primary key, snapshot jsonb);
    insert into action_case_customer_offer_drafts values(1,'{"saved":"legacy"}');
    insert into action_case_customer_contract_drafts values(1,'{"saved":"legacy"}');
    insert into action_case_contract_signing_documents values(1,'{"signed":"unchanged"}');`)
  await db.exec(read('2026-10-08_04_contract_pricing.sql').split('-- Extend the existing guards')[0] + '\ncommit;')
  await db.exec(migration); await db.exec(migration)
})
after(() => db.close())

test('migration is repeatable and rewrites no legacy drafts or signing evidence', async () => {
  for (const table of ['action_case_customer_offer_drafts', 'action_case_customer_contract_drafts'])
    assert.deepEqual((await db.query(`select body from ${table} where id=1`)).rows[0].body, { saved: 'legacy' })
  assert.deepEqual((await db.query('select snapshot from action_case_contract_signing_documents where id=1')).rows[0].snapshot, { signed: 'unchanged' })
})

test('budget guards run inside the existing canonical price validator without returning a fixed amount', async () => {
  assert.equal((await db.query('select assert_contract_pricing($1,true) amount', [body()])).rows[0].amount, null)
  const d = body(); d.contractPricing.budget.rows[0].amountOre = 0
  await db.query('select assert_contract_pricing($1,true)', [d])
  d.contractPricing.budget.rows[0].amountOre = null
  await db.query('select assert_contract_pricing($1,false)', [d])
  await assert.rejects(db.query('select assert_contract_pricing($1,true)', [d]), /CUSTOMER_OFFER_INCOMPLETE/)
})

test('database rejects malformed, contradictory and orphan budgets before they can be stored or published', async () => {
  for (const patch of [{ version: 2 }, { assumptions: false }, { reviewTerms: 'x'.repeat(6001) },
    { rows: [{ id: a, amountOre: -1 }] }, { rows: [{ id: a, amountOre: '100' }] }, { rows: [{ id: a, amountOre: 0.5 }] },
    { rows: [{ id: a, amountOre: 100000000001 }] }, { rows: [{ id: b, amountOre: 1 }] },
    { rows: [{ id: a, amountOre: 1 }, { id: a.toUpperCase(), amountOre: 2 }] }]) {
    const d = body(); Object.assign(d.contractPricing.budget, patch)
    await assert.rejects(db.query('select assert_contract_budget($1,false)', [d]), /CUSTOMER_OFFER_INVALID/)
  }
  const d = body(); d.contractPricing.running.approximateOre = 1
  await assert.rejects(db.query('select assert_contract_pricing($1,false)', [d]), /CUSTOMER_OFFER_INVALID/)
  d.contractPricing.running.approximateOre = null; d.contractPricing.mode = 'fixed'
  await assert.rejects(db.query('select assert_contract_pricing($1,false)', [d]), /CUSTOMER_OFFER_INVALID/)
})

test('complete budget terms require assumptions, review terms and a budget for each running moment', async () => {
  for (const patch of [{ assumptions: '' }, { reviewTerms: '  ' }, { rows: [] }]) {
    const d = body(); Object.assign(d.contractPricing.budget, patch)
    await db.query('select assert_contract_pricing($1,false)', [d])
    await assert.rejects(db.query('select assert_contract_pricing($1,true)', [d]), /CUSTOMER_OFFER_INCOMPLETE/)
  }
})

test('fixed portions and running budgets have separate amounts and reject a combined overflow', async () => {
  const d = body(); d.contractPricing.mode = 'mixed'; d.baseAmountOre = 4000000
  d.contractPricing.rows.push({ id: b, title: 'Fast moment', kind: 'fixed', amountOre: 4000000, labourOre: null, materialOre: null })
  assert.equal(Number((await db.query('select assert_contract_pricing($1,true) amount', [d])).rows[0].amount), 4000000)
  d.contractPricing.budget.rows[0].amountOre = 100000000000
  await assert.rejects(db.query('select assert_contract_pricing($1,true)', [d]), /CUSTOMER_OFFER_INVALID/)
})

test('old offer and contract clients cannot silently erase budgets, but explicit null can clear them', async () => {
  for (const table of ['action_case_customer_offer_drafts', 'action_case_customer_contract_drafts']) {
    await db.query(`insert into ${table} values(2,$1)`, [body()])
    const old = body(); delete old.contractPricing.budget
    await assert.rejects(db.query(`update ${table} set body=$1 where id=2`, [old]), /CUSTOMER_OFFER_STALE/)
    await assert.rejects(db.query(`update ${table} set body=$1 where id=2`, [{ pricingMode: 'total' }]), /CUSTOMER_OFFER_STALE/)
    const cleared = body(); cleared.contractPricing.budget = null
    await db.query(`update ${table} set body=$1 where id=2`, [cleared])
    assert.equal((await db.query(`select body from ${table} where id=2`)).rows[0].body.contractPricing.budget, null)
  }
})

test('anonymous and normal authenticated clients cannot invoke private budget guards', async () => {
  const { rows } = await db.query(`select has_function_privilege('anon','assert_contract_budget(jsonb,boolean)','execute') a,
    has_function_privilege('authenticated','assert_contract_budget(jsonb,boolean)','execute') b,
    has_function_privilege('service_role','assert_contract_budget(jsonb,boolean)','execute') c`)
  assert.deepEqual(rows[0], { a: false, b: false, c: true })
})
