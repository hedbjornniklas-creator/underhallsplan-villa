import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

export const STAGING_PROJECT = 'lodbgdbmfdtdzfaezblx'
export const REVIEW_SHA256 = '7d53203bab004265bbc69f5b22e498e71dfa07490af736b0b66775c6d325827e'
const excludedFunctions = new Set([
  'public.cleanup_task_cron_job_run_details(interval)',
  'public.configure_eb_follow_up_mail_cron()',
  'public.configure_inspection_report_pdf_cron()',
  'public.configure_task_followup_cron()',
  'public.eb_follow_up_mail_cron_status()',
  'public.inspection_report_pdf_cron_configuration_status()',
  'public.invoke_eb_follow_up_mail_cron()',
  'public.invoke_inspection_report_pdf_cron()',
  'public.invoke_task_followup_cron()',
  'public.task_followup_cron_configuration_status()',
])
const ident = value => '"' + String(value).replaceAll('"', '""') + '"'
const literal = value => "'" + String(value).replaceAll("'", "''") + "'"
const relation = name => `public.${ident(name)}`
export const digest = value => createHash('sha256').update(value).digest('hex')

// This is a pinned rehearsal, not a general-purpose pg_dump replacement.
export function buildStagingSchema(bytes, { targetProject = STAGING_PROJECT } = {}) {
  assert.equal(targetProject, STAGING_PROJECT, 'Not the approved staging project')
  assert.equal(digest(bytes), REVIEW_SHA256, 'Unreviewed or modified structure export')
  const report = JSON.parse(bytes.toString('utf8'), (_key, value, context) => {
    if (typeof value !== 'number' || Number.isSafeInteger(value)) return value
    assert.ok(context?.source, 'Lossless JSON parsing requires Node 24')
    assert.match(context.source, /^-?[0-9]+$/, 'Unexpected non-integer catalog number')
    return context.source
  })
  assert.equal(report.transaction_read_only, 'on')
  assert.equal(report.transaction_isolation, 'repeatable read')
  assert.equal(report.scope, 'public_objects_and_managed_schema_access_metadata')
  const s = report.sections
  for (const [key, items] of Object.entries(s)) assert.equal(items.length, report.counts[key])
  assert.equal(s.rules.length, 0, 'Rules require separate review')
  assert.equal(s.column_grants.length, 0, 'Column grants require separate review')
  const units = []
  const add = (kind, name, sql) => units.push({ kind, name, sql })
  const clientSeal = name => `REVOKE ALL ON TABLE ${relation(name)} FROM PUBLIC, anon, authenticated;`
  for (const t of s.types) {
    assert.equal(t.kind, 'e', 'Only reviewed enums supported')
    add('type', t.name, `CREATE TYPE ${relation(t.name)} AS ENUM (${t.enum_labels.map(literal).join(', ')});`)
  }
  for (const t of s.relations.filter(t => t.kind === 'r')) {
    assert.equal(t.schema_name, 'public')
    assert.equal(t.owner, 'postgres')
    assert.equal(t.persistence, 'p')
    assert.equal(t.is_partition, false)
    assert.deepEqual(t.parents, [])
    assert.equal(t.options, null, 'Table options need review')
    const columns = s.columns.filter(c => c.relation_name === t.name).sort((a, b) => a.position - b.position)
    const definitions = columns.map(c => {
      assert.equal(c.generated_kind, '', 'Generated expressions need review')
      assert.ok(['', 'a', 'd'].includes(c.identity_kind))
      let value = `${ident(c.name)} ${c.data_type}`
      if (c.collation) value += ` COLLATE ${c.collation}`
      if (c.identity_kind) {
        const seq = s.sequences.find(q => q.name === `public.${t.name}_${c.name}_seq`)
        assert.ok(seq, 'Identity sequence settings missing')
        value += ` GENERATED ${c.identity_kind === 'a' ? 'ALWAYS' : 'BY DEFAULT'} AS IDENTITY (START WITH ${seq.start_value} INCREMENT BY ${seq.increment_by} MINVALUE ${seq.min_value} MAXVALUE ${seq.max_value} CACHE ${seq.cache_size} ${seq.cycle ? 'CYCLE' : 'NO CYCLE'})`
      }
      if (c.default_expression !== null) value += ` DEFAULT ${c.default_expression}`
      if (c.not_null) value += ' NOT NULL'
      return value
    })
    add('table', t.name, `CREATE TABLE ${relation(t.name)} (\n  ${definitions.join(',\n  ')}\n);\n${clientSeal(t.name)}`)
  }
  const identities = s.columns.filter(c => c.identity_kind)
  assert.equal(identities.length, s.sequences.length, 'Standalone sequence needs review')
  for (const f of s.functions) {
    if (excludedFunctions.has(f.signature)) continue
    assert.equal(f.owner, 'postgres')
    assert.equal(f.kind, 'f')
    assert.equal(f.extension_owned, false)
    assert.ok(['sql', 'plpgsql'].includes(f.language))
    assert.ok(f.definition.startsWith('CREATE OR REPLACE FUNCTION public.'))
    assert.doesNotMatch(f.definition, /\b(?:net\.|cron\.|http_|http\(|dblink|vault\.|https?:\/\/)/i, 'External integration not reviewed')
    assert.equal(createHash('md5').update(f.definition).digest('hex'), f.definition_md5)
    add('function', f.signature, `${f.definition};\nREVOKE ALL ON FUNCTION ${f.signature} FROM PUBLIC, anon, authenticated;`)
  }
  for (const c of s.constraints.filter(c => c.kind !== 'f')) {
    assert.ok(['p', 'u', 'c'].includes(c.kind))
    assert.ok(c.relation_name.startsWith('public.'))
    assert.equal(c.is_local, true)
    add('constraint', c.name, `ALTER TABLE ${c.relation_name} ADD CONSTRAINT ${ident(c.name)} ${c.definition};`)
  }
  const ownedIndexes = new Set(s.constraints.filter(c => ['p', 'u'].includes(c.kind)).map(c => `public.${c.name}`))
  for (const index of s.indexes) {
    assert.equal(index.valid, true)
    assert.equal(index.ready, true)
    if (!ownedIndexes.has(index.name)) add('index', index.name, `${index.definition};`)
  }
  for (const c of s.constraints.filter(c => c.kind === 'f')) {
    add('foreign-key', c.name, `ALTER TABLE ${c.relation_name} ADD CONSTRAINT ${ident(c.name)} ${c.definition};`)
  }
  for (const v of s.views) {
    assert.equal(v.kind, 'v')
    assert.equal(v.owner, 'postgres')
    assert.ok(v.options === null || JSON.stringify(v.options) === '["security_invoker=true"]')
    add('view', v.name, `CREATE VIEW ${relation(v.name)}${v.options ? ' WITH (security_invoker=true)' : ''} AS\n${v.definition.replace(/;\s*$/, '')};\n${clientSeal(v.name)}`)
  }
  for (const p of s.policies.filter(p => p.schema_name === 'public')) {
    assert.ok(['ALL', 'SELECT', 'INSERT', 'UPDATE', 'DELETE'].includes(p.command))
    assert.ok(['PERMISSIVE', 'RESTRICTIVE'].includes(p.permissive))
    assert.ok(p.roles.every(role => ['public', 'authenticated'].includes(role)))
    add('policy', `${p.table_name}.${p.name}`, `CREATE POLICY ${ident(p.name)} ON ${relation(p.table_name)} AS ${p.permissive} FOR ${p.command} TO ${p.roles.map(role => role === 'public' ? 'PUBLIC' : ident(role)).join(', ')}${p.using_expression ? ` USING (${p.using_expression})` : ''}${p.check_expression ? ` WITH CHECK (${p.check_expression})` : ''};`)
  }
  for (const t of s.relations.filter(t => t.kind === 'r')) {
    if (t.rls_enabled) add('rls', t.name, `ALTER TABLE ${relation(t.name)} ENABLE ROW LEVEL SECURITY;`)
    if (t.rls_forced) add('rls-force', t.name, `ALTER TABLE ${relation(t.name)} FORCE ROW LEVEL SECURITY;`)
    if (t.replica_identity === 'f') add('replica-identity', t.name, `ALTER TABLE ${relation(t.name)} REPLICA IDENTITY FULL;`)
    else assert.equal(t.replica_identity, 'd', 'Replica identity needs review')
  }
  for (const t of s.triggers.filter(t => t.schema_name === 'public')) {
    assert.equal(t.enabled, 'O', 'Disabled or replica trigger needs review')
    assert.ok(!excludedFunctions.has(t.function_name), 'External trigger must not be silently omitted')
    add('trigger', `${t.table_name}.${t.name}`, `${t.definition};`)
  }
  // Never reproduce the existing broad browser grants in the test baseline.
  add('seal', 'public', `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon, authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;`)

  const chunks = []
  let current = [], size = 0
  for (const unit of units) {
    if (size > 0 && size + Buffer.byteLength(unit.sql) > 170000) {
      chunks.push(current); current = []; size = 0
    }
    current.push(unit); size += Buffer.byteLength(unit.sql)
  }
  if (current.length) chunks.push(current)
  const bootstrap = `BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';
DO $guard$ BEGIN
  IF current_user <> 'postgres' THEN RAISE EXCEPTION 'STAGING_ADMIN_REQUIRED'; END IF;
  IF EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public')
    OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public')
    OR to_regnamespace('ob_staging_control') IS NOT NULL THEN
    RAISE EXCEPTION 'STAGING_REQUIRES_EMPTY_PUBLIC_SCHEMA';
  END IF;
  IF to_regclass('auth.users') IS NULL OR to_regclass('storage.objects') IS NULL THEN
    RAISE EXCEPTION 'SUPABASE_MANAGED_SCHEMAS_REQUIRED';
  END IF;
END $guard$;
CREATE SCHEMA ob_staging_control;
REVOKE ALL ON SCHEMA ob_staging_control FROM PUBLIC, anon, authenticated;
CREATE TABLE ob_staging_control.installation (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  project_ref text NOT NULL, source_sha256 text NOT NULL,
  completed_part integer NOT NULL DEFAULT 0, ready boolean NOT NULL DEFAULT false,
  building_phase integer NOT NULL DEFAULT 0
);
REVOKE ALL ON ob_staging_control.installation FROM PUBLIC, anon, authenticated;
INSERT INTO ob_staging_control.installation(project_ref,source_sha256) VALUES (${literal(STAGING_PROJECT)},${literal(REVIEW_SHA256)});
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;
COMMIT;
SELECT project_ref, completed_part, ready FROM ob_staging_control.installation;`
  const parts = chunks.map((items, i) => {
    const ordinal = i + 1
    const sql = `BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';
SET LOCAL search_path = public, extensions, pg_catalog;
SET LOCAL check_function_bodies = off;
DO $guard$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM ob_staging_control.installation WHERE singleton
    AND project_ref=${literal(STAGING_PROJECT)} AND source_sha256=${literal(REVIEW_SHA256)}
    AND completed_part=${i} AND NOT ready FOR UPDATE) THEN
    RAISE EXCEPTION 'STAGING_WRONG_TARGET_OR_PART_ORDER';
  END IF;
END $guard$;
${items.map(u => u.sql).join('\n\n')}
UPDATE ob_staging_control.installation SET completed_part=${ordinal}, ready=${ordinal === chunks.length};
COMMIT;
SELECT project_ref, completed_part, ready FROM ob_staging_control.installation;`
    return { ordinal, sql, sha256: digest(sql), objects: items.map(({ kind, name }) => ({ kind, name })) }
  })
  return { bootstrap, parts, manifest: {
    targetProject, sourceSha256: REVIEW_SHA256, mode: 'sealed_schema_rehearsal_not_backup',
    bootstrapSha256: digest(bootstrap), parts: parts.map(({ sql, ...part }) => ({ ...part, bytes: Buffer.byteLength(sql) })),
    counts: Object.fromEntries([...new Set(units.map(u => u.kind))].map(kind => [kind, units.filter(u => u.kind === kind).length])),
    omittedFunctions: [...excludedFunctions], omittedManagedTriggers: s.triggers.filter(t => t.schema_name !== 'public').map(t => t.name),
    omitted: ['customer/settings rows', 'auth users', 'storage buckets/files/policies', 'managed schema definitions',
      'cron jobs', 'event triggers', 'publications', 'production role memberships/default grants', 'browser grants'],
  } }
}

export function guardBuildingMigration(source, phase) {
  assert.ok(Number.isInteger(phase) && phase >= 1 && phase <= 4)
  assert.equal((source.match(/^begin;\r?$/gim) ?? []).length, 1)
  assert.equal((source.match(/^commit;\r?$/gim) ?? []).length, 1)
  return source.replace(/^begin;\r?$/im, `BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='30s';
DO $staging$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM ob_staging_control.installation WHERE singleton AND ready
    AND project_ref=${literal(STAGING_PROJECT)} AND source_sha256=${literal(REVIEW_SHA256)}
    AND building_phase=${phase - 1} FOR UPDATE) THEN RAISE EXCEPTION 'STAGING_WRONG_BUILDING_PHASE'; END IF;
END $staging$;`).replace(/^commit;\r?$/im, `REVOKE ALL ON ALL TABLES IN SCHEMA public FROM PUBLIC, anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon, authenticated;
UPDATE ob_staging_control.installation SET building_phase=${phase};
COMMIT;
SELECT project_ref,completed_part,ready,building_phase FROM ob_staging_control.installation;`)
}
