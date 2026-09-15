import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
const read = (path: string) => readFileSync(new URL(path,import.meta.url),'utf8')
const migration = read('../docs/db/2026-09-13_04_component_catalogue_access.sql')
const ordinary=randomUUID(), legacy=randomUUID(), admin=randomUUID(), foreign=randomUUID(), type=randomUUID()
const product=randomUUID(), moduleId=randomUUID(), roleId=randomUUID(), assignment=randomUUID()
async function asRole<T>(role: string, id: string, fn: () => Promise<T>) {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id])
  await db.exec('set role ' + role)
  try { return await fn() } finally { await db.exec('reset role') }
}
const snapshot = async () => {
  const result: Record<string, unknown> = {}
  for (const table of ['profiles','platform_products','platform_modules','platform_roles','platform_access_assignments','component_types','components','components_calc','actions']) {
    result[table] = (await db.query('select * from public.' + table + ' order by id')).rows
  }
  return result
}
const canEdit = async () => (await db.query<{allowed: boolean}>('select public.is_hushub_besiktapp_admin() as allowed')).rows[0].allowed
before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema public,auth to anon,authenticated,service_role;`)
  await db.exec(read('./fixtures/components-access.sql'))
  await db.exec(read('./fixtures/component-catalogue-access.sql'))
  const helper = read('../docs/db/2026-06-04_03_tu_report_section_types_rls.sql')
  await db.exec(helper.slice(helper.indexOf('create or replace function'),helper.indexOf('grant execute')))
  await db.query('insert into public.profiles(id,is_admin) values($1,false),($2,true),($3,false),($4,false)',[ordinary,legacy,admin,foreign])
  await db.query("insert into public.platform_products values($1,'hushub_admin')",[product])
  await db.query("insert into public.platform_modules values($1,$2,'besiktapp_admin')",[moduleId,product])
  await db.query("insert into public.platform_roles values($1,$2,'product_admin')",[roleId,product])
  await db.query("insert into public.platform_access_assignments(id,profile_id,product_id,module_id,role_id,scope_type) values($1,$2,$3,$4,$5,'global')",[assignment,admin,product,moduleId,roleId])
  await db.query("insert into public.component_types values($1,'TEST catalogue',30)",[type])
  const property = randomUUID()
  await db.query('insert into public.properties values($1,$2)',[property,ordinary])
  await db.query("insert into public.components(property_id,component_type_id,install_year,comment) values($1,$2,2020,'TEST unchanged')",[property,type])
})
after(() => db.close())

test('reproduces ordinary catalogue writes, self-promotion and browser role-catalogue mutation',async () => {
  await db.exec('begin')
  try {
    await asRole('authenticated',ordinary,async () => {
      assert.equal(await canEdit(),false)
      assert.equal((await db.query("update public.component_types set name='WRONG' where id=$1 returning id",[type])).rows.length,1)
      await db.query('update public.profiles set is_admin=true where id=$1',[ordinary])
      assert.equal(await canEdit(),true)
      await db.query("update public.platform_roles set key='WRONG' where id=$1",[roleId])
    })
  } finally { await db.exec('rollback') }
})

test('requires review, is repeatable, and preserves records, formulas and service grants',async () => {
  const before = await snapshot()
  const service = async () => (await db.query("select relname,privilege_type from pg_class c cross join lateral aclexplode(c.relacl) a where a.grantee='service_role'::regrole order by 1,2")).rows
  const grants=await service()
  await assert.rejects(db.exec(migration),/COMPONENT_CATALOGUE_REVIEW_REQUIRED/)
  await db.exec("rollback; set app.component_catalogue_access_approved='true'")
  await db.exec(migration)
  await db.exec(migration)
  assert.deepEqual(await snapshot(),before)
  assert.deepEqual(await service(),grants)
})

test('ordinary users read the catalogue but cannot mutate it or forge admin through a profile/upsert',async () => {
  await asRole('authenticated',ordinary,async () => {
    assert.equal(await canEdit(),false)
    assert.equal((await db.query('select * from public.component_types')).rows.length,1)
    await assert.rejects(db.query("insert into public.component_types(name,default_lifespan_years) values('FORBIDDEN',1)"),/row-level security/)
    assert.equal((await db.query("update public.component_types set name='FORBIDDEN' where id=$1 returning id",[type])).rows.length,0)
    assert.equal((await db.query('delete from public.component_types where id=$1 returning id',[type])).rows.length,0)
    await assert.rejects(db.query('update public.profiles set is_admin=true where id=$1',[ordinary]),/permission denied/)
    await assert.rejects(db.query('insert into public.profiles(id,is_admin) values($1,true) on conflict(id) do update set is_admin=excluded.is_admin',[ordinary]),/permission denied/)
    for (const table of ['platform_products','platform_modules','platform_roles','platform_access_assignments']) {
      await assert.rejects(db.query('delete from public.' + table),/permission denied/)
      await assert.rejects(db.query('update public.' + table + ' set id=id'),/permission denied/)
      await assert.rejects(db.exec('truncate public.' + table + ' cascade'),/permission denied/)
    }
    assert.equal(await canEdit(),false)
  })
})

test('self-profile upsert including report assets survives; foreign profiles and admin changes stay protected',async () => {
  for (const person of [ordinary,legacy]) {
    await asRole('authenticated',person,async () => {
      await db.query("insert into public.profiles(id,full_name,phone,company_name,signature_path) values($1,'TEST profile','123','TEST Co','TEST signature') on conflict(id) do update set id=excluded.id,full_name=excluded.full_name,phone=excluded.phone,company_name=excluded.company_name,signature_path=excluded.signature_path",[person])
      const row=(await db.query<{is_admin: boolean; signature_path: string}>('select is_admin,signature_path from public.profiles where id=$1',[person])).rows[0]
      assert.equal(row.is_admin,person===legacy)
      assert.equal(row.signature_path,'TEST signature')
      await assert.rejects(db.query('insert into public.profiles(id,full_name) values($1,$2) on conflict(id) do update set full_name=excluded.full_name',[foreign,'FORBIDDEN']),/row-level security/)
      assert.equal((await db.query("update public.profiles set full_name='FORBIDDEN' where id=$1 returning id",[foreign])).rows.length,0)
    })
  }
  const newcomer=randomUUID()
  await asRole('authenticated',newcomer,async () => {
    await db.query("insert into public.profiles(id,full_name) values($1,'TEST new profile')",[newcomer])
    assert.equal(await canEdit(),false)
  })
})

test('both existing global admin models retain catalogue CRUD; referenced types still cannot be deleted',async () => {
  for (const person of [legacy,admin]) {
    await asRole('authenticated',person,async () => {
      assert.equal(await canEdit(),true)
      const id=randomUUID()
      await db.query("insert into public.component_types values($1,'TEST admin',20)",[id])
      assert.equal((await db.query('update public.component_types set default_lifespan_years=25 where id=$1 returning id',[id])).rows.length,1)
      await assert.rejects(db.query('delete from public.component_types where id=$1',[type]),/foreign key/)
      assert.equal((await db.query('delete from public.component_types where id=$1 returning id',[id])).rows.length,1)
    })
  }
})

test('expired, inactive, organization-scoped, other-module and ordinary-role assignments are not global admins',async () => {
  const cases=[
    "update public.platform_access_assignments set expires_at=now()-interval '1 second'",
    'update public.platform_access_assignments set is_active=false',
    "update public.platform_access_assignments set scope_type='organization'",
    'update public.platform_access_assignments set scope_id=gen_random_uuid()',
    "update public.platform_modules set key='renoapp_admin'",
    "update public.platform_roles set key='inspector'",
    "update public.platform_products set key='dashboard'",
  ]
  for(const change of cases) {
    await db.exec('begin; ' + change)
    try { await asRole('authenticated',admin,async () => {
      assert.equal(await canEdit(),false)
      await db.exec('savepoint denied_write')
      await assert.rejects(db.query("insert into public.component_types(name,default_lifespan_years) values('FORBIDDEN',1)"),/row-level security/)
      await db.exec('rollback to denied_write')
    }) } finally { await db.exec('rollback') }
  }
})

test('anonymous access is denied even with a forged admin subject; service still manages profiles and assignments',async () => {
  await asRole('anon',legacy,async () => {
    for(const table of ['profiles','platform_access_assignments','component_types']) await assert.rejects(db.query('select * from public.' + table),/permission denied/)
    await assert.rejects(db.query('update public.profiles set is_admin=true'),/permission denied/)
  })
  await asRole('service_role','',async () => {
    await db.query('update public.profiles set is_admin=false where id=$1',[legacy])
    await db.query('update public.profiles set is_admin=true where id=$1',[legacy])
    await db.query('update public.platform_access_assignments set is_active=true where id=$1',[assignment])
    const id=randomUUID()
    await db.query("insert into public.component_types values($1,'TEST service',30)",[id])
    await db.query('delete from public.component_types where id=$1',[id])
  })
})

test('unexpected inherited grants, helper, defaults, owners and schema privileges abort atomically',async () => {
  const cases=[
    ['grant update(is_admin) on public.profiles to unreviewed',/INHERITED_PROFILE_GRANT/],
    ['grant insert on public.platform_roles to unreviewed',/INHERITED_GRANT/],
    ['grant maintain on public.component_types to unreviewed',/INHERITED_GRANT/],
    ['grant select on public.platform_access_assignments to unreviewed',/INHERITED_GRANT/],
    ['alter function public.is_hushub_besiktapp_admin() security invoker',/ADMIN_HELPER_REVIEW_REQUIRED/],
    ['alter table public.profiles alter is_admin set default true',/PROFILE_DEFAULT_REVIEW_REQUIRED/],
    ['alter table public.profiles owner to authenticated',/UNSAFE_RELATION/],
    ['grant create on schema public to authenticated',/UNSAFE_ROLE/],
  ] as const
  await db.exec('create role unreviewed; grant unreviewed to authenticated')
  for(const [change,error] of cases) {
    // Run the real transactional body under a savepoint to prove failure rolls everything back.
    await db.exec('begin; ' + change + '; savepoint before_migration')
    const acls=async () => (await db.query("select relname,relacl::text from pg_class where relname in ('profiles','component_types','platform_roles') order by relname")).rows
    const before=await acls()
    try {
      await assert.rejects(db.exec(migration.replace(/^begin;$/mi,'').replace(/^commit;$/mi,'')),error)
      await db.exec('rollback to before_migration')
      assert.deepEqual(await acls(),before)
    } finally { await db.exec('rollback') }
  }
})
