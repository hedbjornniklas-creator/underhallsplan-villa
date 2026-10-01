import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

test('manual package price migration preserves old items and rejects malformed totals', async () => {
  const db = new PGlite()
  try {
    await db.exec('create table action_case_items(id integer primary key); insert into action_case_items values(1);')
    const sql = readFileSync(new URL('../docs/db/2026-10-01_05_action_case_lump_sum.sql', import.meta.url), 'utf8')
    await db.exec(sql); await db.exec(sql)
    assert.equal((await db.query('select lump_sum from action_case_items')).rows[0].lump_sum, null)
    const write = (value) => db.query('update action_case_items set lump_sum=$1::jsonb where id=1', [JSON.stringify(value)])
    const valid = { internalCost: null, customerPrice: 10000.25, vatRate: 25, verified: true }
    await write(valid)
    for (const bad of [[], {}, { ...valid, customerPrice: null }, { ...valid, customerPrice: -1 }, { ...valid, customerPrice: 1.001 }, { ...valid, customerPrice: '1000' }, { ...valid, vatRate: 13 }, { ...valid, verified: 'true' }, { ...valid, internalCost: 1000000001 }]) {
      await assert.rejects(write(bad), /lump_sum_check/)
    }
    assert.deepEqual((await db.query('select lump_sum from action_case_items')).rows[0].lump_sum, valid)
    await write({ ...valid, customerPrice: null, verified: false })
    await db.exec('update action_case_items set lump_sum=null')
  } finally { await db.close() }
})
