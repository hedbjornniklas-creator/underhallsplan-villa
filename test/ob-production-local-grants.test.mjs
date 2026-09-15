import test from 'node:test'
import assert from 'node:assert/strict'
import { PGlite } from '@electric-sql/pglite'
import { replayLocalPublicGrants } from '../scripts/lib/ob-production-local-schema.mjs'

test('local ACL replay reproduces reviewed grants without retaining sealed-baseline extras', async () => {
  const db = new PGlite()
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create table public.example(id int); create sequence public.example_seq;
      create function public.example_fn() returns int language sql as $$ select 1 $$;
      grant all on public.example to authenticated;`)
    const sections = { column_grants: [], relations: [{ name: 'example', kind: 'r' }, { name: 'example_seq', kind: 'S' }],
      functions: [{ signature: 'public.example_fn()' }],
      relation_grants: [
        { schema_name: 'public', relation_name: 'example', privilege_type: 'SELECT', grantee: 'authenticated' },
        { schema_name: 'public', relation_name: 'example_seq', privilege_type: 'USAGE', grantee: 'authenticated' },
      ], function_grants: [{ signature: 'public.example_fn()', privilege_type: 'EXECUTE', grantee: 'authenticated' }] }
    await replayLocalPublicGrants(db, sections)
    const result = (await db.query(`select has_table_privilege('authenticated','public.example','SELECT') as read,
      has_table_privilege('authenticated','public.example','UPDATE') as write,
      has_table_privilege('anon','public.example','SELECT') as anon,
      has_sequence_privilege('authenticated','public.example_seq','USAGE') as sequence,
      has_function_privilege('authenticated','public.example_fn()','EXECUTE') as execute,
      has_function_privilege('anon','public.example_fn()','EXECUTE') as anon_execute`)).rows[0]
    assert.deepEqual(result, { read: true, write: false, anon: false, sequence: true, execute: true, anon_execute: false })
    await assert.rejects(replayLocalPublicGrants(db, { ...sections, column_grants: [{}] }), /Column grants/)
  } finally { await db.close() }
})

test('production grant replay refuses remote/custom database clients', async () => {
  await assert.rejects(replayLocalPublicGrants({ exec: () => { throw new Error('must not execute') } }, {}), /local PGlite/)
})
