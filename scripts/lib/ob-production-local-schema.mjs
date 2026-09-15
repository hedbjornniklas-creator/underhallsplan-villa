import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto'
import { uuid_ossp } from '@electric-sql/pglite/contrib/uuid_ossp'
import { buildStagingSchema } from './ob-staging-schema.mjs'
import { describeRestoreSchema } from './ob-restore-rehearsal.mjs'

const quote = value => '"' + value.replaceAll('"', '""') + '"'

export async function replayLocalPublicGrants(db, sections) {
  assert.ok(db instanceof PGlite, 'Production grants may only be reproduced in local PGlite')
  assert.equal(sections.column_grants.length, 0, 'Column grants require review')
  const roles = ['anon', 'authenticated', 'service_role', 'PUBLIC']
  const privileges = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN', 'USAGE']
  const statements = ['revoke all on all tables in schema public from public,anon,authenticated,service_role',
    'revoke all on all sequences in schema public from public,anon,authenticated,service_role',
    'revoke all on all functions in schema public from public,anon,authenticated,service_role']
  const roleSql = role => role === 'PUBLIC' ? 'PUBLIC' : quote(role)
  for (const grant of sections.relation_grants.filter(g => g.schema_name === 'public' && g.grantee !== 'postgres')) {
    assert.ok(roles.includes(grant.grantee) && privileges.includes(grant.privilege_type))
    const object = sections.relations.find(r => r.name === grant.relation_name)
    assert.ok(object && ['r', 'v', 'S'].includes(object.kind))
    statements.push(`grant ${grant.privilege_type} on ${object.kind === 'S' ? 'sequence' : 'table'} public.${quote(object.name)} to ${roleSql(grant.grantee)}${grant.is_grantable ? ' with grant option' : ''}`)
  }
  for (const grant of sections.function_grants.filter(g => g.grantee !== 'postgres')) {
    assert.ok(roles.includes(grant.grantee) && grant.privilege_type === 'EXECUTE')
    assert.ok(sections.functions.some(f => f.signature === grant.signature))
    // External cron/integration functions intentionally do not exist locally.
    const found = (await db.query('select to_regprocedure($1) is not null as present', [grant.signature])).rows[0].present
    if (found) statements.push(`grant execute on function ${grant.signature} to ${roleSql(grant.grantee)}${grant.is_grantable ? ' with grant option' : ''}`)
  }
  await db.exec(statements.join(';\n') + ';')
}

export async function productionSchemaLocally(root, freshSchema) {
  const baseline = await readFile(join(root, '.cache/inspection-schema-export/production-schema-review.json'))
  const bundle = buildStagingSchema(baseline)
  const runtime = createRequire(join(root, '.cache/inspection-schema-export/runtime/package.json'))
  const { vector } = await import(pathToFileURL(runtime.resolve('@electric-sql/pglite-pgvector')).href)
  const db = new PGlite({ extensions: { pgcrypto, uuid_ossp, vector } })
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create schema storage; create schema extensions;
      create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');
      create table storage.objects(id uuid primary key,bucket_id text,name text,owner uuid);
      create table storage.buckets(id text primary key,name text,public boolean default false);
      alter table storage.objects enable row level security;
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      create function auth.role() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claim.role',true),'') $$;
      create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
      grant usage on schema public,auth,storage to anon,authenticated,service_role;`)
    await db.exec(bundle.bootstrap)
    for (const part of bundle.parts) await db.exec(part.sql)
    await db.exec("set search_path=public,extensions,pg_catalog; set timezone='UTC'")
    // This migration is ALREADY installed in production. Replay it only into
    // this empty, local engine to match the fresh catalog, never into Supabase.
    await db.exec(await readFile(join(root, 'docs/db/2026-09-12_07_profile_org_cards.sql'), 'utf8'))
    await db.exec('set search_path=pg_catalog')
    const metadata = await describeRestoreSchema(db)
    await db.exec('set search_path=public,extensions,pg_catalog')
    const expectedTables = freshSchema.sections.relations.filter(r => r.kind === 'r').map(r => r.schema_name + '.' + r.name).sort()
    assert.deepEqual(metadata.tables.filter(t => t.name.startsWith('public.')).map(t => t.name).sort(), expectedTables)
    for (const table of metadata.tables.filter(t => t.name.startsWith('public.'))) {
      const expected = freshSchema.sections.columns.filter(c => 'public.' + c.relation_name === table.name)
        .sort((a, b) => a.position - b.position).map(c => c.name)
      assert.deepEqual(table.columns, expected, 'Live/local column mismatch: ' + table.name)
    }
    const fkIdentity = fk => fk.from + ':' + fk.name + ':' + fk.definition
    assert.deepEqual(metadata.fks.map(fkIdentity).sort(), freshSchema.sections.constraints.filter(c => c.kind === 'f')
      .map(c => fkIdentity({ from: c.relation_name, name: c.name, definition: c.definition })).sort(), 'Live/local FK mismatch')
    // The shared staging schema deliberately seals browser grants. Reproduce
    // the fresh public ACL here only, in this non-networked local engine.
    await replayLocalPublicGrants(db, freshSchema.sections)
    return { db, metadata }
  } catch (error) { await db.close(); throw error }
}
