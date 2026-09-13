import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
// @ts-expect-error The standalone Node ESM rehearsal utility is not part of the app build.
import { buildStagingSchema, guardBuildingMigration, STAGING_PROJECT } from '../scripts/lib/ob-staging-schema.mjs'

test('staging builder rejects production and unreviewed inventories before creating SQL', () => {
  assert.throws(() => buildStagingSchema(Buffer.from('{}'), { targetProject: 'rfresrbuekidumbwzpcm' }), /Not the approved staging/)
  assert.throws(() => buildStagingSchema(Buffer.from('{}'), { targetProject: STAGING_PROJECT }), /Unreviewed/)
})

test('building wrappers require verified staging and ordered phases inside each transaction', () => {
  const sql = guardBuildingMigration('begin;\nselect 1;\ncommit;', 2)
  assert.ok(sql.indexOf('STAGING_WRONG_BUILDING_PHASE') < sql.indexOf('select 1;'))
  assert.match(sql, /building_phase=1 FOR UPDATE/)
  assert.match(sql, /building_phase=2/)
  assert.match(sql, /REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC, anon, authenticated/)
  assert.match(sql, /SET LOCAL lock_timeout='2s'/)
  assert.throws(() => guardBuildingMigration('begin;\ncommit;', 5))
  assert.throws(() => guardBuildingMigration('select 1;', 1))
  assert.throws(() => guardBuildingMigration('begin;\ncommit;\nbegin;\ncommit;', 1))
})

test('staging smoke tests end with rollback and never enable a lasting rollout', () => {
  const sql = readFileSync(new URL('../scripts/sql/ob-staging-building-smoke.sql', import.meta.url), 'utf8')
  assert.match(sql, /VERIFIED_STAGING_REQUIRED/)
  assert.match(sql, /EXPECTED_ROLLOUT_OFF_BEFORE_TEST/)
  assert.match(sql, /example\.invalid/)
  assert.match(sql, /ROLLBACK;\s*$/)
  assert.doesNotMatch(sql, /^COMMIT;/m)
})
