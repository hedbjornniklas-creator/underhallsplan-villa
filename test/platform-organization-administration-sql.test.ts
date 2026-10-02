import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID, createHash } from 'node:crypto'
import type { PGlite } from '@electric-sql/pglite'
// @ts-expect-error Node strip-types requires the TypeScript extension.
import { platformOrganizationDb, sql, person, organization, grant, asRole } from './helpers/platform-organization-db.ts'

const migration = sql('2026-10-02_01_platform_organization_administration.sql')
const TU = 'technical_investigations'
type State = { role: 'admin' | 'inspector'; isActive: boolean; modules: string[] }
const state = (role: State['role'] = 'inspector', modules: string[] = [TU], isActive = true): State => ({role,isActive,modules})
const create = (db: PGlite, actor: string, adminProfileId: string, request = randomUUID(), patch: Record<string,unknown> = {}) =>
  db.query<{result:{saved:boolean;organizationId:string}}>('select platform_organization_create($1,$2,$3) as result',
    [actor,request,JSON.stringify({name:'New organization',organizationNumber:null,adminProfileId,modules:[TU],...patch})])
const member = (db: PGlite, actor: string, org: string, profile: string, expected: State | null, values: State) =>
  db.query('select platform_organization_member_save($1,$2,$3,$4,$5)', [actor,org,profile,expected === null ? null : JSON.stringify(expected),JSON.stringify(values)])
const modules = (db: PGlite, actor: string, org: string, expected: string[], values: string[]) =>
  db.query('select platform_organization_modules_save($1,$2,$3,$4)',[actor,org,expected,values])
const activeGrants = async (db: PGlite, profile: string, org: string) => (await db.query<{key:string}>(
  `select m.key from platform_access_assignments a join platform_modules m on m.id=a.module_id
   join platform_products p on p.id=a.product_id and p.key='dashboard'
   where a.profile_id=$1 and a.scope_type='organization' and a.scope_id=$2 and a.is_active order by m.key`,[profile,org])).rows.map(row=>row.key)
const orgId = (result: Awaited<ReturnType<typeof create>>) => result.rows[0].result.organizationId

test('central organization administration database lifecycle and authorization', async t => {
  const db = await platformOrganizationDb()
  try {
    const operator = await person(db), firstAdmin = await person(db), existingOrg = await organization(db,firstAdmin)
    await grant(db,operator)
    const oldGlobal = await grant(db,firstAdmin,{product:'dashboard',module:TU,role:'inspector'})
    const preexistingTables = ['organizations','org_members','profiles','profile_org_cards','organization_enabled_modules',
      'platform_access_assignments','organization_invitations','fortnox_connections']
    const snapshot = async () => Promise.all(preexistingTables.map(async table => (
      await db.query(`select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]'::jsonb) as rows from ${table} t`)).rows))
    await t.test('installation and repeated installation do not rewrite existing data or autogrant', async () => {
      const before = await snapshot()
      await db.exec(migration)
      assert.deepEqual(await snapshot(),before)
      await db.exec(migration)
      assert.deepEqual(await snapshot(),before)
      assert.equal((await db.query('select * from platform_organization_audit')).rows.length,0)
      assert.equal((await db.query('select * from platform_organization_create_requests')).rows.length,0)
    })

    await t.test('anon/auth cannot execute wrappers and service cannot invoke helpers or mutate audit/idempotency records', async () => {
      for (const role of ['anon','authenticated'] as const) await asRole(db,role,async()=> {
        await assert.rejects(create(db,operator,firstAdmin),/permission denied/)
        await assert.rejects(member(db,operator,existingOrg,firstAdmin,null,state()),/permission denied/)
        await assert.rejects(modules(db,operator,existingOrg,[],[TU]),/permission denied/)
        await assert.rejects(db.query('select * from platform_organization_audit'),/permission denied/)
        await assert.rejects(db.query('select * from platform_organization_create_requests'),/permission denied/)
      })
      await asRole(db,'service_role',async()=> {
        await assert.rejects(db.query('select platform_organization_assert_admin($1)',[operator]),/permission denied/)
        await assert.rejects(db.query('select platform_organization_assert_managed_target($1)',[firstAdmin]),/permission denied/)
        await assert.rejects(db.query('select organization_apply_member_grants($1,$2,$3,$4,true,$5)',[operator,existingOrg,firstAdmin,'admin',[TU]]),/permission denied/)
        await assert.rejects(db.query('delete from platform_organization_audit'),/permission denied/)
        await assert.rejects(db.query('delete from platform_organization_create_requests'),/permission denied/)
      })
      const secured = (await db.query<{relname:string;relrowsecurity:boolean}>(`select relname,relrowsecurity from pg_class
        where relname in ('platform_organization_audit','platform_organization_create_requests')`)).rows
      assert.equal(secured.length,2); assert.ok(secured.every(row=>row.relrowsecurity))
    })

    await t.test('org admins and scoped/expired/inactive central grants cannot authorize platform writes', async () => {
      const actors = [firstAdmin, await person(db), await person(db), await person(db)]
      await grant(db,actors[1],{scope:'organization',scopeId:existingOrg})
      await grant(db,actors[2],{expiresAt:new Date(Date.now()-86400000).toISOString()})
      await grant(db,actors[3],{active:false})
      for (const actor of actors) await asRole(db,'service_role',async()=> {
        await assert.rejects(create(db,actor,firstAdmin),/ORG_PLATFORM_ADMIN_REQUIRED/)
        await assert.rejects(member(db,actor,existingOrg,firstAdmin,state('admin',[]),state('admin',[])),/ORG_PLATFORM_ADMIN_REQUIRED/)
        await assert.rejects(modules(db,actor,existingOrg,[],[TU]),/ORG_PLATFORM_ADMIN_REQUIRED/)
      })
      await assert.rejects(create(db,randomUUID(),firstAdmin),/ORG_PLATFORM_ADMIN_REQUIRED/)
    })

    await t.test('legacy admin fallback matches existing access helper and valid normalized access takes precedence', async () => {
      const legacy = await person(db,true), scopedLegacy = await person(db,true), wrongModule = await person(db,true)
      const expiredLegacy = await person(db,true), productWide = await person(db,true)
      await grant(db,scopedLegacy,{scope:'organization',scopeId:existingOrg})
      await grant(db,wrongModule,{module:'users'})
      await grant(db,expiredLegacy,{expiresAt:new Date(Date.now()-86400000).toISOString()})
      await grant(db,productWide,{module:null})
      for (const actor of [legacy,expiredLegacy]) {
        const created = await asRole(db,'service_role',()=>create(db,actor,firstAdmin,randomUUID(),{modules:[]}))
        assert.equal(created.rows[0].result.saved,true)
      }
      for (const actor of [scopedLegacy,wrongModule,productWide]) await assert.rejects(create(db,actor,firstAdmin),/ORG_PLATFORM_ADMIN_REQUIRED/)
    })

    let createdOrg = ''
    await t.test('creation atomically enables organization TU, grants admin only and preserves existing defaults, globals and personal data', async () => {
      createdOrg = orgId(await asRole(db,'service_role',()=>create(db,operator,firstAdmin)))
      const created = (await db.query<{role:string;is_active:boolean;is_default:boolean}>(
        'select role,is_active,is_default from org_members where org_id=$1 and profile_id=$2',[createdOrg,firstAdmin])).rows[0]
      assert.deepEqual(created,{role:'admin',is_active:true,is_default:false})
      assert.deepEqual(await activeGrants(db,firstAdmin,createdOrg),['admin'])
      assert.equal((await db.query<{is_active:boolean}>('select is_active from organization_enabled_modules where org_id=$1',[createdOrg])).rows[0].is_active,true)
      assert.equal((await db.query<{org_id:string}>('select org_id from org_members where profile_id=$1 and is_default',[firstAdmin])).rows[0].org_id,existingOrg)
      assert.equal((await db.query<{full_name:string}>('select full_name from profiles where id=$1',[firstAdmin])).rows[0].full_name,'Unchanged personal name')
      assert.equal((await db.query<{is_active:boolean}>('select is_active from platform_access_assignments where id=$1',[oldGlobal])).rows[0].is_active,true)
      assert.equal((await db.query('select * from org_members where org_id=$1 and profile_id=$2',[createdOrg,operator])).rows.length,0)
      assert.equal((await db.query<{profile_configured:boolean}>('select profile_configured from organizations where id=$1',[createdOrg])).rows[0].profile_configured,false)
      await assert.rejects(db.query('select organization_profile_save($1,$2,1,$3)',[operator,createdOrg,JSON.stringify({name:'Forged central bypass'})]),/ORG_ADMIN_REQUIRED/)
      await assert.rejects(db.query('select organization_member_update($1,$2,$3,$4)',[operator,createdOrg,firstAdmin,JSON.stringify(state('admin'))]),/ORG_ADMIN_REQUIRED/)
    })

    await t.test('creation retries are idempotent and changed payload/actor conflict without creating extra organizations', async () => {
      const request = randomUUID(), anotherOperator = await person(db)
      await grant(db,anotherOperator)
      const first = await create(db,operator,firstAdmin,request)
      assert.deepEqual(await create(db,operator,firstAdmin,request),first)
      await assert.rejects(create(db,operator,firstAdmin,request,{name:'Changed'}),/ORG_CONFLICT/)
      await assert.rejects(create(db,operator,firstAdmin,request,{modules:[]}),/ORG_CONFLICT/)
      await assert.rejects(create(db,anotherOperator,firstAdmin,request),/ORG_CONFLICT/)
      assert.equal((await db.query('select * from platform_organization_audit where organization_id=$1',[orgId(first)])).rows.length,1)
      const stored = (await db.query<{request_fingerprint:string}>('select request_fingerprint from platform_organization_create_requests where request_id=$1',[request])).rows[0]
      assert.match(stored.request_fingerprint,/^[a-f0-9]{64}$/)
    })

    await t.test('empty modules writes explicit disabled entitlement but admin grant; first membership alone becomes default', async () => {
      const brandNew = await person(db), org = orgId(await create(db,operator,brandNew,randomUUID(),{modules:[]}))
      assert.deepEqual(await activeGrants(db,brandNew,org),['admin'])
      assert.equal((await db.query<{is_active:boolean}>('select is_active from organization_enabled_modules where org_id=$1',[org])).rows[0].is_active,false)
      assert.equal((await db.query<{is_default:boolean}>('select is_default from org_members where org_id=$1',[org])).rows[0].is_default,true)
      assert.equal((await db.query('select * from platform_access_assignments where profile_id=$1 and scope_type=$2',[brandNew,'global'])).rows.length,0)
    })

    await t.test('invalid create values or missing catalog/profile leave no orphan org, membership, request or audit', async () => {
      const before = await snapshot(), beforeRequests = (await db.query('select * from platform_organization_create_requests')).rows.length
      for (const patch of [{name:''},{organizationNumber:'111111-1111'},{modules:['inspections']},{modules:[TU,TU]},
        {modules:[null]},{adminProfileId:randomUUID()},{adminProfileId:'invalid'},{extra:'forbidden'}]) {
        await assert.rejects(create(db,operator,firstAdmin,randomUUID(),patch),/ORG_(?:INPUT_INVALID|MODULE_NOT_ENABLED|PROFILE_NOT_FOUND)/)
      }
      await db.exec("update platform_roles set is_active=false where key='inspector' and product_id=(select id from platform_products where key='dashboard')")
      await assert.rejects(create(db,operator,firstAdmin),/ORG_CATALOG_REQUIRED/)
      await db.exec("update platform_roles set is_active=true where key='inspector' and product_id=(select id from platform_products where key='dashboard')")
      assert.deepEqual(await snapshot(),before)
      assert.equal((await db.query('select * from platform_organization_create_requests')).rows.length,beforeRequests)
    })

    await t.test('legacy dashboard fallback requires review before first managed creation or membership write', async () => {
      const legacyMember = await person(db), legacyOrg = await organization(db,legacyMember)
      const legacyAdmin = await person(db,true)
      const before = await snapshot()
      const auditBefore = (await db.query('select count(*)::integer as n from platform_organization_audit')).rows
      const requestsBefore = (await db.query('select count(*)::integer as n from platform_organization_create_requests')).rows
      await asRole(db,'service_role',async()=> {
        for (const profile of [legacyMember,legacyAdmin]) {
          await assert.rejects(create(db,operator,profile),/ORG_LEGACY_ACCESS_REVIEW_REQUIRED/)
          await assert.rejects(member(db,operator,createdOrg,profile,null,state('inspector',[])),/ORG_LEGACY_ACCESS_REVIEW_REQUIRED/)
        }
        // Even an otherwise harmless edit is explicitly rejected until reviewed.
        await assert.rejects(member(db,operator,legacyOrg,legacyMember,state('admin',[]),state('admin',[])),/ORG_LEGACY_ACCESS_REVIEW_REQUIRED/)
      })
      assert.deepEqual(await snapshot(),before)
      assert.deepEqual((await db.query('select count(*)::integer as n from platform_organization_audit')).rows,auditBefore)
      assert.deepEqual((await db.query('select count(*)::integer as n from platform_organization_create_requests')).rows,requestsBefore)
    })

    await t.test('expired/unmanaged revoked dashboard grants do not erase the requirement to review legacy access', async () => {
      const legacy = await person(db), legacyOrg = await organization(db,legacy)
      const expired = await grant(db,legacy,{product:'dashboard',module:TU,role:'inspector',scope:'organization',scopeId:legacyOrg,
        expiresAt:new Date(Date.now()-86400000).toISOString()})
      await assert.rejects(create(db,operator,legacy),/ORG_LEGACY_ACCESS_REVIEW_REQUIRED/)
      await db.query("update platform_access_assignments set is_active=false,source_system='admin_access_management' where id=$1",[expired])
      await assert.rejects(member(db,operator,createdOrg,legacy,null,state('inspector',[])),/ORG_LEGACY_ACCESS_REVIEW_REQUIRED/)
      assert.equal((await db.query('select * from org_members where org_id=$1 and profile_id=$2',[createdOrg,legacy])).rows.length,0)
    })

    await t.test('existing managed dashboard history permits writes without restoring other revoked grants', async () => {
      for (const source of ['organization_administration','organization_admin_migration']) {
        const managed = await person(db), managedOrg = await organization(db,managed)
        const inactive = await grant(db,managed,{product:'dashboard',module:TU,role:'inspector',scope:'organization',scopeId:managedOrg,active:false})
        await db.query('update platform_access_assignments set source_system=$2 where id=$1',[inactive,source])
        const created = orgId(await create(db,operator,managed))
        assert.deepEqual(await activeGrants(db,managed,created),['admin'])
        await member(db,operator,createdOrg,managed,null,state('inspector',[]))
        assert.equal((await db.query<{is_active:boolean}>('select is_active from platform_access_assignments where id=$1',[inactive])).rows[0].is_active,false)
        assert.deepEqual(await activeGrants(db,managed,managedOrg),[])
      }
    })

    const colleague = await person(db)
    const colleagueOrg = await organization(db,colleague)
    const colleagueOtherGrant = await grant(db,colleague,{product:'dashboard',module:TU,role:'inspector',scope:'organization',scopeId:colleagueOrg})
    await t.test('central member add requires exact absence, preserves other organization and writes scoped modules', async () => {
      await asRole(db,'service_role',()=>member(db,operator,createdOrg,colleague,null,state()))
      assert.deepEqual(await activeGrants(db,colleague,createdOrg),[TU])
      assert.equal((await db.query<{org_id:string}>('select org_id from org_members where profile_id=$1 and is_default',[colleague])).rows[0].org_id,colleagueOrg)
      await assert.rejects(member(db,operator,createdOrg,colleague,null,state()),/ORG_CONFLICT/)
      await assert.rejects(member(db,operator,createdOrg,randomUUID(),null,state()),/ORG_PROFILE_NOT_FOUND/)
      const absent = await person(db)
      await assert.rejects(member(db,operator,createdOrg,absent,state(),state()),/ORG_CONFLICT/)
    })

    await t.test('membership compare-and-swap rejects stale role/active/modules and promotion keeps unrelated grants', async () => {
      const otherGrant = colleagueOtherGrant
      const nonTu = await grant(db,colleague,{product:'dashboard',module:'inspections',role:'inspector',scope:'organization',scopeId:createdOrg})
      await member(db,operator,createdOrg,colleague,state(),state('admin'))
      assert.deepEqual(await activeGrants(db,colleague,createdOrg),['admin','inspections',TU])
      await assert.rejects(member(db,operator,createdOrg,colleague,state(),state('inspector',[])),/ORG_CONFLICT/)
      await assert.rejects(member(db,operator,createdOrg,colleague,state('admin',[]),state('inspector',[])),/ORG_CONFLICT/)
      await assert.rejects(member(db,operator,createdOrg,colleague,state('admin',[TU],false),state('inspector',[])),/ORG_CONFLICT/)
      await member(db,operator,createdOrg,colleague,state('admin'),state('inspector',[]))
      assert.deepEqual(await activeGrants(db,colleague,createdOrg),['inspections'])
      for (const id of [otherGrant,nonTu]) assert.equal((await db.query<{is_active:boolean}>('select is_active from platform_access_assignments where id=$1',[id])).rows[0].is_active,true)
    })

    await t.test('membership CAS matches the API projection: a TU grant with the wrong role is not selected TU', async () => {
      const mismatched = await person(db)
      await member(db,operator,createdOrg,mismatched,null,state('inspector',[]))
      const wrongRoleGrant = await grant(db,mismatched,{
        product:'dashboard',module:TU,role:'dashboard_admin',scope:'organization',scopeId:createdOrg,
      })
      // The service lists personal TU only for an active exact inspector grant.
      await member(db,operator,createdOrg,mismatched,state('inspector',[]),state())
      assert.equal((await db.query<{is_active:boolean}>('select is_active from platform_access_assignments where id=$1',[wrongRoleGrant])).rows[0].is_active,false)
      const grants = (await db.query<{key:string}>(`select r.key from platform_access_assignments a
        join platform_roles r on r.id=a.role_id where a.profile_id=$1 and a.scope_id=$2 and a.is_active`,[mismatched,createdOrg])).rows
      assert.deepEqual(grants,[{key:'inspector'}])
    })

    await t.test('last admin cannot be removed; deactivation revokes only selected organization and preserves history', async () => {
      await assert.rejects(member(db,operator,createdOrg,firstAdmin,state('admin',[]),state('inspector',[])),/ORG_LAST_ADMIN/)
      await assert.rejects(member(db,operator,createdOrg,firstAdmin,state('admin',[]),state('admin',[],false)),/ORG_LAST_ADMIN/)
      await member(db,operator,createdOrg,colleague,state('inspector',[]),state('inspector',[],false))
      assert.deepEqual(await activeGrants(db,colleague,createdOrg),[])
      assert.deepEqual(await activeGrants(db,colleague,colleagueOrg),[TU])
      assert.equal((await db.query('select * from org_members where org_id=$1 and profile_id=$2',[createdOrg,colleague])).rows.length,1)
      await member(db,operator,createdOrg,colleague,state('inspector',[],false),state())
    })

    await t.test('member mutations reject unsupported/disabled modules and strict values atomically', async () => {
      const disabledAdmin = await person(db), disabledOrg = orgId(await create(db,operator,disabledAdmin,randomUUID(),{modules:[]}))
      await assert.rejects(member(db,operator,disabledOrg,colleague,null,state()),/ORG_MODULE_NOT_ENABLED/)
      await assert.rejects(member(db,operator,createdOrg,colleague,state(),state('inspector',['inspections'])),/ORG_MODULE_NOT_ENABLED/)
      await assert.rejects(member(db,operator,createdOrg,colleague,state(),state('inspector',[TU],false)),/ORG_INPUT_INVALID/)
      await assert.rejects(db.query('select platform_organization_member_save($1,$2,$3,$4,$5)',
        [operator,createdOrg,colleague,JSON.stringify(state()),JSON.stringify({...state(),extra:true})]),/ORG_INPUT_INVALID/)
      assert.deepEqual(await activeGrants(db,colleague,createdOrg),[TU])
    })

    await t.test('TU disable revokes exact scoped grants and pending TU invitations, preserving other access', async () => {
      await member(db,operator,createdOrg,firstAdmin,state('admin',[]),state('admin'))
      const pendingTuHash=createHash('sha256').update(randomUUID()).digest('hex')
      const pendingAdminHash=createHash('sha256').update(randomUUID()).digest('hex')
      for (const [email,hash,role,selected] of [['tu@example.test',pendingTuHash,'inspector',[TU]],['admin@example.test',pendingAdminHash,'admin',[]]] as const) {
        await db.query('select organization_invitation_create($1,$2,$3)',[firstAdmin,createdOrg,JSON.stringify({
          requestId:randomUUID(),email,fullName:'Invited name',role,modules:selected,tokenHash:hash,
          expiresAt:new Date(Date.now()+86400000).toISOString(),
        })])
      }
      const nonTu=await grant(db,firstAdmin,{product:'dashboard',module:'inspections',role:'inspector',scope:'organization',scopeId:createdOrg})
      await asRole(db,'service_role',()=>modules(db,operator,createdOrg,[TU],[]))
      assert.deepEqual(await activeGrants(db,firstAdmin,createdOrg),['admin','inspections'])
      assert.deepEqual(await activeGrants(db,colleague,createdOrg),[])
      assert.deepEqual(await activeGrants(db,colleague,colleagueOrg),[TU])
      for (const id of [oldGlobal,nonTu]) assert.equal((await db.query<{is_active:boolean}>('select is_active from platform_access_assignments where id=$1',[id])).rows[0].is_active,true)
      const pending=(await db.query<{token_hash:string;status:string;revision:number}>('select token_hash,status,revision from organization_invitations where org_id=$1',[createdOrg])).rows
      assert.equal(pending.find(r=>r.token_hash===pendingTuHash)?.status,'revoked')
      assert.equal(pending.find(r=>r.token_hash===pendingTuHash)?.revision,1)
      assert.equal(pending.find(r=>r.token_hash===pendingAdminHash)?.status,'pending')
      await assert.rejects(modules(db,operator,createdOrg,[TU],[]),/ORG_CONFLICT/)
      await modules(db,operator,createdOrg,[],[TU])
      assert.deepEqual(await activeGrants(db,colleague,createdOrg),[])
      assert.equal((await db.query<{status:string}>('select status from organization_invitations where token_hash=$1',[pendingTuHash])).rows[0].status,'revoked')
      await member(db,operator,createdOrg,colleague,state('inspector',[]),state())
      assert.deepEqual(await activeGrants(db,colleague,createdOrg),[TU])
    })

    await t.test('enable/disable supports explicit legacy-off marker and validates strict modules and catalog', async () => {
      const legacyOrg=await organization(db,firstAdmin)
      await modules(db,operator,legacyOrg,[],[])
      assert.equal((await db.query<{is_active:boolean}>('select is_active from organization_enabled_modules where org_id=$1',[legacyOrg])).rows[0].is_active,false)
      await modules(db,operator,legacyOrg,[],[])
      await assert.rejects(modules(db,operator,legacyOrg,[],['inspections']),/ORG_MODULE_NOT_ENABLED/)
      await assert.rejects(modules(db,operator,legacyOrg,[],[TU,TU]),/ORG_MODULE_NOT_ENABLED/)
      await assert.rejects(modules(db,operator,randomUUID(),[],[TU]),/ORG_NOT_FOUND/)
      await db.exec("update platform_modules set is_active=false where key='technical_investigations'")
      await assert.rejects(modules(db,operator,legacyOrg,[],[TU]),/ORG_CATALOG_REQUIRED/)
      await db.exec("update platform_modules set is_active=true where key='technical_investigations'")
      assert.equal((await db.query<{is_active:boolean}>('select is_active from organization_enabled_modules where org_id=$1',[legacyOrg])).rows[0].is_active,false)
    })

    await t.test('strict SQL boundaries reject null/malformed values rather than relying on the HTTP parser', async () => {
      const fresh = await person(db)
      for (const values of [null,[],{}, {name:'Test',adminProfileId:fresh,modules:null},
        {name:'Test',adminProfileId:fresh,modules:'technical_investigations'},
        {name:'x'.repeat(241),adminProfileId:fresh,modules:[]},
        {name:'Test',adminProfileId:fresh,modules:[1]}]) {
        await assert.rejects(db.query('select platform_organization_create($1,$2,$3)',[operator,randomUUID(),JSON.stringify(values)]),/ORG_INPUT_INVALID/)
      }
      const maxName=orgId(await create(db,operator,fresh,randomUUID(),{name:'x'.repeat(240),modules:[]}))
      assert.equal((await db.query<{name:string}>('select name from organizations where id=$1',[maxName])).rows[0].name.length,240)
      await assert.rejects(db.query('select platform_organization_create($1,null,$2)',[operator,JSON.stringify({name:'Test',adminProfileId:fresh,modules:[]})]),/ORG_INPUT_INVALID/)
      await assert.rejects(db.query('select platform_organization_modules_save($1,$2,null,$3)',[operator,createdOrg,[]]),/ORG_INPUT_INVALID/)
      await assert.rejects(db.query('select platform_organization_modules_save($1,$2,$3,null)',[operator,createdOrg,[TU]]),/ORG_INPUT_INVALID/)
      await assert.rejects(db.query('select platform_organization_modules_save($1,$2,$3,$4)',[operator,createdOrg,[TU],[null]]),/ORG_MODULE_NOT_ENABLED/)
      await assert.rejects(db.query('select platform_organization_modules_save($1,$2,$3,array[array[$4]])',[operator,createdOrg,[TU],TU]),/ORG_INPUT_INVALID/)
      for (const expected of [null,'wrong',[],{role:'admin',isActive:'true',modules:[]},{role:'admin',isActive:true,modules:[],extra:true}]) {
        if (expected===null) continue // SQL NULL has the documented add-if-absent meaning.
        await assert.rejects(db.query('select platform_organization_member_save($1,$2,$3,$4,$5)',[
          operator,maxName,fresh,JSON.stringify(expected),JSON.stringify(state('admin',[])),
        ]),/ORG_INPUT_INVALID/)
      }
    })

    await t.test('audit contains only identifiers/action metadata and records central successful operations', async () => {
      const columns=(await db.query<{column_name:string}>(`select column_name from information_schema.columns
        where table_schema='public' and table_name='platform_organization_audit' order by ordinal_position`)).rows.map(r=>r.column_name)
      assert.deepEqual(columns,['id','actor_profile_id','organization_id','target_profile_id','action','created_at'])
      const entries=(await db.query<{action:string;actor_profile_id:string}>('select action,actor_profile_id from platform_organization_audit where organization_id=$1',[createdOrg])).rows
      assert.ok(entries.some(r=>r.action==='organization_created'))
      assert.ok(entries.some(r=>r.action==='member_added'))
      assert.ok(entries.some(r=>r.action==='member_updated'))
      assert.ok(entries.some(r=>r.action==='modules_updated'))
      assert.ok(entries.every(r=>r.actor_profile_id===operator))
    })
  } finally { await db.close() }
})
