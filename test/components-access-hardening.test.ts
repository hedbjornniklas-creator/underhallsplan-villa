import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
const migration = readFileSync(new URL('../docs/db/2026-09-13_03_components_access_hardening.sql', import.meta.url), 'utf8')
const owner = randomUUID(), other = randomUUID(), property = randomUUID(), foreign = randomUUID(), type = randomUUID()
const ownId = randomUUID(), foreignId = randomUUID()
async function asRole<T>(role: 'anon' | 'authenticated' | 'service_role', id: string, fn: () => Promise<T>) {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id])
  await db.exec('set role ' + role)
  try { return await fn() } finally { await db.exec('reset role') }
}
const all = async (table: string) => (await db.query(`select * from public.${table} order by id`)).rows
before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema public,auth to anon,authenticated,service_role;`)
  await db.exec(readFileSync(new URL('./fixtures/components-access.sql', import.meta.url), 'utf8'))
  await db.exec(`alter table public.properties enable row level security;
    create policy owner_all on public.properties for all to authenticated using(owner=auth.uid()) with check(owner=auth.uid());
    alter table public.component_types enable row level security;
    create policy read_types on public.component_types for select to public using(true);
    create policy write_types on public.component_types for all to authenticated using(true) with check(true);
    alter table public.components enable row level security;
    create policy owner_all on public.components for all to public using(exists(select 1 from public.properties p where p.id=components.property_id and p.owner=auth.uid()))
      with check(exists(select 1 from public.properties p where p.id=components.property_id and p.owner=auth.uid()));
    create policy legacy_read on public.components for select to authenticated using(true);
    create policy legacy_insert on public.components for insert to authenticated with check(true);
    create policy legacy_update on public.components for update to authenticated using(true);
    grant all on all tables in schema public to anon,authenticated,service_role;
    grant select(comment),update(comment) on public.components,public.components_calc to public;`)
  await db.query('insert into public.properties values($1,$2),($3,$4)', [property,owner,foreign,other])
  await db.query("insert into public.component_types values($1,'TEST Roof',30)", [type])
  await db.query("insert into public.components(id,property_id,component_type_id,install_year,condition,comment) values($1,$2,$3,2020,'Bra','OWNER'),($4,$5,$3,2021,'Svag','FOREIGN')", [ownId,property,type,foreignId,foreign])
  await db.query("insert into public.actions(property_id,component_id,title) values($1,$2,'TEST related action')", [property,ownId])
})
after(() => db.close())

test('reproduces anonymous owner-executed view leak and authenticated cross-property reads', async () => {
  await asRole('anon', '', async () => assert.equal((await all('components_calc')).length, 2))
  await asRole('authenticated', owner, async () => assert.equal((await all('components')).length, 2))
  await db.exec('begin; alter view public.components_calc set (security_invoker=true)')
  try {
    await asRole('authenticated', owner, async () => assert.equal((await all('components_calc')).length, 2, 'Invoker alone cannot contain open policies'))
  } finally { await db.exec('rollback') }
})

test('requires explicit review; repeated hardening preserves rows, formulas and unrelated grants', async () => {
  const before = await Promise.all(['components','components_calc','component_types','actions'].map(all))
  const metadata = async () => (await db.query(`select relname,relacl::text from pg_class
    where oid in ('public.properties'::regclass,'public.component_types'::regclass,'public.actions'::regclass) order by relname`)).rows
  const grants = await metadata()
  await assert.rejects(db.exec(migration), /COMPONENTS_ACCESS_REVIEW_REQUIRED/)
  await db.exec("rollback; set app.components_access_hardening_approved='true'")
  await db.exec(migration)
  await db.exec(migration)
  assert.deepEqual(await Promise.all(['components','components_calc','component_types','actions'].map(all)), before)
  assert.deepEqual(await metadata(), grants)
  assert.equal((await db.query<{options: string[]}>("select reloptions as options from pg_class where oid='public.components_calc'::regclass")).rows[0].options.includes('security_invoker=true'), true)
})

test('anonymous table/view/column access is denied, including forged subject and whole-table commands', async () => {
  await asRole('anon', owner, async () => {
    for (const table of ['components','components_calc']) {
      assert.equal((await db.query<{allowed: boolean}>("select has_any_column_privilege('anon',$1,'SELECT,INSERT,UPDATE,REFERENCES') as allowed", ['public.' + table])).rows[0].allowed, false)
      await assert.rejects(all(table), /permission denied/)
      await assert.rejects(db.query(`select comment from public.${table}`), /permission denied/)
      await assert.rejects(db.query(`update public.${table} set comment='FORGED'`), /permission denied|cannot update view/)
    }
    await assert.rejects(db.exec('truncate public.components cascade'), /permission denied/)
  })
})

test('owners retain CRUD and identical calculations, but cannot read/write/reparent another property', async () => {
  await asRole('authenticated', owner, async () => {
    assert.deepEqual((await all('components')).map(row => (row as {id: string}).id), [ownId])
    const rows = await db.query<{id: string; remaining_years: number}>("select id,remaining_years from public.components_calc")
    assert.equal(rows.rows[0].id, ownId)
    assert.equal(rows.rows[0].remaining_years, 30 - (new Date().getUTCFullYear() - 2020))
    const id = randomUUID()
    await db.query("insert into public.components(id,property_id,component_type_id,comment) values($1,$2,$3,'NEW')", [id,property,type])
    await db.query("update public.components set comment='EDITED' where id=$1", [id])
    await assert.rejects(db.query('update public.components set property_id=$1 where id=$2', [foreign,id]), /row-level security/)
    await assert.rejects(db.query('insert into public.components(property_id,component_type_id) values($1,$2)', [foreign,type]), /row-level security/)
    assert.equal((await db.query("update public.components set comment='WRONG' where id=$1 returning id", [foreignId])).rows.length, 0)
    assert.equal((await db.query('delete from public.components where id=$1 returning id', [foreignId])).rows.length, 0)
    assert.equal((await db.query('delete from public.components where id=$1 returning id', [id])).rows.length, 1)
    await assert.rejects(db.query("update public.components_calc set comment='WRONG'"), /permission denied|cannot update view/)
    await assert.rejects(db.exec('truncate public.components cascade'), /permission denied/)
  })
  await asRole('authenticated', other, async () => assert.deepEqual((await all('components_calc')).map(row => (row as {id: string}).id), [foreignId]))
  await asRole('authenticated', '', async () => assert.equal((await all('components_calc')).length, 0))
})

test('service reads and writes survive while existing action references remain intact', async () => {
  await asRole('service_role', '', async () => {
    assert.equal((await all('components_calc')).length, 2)
    const id = randomUUID()
    await db.query('insert into public.components(id,property_id,component_type_id) values($1,$2,$3)', [id,foreign,type])
    await db.query("update public.components set comment='SERVICE' where id=$1", [id])
    await db.query('delete from public.components where id=$1', [id])
  })
  assert.equal((await db.query<{component_id: string}>('select component_id from public.actions')).rows[0].component_id, ownId)
})

test('rejects inherited table and column grants', async () => {
  for (const [role,grant] of [
    ['anon','select on public.components_calc'],
    ['anon','select(comment) on public.components'],
    ['authenticated','update(comment) on public.components_calc'],
    ['authenticated','truncate on public.components'],
    ['authenticated','maintain on public.components'],
  ]) {
    await db.exec(`create role unexpected_access; grant ${grant} to unexpected_access; grant unexpected_access to ${role}`)
    try {
      await assert.rejects(db.exec(migration), /COMPONENTS_ACCESS_INHERITED_GRANT/)
    } finally { await db.exec(`rollback; revoke unexpected_access from ${role}; drop owned by unexpected_access; drop role unexpected_access`) }
  }
})

test('a late failure rolls back grants instead of partially opening a sealed target', async () => {
  await db.exec(`revoke all on public.components,public.components_calc from authenticated;
    create role unexpected_view_reader;
    grant select(comment) on public.components_calc to unexpected_view_reader;
    grant unexpected_view_reader to anon`)
  await assert.rejects(db.exec(migration), /COMPONENTS_ACCESS_INHERITED_GRANT: components_calc/)
  await db.exec('rollback')
  for (const table of ['components','components_calc']) {
    assert.equal((await db.query<{allowed: boolean}>(
      "select has_table_privilege('authenticated',$1,'SELECT,INSERT,UPDATE,DELETE') as allowed", ['public.' + table])).rows[0].allowed, false)
  }
})

test('fails closed on unsafe roles, owners, missing parent access and changed view definitions', async () => {
  const cases = [
    ['alter role anon bypassrls', 'alter role anon nobypassrls', /COMPONENTS_ACCESS_UNSAFE_ROLE/],
    ['alter table public.components owner to authenticated', 'alter table public.components owner to postgres', /COMPONENTS_ACCESS_UNSAFE_OWNER/],
    ['alter table public.properties disable row level security', 'alter table public.properties enable row level security', /COMPONENTS_ACCESS_PARENT_READ_REQUIRED/],
    ['revoke select on public.component_types from authenticated', 'grant select on public.component_types to authenticated', /COMPONENTS_ACCESS_PARENT_READ_REQUIRED/],
    ['alter view public.components_calc rename column comment to unreviewed', 'alter view public.components_calc rename column unreviewed to comment', /COMPONENTS_ACCESS_VIEW_REVIEW_REQUIRED/],
  ] as const
  for (const [setup,undo,error] of cases) {
    await db.exec(setup)
    try { await assert.rejects(db.exec(migration), error) } finally { await db.exec('rollback; ' + undo) }
  }
})
