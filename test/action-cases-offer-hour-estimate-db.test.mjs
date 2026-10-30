import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
const migration = readFileSync(new URL('../docs/db/2026-10-30_03_offer_hour_estimate.sql', import.meta.url), 'utf8')
const body = () => ({ offerHourEstimate: { version: 1, minHours: 80, maxHours: 100 },
  contractPricing: { mode: 'running', running: { hourlyOre: 75000 } } })
before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table action_case_customer_offer_drafts(id integer primary key, body jsonb);
    create table action_case_customer_contract_drafts(id integer primary key, body jsonb);
    create table action_case_contract_signing_documents(id integer primary key, snapshot jsonb);
    insert into action_case_customer_contract_drafts values(1,'{"signed":"unchanged"}');
    insert into action_case_contract_signing_documents values(1,'{"signed":"unchanged"}');
    insert into action_case_customer_offer_drafts values(1,'{"baseAmountOre":123456}');`)
  await db.exec(migration); await db.exec(migration)
})
after(() => db.close())

test('migration is idempotent and does not rewrite existing offers or any contracts', async () => {
  for (const table of ['action_case_customer_contract_drafts', 'action_case_contract_signing_documents']) {
    const row = (await db.query(`select * from ${table}`)).rows[0]
    assert.deepEqual(row.body ?? row.snapshot, { signed: 'unchanged' })
  }
  assert.deepEqual((await db.query('select body from action_case_customer_offer_drafts where id=1')).rows[0].body, { baseAmountOre: 123456 })
})

test('database validates ranges and distinguishes incomplete drafts from complete customer terms', async () => {
  await db.query('select assert_offer_hour_estimate($1,true)', [body()])
  for (const estimate of [{ version: 1, minHours: null, maxHours: 100 }, { version: 1, minHours: 100, maxHours: 80 }]) {
    const value = { ...body(), offerHourEstimate: estimate }
    await db.query('select assert_offer_hour_estimate($1,false)', [value])
    await assert.rejects(db.query('select assert_offer_hour_estimate($1,true)', [value]), /CUSTOMER_OFFER_INCOMPLETE/)
  }
  for (const minHours of ['80', -1, 1.234, 100001]) {
    await assert.rejects(db.query('select assert_offer_hour_estimate($1,false)', [{ ...body(), offerHourEstimate: { version: 1, minHours, maxHours: 100 } }]), /CUSTOMER_OFFER_INVALID/)
  }
})

test('older offer clients cannot erase the new range or running terms; explicit clearing remains possible', async () => {
  await db.query('insert into action_case_customer_offer_drafts values(2,$1)', [body()])
  const current = body(); delete current.offerHourEstimate
  await assert.rejects(db.query('update action_case_customer_offer_drafts set body=$1 where id=2', [current]), /CUSTOMER_OFFER_STALE/)
  await assert.rejects(db.query('update action_case_customer_offer_drafts set body=$1 where id=2', [{ offerHourEstimate: null }]), /CUSTOMER_OFFER_STALE/)
  await db.query('update action_case_customer_offer_drafts set body=$1 where id=2', [{ ...body(), offerHourEstimate: null }])
  assert.equal((await db.query('select body from action_case_customer_offer_drafts where id=2')).rows[0].body.offerHourEstimate, null)
})

test('hour guard cannot be invoked by anonymous or normal authenticated clients', async () => {
  const { rows } = await db.query(`select has_function_privilege('anon','assert_offer_hour_estimate(jsonb,boolean)','execute') a,
    has_function_privilege('authenticated','assert_offer_hour_estimate(jsonb,boolean)','execute') b,
    has_function_privilege('service_role','assert_offer_hour_estimate(jsonb,boolean)','execute') c`)
  assert.deepEqual(rows[0], { a: false, b: false, c: true })
})
