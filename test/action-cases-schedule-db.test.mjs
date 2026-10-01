import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

test('schedule migration is rerunnable, tenant scoped, revisioned and private until shared', async () => {
  const db = new PGlite()
  const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role; create table action_cases(id uuid primary key, org_id uuid not null); insert into action_cases values ('${id(1)}','${id(2)}');`)
    const sql = readFileSync(new URL('../docs/db/2026-10-01_04_action_case_schedule.sql', import.meta.url), 'utf8')
    await db.exec(sql); await db.exec(sql)
    const write = (operation, revision, rows = [], org = id(2)) => db.query('select write_action_case_schedule($1,$2,$3,$4,$5,$6::jsonb)', [org, id(1), id(3), operation, revision, JSON.stringify(rows)])
    const read = async () => (await db.query('select * from action_case_schedules')).rows[0]
    await assert.rejects(write('save', 0, [], id(9)), /NOT_FOUND/)
    const row = { id: id(4), title: 'Grund', phase: 'Mark', startDate: '', endDate: '', status: 'planned', sourceItemId: null }
    await write('save', 0, [row])
    assert.deepEqual((await read()).shared_rows, [])
    await assert.rejects(write('save', 0, []), /STALE/)
    await write('share', 1)
    assert.deepEqual((await read()).shared_rows, [row])
    await write('save', 2, [{ ...row, title: 'Ändrad internt' }])
    assert.equal((await read()).shared_rows[0].title, 'Grund')
    await write('unshare', 3)
    assert.deepEqual((await read()).shared_rows, [])
    assert.equal((await read()).rows[0].title, 'Ändrad internt')
    await write('save', 4, [{ ...row, title: '' }])
    await assert.rejects(write('share', 5), /INVALID/)
    assert.equal((await read()).revision, 5)
    await db.exec('set role authenticated')
    await assert.rejects(db.query('select * from action_case_schedules'), /permission denied/)
    await assert.rejects(write('save', 5), /permission denied/)
    await db.exec('reset role')
  } finally { await db.close() }
})
