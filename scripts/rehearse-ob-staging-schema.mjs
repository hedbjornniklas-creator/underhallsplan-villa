import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp'
import { buildStagingSchema, guardBuildingMigration } from './lib/ob-staging-schema.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const privateRoot = join(root, '.cache/inspection-schema-export')
const runtime = createRequire(join(privateRoot, 'runtime/package.json'))
const { vector } = await import(pathToFileURL(runtime.resolve('@electric-sql/pglite-pgvector')).href)
const bytes = readFileSync(join(privateRoot, 'production-schema-review.json'))
const report = JSON.parse(bytes.toString('utf8'))
const bundle = buildStagingSchema(bytes)
assert.throws(() => buildStagingSchema(bytes, { targetProject: 'rfresrbuekidumbwzpcm' }), /Not the approved staging/)
assert.throws(() => buildStagingSchema(Buffer.concat([bytes, Buffer.from(' ')])), /Unreviewed/)
const db = new PGlite({ extensions: { pgcrypto, uuid_ossp, vector } })
const readDb = name => readFileSync(join(root, 'docs/db', name), 'utf8')
try {
  // Local platform stand-ins only. These statements are never in the remote bundle.
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth; CREATE SCHEMA storage; CREATE SCHEMA extensions;
    CREATE TABLE auth.users (id uuid PRIMARY KEY, email text, raw_user_meta_data jsonb DEFAULT '{}');
    CREATE TABLE storage.objects (id uuid PRIMARY KEY, bucket_id text, name text, owner uuid);
    CREATE TABLE storage.buckets (id text PRIMARY KEY, name text, public boolean DEFAULT false);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
      SELECT nullif(current_setting('request.jwt.claim.role',true),'') $$;
    CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
      SELECT coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
    GRANT USAGE ON SCHEMA auth TO anon,authenticated,service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon,authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon,authenticated;
  `)
  await db.exec('CREATE TABLE public.preexisting (id integer)')
  await assert.rejects(db.exec(bundle.bootstrap), /STAGING_REQUIRES_EMPTY_PUBLIC_SCHEMA/)
  await db.exec('ROLLBACK; DROP TABLE public.preexisting;')
  await db.exec(bundle.bootstrap)
  await assert.rejects(db.exec(bundle.parts[1].sql), /STAGING_WRONG_TARGET_OR_PART_ORDER/)
  await db.exec('ROLLBACK')
  for (const part of bundle.parts) {
    console.log(`Checking installed-schema part ${part.ordinal}/${bundle.parts.length}`)
    try { await db.exec(part.sql) }
    catch (error) {
      // Database errors can contain entire private queries. Do not dump error objects.
      throw new Error(`Part ${part.ordinal}: ${error.message}`)
    }
    const privileges = await db.query(`select count(*)::int as total from pg_class c
      join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind in ('r','v')
      and (has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE')
        or has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE'))`)
    assert.equal(privileges.rows[0].total, 0, 'Browser privileges must remain sealed between parts')
  }
  const installed = (await db.query('SELECT * FROM ob_staging_control.installation')).rows[0]
  assert.equal(installed.ready, true)
  await assert.rejects(db.exec(bundle.parts[0].sql), /STAGING_WRONG_TARGET_OR_PART_ORDER/)
  await db.exec('ROLLBACK')
  await db.exec('SET search_path = pg_catalog')
  const functions = (await db.query(`select p.oid::regprocedure::text as signature, pg_get_functiondef(p.oid) as definition
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'`)).rows
  assert.equal(functions.length, 261)
  for (const f of functions) {
    const original = report.sections.functions.find(item => item.signature === `public.${f.signature}` || item.signature === f.signature)
    assert.ok(original, `Unexpected function ${f.signature}`)
    assert.equal(f.definition.replaceAll('\r\n', '\n'), original.definition.replaceAll('\r\n', '\n'))
  }
  const counts = (await db.query(`SELECT
    (select count(*)::int from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r') as tables,
    (select count(*)::int from pg_constraint c join pg_namespace n on n.oid=c.connamespace where n.nspname='public' and c.contype in ('p','u','f','c')) as constraints,
    (select count(*)::int from pg_indexes where schemaname='public') as indexes,
    (select count(*)::int from pg_policies where schemaname='public') as policies,
    (select count(*)::int from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal) as triggers`)).rows[0]
  assert.deepEqual(counts, { tables: 215, constraints: 1578, indexes: 749, policies: 194, triggers: 289 })
  assert.equal((await db.query(`SELECT seqmax::text AS maximum FROM pg_sequence`)).rows[0].maximum, '9223372036854775807')
  await db.exec('SET search_path = public, extensions, pg_catalog')
  console.log('Installed schema counts and function definitions match the reviewed scope.')
  for (const [index, name] of ['2026-09-12_01_ob_building_parts.sql','2026-09-12_02_ob_building_commands.sql',
    '2026-09-12_03_ob_building_round.sql','2026-09-12_04_ob_building_cutover.sql'].entries()) {
    await db.exec(guardBuildingMigration(readDb(name), index + 1))
    await db.exec(readDb(name))
    console.log(`Applied twice: ${name}`)
  }
  const rollout = (await db.query('SELECT enabled FROM ob_building_rollout')).rows
  assert.ok(rollout.length > 0 && rollout.every(row => row.enabled === false))
  const smoke = await db.exec(readFileSync(join(root, 'scripts/sql/ob-staging-building-smoke.sql'), 'utf8'))
  const checks = smoke.find(result => result.fields.some(field => field.name === 'passed')).rows
  assert.equal(checks.length, 5)
  assert.ok(checks.every(row => row.passed === true))
  assert.equal((await db.query('SELECT count(*)::int AS total FROM properties')).rows[0].total, 0)
  assert.equal((await db.query('SELECT count(*)::int AS total FROM auth.users')).rows[0].total, 0)
  assert.ok((await db.query('SELECT enabled FROM ob_building_rollout')).rows.every(row => !row.enabled))
  await db.exec('SET search_path=pg_catalog')
  const finalFunctionsMd5 = (await db.query(`SELECT md5(string_agg(
    p.oid::regprocedure::text||':'||md5(replace(pg_get_functiondef(p.oid),chr(13),'')),
    chr(10) ORDER BY p.oid::regprocedure::text COLLATE "C")) AS digest
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public'`)).rows[0].digest
  const serverVersion = (await db.query("SELECT current_setting('server_version') AS version")).rows[0].version
  const result = { checkedAt: new Date().toISOString(), source: bundle.manifest.sourceSha256,
    schemaParts: bundle.parts.length, counts, serverVersion, finalFunctionsMd5,
    definitionCheck: true, unsafeTargetRejected: true,
    nonemptyTargetRejected: true, outOfOrderRejected: true, browserPrivilegesSealed: true,
    buildingMigrationsAppliedTwice: true, buildingRolloutEnabled: false, syntheticChecks: checks,
    remoteSupabaseAcceptance: false, platformStandIns: ['auth', 'storage'] }
  writeFileSync(join(privateRoot, 'staging-schema-local-rehearsal.json'), JSON.stringify(result, null, 2))
  console.log(JSON.stringify(result, null, 2))
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
} finally {
  await db.close()
}
