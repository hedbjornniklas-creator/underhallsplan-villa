import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite(), org = randomUUID(), actor = randomUUID(), stranger = randomUUID(), inspection = randomUUID()
const migration = readFileSync(new URL('../docs/db/2026-09-28_01_ob_environmental_protocols.sql', import.meta.url), 'utf8')
const document = { schema: 1, include: false, fields: {}, rows: [], attachments: [] as string[] }
before(async () => {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create function auth.uid() returns uuid language sql as $$ select null::uuid $$;
    create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table org_members(org_id uuid,profile_id uuid,is_active boolean);
    create table settings_addon_services(key text primary key,name text,sort_order integer);
    insert into settings_addon_services values('radonindikering','Eget bevarat namn',45);
    create table properties(id uuid primary key,owner uuid);
    create table inspections(id uuid primary key,property_id uuid,inspection_family text,type text,locked_at timestamptz,paused boolean default false);
    insert into org_members values('${org}','${actor}',true),('${org}','${stranger}',true);
    insert into properties values('${inspection}','${actor}');
    insert into inspections(id,property_id,type) values('${inspection}','${inspection}','OB');
    create function ob_round_mutate(uuid,uuid,uuid,text,jsonb) returns jsonb language plpgsql as $$ begin
      if exists(select 1 from inspections where id=$1 and locked_at is not null) then raise exception 'OB_ROUND_LOCKED'; end if;
      if exists(select 1 from inspections where id=$1 and paused) then raise exception 'OB_ROUND_PAUSED'; end if;
      return '{}'; end $$;
  `)
  // Use the production ownership/membership guard; the round command's lock response is an isolated fixture.
  const commands = readFileSync(new URL('../docs/db/2026-09-12_02_ob_building_commands.sql', import.meta.url), 'utf8')
  await db.exec(commands.slice(commands.indexOf('create or replace function public.ob_building_access'), commands.indexOf('end $$;') + 7))
  await db.exec(migration); await db.exec(migration)
})
after(() => db.close())
async function command(operation: string, payload = {}, kind: string | null = 'radon', user = actor, organization = org) {
  return (await db.query<{ result: { revision: number; document: unknown; files: unknown[] } }>('select ob_environmental_command($1,$2,$3,$4,$5,$6::jsonb) result', [inspection, organization, user, kind, operation, JSON.stringify(payload)])).rows[0].result
}
test('migration is repeatable and only creates private storage, with service-only mutations', async () => {
  assert.deepEqual(await command('read'), { document: null, revision: 0, files: [] })
  const bucket = (await db.query<{ public: boolean }>('select public from storage.buckets')).rows[0]
  assert.equal(bucket.public, false)
  assert.deepEqual((await db.query('select key,name from settings_addon_services order by key')).rows, [
    { key: 'mould', name: 'Mögelprov' }, { key: 'radonindikering', name: 'Eget bevarat namn' },
  ])
  const privileges = (await db.query<{ mutate: boolean; insert: boolean }>(`select has_function_privilege('authenticated','ob_environmental_command(uuid,uuid,uuid,text,text,jsonb)','execute') mutate,
    has_table_privilege('authenticated','inspection_environmental_protocols','insert') "insert"`)).rows[0]
  assert.deepEqual(privileges, { mutate: false, insert: false })
})
test('ownership, membership, family, null kind and malformed documents are rejected', async () => {
  await assert.rejects(command('read', {}, 'radon', stranger), /FORBIDDEN/)
  await assert.rejects(command('read', {}, 'radon', actor, randomUUID()), /FORBIDDEN/)
  await assert.rejects(command('read', {}, null), /INVALID/)
  await assert.rejects(command('save', { revision: 0, document: {} }), /INVALID/)
  await assert.rejects(command('save', { revision: 0, document: { ...document, include: null } }), /INVALID/)
  await db.exec(`update inspections set type='EB' where id='${inspection}'`)
  await assert.rejects(command('read'), /FORBIDDEN/)
  await db.exec(`update inspections set type='OB' where id='${inspection}'`)
})
test('compare-and-swap prevents overwrites and separates both protocols', async () => {
  assert.equal((await command('save', { revision: 0, document })).revision, 1)
  await assert.rejects(command('save', { revision: 0, document: { ...document, fields: { comment: 'stale' } } }), /CONFLICT/)
  assert.deepEqual((await command('read')).document, document)
  assert.equal((await command('read', {}, 'mould')).revision, 0)
  const before = await command('read'); await db.exec(migration)
  assert.deepEqual(await command('read'), before)
})
test('locked or paused inspections stay readable but reject changes', async () => {
  for (const column of ['locked_at', 'paused']) {
    await db.exec(`update inspections set ${column}=${column === 'paused' ? 'true' : 'now()'} where id='${inspection}'`)
    await assert.rejects(command('save', { revision: 1, document }), /LOCKED|PAUSED/)
    assert.equal((await command('read')).revision, 1)
    await db.exec(`update inspections set ${column}=${column === 'paused' ? 'false' : 'null'} where id='${inspection}'`)
  }
})
test('files are immutable and scoped; detach never deletes their metadata', async () => {
  const id = randomUUID(), file = { id, path: `${org}/${inspection}/radon/${id}.pdf`, name: 'Lab.pdf', sha256: 'a'.repeat(64), size: 10 }
  await assert.rejects(command('file', { ...file, path: 'foreign/path' }), /INVALID/)
  await command('file', file)
  await assert.rejects(command('file', { ...file, name: 'Replacement.pdf' }), /duplicate key/)
  await assert.rejects(command('save', { revision: 0, document: { ...document, attachments: [id] } }, 'mould'), /INVALID/)
  await assert.rejects(command('save', { revision: 1, document: { ...document, attachments: [randomUUID()] } }), /INVALID/)
  await command('save', { revision: 1, document: { ...document, attachments: [id] } })
  await command('save', { revision: 2, document })
  assert.equal((await command('read')).files.length, 1)
})
