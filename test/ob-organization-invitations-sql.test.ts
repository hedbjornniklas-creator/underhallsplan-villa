import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash, randomUUID } from 'node:crypto'
import type { PGlite } from '@electric-sql/pglite'
// @ts-expect-error Node strip-types requires the TypeScript extension.
import { platformOrganizationDb, sql, person, organization, grant, asRole } from './helpers/platform-organization-db.ts'

const OB = 'inspections', TU = 'technical_investigations'
const migration = sql('2026-10-08_03_ob_organization_invitations.sql')
const central = sql('2026-10-02_01_platform_organization_administration.sql')
const runtime = sql('2026-10-02_05_ob_organization_runtime.sql')
const runtimeAccess = runtime.slice(runtime.indexOf('create or replace function public.ob_actor_has_organization_access('),
  runtime.indexOf('create or replace function public.ob_assert_organization_inspection('))
type MemberState = { role: string; isActive: boolean; modules: string[] }
const state = (modules: string[] = [OB], role = 'inspector', isActive = true): MemberState => ({role,isActive,modules})
const token = () => createHash('sha256').update(randomUUID()).digest('hex')
const future = () => new Date(Date.now() + 86400000).toISOString()
const create = (db: PGlite, actor: string, admin: string, modules: string[] = [OB,TU], request = randomUUID()) =>
  db.query<{result:{organizationId:string}}>('select platform_organization_create($1,$2,$3) as result',
    [actor,request,JSON.stringify({name:'Test organization',organizationNumber:null,adminProfileId:admin,modules})])
const orgId = (value: Awaited<ReturnType<typeof create>>) => value.rows[0].result.organizationId
const modules = (db: PGlite, actor: string, org: string, expected: string[], selected: string[]) =>
  db.query('select platform_organization_modules_save($1,$2,$3,$4)',[actor,org,expected,selected])
const saveMember = (db: PGlite, actor: string, org: string, profile: string, expected: MemberState | null, value: MemberState) =>
  db.query('select platform_organization_member_save($1,$2,$3,$4,$5)',
    [actor,org,profile,expected === null ? null : JSON.stringify(expected),JSON.stringify(value)])
const updateMember = (db: PGlite, actor: string, org: string, profile: string, value: MemberState) =>
  db.query('select organization_member_update($1,$2,$3,$4)',[actor,org,profile,JSON.stringify(value)])
const inviteValues = (email: string, selected: string[] = [OB]) => ({requestId:randomUUID(),email,fullName:'Invited name',
  role:'inspector',modules:selected,tokenHash:token(),expiresAt:future()})
const invite = (db: PGlite, actor: string, org: string, values: ReturnType<typeof inviteValues>) =>
  db.query<{result:{id:string;modules:string[]}}>('select organization_invitation_create($1,$2,$3) as result',[actor,org,JSON.stringify(values)])
const accept = (db: PGlite, actor: string, hash: string) => db.query('select organization_invitation_accept($1,$2)',[actor,hash])
const email = (id: string) => `${id}@example.test`
const activeGrants = async (db: PGlite, profile: string, org: string) => (await db.query<{key:string}>(
  `select m.key from platform_access_assignments a join platform_modules m on m.id=a.module_id
   where a.profile_id=$1 and a.scope_type='organization' and a.scope_id=$2 and a.is_active
     and (a.expires_at is null or a.expires_at>now()) order by m.key`,[profile,org])).rows.map(row=>row.key)
const obAccess = async (db: PGlite, org: string, profile: string) => (await db.query<{allowed:boolean}>(
  'select ob_actor_has_organization_access($1,$2) as allowed',[org,profile])).rows[0].allowed

test('real SQL: ÖB organization invitations, module administration and two-organization account safety', async t => {
  const db = await platformOrganizationDb()
  try {
    await db.exec(central)
    await t.test('requires deployed ÖB runtime, atomically refusing an incomplete prerequisite', async () => {
      await assert.rejects(db.exec(migration),/ORG_OB_INVITATIONS_PREREQUISITES_REQUIRED/)
      await db.exec('rollback')
    })
    await db.exec(runtimeAccess)
    const operator = await person(db), admin = await person(db)
    await grant(db,operator)
    const preexisting = ['organizations','org_members','profiles','profile_org_cards','organization_enabled_modules',
      'platform_access_assignments','organization_invitations','platform_organization_audit','platform_organization_create_requests']
    const snapshot = () => Promise.all(preexisting.map(async table => (await db.query(
      `select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) as rows from ${table} t`)).rows))
    await t.test('installation and repeat installation do not enable modules or mutate any business data', async () => {
      const before = await snapshot()
      await db.exec(migration)
      assert.deepEqual(await snapshot(),before)
      await db.exec(migration)
      assert.deepEqual(await snapshot(),before)
    })

    await t.test('service-only entry points, private writers, and inherited privilege fail-closed', async () => {
      for (const role of ['anon','authenticated'] as const) await asRole(db,role,async () => {
        await assert.rejects(create(db,operator,admin),/permission denied/)
        await assert.rejects(accept(db,admin,token()),/permission denied/)
        await assert.rejects(invite(db,admin,randomUUID(),inviteValues(email(admin))),/permission denied/)
      })
      await asRole(db,'service_role',async () => {
        await assert.rejects(db.query('select organization_assert_ob_activation_reviewed($1)',[randomUUID()]),/permission denied/)
        await assert.rejects(db.query('select organization_apply_member_grants($1,$2,$3,$4,true,$5)',
          [admin,randomUUID(),admin,'admin',[OB]]),/permission denied/)
      })
      await db.exec('grant service_role to authenticated')
      await assert.rejects(db.exec(migration),/ORG_INVITATION_ACL_INVALID/)
      await db.exec('rollback; revoke service_role from authenticated')
      await db.exec(migration)
    })

    let org = ''
    await t.test('new org can enable ÖB+TU with no automatic personal inspection rights; sorted-set retries reuse it', async () => {
      const request = randomUUID()
      const first = await asRole(db,'service_role',()=>create(db,operator,admin,[TU,OB],request))
      org = orgId(first)
      assert.deepEqual(await create(db,operator,admin,[OB,TU],request),first)
      assert.deepEqual(await activeGrants(db,admin,org),['admin'])
      assert.equal(await obAccess(db,org,admin),false)
      const enabled = (await db.query<{module_key:string;is_active:boolean}>(
        'select module_key,is_active from organization_enabled_modules where org_id=$1 order by module_key',[org])).rows
      assert.deepEqual(enabled,[{module_key:OB,is_active:true},{module_key:TU,is_active:true}])
      await saveMember(db,operator,org,admin,state([],'admin'),state([OB,TU],'admin'))
      assert.equal(await obAccess(db,org,admin),true)
    })

    await t.test('strict whitelist rejects EB, duplicate, null and malformed module arrays before any write', async () => {
      const before = await snapshot()
      for (const selected of [[OB,OB],[TU,TU],['entrepreneur_inspections'],[OB,TU,'admin'],[null]]) {
        await assert.rejects(db.query('select platform_organization_modules_save($1,$2,$3,$4)',
          [operator,org,[OB,TU],selected]),/ORG_MODULE_NOT_ENABLED/)
        await assert.rejects(invite(db,admin,org,{...inviteValues('bad@example.test'),modules:selected as string[]}),/ORG_MODULE_NOT_ENABLED|ORG_INPUT_INVALID/)
      }
      await assert.rejects(db.query('select platform_organization_modules_save($1,$2,$3,array[array[$4]])',
        [operator,org,[OB,TU],OB]),/ORG_INPUT_INVALID/)
      for (const value of [null,'inspections',{},[1]]) await assert.rejects(db.query('select organization_invitation_create($1,$2,$3)',
        [admin,org,JSON.stringify({...inviteValues('bad@example.test'),modules:value})]),/ORG_INPUT_INVALID/)
      assert.deepEqual(await snapshot(),before)
    })

    await t.test('table constraints enforce whitelist and uniqueness even outside RPC parsing', async () => {
      const invited = inviteValues('constraint@example.test')
      await invite(db,admin,org,invited)
      for (const selected of [[OB,OB],[TU,TU],['entrepreneur_inspections'],[null]]) {
        await assert.rejects(db.query('update organization_invitations set modules=$2 where token_hash=$1',
          [invited.tokenHash,selected]),/violates check constraint/)
      }
      await assert.rejects(db.query("update organization_invitations set modules='[0:1]={inspections,inspections}'::text[] where token_hash=$1",
        [invited.tokenHash]),/violates check constraint/)
      await assert.rejects(db.query('insert into organization_enabled_modules(org_id,module_key) values($1,$2)',
        [org,'entrepreneur_inspections']),/violates check constraint/)
    })

    await t.test('resend retains both modules, checks revision, invalidates old token and cannot revive revoked invitation', async () => {
      const fresh = await person(db), values = inviteValues(email(fresh),[OB,TU])
      const invitationId = (await invite(db,admin,org,values)).rows[0].result.id
      const newHash = token()
      await asRole(db,'service_role',()=>db.query('select organization_invitation_change($1,$2,$3,0,$4,$5,$6)',
        [admin,org,invitationId,'resend',newHash,future()]))
      await assert.rejects(accept(db,fresh,values.tokenHash),/ORG_INVITE_INVALID/)
      await assert.rejects(db.query('select organization_invitation_change($1,$2,$3,0,$4,$5,$6)',
        [admin,org,invitationId,'resend',token(),future()]),/ORG_CONFLICT/)
      await accept(db,fresh,newHash)
      assert.deepEqual(await activeGrants(db,fresh,org),[OB,TU])
      const revoked = inviteValues('revoked-resend@example.test',[OB,TU])
      const revokedId = (await invite(db,admin,org,revoked)).rows[0].result.id
      await db.query('select organization_invitation_change($1,$2,$3,0,$4,null,null)',[admin,org,revokedId,'revoke'])
      await assert.rejects(db.query('select organization_invitation_change($1,$2,$3,1,$4,$5,$6)',
        [admin,org,revokedId,'resend',token(),future()]),/ORG_CONFLICT/)
    })

    await t.test('ÖB-only invitation reuses confirmed account in a second org without changing existing roles or defaults', async () => {
      const colleague = await person(db), otherOrg = await organization(db,colleague)
      const otherGrant = await grant(db,colleague,{product:'dashboard',module:TU,role:'inspector',scope:'organization',scopeId:otherOrg,expiresAt:future()})
      const before = (await db.query('select * from platform_access_assignments where id=$1',[otherGrant])).rows
      const values = inviteValues(`  ${email(colleague).toUpperCase()}  `)
      await invite(db,admin,org,values)
      await asRole(db,'service_role',()=>accept(db,colleague,values.tokenHash))
      assert.deepEqual(await activeGrants(db,colleague,org),[OB])
      assert.deepEqual((await db.query('select * from platform_access_assignments where id=$1',[otherGrant])).rows,before)
      assert.deepEqual((await db.query('select role,is_default from org_members where org_id=$1 and profile_id=$2',[otherOrg,colleague])).rows,
        [{role:'admin',is_default:true}])
      assert.deepEqual((await db.query('select role,is_default from org_members where org_id=$1 and profile_id=$2',[org,colleague])).rows,
        [{role:'inspector',is_default:false}])
      assert.equal((await db.query<{full_name:string}>('select full_name from profiles where id=$1',[colleague])).rows[0].full_name,'Unchanged personal name')
      assert.equal(await obAccess(db,org,colleague),true)
      await assert.rejects(db.query('select organization_profile_save($1,$2,1,$3)',[colleague,org,JSON.stringify({name:'Denied'})]),/ORG_ADMIN_REQUIRED/)
      await assert.rejects(invite(db,colleague,org,inviteValues('denied@example.test')),/ORG_ADMIN_REQUIRED/)
      await assert.rejects(invite(db,admin,org,inviteValues(email(colleague))),/ORG_MEMBER_EXISTS/)
    })

    await t.test('ÖB+TU invitation canonicalizes order and idempotency does not create duplicate invite/account', async () => {
      const fresh = await person(db), values = inviteValues(email(fresh),[TU,OB])
      const first = await invite(db,admin,org,values)
      assert.deepEqual(first.rows[0].result.modules,[OB,TU])
      assert.deepEqual(await invite(db,admin,org,{...values,modules:[OB,TU]}),first)
      await accept(db,fresh,values.tokenHash)
      assert.deepEqual(await activeGrants(db,fresh,org),[OB,TU])
      await updateMember(db,admin,org,fresh,state([]))
      await accept(db,fresh,values.tokenHash)
      assert.deepEqual(await activeGrants(db,fresh,org),[])
      assert.equal((await db.query('select * from profiles where id=$1',[fresh])).rows.length,1)
      assert.equal((await db.query('select * from org_members where org_id=$1 and profile_id=$2',[org,fresh])).rows.length,1)
      assert.equal(await obAccess(db,org,fresh),false)
    })

    await t.test('confirmed invited email is mandatory; fresh invited auth account receives profile only on acceptance', async () => {
      const fresh = randomUUID(), stranger = await person(db)
      await db.query('insert into auth.users values($1,$2,null)',[fresh,email(fresh)])
      const values = inviteValues(email(fresh))
      await invite(db,admin,org,values)
      await assert.rejects(accept(db,stranger,values.tokenHash),/ORG_INVITE_EMAIL_MISMATCH/)
      await assert.rejects(accept(db,fresh,values.tokenHash),/ORG_INVITE_EMAIL_MISMATCH/)
      assert.equal((await db.query('select * from profiles where id=$1',[fresh])).rows.length,0)
      await db.query('update auth.users set email_confirmed_at=now() where id=$1',[fresh])
      await accept(db,fresh,values.tokenHash)
      assert.deepEqual(await activeGrants(db,fresh,org),[OB])
    })

    await t.test('existing member race, expired/revoked invite, and expired inviter authority cannot overwrite membership', async () => {
      const colleague = await person(db), values = inviteValues(email(colleague))
      await invite(db,admin,org,values)
      await saveMember(db,operator,org,colleague,null,state([TU]))
      await assert.rejects(accept(db,colleague,values.tokenHash),/ORG_MEMBER_EXISTS/)
      assert.deepEqual(await activeGrants(db,colleague,org),[TU])
      for (const patch of ["expires_at=now()-interval '1 second'","status='revoked'"]) {
        const fresh = await person(db), next = inviteValues(email(fresh))
        await invite(db,admin,org,next)
        await db.query(`update organization_invitations set ${patch} where token_hash=$1`,[next.tokenHash])
        await assert.rejects(accept(db,fresh,next.tokenHash),/ORG_INVITE_INVALID/)
      }
      const secondAdmin = await person(db), invited = await person(db)
      await saveMember(db,operator,org,secondAdmin,null,state([],'admin'))
      const next = inviteValues(email(invited))
      await invite(db,secondAdmin,org,next)
      await updateMember(db,admin,org,secondAdmin,state([],'inspector'))
      await assert.rejects(accept(db,invited,next.tokenHash),/ORG_INVITE_INVALID/)
    })

    await t.test('last-admin, sorted-set member CAS, stale snapshot and expiration semantics are retained', async () => {
      await assert.rejects(saveMember(db,operator,org,admin,state([TU,OB],'admin'),state([])),/ORG_LAST_ADMIN/)
      const colleague = await person(db)
      await saveMember(db,operator,org,colleague,null,state([TU,OB]))
      await saveMember(db,operator,org,colleague,state([OB,TU]),state([OB,TU],'admin'))
      await assert.rejects(saveMember(db,operator,org,colleague,state([OB,TU]),state([OB])),/ORG_CONFLICT/)
      await db.query(`update platform_access_assignments set expires_at=now()-interval '1 second'
        where profile_id=$1 and scope_id=$2 and module_id=(select id from platform_modules where key=$3)`,[colleague,org,OB])
      await assert.rejects(saveMember(db,operator,org,colleague,state([OB,TU],'admin'),state([OB])),/ORG_CONFLICT/)
      await saveMember(db,operator,org,colleague,state([TU],'admin'),state([OB]))
      assert.deepEqual(await activeGrants(db,colleague,org),[OB])
      assert.equal(await obAccess(db,org,colleague),true)
      await updateMember(db,admin,org,colleague,state([],'inspector',false))
      assert.equal(await obAccess(db,org,colleague),false)
    })

    await t.test('disable ÖB revokes exact scoped grants and entire mixed pending invitation; enable never resurrects', async () => {
      const mixed = await person(db), tuOnly = await person(db), granted = await person(db)
      const mixedInvite = inviteValues(email(mixed),[OB,TU]), tuInvite = inviteValues(email(tuOnly),[TU])
      await invite(db,admin,org,mixedInvite); await invite(db,admin,org,tuInvite)
      await saveMember(db,operator,org,granted,null,state([OB,TU]))
      const other = await organization(db,granted)
      const otherGrant = await grant(db,granted,{product:'dashboard',module:OB,role:'inspector',scope:'organization',scopeId:other})
      const globalGrant = await grant(db,granted,{product:'dashboard',module:OB,role:'inspector'})
      await modules(db,operator,org,[TU,OB],[TU])
      assert.deepEqual(await activeGrants(db,granted,org),[TU])
      assert.equal(await obAccess(db,org,granted),false)
      const statuses = (await db.query<{token_hash:string;status:string}>(
        'select token_hash,status from organization_invitations where token_hash=any($1)',[[mixedInvite.tokenHash,tuInvite.tokenHash]])).rows
      assert.equal(statuses.find(v=>v.token_hash===mixedInvite.tokenHash)?.status,'revoked')
      assert.equal(statuses.find(v=>v.token_hash===tuInvite.tokenHash)?.status,'pending')
      for (const id of [otherGrant,globalGrant]) assert.equal((await db.query<{is_active:boolean}>(
        'select is_active from platform_access_assignments where id=$1',[id])).rows[0].is_active,true)
      await assert.rejects(accept(db,mixed,mixedInvite.tokenHash),/ORG_INVITE_INVALID/)
      await modules(db,operator,org,[TU],[OB,TU])
      assert.deepEqual(await activeGrants(db,granted,org),[TU])
      assert.equal(await obAccess(db,org,granted),false)
      await accept(db,tuOnly,tuInvite.tokenHash)
      assert.deepEqual(await activeGrants(db,tuOnly,org),[TU])
      await saveMember(db,operator,org,granted,state([TU]),state([OB,TU]))
      assert.equal(await obAccess(db,org,granted),true)
    })

    await t.test('existing unmanaged ÖB grants stay outside TU editing and no off marker is invented', async () => {
      const legacyAdmin = await person(db), unmanaged = await organization(db,legacyAdmin)
      const scoped = await grant(db,legacyAdmin,{product:'dashboard',module:OB,role:'inspector',scope:'organization',scopeId:unmanaged})
      await modules(db,operator,unmanaged,[],[TU])
      assert.equal((await db.query('select * from organization_enabled_modules where org_id=$1 and module_key=$2',[unmanaged,OB])).rows.length,0)
      await saveMember(db,operator,unmanaged,legacyAdmin,state([],'admin'),state([TU],'admin'))
      assert.equal((await db.query<{is_active:boolean}>('select is_active from platform_access_assignments where id=$1',[scoped])).rows[0].is_active,true)
      assert.equal(await obAccess(db,unmanaged,legacyAdmin),true)
      await modules(db,operator,unmanaged,[TU],[OB,TU])
      await saveMember(db,operator,unmanaged,legacyAdmin,state([OB,TU],'admin'),state([TU],'admin'))
      assert.equal(await obAccess(db,unmanaged,legacyAdmin),false)
    })

    await t.test('first ÖB activation refuses silent loss of legacy/global/product-wide access without inventing rights', async () => {
      for (const mode of ['legacy','global','product','wrong-scoped-role','expired-scoped'] as const) {
        const legacy = await person(db), legacyOrg = await organization(db,legacy)
        if (mode!=='legacy') await grant(db,legacy,{product:'dashboard',module:mode==='product' ? null : OB,
          role:mode==='wrong-scoped-role' ? 'dashboard_admin' : 'inspector',
          scope:mode==='wrong-scoped-role'||mode==='expired-scoped' ? 'organization' : 'global',scopeId:mode==='wrong-scoped-role'||mode==='expired-scoped' ? legacyOrg : null,
          expiresAt:mode==='expired-scoped' ? new Date(Date.now()-86400000).toISOString() : null})
        const before = await snapshot()
        await assert.rejects(modules(db,operator,legacyOrg,[],[OB]),/ORG_LEGACY_ACCESS_REVIEW_REQUIRED/)
        assert.deepEqual(await snapshot(),before)
      }
    })

    await t.test('acceptance and org-member editing refuse first managed grant that would suppress other legacy org access', async () => {
      const legacy = await person(db), legacyOrg = await organization(db,legacy)
      const values = inviteValues(email(legacy))
      await invite(db,admin,org,values)
      await assert.rejects(accept(db,legacy,values.tokenHash),/ORG_LEGACY_ACCESS_REVIEW_REQUIRED/)
      assert.equal((await db.query('select * from org_members where org_id=$1 and profile_id=$2',[org,legacy])).rows.length,0)
      await db.query('insert into organization_enabled_modules(org_id,module_key) values($1,$2)',[legacyOrg,TU])
      await assert.rejects(updateMember(db,legacy,legacyOrg,legacy,state([TU],'admin')),/ORG_LEGACY_ACCESS_REVIEW_REQUIRED/)
      assert.equal(await obAccess(db,legacyOrg,legacy),true)
    })

    await t.test('rerunning migration after real invitations and grants preserves every row and permission', async () => {
      const before = await snapshot()
      await db.exec(migration)
      assert.deepEqual(await snapshot(),before)
    })

    await t.test('read-only preflight reports review targets and all ten postflight checks pass', async () => {
      const before = await snapshot()
      const preflight = await db.exec(sql('2026-10-08_03_ob_organization_invitations_preflight.sql'))
      assert.ok(preflight.flatMap(result=>result.rows).some(row=>'profile_id' in row))
      const postflight = await db.exec(sql('2026-10-08_03_ob_organization_invitations_postflight.sql'))
      const checks = postflight.flatMap(result=>result.rows).filter(row=>'check_name' in row)
      assert.equal(checks.length,10)
      assert.deepEqual(checks.filter(row=>row.ok!==true),[])
      assert.deepEqual(await snapshot(),before)
    })
  } finally { await db.close() }
})
