import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
// @ts-expect-error Node's strip-types runner requires the TypeScript extension.
import { getPublicLoginDestination } from '../src/lib/publicNavigation.ts'

const db = new PGlite()
const brf = randomUUID(), actor = randomUUID()
const migration = readFileSync(new URL('../docs/db/2026-09-07_04_renoapp_consultant_reviews.sql', import.meta.url), 'utf8')
before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table profiles(id uuid primary key); create table brf_associations(id uuid primary key);
    create table renovation_cases(id uuid primary key, brf_id uuid references brf_associations, status text);
  `)
  await db.query('insert into profiles values($1)', [actor])
  await db.query('insert into brf_associations values($1)', [brf])
  await db.exec(migration)
  await db.exec(migration)
})
after(async () => { await db.close() })
async function fixture(status = 'review') {
  const id = randomUUID()
  await db.query('insert into renovation_cases values($1,$2,$3)', [id, brf, status])
  return id
}
async function order(id: string, message: string | null = null, by = actor) {
  return (await db.query<{ result: { id: string; message: string | null; price_ore: number; brf_id: string; email_payload: object } }>(
    'select renoapp_order_consultant_review($1,$2,$3,$4,$5,$6) result', [id, by, 'Board', 'board@example.test', message, { text: 'Frozen email' }])).rows[0].result
}
test('repeatable migration; one fixed-price immutable order per case, without changing its status', async () => {
  const id = await fixture(), first = await order(id, 'Please review')
  assert.equal(first.price_ore, 150000)
  assert.equal(first.brf_id, brf)
  const again = await order(id, 'Changed message')
  assert.equal(again.id, first.id)
  assert.equal(again.message, 'Please review')
  assert.equal((await db.query<{ status: string }>('select status from renovation_cases where id=$1', [id])).rows[0].status, 'review')
  await assert.rejects(db.query('update renoapp_consultant_reviews set message=$1 where id=$2', ['Changed', first.id]), /REVIEW_ORDER_IMMUTABLE/)
  await assert.rejects(db.query('update renoapp_consultant_reviews set price_ore=1 where id=$1', [first.id]), /REVIEW_ORDER_IMMUTABLE/)
  await assert.rejects(db.query('delete from renovation_cases where id=$1', [id]), /foreign key/)
})
test('parallel submissions return the same order, and an empty message is accepted', async () => {
  const id = await fixture()
  const results = await Promise.all([order(id, ''), order(id, '  '), order(id)])
  assert.equal(new Set(results.map(row => row.id)).size, 1)
  assert.equal(results[0].message, null)
  assert.equal((await db.query('select id from renoapp_consultant_reviews where case_id=$1', [id])).rows.length, 1)
})
test('drafts, missing cases, invalid actors and overly long messages do not create orders', async () => {
  const draft = await fixture('draft')
  await assert.rejects(order(draft), /REVIEW_DRAFT/)
  await assert.rejects(order(randomUUID()), /CASE_NOT_FOUND/)
  const id = await fixture()
  await assert.rejects(order(id, 'x'.repeat(4001)), /check constraint/)
  await assert.rejects(order(id, null, randomUUID()), /foreign key/)
  assert.equal((await db.query('select id from renoapp_consultant_reviews where case_id=$1', [id])).rows.length, 0)
})
test('notification lease is exclusive, expires for recovery, and sent orders cannot be resent', async () => {
  const row = await order(await fixture()), attempt = randomUUID()
  const claim = async () => (await db.query<{ claimed: boolean }>('select renoapp_claim_review_email($1,$2) claimed', [row.id, attempt])).rows[0].claimed
  assert.equal(await claim(), true)
  assert.equal(await claim(), false)
  await db.query("update renoapp_consultant_reviews set delivery_attempt_at=now()-interval '3 minutes' where id=$1", [row.id])
  assert.equal(await claim(), true)
  await db.query("update renoapp_consultant_reviews set delivery_status='sent' where id=$1", [row.id])
  assert.equal(await claim(), false)
})
test('public and authenticated database roles cannot read orders or call paid-action RPCs', async () => {
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set role ${role}`)
    try {
      await assert.rejects(db.query('select * from renoapp_consultant_reviews'), /permission denied/)
      await assert.rejects(order(randomUUID()), /permission denied/)
      await assert.rejects(db.query('select renoapp_claim_review_email($1,$2)', [randomUUID(), randomUUID()]), /permission denied/)
    } finally { await db.exec('reset role') }
  }
})
test('login preserves only valid consultant case links, not arbitrary URLs or open redirects', () => {
  const path = `/renoapp/review/${randomUUID()}`
  assert.equal(getPublicLoginDestination(path), path)
  for (const rejected of [`${path}/../../admin`, `${path}?next=//evil.test`, `//hushub.se${path}`, `https://evil.test${path}`, '/renoapp/review/not-a-uuid']) {
    assert.equal(getPublicLoginDestination(rejected), '/app')
  }
})
