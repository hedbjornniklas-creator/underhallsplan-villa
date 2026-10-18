import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import type { PGlite } from '@electric-sql/pglite'
// @ts-expect-error Node strip-types requires the TypeScript extension.
import { platformOrganizationDb, sql, person, organization, asRole } from './helpers/platform-organization-db.ts'

const migration = sql('2026-10-12_02_organization_sender_profiles.sql')
const values = (name = 'Inspection brand') => ({ name, address: null, postalCode: null, city: null, email: null, phone: null,
  website: null, logoPath: null, reportFooterText: null, isActive: true })
const save = (db: PGlite, actor: string, org: string, id: string = randomUUID(), version = 0, input: unknown = values()) =>
  db.query('select organization_sender_profile_save($1,$2,$3,$4,$5)', [actor, org, id, version, JSON.stringify(input)])
const legalName = (db: PGlite, actor: string, org: string, name: string | null = 'Legal company AB', version = 0) =>
  db.query('select organization_legal_name_save($1,$2,$3,$4)', [actor, org, version, name])
const without = (row: Record<string, unknown>, keys: string[]) => Object.fromEntries(Object.entries(row).filter(([key]) => !keys.includes(key)))

test('sender-profile SQL preserves organizations and isolates sender identity from authority and document data', async t => {
  const db = await platformOrganizationDb()
  try {
    const actor = await person(db)
    const org = await organization(db, actor)
    const otherAdmin = await person(db)
    const otherOrg = await organization(db, otherAdmin)
    const inspector = await person(db)
    const outsider = await person(db)
    await db.query("insert into org_members(org_id,profile_id,role) values($1,$2,'inspector')", [org, inspector])
    const businessTables = ['org_members', 'profiles', 'profile_org_cards', 'organization_enabled_modules', 'platform_access_assignments', 'fortnox_connections']
    const businessSnapshot = () => Promise.all(businessTables.map(async table => (await db.query(
      `select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) as rows from ${table} t`)).rows))
    const original = await businessSnapshot()
    const originalOrg = (await db.query<Record<string, unknown>>('select * from organizations order by id')).rows
    await t.test('installation is additive, does not guess legal names, and reruns without writes', async () => {
      await db.exec(migration)
      assert.deepEqual(await businessSnapshot(), original)
      const after = (await db.query<Record<string, unknown>>('select * from organizations order by id')).rows
      assert.deepEqual(after.map(({ legal_name, legal_name_version, ...rest }) => {
        assert.equal(legal_name, null); assert.equal(legal_name_version, 0); return rest
      }), originalOrg)
      await db.exec(migration)
      assert.deepEqual((await db.query('select * from organizations order by id')).rows, after)
    })
    await t.test('only service RPCs mutate; clients cannot write tables or invoke RPCs', async () => {
      for (const role of ['anon', 'authenticated'] as const) await asRole(db, role, async () => {
        await assert.rejects(save(db, actor, org), /permission denied/)
        await assert.rejects(legalName(db, actor, org), /permission denied/)
        await assert.rejects(db.exec('delete from organization_sender_profiles'), /permission denied/)
        await assert.rejects(db.exec('select * from organization_sender_profile_audit'), /permission denied/)
      })
      await asRole(db, 'service_role', async () => {
        await assert.rejects(db.exec('delete from organization_sender_profiles'), /permission denied/)
        await assert.rejects(db.exec('delete from organization_sender_profile_audit'), /permission denied/)
      })
    })
    await t.test('outsiders, inspectors, inactive admins and admins of another org cannot write', async () => {
      for (const denied of [outsider, inspector, otherAdmin, randomUUID()]) {
        await assert.rejects(save(db, denied, org), /ORG_ADMIN_REQUIRED/)
        await assert.rejects(legalName(db, denied, org), /ORG_ADMIN_REQUIRED/)
      }
      await db.query('update org_members set is_active=false where org_id=$1 and profile_id=$2', [org, actor])
      await assert.rejects(save(db, actor, org), /ORG_ADMIN_REQUIRED/)
      await db.query('update org_members set is_active=true where org_id=$1 and profile_id=$2', [org, actor])
      // These fixture updates exercise revocation; exclude their trigger timestamp
      // from later preservation checks by refreshing the expected fixture state.
      original.splice(0, original.length, ...await businessSnapshot())
    })
    await t.test('legal name has independent optimistic version; company name/document fields stay unchanged', async () => {
      await asRole(db, 'service_role', () => legalName(db, actor, org))
      await assert.rejects(legalName(db, actor, org, 'A later conflicting write'), /ORG_CONFLICT/)
      await legalName(db, actor, org, 'Legal company AB', 1)
      assert.deepEqual((await db.query('select legal_name,legal_name_version from organizations where id=$1', [org])).rows,
        [{ legal_name: 'Legal company AB', legal_name_version: 1 }])
      assert.deepEqual((await db.query<Record<string, unknown>>('select * from organizations order by id')).rows.map(row => without(row, ['legal_name', 'legal_name_version', 'updated_at'])),
        originalOrg.map(row => without(row, ['updated_at'])))
      for (const name of [null, '', 'Bad\nname', 'a'.repeat(241)]) await assert.rejects(legalName(db, actor, org, name, 1), /ORG_INPUT_INVALID/)
    })
    const sender = randomUUID()
    await t.test('creates sender only, normalizes exact retry, refuses changed create retry', async () => {
      await asRole(db, 'service_role', () => save(db, actor, org, sender))
      await save(db, actor, org, sender, 0, values(' Inspection brand '))
      await assert.rejects(save(db, actor, org, sender, 0, values('Not the same payload')), /ORG_CONFLICT/)
      assert.equal((await db.query<{ n: number }>('select count(*)::int as n from organization_sender_profiles')).rows[0].n, 1)
      assert.equal((await db.query<{ n: number }>("select count(*)::int as n from organization_sender_profile_audit where action='sender_profile_created'")).rows[0].n, 1)
      assert.deepEqual(await businessSnapshot(), original)
    })
    await t.test('RLS permits active same-org members only', async () => {
      for (const [viewer, count] of [[actor, 1], [inspector, 1], [otherAdmin, 0], [outsider, 0]] as const) {
        await db.query("select set_config('request.jwt.claim.sub',$1,false)", [viewer])
        const result = await asRole(db, 'authenticated', () => db.query('select * from organization_sender_profiles'))
        assert.equal(result.rows.length, count)
      }
      await db.query('update org_members set is_active=false where org_id=$1 and profile_id=$2', [org, inspector])
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [inspector])
      assert.equal((await asRole(db, 'authenticated', () => db.query('select * from organization_sender_profiles'))).rows.length, 0)
      await db.query('update org_members set is_active=true where org_id=$1 and profile_id=$2', [org, inspector])
      original.splice(0, original.length, ...await businessSnapshot())
    })
    await t.test('strict schema and protected identity fields cannot be injected', async () => {
      for (const input of [null, [], {}, { ...values(), orgId: otherOrg }, { ...values(), organizationNumber: '5592810823' },
        { ...values(), role: 'admin' }, { ...values(), isDefault: true }, { ...values(), name: '' }, { ...values(), name: 'bad\nname' },
        { ...values(), name: 'a'.repeat(241) }, { ...values(), email: 'invalid' }, { ...values(), website: 'javascript:alert(1)' },
        { ...values(), website: 'https://user:secret@example.test' }, { ...values(), isActive: 'true' }, { ...values(), isActive: null }]) {
        await assert.rejects(save(db, actor, org, randomUUID(), 0, input), /ORG_INPUT_INVALID/)
      }
    })
    await t.test('name collisions include archived profiles but never prevent separate organizations using same brand', async () => {
      await assert.rejects(save(db, actor, org, randomUUID(), 0, values('inspection BRAND')), /ORG_SENDER_NAME_EXISTS/)
      await save(db, otherAdmin, otherOrg)
      await assert.rejects(save(db, otherAdmin, otherOrg, sender), /ORG_CONFLICT/)
    })
    await t.test('logo must be immutable organization-owned stored object, not arbitrary URL/path or guessed upload', async () => {
      const logo = `organizations/${org}/logo-${randomUUID()}.png`
      for (const path of [logo, `organizations/${otherOrg}/logo-${randomUUID()}.png`, 'https://example.test/logo.png', `organizations/${org}/../logo.png`]) {
        await assert.rejects(save(db, actor, org, sender, 1, { ...values(), logoPath: path }), /ORG_SENDER_MEDIA_INVALID/)
      }
      await db.query('insert into storage.objects(bucket_id,name) values($1,$2)', ['property-media', logo])
      await save(db, actor, org, sender, 1, { ...values(), logoPath: logo })
      assert.equal((await db.query<{ version: number }>('select version from organization_sender_profiles where id=$1', [sender])).rows[0].version, 2)
    })
    await t.test('stale saves and creation retries cannot overwrite later changes or archives; restore is explicit', async () => {
      await assert.rejects(save(db, actor, org, sender, 1), /ORG_CONFLICT/)
      await assert.rejects(save(db, actor, org, sender, 0), /ORG_CONFLICT/)
      await save(db, actor, org, sender, 2, { ...values(), isActive: false })
      await assert.rejects(save(db, actor, org, sender, 0), /ORG_CONFLICT/)
      await assert.rejects(save(db, actor, org, randomUUID(), 0), /ORG_SENDER_NAME_EXISTS/)
      await save(db, actor, org, sender, 3)
      assert.deepEqual((await db.query('select version,is_active from organization_sender_profiles where id=$1', [sender])).rows,
        [{ version: 4, is_active: true }])
      assert.deepEqual((await db.query<{ action: string }>("select action from organization_sender_profile_audit where sender_profile_id=$1 order by version", [sender])).rows.map(row => row.action),
        ['sender_profile_created', 'sender_profile_updated', 'sender_profile_archived', 'sender_profile_restored'])
    })
    await t.test('limit counts archived profiles and still accepts exact retries', async () => {
      for (let i = 2; i <= 20; i++) await save(db, actor, org, randomUUID(), 0, values(`Brand ${i}`))
      await save(db, actor, org, sender, 4, { ...values(), isActive: false })
      await assert.rejects(save(db, actor, org, randomUUID(), 0, values('Brand 21')), /ORG_SENDER_LIMIT/)
      const existing = (await db.query<{ id: string }>("select id from organization_sender_profiles where org_id=$1 and name='Brand 20'", [org])).rows[0].id
      await save(db, actor, org, existing, 0, values('Brand 20'))
    })
    await t.test('rerun preserves saved senders, legal identity and all unrelated business state', async () => {
      const before = (await db.query('select * from organization_sender_profiles order by id')).rows
      await db.exec(migration)
      assert.deepEqual((await db.query('select * from organization_sender_profiles order by id')).rows, before)
      assert.deepEqual(await businessSnapshot(), original)
    })
    await t.test('installation fails closed when inherited privileges would expose service functions', async () => {
      await db.exec('grant service_role to authenticated')
      await assert.rejects(db.exec(migration), /ORG_SENDER_ACL_INVALID/)
      await db.exec('rollback; revoke service_role from authenticated')
    })
  } finally { await db.close() }
})
