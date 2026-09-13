import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const sql = readFileSync(new URL('../docs/db/2026-09-12_00_ob_building_preflight.sql', import.meta.url), 'utf8')
const sections = ['tables', 'columns', 'indexes', 'constraints', 'triggers', 'policies', 'privileges'] as const
type Preflight = Record<typeof sections[number], Record<string, unknown>[]> & {
  format_version: number
  server_version: string
}

test('preflight returns every catalog section in one result without reading or changing inspection records', async () => {
  const db = new PGlite()
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create table properties(id integer primary key);
      create table buildings(id integer primary key, property_id integer references properties(id), name text not null);
      create table inspections(id integer primary key, secret_note text);
      create table inspection_conditions(id integer primary key, inspection_id integer unique references inspections(id));
      create table unrelated_private_table(id integer);
      insert into properties values(1);
      insert into buildings values(1, 1, 'PRIVATE_BUILDING_CANARY');
      insert into inspections values(1, 'PRIVATE_INSPECTION_CANARY');
      grant all on buildings to anon, authenticated;
      alter table buildings enable row level security;
      create policy building_read on buildings for select to authenticated using(true);
      create function test_inspection_guard() returns trigger language plpgsql as $$ begin return new; end $$;
      create trigger inspection_guard before update on inspections for each row execute function test_inspection_guard();
    `)
    const before = await db.query('select * from inspections')
    // The exported query must work unchanged inside a read-only transaction.
    await db.exec('begin read only')
    const results = await db.exec(sql)
    await db.exec('rollback')
    assert.equal(results.length, 1)
    assert.equal(results[0].rows.length, 1)
    assert.deepEqual(results[0].fields.map(field => field.name), ['preflight'])
    const report = results[0].rows[0].preflight as Preflight
    assert.equal(report.format_version, 2)
    assert.equal(typeof report.server_version, 'string')
    for (const section of sections) {
      assert.ok(Array.isArray(report[section]) && report[section].length > 0, section)
    }
    assert.ok(report.tables.some(row => row.table_name === 'buildings' && row.rls_enabled === true))
    assert.ok(report.columns.some(row => row.table_name === 'buildings' && row.column_name === 'name' && row.not_null === true))
    assert.ok(report.constraints.some(row => row.table_name === 'buildings' && row.constraint_type === 'f'))
    assert.ok(report.triggers.some(row => row.trigger_name === 'inspection_guard'))
    assert.ok(report.policies.some(row => row.policy_name === 'building_read'))
    assert.ok(report.privileges.some(row => row.grantee === 'anon' && row.privilege_type === 'TRUNCATE'))
    assert.doesNotMatch(JSON.stringify(report), /PRIVATE_.*_CANARY|unrelated_private_table/)
    assert.deepEqual((await db.query('select * from inspections')).rows, before.rows)
    assert.equal((await db.query<{name: string | null}>("select to_regclass('public.ob_building_rollout') as name")).rows[0].name, null)
    const repeated = await db.exec(sql)
    assert.deepEqual(repeated[0].rows, results[0].rows)
  } finally {
    await db.close()
  }
})

test('preflight also returns all empty sections before any OB tables exist', async () => {
  const db = new PGlite()
  try {
    const results = await db.exec(sql)
    const report = results[0].rows[0].preflight as Preflight
    for (const section of sections) {
      assert.deepEqual(report[section], [])
    }
  } finally {
    await db.close()
  }
})
