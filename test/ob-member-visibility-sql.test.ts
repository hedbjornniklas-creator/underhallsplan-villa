import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
// @ts-expect-error Node strip-types requires the TypeScript extension.
import { runtimeDb,asRole,create,ORG,OTHER,ACTOR,COLLEAGUE,sql } from './helpers/ob-organization-runtime-db.ts'
import type { PGlite } from '@electric-sql/pglite'

const migration=sql('2026-10-12_04_ob_member_visibility.sql')
const ADMIN='20000000-0000-4000-8000-000000000003'

async function grant(db:PGlite,actor=ACTOR,org:string|null=ORG,module='inspections',role='inspector') {
  return (await db.query<{id:string}>(`insert into platform_access_assignments(profile_id,product_id,module_id,role_id,scope_type,scope_id)
    select $1,p.id,m.id,r.id,$2,$3 from platform_products p,platform_modules m,platform_roles r
    where p.key='dashboard' and m.key=$4 and r.key=$5 returning id`,[actor,org?'organization':'global',org,module,role])).rows[0].id
}
async function visibilityDb(install=true) {
  const db=await runtimeDb()
  const administration=sql('2026-10-01_01_organization_administration.sql')
  await db.exec(administration.slice(administration.indexOf('create or replace function public.organization_assert_admin('),
    administration.indexOf('create or replace function public.organization_validate_values(')))
  await db.exec(`create function public.is_org_admin(uuid) returns boolean language sql security definer as $$
    select exists(select 1 from org_members where org_id=$1 and profile_id=auth.uid() and is_active and role='admin') $$;
    insert into profiles values('${ADMIN}'); insert into org_members values('${ORG}','${ADMIN}','admin',true);
    grant select,insert,update,delete on assignments,assignment_links to authenticated;`)
  const rls=sql('2026-02-20_03_assignments_rls.sql')
  await db.exec(rls.slice(rls.indexOf('drop policy if exists assignments_select_member'),
    rls.indexOf('-- assignment_acceptances')))
  await grant(db);await grant(db,COLLEAGUE);await grant(db,ACTOR,OTHER)
  if(install) await db.exec(migration)
  return db
}
async function setVisibility(db:PGlite,on:boolean,revision:number,profile=ACTOR,actor=ADMIN,org=ORG) {
  return asRole(db,'service_role',async()=>(await db.query<{value:{saved:boolean;canViewColleagues:boolean;revision:number}}>(
    'select organization_member_ob_visibility_set($1,$2,$3,$4,$5) value',[actor,org,profile,on,revision])).rows[0].value)
}
async function draft(db:PGlite,actor=ACTOR,org=ORG,type='OB',inspection:string|null=null) {
  return (await db.query<{id:string}>(`insert into assignments(org_id,responsible_profile_id,customer_email,assignment_type,inspection_id)
    values($1,$2,'private@example.test',$3,$4) returning id`,[org,actor,type,inspection])).rows[0].id
}
async function list(db:PGlite,actor=ACTOR,org=ORG,property:string|null=null) {
  return asRole(db,'service_role',async()=>(await db.query<{value:Array<{id:string;canEdit:boolean}>}>(
    'select ob_list_organization_inspections($1,$2,$3) value',[org,actor,property])).rows[0].value)
}
async function page(db:PGlite,actor=ACTOR,org=ORG) {
  return asRole(db,'authenticated',async()=>(await db.query<{value:{rows:Array<{canEdit:boolean;assignment:{id:string}|null;inspection:{id:string}|null}>;total:number}}>(
    'select ob_overview_page($1) value',[org])).rows[0].value,actor)
}
async function flag(db:PGlite,actor=ACTOR,org=ORG) {
  return (await db.query<{can_view_colleagues:boolean;revision:number}>('select * from organization_member_ob_visibility where org_id=$1 and profile_id=$2',[org,actor])).rows[0]
}

test('existing/new members default off; only actual org admin may opt in a member with actual OB access; CAS and audit persist',async()=>{
  const db=await visibilityDb()
  try {
    assert.equal(await flag(db),undefined)
    const newMember=randomUUID()
    await db.query('insert into profiles values($1)',[newMember])
    await db.query("insert into org_members values($1,$2,'inspector',true)",[ORG,newMember])
    assert.equal(await flag(db,newMember),undefined)
    await assert.rejects(setVisibility(db,true,0,ACTOR,COLLEAGUE),/ORG_ADMIN_REQUIRED/)
    await assert.rejects(setVisibility(db,true,0,newMember),/ORG_OB_VISIBILITY_MODULE_REQUIRED/)
    await grant(db,newMember,ORG,'technical_investigations')
    await assert.rejects(setVisibility(db,true,0,newMember),/ORG_OB_VISIBILITY_MODULE_REQUIRED/)
    await grant(db,newMember,ORG,'inspections','dashboard_admin')
    await assert.rejects(setVisibility(db,true,0,newMember),/ORG_OB_VISIBILITY_MODULE_REQUIRED/)
    assert.deepEqual(await setVisibility(db,true,0),{saved:true,canViewColleagues:true,revision:1})
    await assert.rejects(setVisibility(db,false,0),/ORG_CONFLICT/)
    assert.deepEqual(await setVisibility(db,false,1),{saved:true,canViewColleagues:false,revision:2})
    const audit=(await db.query<{updated_by:string;updated_at:string}>('select updated_by,updated_at from organization_member_ob_visibility')).rows[0]
    assert.equal(audit.updated_by,ADMIN);assert.ok(audit.updated_at)
    await db.exec(migration)
    assert.equal((await flag(db)).revision,2)
  } finally {await db.close()}
})

test('flag off lists own only; flag on adds same-org OB/STATUS with canEdit false in list and paginated overview',async()=>{
  const db=await visibilityDb()
  try {
    const emptyOwn=(await db.query<{id:string}>('insert into properties(owner) values($1) returning id',[ACTOR])).rows[0].id
    const emptyColleague=(await db.query<{id:string}>('insert into properties(owner) values($1) returning id',[COLLEAGUE])).rows[0].id
    assert.deepEqual(await list(db,ACTOR,ORG,emptyOwn),[])
    await assert.rejects(list(db,ACTOR,ORG,emptyColleague),/OB_ORGANIZATION_FORBIDDEN/)
    const own=await create(db),colleague=await create(db,ORG,COLLEAGUE),other=await create(db,OTHER)
    await db.query("update inspections set type='STATUS',inspection_variant='SB' where id=$1",[colleague.inspectionId])
    const ownAssignment=await draft(db,ACTOR,ORG,'OB',own.inspectionId)
    const colleagueAssignment=await draft(db,COLLEAGUE,ORG,'STATUS',colleague.inspectionId)
    const waiting=await draft(db,COLLEAGUE)
    await draft(db,ACTOR,OTHER,'OB',other.inspectionId)
    assert.deepEqual((await list(db)).map(x=>x.id),[own.inspectionId])
    let overview=await page(db)
    assert.equal(overview.total,1);assert.equal(overview.rows[0].assignment?.id,ownAssignment);assert.equal(overview.rows[0].canEdit,true)
    await assert.rejects(list(db,ACTOR,ORG,colleague.propertyId),/OB_ORGANIZATION_FORBIDDEN/)
    await asRole(db,'authenticated',async()=>{
      await assert.rejects(db.query('select ob_overview_item_flags($1,$2,null)',[ORG,colleagueAssignment]),/OB_OVERVIEW_ASSIGNMENT_FORBIDDEN/)
    })
    await setVisibility(db,true,0)
    assert.deepEqual(await list(db,ACTOR,ORG,emptyOwn),[])
    await assert.rejects(list(db,ACTOR,ORG,emptyColleague),/OB_ORGANIZATION_FORBIDDEN/)
    const summaries=await list(db)
    assert.equal(summaries.length,2);assert.equal(summaries.find(x=>x.id===colleague.inspectionId)?.canEdit,false)
    assert.equal((await list(db,ACTOR,ORG,colleague.propertyId)).length,1)
    overview=await page(db)
    assert.equal(overview.total,3)
    assert.equal(overview.rows.find(x=>x.assignment?.id===colleagueAssignment)?.canEdit,false)
    assert.equal(overview.rows.find(x=>x.assignment?.id===waiting)?.canEdit,false)
    assert.ok(!JSON.stringify(overview).includes(other.inspectionId))
    await asRole(db,'authenticated',async()=>{
      assert.equal((await db.query('select * from inspections where id=$1',[colleague.inspectionId])).rows.length,0)
      assert.equal((await db.query('select * from inspection_conditions where inspection_id=$1',[colleague.inspectionId])).rows.length,0)
      await assert.rejects(db.query("insert into inspection_conditions values($1,'none')",[colleague.inspectionId]),/row-level security/)
      assert.equal((await db.query("update inspections set inspector_name='forbidden' where id=$1 returning id",[colleague.inspectionId])).rows.length,0)
      await assert.rejects(db.query('select ob_overview_item_flags($1,$2,null)',[OTHER,colleagueAssignment]),/OB_OVERVIEW_ASSIGNMENT_FORBIDDEN/)
    })
    await setVisibility(db,false,1)
    assert.equal((await page(db)).total,1)
  } finally {await db.close()}
})

test('assignment/link RLS permits colleague reads only when enabled, never writes, and preserves unrelated types',async()=>{
  const db=await visibilityDb()
  try {
    await db.query("update org_members set role='admin' where profile_id=$1 and org_id=$2",[ACTOR,ORG])
    const own=await draft(db),colleague=await draft(db,COLLEAGUE),other=await draft(db,ACTOR,OTHER),uhp=await draft(db,COLLEAGUE,ORG,'UHP')
    const link=(await db.query<{id:string}>("insert into assignment_links(assignment_id,org_id,token_hash,expires_at) values($1,$2,repeat('a',64),now()+interval '1 day') returning id",[colleague,ORG])).rows[0].id
    for(const enabled of [false,true]) {
      if(enabled) await setVisibility(db,true,0)
      await asRole(db,'authenticated',async()=>{
        assert.equal((await db.query('select * from assignments where id=$1',[colleague])).rows.length,enabled?1:0)
        assert.equal((await db.query('select * from assignment_links where id=$1',[link])).rows.length,enabled?1:0)
        assert.equal((await db.query("update assignments set customer_name='No' where id=$1 returning id",[colleague])).rows.length,0)
        assert.equal((await db.query('delete from assignments where id=$1 returning id',[colleague])).rows.length,0)
        assert.equal((await db.query('update assignment_links set revoked_at=now() where id=$1 returning id',[link])).rows.length,0)
        assert.equal((await db.query('delete from assignment_links where id=$1 returning id',[link])).rows.length,0)
        await assert.rejects(db.query("insert into assignment_links(assignment_id,org_id,token_hash,expires_at) values($1,$2,repeat('b',64),now())",[colleague,ORG]),/row-level security/)
        await assert.rejects(draft(db,COLLEAGUE),/row-level security/)
        assert.equal((await db.query("update assignments set customer_name='Own' where id=$1 returning id",[own])).rows.length,1)
        assert.equal((await db.query("update assignments set customer_name='Other module' where id=$1 returning id",[uhp])).rows.length,1)
        assert.equal((await db.query('select * from assignments where id=$1',[other])).rows.length,1)
        await assert.rejects(db.query('update assignments set responsible_profile_id=$1 where id=$2',[COLLEAGUE,own]),/OB_ASSIGNMENT_OWNER_IMMUTABLE|row-level security/)
        // Actor owns this unlinked draft and has active access to both orgs;
        // membership never authorizes moving its identity or child metadata.
        await assert.rejects(db.query('update assignments set org_id=$1 where id=$2',[OTHER,own]),/OB_ASSIGNMENT_OWNER_IMMUTABLE/)
        await assert.rejects(db.query("update assignments set assignment_type='UHP' where id=$1",[own]),/OB_ASSIGNMENT_OWNER_IMMUTABLE/)
        // Draft OB/STATUS changes remain covered by their existing legal-profile
        // guard; neither type escapes this migration's ownership boundary.
        await db.query("update assignments set assignment_type='STATUS' where id=$1",[own])
        await db.query("update assignments set assignment_type='OB' where id=$1",[own])
      })
    }
    const colleagueInspection=await create(db,ORG,COLLEAGUE)
    const mismatched=await draft(db,ACTOR,ORG,'OB',colleagueInspection.inspectionId)
    await asRole(db,'authenticated',async()=>{
      assert.equal((await db.query("update assignments set customer_name='No' where id=$1 returning id",[mismatched])).rows.length,0)
    })
  } finally {await db.close()}
})

test('revoked member/module access resets opt-in and revision; reactivation does not restore it; temporary grant rewrites preserve valid opt-in',async()=>{
  const db=await visibilityDb()
  try {
    await setVisibility(db,true,0)
    await db.query('update org_members set is_active=false where org_id=$1 and profile_id=$2',[ORG,ACTOR])
    assert.equal((await flag(db)).can_view_colleagues,false);assert.equal((await flag(db)).revision,2)
    await assert.rejects(list(db),/OB_ORGANIZATION_FORBIDDEN/)
    await db.query('update org_members set is_active=true where org_id=$1 and profile_id=$2',[ORG,ACTOR])
    await assert.rejects(setVisibility(db,true,1),/ORG_CONFLICT/)
    await setVisibility(db,true,2)
    await db.exec('begin')
    await db.query('update platform_access_assignments set is_active=false where profile_id=$1 and scope_id=$2',[ACTOR,ORG])
    await db.query('update platform_access_assignments set is_active=true where profile_id=$1 and scope_id=$2',[ACTOR,ORG])
    await db.exec('commit')
    // BEFORE reactivation would otherwise mistake a temporary rewrite for expiry.
    assert.equal((await flag(db)).can_view_colleagues,true)
    await db.query('update platform_access_assignments set is_active=false where profile_id=$1 and scope_id=$2',[ACTOR,ORG])
    assert.equal((await flag(db)).can_view_colleagues,false)
    await db.query('update platform_access_assignments set is_active=true where profile_id=$1 and scope_id=$2',[ACTOR,ORG])
    assert.equal((await flag(db)).can_view_colleagues,false)
    await setVisibility(db,true,(await flag(db)).revision)
    await db.query("insert into organization_enabled_modules values($1,'inspections',false)",[ORG])
    assert.equal((await flag(db)).can_view_colleagues,false)
    await db.query('update organization_enabled_modules set is_active=true where org_id=$1',[ORG])
    assert.equal((await flag(db)).can_view_colleagues,false)
  } finally {await db.close()}
})

test('own legacy access is preserved; colleague opt-in requires real grants; global grants stop applying when an organization becomes managed',async()=>{
  const db=await visibilityDb()
  try {
    const own=await create(db)
    await db.query('delete from platform_access_assignments where profile_id=$1',[ACTOR])
    assert.equal((await list(db))[0].id,own.inspectionId)
    assert.equal((await page(db)).total,1)
    await assert.rejects(setVisibility(db,true,0),/ORG_OB_VISIBILITY_MODULE_REQUIRED/)
    await grant(db,ACTOR,null)
    assert.equal((await list(db))[0].id,own.inspectionId)
    await setVisibility(db,true,0)
    await db.query("insert into organization_enabled_modules values($1,'inspections',true)",[ORG])
    assert.equal((await flag(db)).can_view_colleagues,false)
    await assert.rejects(list(db),/OB_ORGANIZATION_FORBIDDEN/)
    const grantId=await grant(db)
    await setVisibility(db,true,2)
    await db.query("update platform_access_assignments set expires_at=now()-interval '1 second' where id=$1",[grantId])
    assert.equal((await flag(db)).can_view_colleagues,false)
    await db.query('update platform_access_assignments set expires_at=null where id=$1',[grantId])
    assert.equal((await flag(db)).can_view_colleagues,false)
  } finally {await db.close()}
})

test('client roles cannot call actor-parameter APIs or write visibility; unknown overview bodies and inherited ACL abort atomically',async()=>{
  const db=await visibilityDb()
  try {
    for(const role of ['anon','authenticated'] as const) await asRole(db,role,async()=>{
      await assert.rejects(db.query('select organization_member_ob_visibility_list($1,$2)',[ADMIN,ORG]),/permission denied/)
      await assert.rejects(db.query('select organization_member_ob_visibility_set($1,$2,$3,true,0)',[ADMIN,ORG,ACTOR]),/permission denied/)
      await assert.rejects(db.query('select ob_actor_can_view_colleagues($1,$2)',[ORG,ACTOR]),/permission denied/)
      await assert.rejects(db.query('select ob_inspection_visibility_access($1,$2,$3,false)',[randomUUID(),ORG,ACTOR]),/permission denied/)
      await assert.rejects(db.query('select * from organization_member_ob_visibility'),/permission denied/)
    })
    await asRole(db,'service_role',async()=>{
      await assert.rejects(db.query('insert into organization_member_ob_visibility(org_id,profile_id,can_view_colleagues) values($1,$2,true)',[ORG,ACTOR]),/permission denied/)
    })
  } finally {await db.close()}
  for(const scenario of ['body','inherited']) {
    const db=await visibilityDb(false)
    try {
      if(scenario==='body') {
        const f=(await db.query<{definition:string;prosrc:string}>("select pg_get_functiondef(oid) definition,prosrc from pg_proc where proname='ob_overview_page'")).rows[0]
        await db.exec(f.definition.replace(f.prosrc,f.prosrc+'\n-- changed'))
      } else await db.exec('create role unexpected_visibility; grant execute on function ob_list_organization_inspections(uuid,uuid,uuid) to unexpected_visibility; grant unexpected_visibility to authenticated')
      await assert.rejects(db.exec(migration),/OB_VISIBILITY_(OVERVIEW_REVIEW_REQUIRED|INHERITED_EXECUTE_REVIEW_REQUIRED)/)
      await db.exec('rollback')
      assert.equal((await db.query<{t:null}>("select to_regclass('organization_member_ob_visibility') t")).rows[0].t,null)
    } finally {await db.close()}
  }
})

test('assignment metadata and mail are bounded too; unrelated optional mail and other modules keep their existing policies',async()=>{
  const db=await visibilityDb()
  try {
    await db.exec(`grant select,insert,update,delete on outbound_messages,assignment_link_incidents to authenticated;
      create policy prior_mail_policy on outbound_messages for all to authenticated using(is_org_member(org_id)) with check(is_org_member(org_id));
      create policy prior_incident_policy on assignment_link_incidents for all to authenticated using(is_org_member(org_id)) with check(is_org_member(org_id));`)
    const own=await draft(db),colleague=await draft(db,COLLEAGUE),otherModule=await draft(db,COLLEAGUE,ORG,'UHP')
    for(const assignment of [own,colleague,otherModule,null]) await db.query(
      "insert into outbound_messages(org_id,assignment_id,recipient_email,subject) values($1,$2,'private@example.test','Private mail')",[ORG,assignment])
    await db.query('insert into assignment_link_incidents(assignment_id,org_id) values($1,$2)',[colleague,ORG])
    for(const enabled of [false,true]) {
      if(enabled) await setVisibility(db,true,0)
      await asRole(db,'authenticated',async()=>{
        assert.equal((await db.query('select * from outbound_messages')).rows.length,enabled?4:3)
        assert.equal((await db.query('select * from assignment_link_incidents')).rows.length,enabled?1:0)
        assert.equal((await db.query("update outbound_messages set subject='Blocked' where assignment_id=$1 returning id",[colleague])).rows.length,0)
        assert.equal((await db.query('update assignment_link_incidents set resolved_at=now() where assignment_id=$1 returning assignment_id',[colleague])).rows.length,0)
        await assert.rejects(db.query("insert into outbound_messages(org_id,assignment_id,recipient_email,subject) values($1,$2,'bad@example.test','No send')",[ORG,colleague]),/row-level security/)
      })
    }
    const inventory=(await db.query<{tablename:string;n:number}>("select tablename,count(*)::int n from pg_policies where policyname like 'ob_visibility_%' group by tablename")).rows
    assert.equal(inventory.length,8);assert.ok(inventory.every(x=>x.n===4))
  } finally {await db.close()}
})

test('administrator and opted-in reader cannot start or reissue another responsible profile assignment through service entrypoints',async()=>{
  const db=await visibilityDb()
  try {
    await db.query("update org_members set role='admin' where org_id=$1 and profile_id=$2",[ORG,ACTOR])
    await setVisibility(db,true,0)
    const ob=await draft(db,COLLEAGUE),status=await draft(db,COLLEAGUE,ORG,'STATUS')
    await asRole(db,'service_role',async()=>{
      await assert.rejects(db.query('select ob_start_assignment_inspection($1,$2,$3,$4)',[ob,ORG,ACTOR,'Early start reason']),/OB_ASSIGNMENT_FORBIDDEN/)
      await assert.rejects(db.query('select ob_start_status_assignment_inspection($1,$2,$3)',[status,ORG,ACTOR]),/OB_ASSIGNMENT_FORBIDDEN/)
      await assert.rejects(db.query('select ob_reissue_started_assignment($1,$2,$3)',[ob,ORG,ACTOR]),/OB_ASSIGNMENT_FORBIDDEN/)
    })
    assert.equal((await db.query('select * from inspections')).rows.length,0)
    const own=await draft(db)
    await asRole(db,'service_role',async()=>{
      // Real owner's authorization passes, then the existing approval rule applies.
      await assert.rejects(db.query('select ob_start_assignment_inspection($1,$2,$3,null)',[own,ORG,ACTOR]),/OB_START_NOT_ALLOWED/)
    })
  } finally {await db.close()}
})

test('a naturally expired grant cannot resurrect an old flag when renewed or replaced',async()=>{
  for(const renewal of ['update','insert']) {
    const db=await visibilityDb()
    try {
      await setVisibility(db,true,0)
      // Simulate elapsed wall-clock time without waiting: bypass row triggers only
      // in the isolated test DB, and make expiry later than the original opt-in.
      await db.query("update organization_member_ob_visibility set updated_at=now()-interval '2 days' where profile_id=$1",[ACTOR])
      await db.exec("set session_replication_role='replica'")
      await db.query("update platform_access_assignments set expires_at=now()-interval '1 day' where profile_id=$1 and scope_id=$2",[ACTOR,ORG])
      await db.exec("set session_replication_role='origin'")
      assert.equal((await flag(db)).can_view_colleagues,true)
      await asRole(db,'service_role',async()=>{
        assert.equal((await db.query<{ok:boolean}>('select ob_actor_can_view_colleagues($1,$2) ok',[ORG,ACTOR])).rows[0].ok,false)
      })
      if(renewal==='update') await db.query('update platform_access_assignments set expires_at=null where profile_id=$1 and scope_id=$2',[ACTOR,ORG])
      else await grant(db)
      assert.equal((await flag(db)).can_view_colleagues,false)
      assert.equal((await flag(db)).revision,2)
    } finally {await db.close()}
  }
})

test('operator pre/postflight are read-only, pass the reviewed installation, and detect privilege/policy drift',async()=>{
  const db=await visibilityDb(false)
  try {
    await db.exec('begin read only')
    const pre=(await db.query<{check_name:string;ok:boolean}>(sql('2026-10-12_04_ob_member_visibility_preflight.sql'))).rows
    await db.exec('commit')
    assert.deepEqual(pre.filter(x=>!x.ok),[])
    await db.exec(migration)
    await db.exec('begin read only')
    const post=(await db.query<{check_name:string;ok:boolean}>(sql('2026-10-12_04_ob_member_visibility_postflight.sql'))).rows
    await db.exec('commit')
    assert.deepEqual(post.filter(x=>!x.ok),[])
    await db.exec('grant execute on function organization_member_ob_visibility_set(uuid,uuid,uuid,boolean,integer) to authenticated; drop policy ob_visibility_update on assignment_acceptances')
    const drift=(await db.query<{check_name:string;ok:boolean}>(sql('2026-10-12_04_ob_member_visibility_postflight.sql'))).rows
    assert.deepEqual(drift.filter(x=>!x.ok).map(x=>x.check_name),['rpc_effective_acl_and_definer','assignment_child_rls_boundaries'])
  } finally {await db.close()}
})

test('admin visibility list is bounded, strictly eligible, org-scoped and returns missing-row CAS defaults',async()=>{
  const db=await visibilityDb()
  try {
    const listing=async(actor=ADMIN,org=ORG)=>asRole(db,'service_role',async()=>(await db.query<{
      value:Array<{profileId:string;canEnable:boolean;canViewColleagues:boolean;revision:number}>
    }>('select organization_member_ob_visibility_list($1,$2) value',[actor,org])).rows[0].value)
    await assert.rejects(listing(COLLEAGUE),/ORG_ADMIN_REQUIRED/)
    await assert.rejects(listing(ADMIN,OTHER),/ORG_ADMIN_REQUIRED/)
    const entries=await listing()
    assert.equal(entries.length,3)
    assert.deepEqual(entries.find(x=>x.profileId===ACTOR),{profileId:ACTOR,canEnable:true,canViewColleagues:false,revision:0})
    assert.equal(entries.find(x=>x.profileId===ADMIN)?.canEnable,false)
    const globalMember=randomUUID()
    await db.query('insert into profiles values($1)',[globalMember])
    await db.query("insert into org_members values($1,$2,'inspector',true)",[ORG,globalMember])
    await grant(db,globalMember,null)
    assert.equal((await listing()).find(x=>x.profileId===globalMember)?.canEnable,true)
    await setVisibility(db,true,0,globalMember)
    assert.deepEqual((await listing()).find(x=>x.profileId===globalMember),{
      profileId:globalMember,canEnable:true,canViewColleagues:true,revision:1,
    })
    await db.query("insert into organization_enabled_modules values($1,'inspections',true)",[ORG])
    assert.deepEqual((await listing()).find(x=>x.profileId===globalMember),{
      profileId:globalMember,canEnable:false,canViewColleagues:false,revision:2,
    })
    await db.exec('insert into profiles(id) select gen_random_uuid() from generate_series(1,1001)')
    await db.query("insert into org_members select $1,id,'inspector',true from profiles on conflict do nothing",[ORG])
    await assert.rejects(listing(),/ORG_DIRECTORY_TOO_LARGE/)
  } finally {await db.close()}
})
