import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import type { PGlite } from '@electric-sql/pglite'
// @ts-expect-error Node strip-types requires the TypeScript extension.
import { platformOrganizationDb, sql, person, organization, grant, asRole } from './helpers/platform-organization-db.ts'

const migration = sql('2026-10-12_01_organization_self_service.sql')
const runtime = sql('2026-10-02_05_ob_organization_runtime.sql')
const runtimeAccess = runtime.slice(runtime.indexOf('create or replace function public.ob_actor_has_organization_access('),
  runtime.indexOf('create or replace function public.ob_assert_organization_inspection('))
const values = (organizationNumber = '559281-0823') => ({ name: 'New company', organizationNumber })
const create = (db: PGlite, actor: string, input: unknown = values(), request = randomUUID()) =>
  db.query<{ result: { saved: boolean; organizationId: string } }>(
    'select organization_self_service_create($1,$2,$3) as result', [actor, request, JSON.stringify(input)])
const id = (result: Awaited<ReturnType<typeof create>>) => result.rows[0].result.organizationId
function number(sequence: number) {
  const base = String(556000000 + sequence)
  const sum = Array.from(base, (n, index) => { const digit = Number(n) * (index % 2 ? 1 : 2); return digit > 9 ? digit - 9 : digit }).reduce((a, b) => a + b, 0)
  return `${base.slice(0, 6)}-${base.slice(6)}${(10 - sum % 10) % 10}`
}

test('real SQL self-service bootstrap preserves account and organization boundaries', async t => {
  const db = await platformOrganizationDb()
  try {
    await t.test('missing administration prerequisites abort the migration', async () => {
      await assert.rejects(db.exec(migration), /ORG_SELF_SERVICE_PREREQUISITES_REQUIRED/)
      await db.exec('rollback')
    })
    await db.exec(sql('2026-10-02_01_platform_organization_administration.sql'))
    await db.exec(runtimeAccess)
    await db.exec(sql('2026-10-08_03_ob_organization_invitations.sql'))
    const tables = ['organizations', 'org_members', 'profiles', 'profile_org_cards', 'organization_enabled_modules',
      'platform_access_assignments', 'organization_invitations', 'platform_organization_audit', 'platform_organization_create_requests']
    const snapshot = () => Promise.all(tables.map(async table => (await db.query(
      `select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) as rows from ${table} t`)).rows))
    await t.test('installation and repeat installation never change existing business data', async () => {
      const before = await snapshot()
      await db.exec(migration)
      assert.deepEqual(await snapshot(), before)
      await db.exec(migration)
      assert.deepEqual(await snapshot(), before)
    })
    const actor = await person(db)
    await t.test('RPC and request table are service-only; inherited exposure aborts installation', async () => {
      for (const role of ['anon', 'authenticated'] as const) await asRole(db, role, async () => {
        await assert.rejects(create(db, actor), /permission denied/)
        await assert.rejects(db.exec('select * from organization_self_service_requests'), /permission denied/)
      })
      await asRole(db, 'service_role', async () => {
        await assert.rejects(db.exec('delete from organization_self_service_requests'), /permission denied/)
      })
      await db.exec('grant service_role to authenticated')
      await assert.rejects(db.exec(migration), /ORG_SELF_SERVICE_ACL_INVALID/)
      await db.exec('rollback; revoke service_role from authenticated')
    })
    await t.test('unknown and unconfirmed actors cannot create anything', async () => {
      const unconfirmed = await person(db)
      await db.query('update auth.users set email_confirmed_at=null where id=$1', [unconfirmed])
      const before = await snapshot()
      await assert.rejects(create(db, randomUUID()), /UNAUTHORIZED/)
      await assert.rejects(create(db, unconfirmed), /ORG_EMAIL_UNVERIFIED/)
      assert.deepEqual(await snapshot(), before)
    })
    await t.test('strict input rejects identity, modules, existing IDs, control text and invalid numbers atomically', async () => {
      const before = await snapshot()
      for (const value of [null, [], {}, { name: 'Company' }, { ...values(), p_actor: actor },
        { ...values(), adminProfileId: actor }, { ...values(), modules: ['inspections'] }, { ...values(), organizationId: randomUUID() },
        { ...values(), name: ' ' }, { ...values(), name: 'Bad\nname' }, { ...values(), name: 'Bad\u007fname' },
        { ...values(), name: 'a'.repeat(241) }, { ...values(), organizationNumber: null },
        ...['559281-0824', '559281082', 'SE559281082301', '559 281-0823', '559281+0823', ''].map(organizationNumber => values(organizationNumber))]) {
        await assert.rejects(create(db, actor, value), /ORG_INPUT_INVALID/)
      }
      assert.deepEqual(await snapshot(), before)
    })
    let created = ''
    const request = randomUUID()
    await t.test('ordinary confirmed user gets admin only in a new organization, with no module or default promotion', async () => {
      const profilesBefore = (await db.query('select * from profiles order by id')).rows
      created = id(await asRole(db, 'service_role', () => create(db, actor, values(), request)))
      assert.deepEqual((await db.query('select org_id,role,is_active,is_default from org_members where profile_id=$1', [actor])).rows,
        [{ org_id: created, role: 'admin', is_active: true, is_default: false }])
      assert.deepEqual((await db.query('select module_key,is_active from organization_enabled_modules where org_id=$1 order by module_key', [created])).rows,
        [{ module_key: 'inspections', is_active: false }, { module_key: 'technical_investigations', is_active: false }])
      assert.deepEqual((await db.query(`select p.key as product,m.key as module,r.key as role,a.scope_type,a.scope_id from platform_access_assignments a
        join platform_products p on p.id=a.product_id join platform_modules m on m.id=a.module_id join platform_roles r on r.id=a.role_id
        where a.profile_id=$1 and a.is_active`, [actor])).rows,
      [{ product: 'dashboard', module: 'admin', role: 'dashboard_admin', scope_type: 'organization', scope_id: created }])
      assert.equal((await db.query<{ allowed: boolean }>('select ob_actor_has_organization_access($1,$2) as allowed', [created, actor])).rows[0].allowed, false)
      assert.deepEqual((await db.query('select * from profiles order by id')).rows, profilesBefore)
      assert.equal((await db.query<{ n: number }>('select count(*)::int as n from platform_organization_audit where organization_id=$1', [created])).rows[0].n, 1)
    })
    await t.test('exact canonical retries return the same org without new writes; changed payload conflicts', async () => {
      const before = await snapshot()
      assert.equal(id(await create(db, actor, { name: ' New company ', organizationNumber: '5592810823' }, request)), created)
      await assert.rejects(create(db, actor, { ...values(), name: 'Changed' }, request), /ORG_CONFLICT/)
      assert.deepEqual(await snapshot(), before)
    })
    await t.test('same number and cross-actor key reuse never disclose or join the existing organization', async () => {
      const other = await person(db)
      const before = await snapshot()
      for (const input of [values(), values('5592810823')]) {
        await assert.rejects(create(db, other, input, request), /ORG_NUMBER_EXISTS/)
        await assert.rejects(create(db, actor, input), /ORG_NUMBER_EXISTS/)
      }
      assert.deepEqual(await snapshot(), before)
    })
    await t.test('replay rechecks email and existing admin membership without reinstating access', async () => {
      await db.query('update auth.users set email_confirmed_at=null where id=$1', [actor])
      await assert.rejects(create(db, actor, values(), request), /ORG_EMAIL_UNVERIFIED/)
      await db.query('update auth.users set email_confirmed_at=now() where id=$1', [actor])
      await db.query("update org_members set role='inspector' where org_id=$1 and profile_id=$2", [created, actor])
      const before = await snapshot()
      await assert.rejects(create(db, actor, values(), request), /ORG_MEMBERSHIP_REQUIRED/)
      assert.deepEqual(await snapshot(), before)
      await db.query("update org_members set role='admin' where org_id=$1 and profile_id=$2", [created, actor])
    })
    await t.test('existing multi-organization defaults, users and grants remain byte-for-byte unchanged', async () => {
      const member = await person(db)
      const other = await person(db)
      const old = await organization(db, member)
      await grant(db, member, { product: 'dashboard', module: 'inspections', role: 'inspector', scope: 'organization', scopeId: old })
      await grant(db, other)
      const oldMembers = (await db.query('select * from org_members order by id')).rows
      const oldGrants = (await db.query('select * from platform_access_assignments order by id')).rows
      const newId = id(await create(db, member, values(number(1))))
      assert.deepEqual((await db.query('select * from org_members where org_id<>$1 order by id', [newId])).rows, oldMembers)
      assert.deepEqual((await db.query('select * from platform_access_assignments where scope_id is distinct from $1 order by id', [newId])).rows, oldGrants)
      assert.equal((await db.query<{ org_id: string }>('select org_id from org_members where profile_id=$1 and is_default', [member])).rows[0].org_id, old)
    })
    await t.test('legacy profiles fail closed before any grant or organization changes', async () => {
      const legacy = await person(db)
      await organization(db, legacy)
      const legacyAdmin = await person(db, true)
      const before = await snapshot()
      for (const profile of [legacy, legacyAdmin]) await assert.rejects(create(db, profile, values(number(2))), /ORG_LEGACY_ACCESS_REVIEW_REQUIRED/)
      assert.deepEqual(await snapshot(), before)
    })
    await t.test('three successful creates per rolling day; same-key retries remain available at the limit', async () => {
      const limited = await person(db)
      const key = randomUUID()
      const first = id(await create(db, limited, values(number(10)), key))
      await create(db, limited, values(number(11)))
      await create(db, limited, values(number(12)))
      const before = await snapshot()
      await assert.rejects(create(db, limited, values(number(13))), /ORG_CREATE_LIMIT/)
      assert.equal(id(await create(db, limited, values(number(10)), key)), first)
      assert.deepEqual(await snapshot(), before)
      await db.query("update organization_self_service_requests set created_at=now()-interval '25 hours' where actor_profile_id=$1", [limited])
      await create(db, limited, values(number(13)))
    })
    await t.test('failure after insertion rolls back org, membership, entitlements, grants, audit and request marker together', async () => {
      const fresh = await person(db)
      await db.exec("update platform_modules set is_active=false where key='admin'")
      const before = await snapshot()
      await assert.rejects(create(db, fresh, values(number(20))), /ORG_CATALOG_REQUIRED/)
      assert.deepEqual(await snapshot(), before)
      assert.equal((await db.query<{ n: number }>('select count(*)::int as n from organization_self_service_requests where actor_profile_id=$1', [fresh])).rows[0].n, 0)
      await db.exec("update platform_modules set is_active=true where key='admin'")
    })
    await t.test('historical duplicate numbers survive migration and cannot be claimed by self-service', async () => {
      const owner = await person(db)
      for (let index = 0; index < 2; index++) await db.query('insert into organizations(name,organization_number,created_by) values($1,$2,$3)', ['Historical', number(30), owner])
      const before = await snapshot()
      await db.exec(migration)
      await assert.rejects(create(db, owner, values(number(30))), /ORG_NUMBER_EXISTS/)
      assert.deepEqual(await snapshot(), before)
    })
    await t.test('confirmed Auth-only account gets a minimal profile atomically; invalid or duplicate requests leave no profile', async () => {
      const noProfile = randomUUID()
      await db.query('insert into auth.users values($1,$2,now())', [noProfile, 'verified@example.test'])
      const before = await snapshot()
      await assert.rejects(create(db, noProfile, { ...values(number(31)), modules: ['inspections'] }), /ORG_INPUT_INVALID/)
      await assert.rejects(create(db, noProfile), /ORG_NUMBER_EXISTS/)
      assert.deepEqual(await snapshot(), before)
      const key = randomUUID()
      const created = id(await create(db, noProfile, values(number(31)), key))
      assert.equal(id(await create(db, noProfile, values(number(31)), key)), created)
      assert.deepEqual((await db.query('select id,email,full_name,is_admin from profiles where id=$1', [noProfile])).rows,
        [{ id: noProfile, email: 'verified@example.test', full_name: null, is_admin: false }])
    })
    await t.test('SQL coordinates all organization writers, not only other self-service requests', () => {
      assert.match(migration, /lock table public\.organizations in share row exclusive mode/u)
      assert.ok(migration.indexOf('for update;') < migration.indexOf('lock table public.organizations'))
      assert.ok(migration.indexOf('lock table public.organizations') < migration.indexOf("raise exception 'ORG_NUMBER_EXISTS'"))
    })
  } finally { await db.close() }
})
