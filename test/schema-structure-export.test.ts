import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import { mkdtempSync, readFileSync, writeFileSync, existsSync, unlinkSync, rmdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { PGlite } from '@electric-sql/pglite'

const sql = readFileSync(new URL('../docs/db/2026-09-12_11_schema_structure_export.sql', import.meta.url), 'utf8')
type Export = {
  format_version: number
  purpose: string
  transaction_read_only: string
  transaction_isolation: string
  counts: Record<string, number>
  sections: Record<string, Record<string, unknown>[]>
}

async function exportStructure(db: PGlite) {
  const results = await db.exec(sql)
  const result = results.find(result => result.fields.some(field => field.name === 'payload_base64'))
  assert.ok(result)
  assert.ok(result.rows.length > 0)
  const rows = result.rows as { part_no: number; part_count: number; json_bytes: number; json_md5: string; payload_base64: string }[]
  const first = rows[0]
  assert.equal(rows.length, first.part_count)
  for (const [index, row] of rows.entries()) {
    assert.equal(row.part_no, index + 1)
    assert.equal(row.part_count, first.part_count)
    assert.equal(row.json_bytes, first.json_bytes)
    assert.equal(row.json_md5, first.json_md5)
    assert.ok(row.payload_base64.length > 0 && row.payload_base64.length <= 32768)
  }
  const bytes = Buffer.from(rows.map(row => row.payload_base64).join(''), 'base64')
  assert.equal(bytes.length, first.json_bytes)
  assert.equal(createHash('md5').update(bytes).digest('hex'), first.json_md5)
  return JSON.parse(bytes.toString('utf8')) as Export
}

test('structure export is read-only and contains definitions, not records or sequence state', async () => {
  const db = new PGlite()
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create schema auth;
      create schema storage;
      create table auth.users(id integer primary key, private_email text);
      create table storage.objects(id integer primary key, name text);
      create type public.condition_kind as enum ('open','closed');
      create domain public.nonempty_name as text check (length(value) > 0);
      create table public.properties(id integer generated always as identity primary key,
        owner_id integer references auth.users(id), name public.nonempty_name, state public.condition_kind default 'open');
      create table public.inspections(id integer primary key, property_id integer references properties(id), private_note text);
      create view public.components_calc as select id, name from properties;
      create function public.guard_test() returns trigger language plpgsql as $$ begin return new; end $$;
      create trigger property_guard before update on public.properties for each row execute function public.guard_test();
      create trigger auth_custom_guard before update on auth.users for each row execute function public.guard_test();
      create function public.never_execute() returns text language plpgsql security definer as $$
        begin raise exception 'EXPORT_MUST_NOT_EXECUTE_ROUTINES'; end $$;
      alter table public.properties enable row level security;
      create policy own_property on public.properties to authenticated using(owner_id = 10) with check(owner_id = 10);
      create policy storage_read on storage.objects for select to authenticated using(true);
      grant select on public.properties to authenticated;
      grant update(name) on public.properties to authenticated;
      alter default privileges in schema public grant select on tables to anon;
      insert into auth.users values(10,'CUSTOMER_EMAIL_CANARY');
      insert into storage.objects values(1,'PRIVATE_IMAGE_PATH_CANARY');
      insert into public.properties(owner_id,name) values(10,'CUSTOMER_NAME_CANARY');
      insert into public.inspections values(1,1,'INSPECTION_TEXT_CANARY');
    `)
    const before = await db.query('select * from properties')
    const report = await exportStructure(db)
    assert.equal(report.format_version, 1)
    assert.equal(report.purpose, 'schema_review_not_restore')
    assert.equal(report.transaction_read_only, 'on')
    assert.equal(report.transaction_isolation, 'repeatable read')
    assert.equal(Object.keys(report.sections).length, 23)
    for (const [section, rows] of Object.entries(report.sections)) assert.equal(report.counts[section], rows.length)
    assert.ok(report.sections.functions.some(row => String(row.signature).includes('never_execute') && String(row.definition).includes('EXPORT_MUST_NOT_EXECUTE_ROUTINES')))
    assert.ok(report.sections.views.some(row => row.name === 'components_calc' && String(row.definition).includes('properties')))
    assert.ok(report.sections.constraints.some(row => row.kind === 'f'))
    assert.ok(report.sections.constraints.some(row => row.domain_name === 'public.nonempty_name'))
    assert.ok(report.sections.triggers.some(row => row.name === 'auth_custom_guard'))
    assert.ok(report.sections.policies.some(row => row.schema_name === 'storage'))
    assert.ok(report.sections.column_grants.some(row => row.column_name === 'name' && row.grantee === 'authenticated'))
    assert.ok(report.sections.default_grants.some(row => row.grantee === 'anon'))
    assert.ok(report.sections.dependencies.some(row => String(row.reference_description).includes('properties')))
    assert.deepEqual(report.sections.types.find(row => row.name === 'condition_kind')?.enum_labels, ['open','closed'])
    assert.equal(report.sections.sequences.length, 1)
    assert.doesNotMatch(JSON.stringify(report), /CUSTOMER_EMAIL_CANARY|PRIVATE_IMAGE_PATH_CANARY|CUSTOMER_NAME_CANARY|INSPECTION_TEXT_CANARY|rolpassword|last_value/)
    assert.ok(!report.sections.relations.some(row => row.schema_name === 'auth' || row.schema_name === 'storage'))
    assert.deepEqual((await db.query('select * from properties')).rows, before.rows)
    assert.deepEqual(await exportStructure(db), report)
    assert.equal((await db.query<{ read_only: string }>("select current_setting('transaction_read_only') as read_only")).rows[0].read_only, 'off')
  } finally {
    await db.close()
  }
})

test('structure export handles an empty application schema and does not create missing tables', async () => {
  const db = new PGlite()
  try {
    const report = await exportStructure(db)
    for (const section of ['relations','columns','functions','constraints','indexes','types','sequences','views','triggers','policies']) {
      assert.deepEqual(report.sections[section], [], section)
    }
    assert.equal(report.transaction_read_only, 'on')
    assert.equal((await db.query<{ relation: string | null }>("select to_regclass('public.inspections')::text as relation")).rows[0].relation, null)
  } finally {
    await db.close()
  }
})

test('large source definitions are encoded once and exported across complete parts', async () => {
  assert.match(sql, /snapshot as materialized/i)
  assert.match(sql, /encoded as materialized/i)
  const db = new PGlite()
  try {
    const sourceComment = 'synthetic schema source '.repeat(2000)
    await db.exec(Array.from({ length: 25 }, (_, i) =>
      `create function public.export_fixture_${i}() returns text language sql as $$ select 'unused'::text /* ${sourceComment} */ $$;`
    ).join('\n'))
    const report = await exportStructure(db)
    assert.equal(report.counts.functions, 25)
    assert.ok(Buffer.byteLength(JSON.stringify(report)) > 1000000)
    for (const row of report.sections.functions) assert.ok(String(row.definition).includes(sourceComment))
    assert.equal(report.transaction_read_only, 'on')
  } finally {
    await db.close()
  }
})

test('PowerShell verifier reconstructs multipart CSV and rejects incomplete, corrupted or wrongly scoped exports', { skip: process.platform !== 'win32' }, () => {
  const repoRoot = fileURLToPath(new URL('../', import.meta.url))
  const temp = mkdtempSync(join(tmpdir(), 'schema-export-verifier-'))
  const csvPath = join(temp, 'export.csv')
  const outputName = `.cache/inspection-schema-export/validator-test-${randomUUID()}.json`
  const outputPath = join(repoRoot, outputName)
  const names = ['relations','columns','functions','constraints','indexes','types','sequences','views','triggers','event_triggers','rules','policies','relation_grants','column_grants','function_grants','default_grants','namespaces','roles','role_memberships','extensions','publications','dependencies','exposure_settings']
  const sections: Record<string, Record<string, unknown>[]> = Object.fromEntries(names.map(name => [name, []]))
  sections.functions = [{ name: 'synthetic_definition', definition: 'x'.repeat(80000) }]
  const report = {
    format_version: 1, purpose: 'schema_review_not_restore', server_version: '17.6',
    transaction_read_only: 'on', transaction_isolation: 'repeatable read', sections,
    counts: Object.fromEntries(names.map(name => [name, sections[name].length])),
  }
  function csvRows(value: typeof report) {
    const bytes = Buffer.from(JSON.stringify(value))
    const encoded = bytes.toString('base64')
    const count = Math.ceil(encoded.length / 32768)
    const hash = createHash('md5').update(bytes).digest('hex')
    return ['part_no,part_count,json_bytes,json_md5,payload_base64', ...Array.from({ length: count }, (_, i) =>
      `${i + 1},${count},${bytes.length},${hash},${encoded.slice(i * 32768, (i + 1) * 32768)}`)]
  }
  function run(output = outputName) {
    return spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-File',
      join(repoRoot, 'scripts/verify-schema-structure-export.ps1'), '-InputCsv', csvPath, '-OutputJson', output],
    { cwd: repoRoot, encoding: 'utf8', timeout: 30000 })
  }
  try {
    const validRows = csvRows(report)
    assert.ok(validRows.length > 2)
    writeFileSync(csvPath, validRows.slice(0, -1).join('\r\n'))
    assert.notEqual(run().status, 0)
    assert.equal(existsSync(outputPath), false)
    writeFileSync(csvPath, [...validRows.slice(0, -1), validRows[validRows.length - 1].replace(/.$/, 'A')].join('\r\n'))
    assert.notEqual(run().status, 0)
    assert.equal(existsSync(outputPath), false)
    writeFileSync(csvPath, csvRows({ ...report, transaction_read_only: 'off' }).join('\r\n'))
    assert.notEqual(run().status, 0)
    writeFileSync(csvPath, validRows.join('\r\n'))
    assert.notEqual(run('docs/not-an-export-output.json').status, 0)
    const result = run()
    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(JSON.parse(readFileSync(outputPath, 'utf8')), report)
    assert.notEqual(run().status, 0)
    assert.deepEqual(JSON.parse(readFileSync(outputPath, 'utf8')), report)
  } finally {
    if (existsSync(outputPath)) unlinkSync(outputPath)
    if (existsSync(csvPath)) unlinkSync(csvPath)
    rmdirSync(temp)
  }
})
