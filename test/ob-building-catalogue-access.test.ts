import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const sql = readFileSync(new URL('../docs/db/2026-09-15_01_ob_building_catalogue_access.sql', import.meta.url), 'utf8')
async function fixture() {
  const db = new PGlite()
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    grant usage on schema public to anon,authenticated,service_role;
    create table settings_ob_building_categories(key text primary key,label text);
    insert into settings_ob_building_categories values('main','Main');
    alter table settings_ob_building_categories enable row level security;
    create policy catalogue_read on settings_ob_building_categories for select to authenticated using(true);
    grant all on settings_ob_building_categories to anon,authenticated,service_role;
    grant update(label),select(label) on settings_ob_building_categories to public;
    create table unrelated(id int); grant all on unrelated to anon;
  `)
  return db
}
test('removes inherited default table and column grants without rewriting catalogue data', async () => {
  const db = await fixture()
  try {
    await assert.rejects(db.exec(sql), /REVIEW_REQUIRED/)
    await db.exec('rollback;')
    await db.exec("set app.ob_building_catalogue_access_approved='true'")
    await db.exec(sql)
    await db.exec(sql)
    const result = await db.query(`select
      has_table_privilege('anon','settings_ob_building_categories','SELECT,INSERT,UPDATE,DELETE,TRUNCATE') as anon,
      has_any_column_privilege('anon','settings_ob_building_categories','SELECT,UPDATE') as anon_columns,
      has_table_privilege('authenticated','settings_ob_building_categories','INSERT,UPDATE,DELETE,TRUNCATE') as writes,
      has_table_privilege('authenticated','settings_ob_building_categories','SELECT') as reads,
      has_table_privilege('service_role','settings_ob_building_categories','SELECT') as service,
      has_table_privilege('anon','unrelated','TRUNCATE') as unrelated`)
    assert.deepEqual(result.rows, [{ anon: false, anon_columns: false, writes: false, reads: true, service: true, unrelated: true }])
    await db.exec('set role authenticated')
    assert.deepEqual((await db.query('select * from settings_ob_building_categories')).rows, [{ key: 'main', label: 'Main' }])
    await assert.rejects(db.exec('truncate settings_ob_building_categories'), /permission denied/)
    await db.exec('reset role; set role anon')
    await assert.rejects(db.exec('select * from settings_ob_building_categories'), /permission denied/)
    await db.exec('reset role; set role service_role')
    await db.exec("insert into settings_ob_building_categories values('other','Other')")
    await db.exec('reset role')
  } finally { await db.close() }
})
test('unexpected inherited grants abort and roll back instead of claiming a secured catalogue', async () => {
  const db = await fixture()
  try {
    await db.exec(`create role extra_access; grant extra_access to anon;
      grant truncate on settings_ob_building_categories to extra_access;
      set app.ob_building_catalogue_access_approved='true';`)
    await assert.rejects(db.exec(sql), /UNEXPECTED_GRANT/)
    await db.exec('rollback')
    assert.deepEqual((await db.query('select * from settings_ob_building_categories')).rows, [{ key: 'main', label: 'Main' }])
    assert.equal((await db.query<{ kept: boolean }>("select has_table_privilege('anon','settings_ob_building_categories','INSERT') as kept")).rows[0].kept, true)
  } finally { await db.close() }
})
