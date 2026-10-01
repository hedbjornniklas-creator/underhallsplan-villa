import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'
// @ts-expect-error Node's strip-types test runner requires the explicit TypeScript extension.
import { isTuObservationReportInclusion, resolveTuObservationReportInclusion } from '../src/lib/tu/evidence.ts'

const source = readFileSync(
  new URL('../src/components/tu/TuEvidenceWorkspace.tsx', import.meta.url),
  'utf8'
)
const reportInclusionMigration = readFileSync(
  new URL('../docs/db/2026-10-01_01_tu_observation_report_inclusion.sql', import.meta.url),
  'utf8'
)

test('opening the next observation also replaces the active measurement form', () => {
  const reviewFlow = source.slice(
    source.indexOf('const approveObservationAndOpenNext = async () => {'),
    source.indexOf('void queueObservationSnapshot(snapshot)', source.indexOf('const approveObservationAndOpenNext = async () => {'))
  )

  assert.match(
    reviewFlow,
    /setForm\(toObservationForm\(nextObservation\)\)[\s\S]*setMeasurementForm\([\s\S]*nextObservation\.measurements\[0\][\s\S]*measurementToForm\(nextObservation\.measurements\[0\]\)/
  )
  assert.match(
    reviewFlow,
    /else \{[\s\S]*setForm\(snapshot\)[\s\S]*setMeasurementForm\(emptyMeasurementWithRememberedInstrument\(\)\)/
  )
})

test('requires an explicit measurement assessment before source review is completed', () => {
  const reviewFlow = source.slice(
    source.indexOf('const approveObservationAndOpenNext = async () => {'),
    source.indexOf('const deleteObservation = async () => {')
  )

  assert.match(reviewFlow, /missingAssessment/)
  assert.match(reviewFlow, /Välj en bedömning för varje mätning/)
  assert.match(
    source,
    /function isObservationReviewComplete[\s\S]*observation\.reviewStatus === 'reviewed'[\s\S]*observation\.measurements\.every[\s\S]*measurement\.assessment/
  )
})

test('accepts only the two explicit report inclusion modes', () => {
  assert.equal(isTuObservationReportInclusion('ai_decides'), false)
  assert.equal(isTuObservationReportInclusion('include'), true)
  assert.equal(isTuObservationReportInclusion('internal'), true)
  assert.equal(isTuObservationReportInclusion('true'), false)
})

test('legacy exclusions remain internal before the corrected backfill runs', () => {
  assert.equal(resolveTuObservationReportInclusion('include', false), 'internal')
  assert.equal(resolveTuObservationReportInclusion('internal', true), 'internal')
  assert.equal(resolveTuObservationReportInclusion(null, false), 'internal')
  assert.equal(resolveTuObservationReportInclusion(null, null), 'include')
  assert.equal(resolveTuObservationReportInclusion('include', true), 'include')
})

async function createMigrationFixture() {
  const db = new PGlite()
  await db.exec(`
    create table inspections (id uuid primary key, locked_at timestamptz);
    create table tu_observations (
      id integer primary key,
      inspection_id uuid references inspections(id),
      include_in_report boolean,
      review_status text default 'reviewed',
      note_text text default 'Original',
      updated_at timestamptz default '2026-09-01T12:00:00Z'
    );
    create table tu_analysis_workflows (
      inspection_id uuid primary key references inspections(id),
      status text default 'approved',
      analysis_approved_at timestamptz default '2026-09-01T13:00:00Z',
      analysis_stale_at timestamptz
    );
    insert into inspections values
      ('00000000-0000-0000-0000-000000000001', '2026-09-01T14:00:00Z'),
      ('00000000-0000-0000-0000-000000000002', null);
    insert into tu_analysis_workflows(inspection_id) select id from inspections;
    insert into tu_observations(id, inspection_id, include_in_report) values
      (1, '00000000-0000-0000-0000-000000000001', true),
      (2, '00000000-0000-0000-0000-000000000001', false),
      (3, '00000000-0000-0000-0000-000000000001', null),
      (4, '00000000-0000-0000-0000-000000000002', true),
      (5, '00000000-0000-0000-0000-000000000002', false);
  `)
  await db.exec(readFileSync(
    new URL('../docs/db/2026-03-24_03_inspection_lock_write_guards.sql', import.meta.url), 'utf8'
  ))
  await db.exec(`
    create trigger trg_guard_locked_inspection_write before insert or update or delete
      on tu_observations for each row execute function guard_locked_inspection_child_write();
    create trigger trg_guard_locked_inspection_write before insert or update or delete
      on tu_analysis_workflows for each row execute function guard_locked_inspection_child_write();
    create function mark_tu_analysis_stale_after_source_write() returns trigger language plpgsql as $$
    begin
      update tu_analysis_workflows set status = 'in_progress', analysis_approved_at = null,
        analysis_stale_at = now() where inspection_id = new.inspection_id;
      return new;
    end; $$;
    create trigger trg_mark_tu_analysis_stale after update on tu_observations
      for each row execute function mark_tu_analysis_stale_after_source_write();
    create function tu_observations_set_updated_at() returns trigger language plpgsql as $$
    begin new.updated_at = now(); return new; end; $$;
    create trigger trg_tu_observations_set_updated_at before update on tu_observations
      for each row execute function tu_observations_set_updated_at();
  `)
  return db
}

async function migrationState(db: PGlite) {
  return {
    inspections: (await db.query('select * from inspections order by id')).rows,
    observations: (await db.query('select id, note_text, updated_at from tu_observations order by id')).rows,
    workflows: (await db.query('select * from tu_analysis_workflows order by inspection_id')).rows,
    triggers: (await db.query(`select tgrelid::regclass::text as relation, tgname, tgenabled
      from pg_trigger where not tgisinternal order by tgrelid, tgname`)).rows,
  }
}

test('migration backfills locked and unlocked observations without changing approval or timestamps', async () => {
  const db = await createMigrationFixture()
  try {
    const before = await migrationState(db)
    await db.exec(reportInclusionMigration)
    assert.deepEqual(await migrationState(db), before)
    assert.deepEqual((await db.query('select report_inclusion from tu_observations order by id')).rows,
      ['include', 'internal', 'include', 'include', 'internal'].map(report_inclusion => ({ report_inclusion })))
    await db.exec(reportInclusionMigration)
    assert.deepEqual(await migrationState(db), before)
    await assert.rejects(db.exec("update tu_observations set note_text = 'Changed' where id = 1"), /låst/)
    await assert.rejects(db.exec("update tu_analysis_workflows set status = 'in_progress' where inspection_id = '00000000-0000-0000-0000-000000000001'"), /låst/)
    await db.exec("update tu_observations set note_text = 'Changed' where id = 4")
    const workflow = (await db.query<{ status: string; analysis_approved_at: null; stale: boolean }>(`
      select status, analysis_approved_at, analysis_stale_at is not null as stale from tu_analysis_workflows
      where inspection_id = '00000000-0000-0000-0000-000000000002'`)).rows[0]
    assert.deepEqual(workflow, { status: 'in_progress', analysis_approved_at: null, stale: true })
    for (const mode of ['enable always', 'enable replica', 'disable']) {
      for (const trigger of ['trg_guard_locked_inspection_write', 'trg_mark_tu_analysis_stale', 'trg_tu_observations_set_updated_at']) {
        await db.exec(`alter table tu_observations ${mode} trigger ${trigger}`)
      }
      const state = await migrationState(db)
      await db.exec(reportInclusionMigration)
      assert.deepEqual(await migrationState(db), state)
    }
  } finally {
    await db.close()
  }
})

test('migration repairs the earlier include default without changing report content', async () => {
  const db = await createMigrationFixture()
  try {
    await db.exec("alter table tu_observations add column report_inclusion text default 'include'")
    const before = await migrationState(db)
    await db.exec(reportInclusionMigration)
    assert.deepEqual(await migrationState(db), before)
    assert.deepEqual((await db.query('select report_inclusion from tu_observations where include_in_report = false')).rows,
      [{ report_inclusion: 'internal' }, { report_inclusion: 'internal' }])
  } finally {
    await db.close()
  }
})

test('a failed backfill rolls back the migration and keeps lock guards active', async () => {
  const db = await createMigrationFixture()
  try {
    await db.exec(`
      create function reject_fixture_update() returns trigger language plpgsql as $$
      begin raise exception 'BACKFILL_FAILED'; end; $$;
      create trigger reject_fixture_update before update on tu_observations
        for each row execute function reject_fixture_update();
    `)
    const before = await migrationState(db)
    await assert.rejects(db.exec(reportInclusionMigration), /BACKFILL_FAILED/)
    await db.exec('rollback')
    assert.deepEqual(await migrationState(db), before)
    const columns = await db.query(`select column_name from information_schema.columns
      where table_name = 'tu_observations' and column_name = 'report_inclusion'`)
    assert.equal(columns.rows.length, 0)
    await db.exec('drop trigger reject_fixture_update on tu_observations')
    await assert.rejects(db.exec("update tu_observations set note_text = 'Changed' where id = 1"), /låst/)
  } finally {
    await db.close()
  }
})
