import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { canonical, relation } from './ob-restore-rehearsal.mjs'
import { digest } from './ob-private-backup.mjs'

export async function rehearseLocalObMigrations(db, metadata, rows, root, receipt) {
  assert.ok(db instanceof PGlite, 'Migration rehearsal is local only')
  const preserved = ['inspections', 'inspection_control_items', 'inspection_images', 'inspection_report_links', 'profiles']
  const before = new Map()
  for (const table of preserved) {
    const result = await db.query(`select to_jsonb(t) as row from jsonb_populate_recordset(null::public.${table},$1::jsonb) t`,
      [JSON.stringify(rows['public.' + table] ?? [])])
    before.set(table, result.rows.map(r => r.row))
  }
  await db.exec(`set app.inspection_access_hardening_approved='true';
    set app.components_access_hardening_approved='true';
    set app.component_catalogue_access_approved='true';
    set app.ob_settings_access_approved='true';`)
  const migrations = [
    '2026-09-12_09_inspection_access_hardening', '2026-09-12_10_inspection_rpc_media_hardening',
    '2026-09-13_03_components_access_hardening', '2026-09-13_04_component_catalogue_access',
    '2026-09-14_01_ob_settings_access', '2026-09-12_01_ob_building_parts',
    '2026-09-12_02_ob_building_commands', '2026-09-12_03_ob_building_round',
    '2026-09-12_04_ob_building_cutover', '2026-09-13_01_ob_building_purpose',
    '2026-09-13_02_ob_building_purpose_catalogue',
  ]
  receipt.localMigrations = []
  for (const name of migrations) {
    const sql = await readFile(join(root, 'docs/db', name + '.sql'))
    await db.exec(sql.toString())
    receipt.localMigrations.push({ name, sha256: digest(sql) })
    console.log('Local migration passed: ' + name)
  }
  for (const table of preserved) {
    const actual = (await db.query('select to_jsonb(t) as row from ' + relation('public.' + table) + ' t')).rows.map(r => r.row)
    const columns = metadata.tables.find(t => t.name === 'public.' + table).columns
    const project = row => Object.fromEntries(columns.map(column => [column, row[column]]))
    assert.deepEqual(actual.map(project).map(canonical).sort(), before.get(table).map(project).map(canonical).sort(),
      'Migration changed original rows: ' + table)
  }
  receipt.localMigrationRehearsalPassed = true
}
