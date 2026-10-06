import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID,createHash } from 'node:crypto'
// @ts-expect-error Node strip-types requires the TypeScript extension.
import { runtimeDb,runtimeSql,asRole,create,ORG,OTHER,ACTOR,COLLEAGUE,guardedFunctions,sql } from './helpers/ob-organization-runtime-db.ts'
import type { PGlite } from '@electric-sql/pglite'

async function counts(db:PGlite) {
  return (await db.query(`select (select count(*)::int from properties) properties,(select count(*)::int from inspections) inspections,
    (select count(*)::int from ob_organization_bindings) bindings,(select count(*)::int from ob_organization_binding_audit) audit,
    (select count(*)::int from ob_property_snapshot) snapshots,(select count(*)::int from inspection_conditions) conditions`)).rows[0]
}
async function entitlement(db:PGlite,enabled:boolean) {
  await db.query("insert into organization_enabled_modules values($1,'inspections',$2) on conflict(org_id,module_key) do update set is_active=excluded.is_active",[ORG,enabled])
}
async function grant(db:PGlite,{module='inspections',org=null,role='inspector',expires=null,active=true,source=null}:{module?:string;org?:string|null;role?:string;expires?:string|null;active?:boolean;source?:string|null}={}) {
  await db.query(`insert into platform_access_assignments(profile_id,product_id,module_id,role_id,scope_type,scope_id,is_active,expires_at,source_system)
    select $1,p.id,m.id,r.id,$2,$3,$4,$5,$6 from platform_products p,platform_modules m,platform_roles r
    where p.key='dashboard' and m.key=$7 and r.key=$8`,[ACTOR,org?'organization':'global',org,active,expires,source,module,role])
}
async function draft(db:PGlite,type='OB',org=ORG,actor=ACTOR) {
  return (await db.query<{id:string}>(`insert into assignments(org_id,responsible_profile_id,customer_email,customer_name,property_address,
    assignment_type,orderer_role,status,last_sent_at,preferred_date,price_amount,scope_description,accepted_at,booked_at,terms_version)
    values($1,$2,'test@example.test','Frozen customer','Frozen street',$3,'Säljare','booked',now(),'2026-10-02',1500,'Frozen scope',now(),now(),'v-test') returning id`,[org,actor,type])).rows[0].id
}
async function start(db:PGlite,id:string,type='OB',org=ORG,actor=ACTOR) {
  return asRole(db,'service_role',async()=>(await db.query<{value:{inspectionId:string;propertyId:string;orgId:string}}>(
    type==='STATUS'?'select ob_start_status_assignment_inspection($1,$2,$3) value':'select ob_start_assignment_inspection($1,$2,$3,null) value',[id,org,actor])).rows[0].value)
}

const moduleRoutines=[
  {name:'lock_eb_inspection_report',signature:'lock_eb_inspection_report(uuid,uuid,uuid,uuid)',family:'EB',hash:'ddacb4f12993d52144a8baf96036b7a3c97787d9513d66a6739c2ac60dfd6128'},
  {name:'unlock_eb_inspection_report',signature:'unlock_eb_inspection_report(uuid,uuid,uuid,text,uuid)',family:'EB',hash:'53acf58d007876c4e04b0ad43773b3a781e570ecc45409c36f53d57ad700aedc'},
  {name:'unlock_tu_investigation_report',signature:'unlock_tu_investigation_report(uuid,uuid,text,uuid)',family:'TU',hash:'afc13ddaf538df07ea14d6ac254cf6477e92254fbdd28c1d923284e67983a902'},
]
async function moduleParent(db:PGlite,family:string|null,type:string) {
  const property=(await db.query<{id:string}>('insert into properties(owner) values($1) returning id',[ACTOR])).rows[0].id
  return (await db.query<{id:string}>("insert into inspections(property_id,inspection_family,type,status) values($1,$2,$3,'draft') returning id",[property,family,type])).rows[0].id
}
async function moduleState(db:PGlite) {
  const result:Record<string,unknown>={}
  for(const table of ['inspections','eb_inspection_details','technical_investigation_details','inspection_lock_events',
    'ob_organization_bindings','ob_organization_binding_audit','inspection_report_links']) {
    result[table]=(await db.query(`select * from ${table} order by 1`)).rows
  }
  return result
}

test('real EB/TU routines preserve reviewed production bodies and valid locks, unlock reasons, events and published links',async()=>{
  const db=await runtimeDb(false)
  try {
    const originals=new Map<string,string>()
    for(const routine of moduleRoutines) {
      const body=(await db.query<{prosrc:string}>('select prosrc from pg_proc where oid=to_regprocedure($1)',[routine.signature])).rows[0].prosrc
      assert.equal(createHash('sha256').update(body.replace(/\r\n/g,'\n').trim()).digest('hex'),routine.hash)
      originals.set(routine.name,body)
    }
    await db.exec(runtimeSql)
    await db.exec(runtimeSql)
    for(const routine of moduleRoutines) {
      const body=(await db.query<{prosrc:string}>('select prosrc from pg_proc where oid=to_regprocedure($1)',[routine.signature])).rows[0].prosrc
      const guard=`  -- inspection-report-module-boundary-v1\n  perform public.assert_inspection_report_module(p_inspection_id,'${routine.family}');\n`
      assert.equal(body.split(guard).length,2)
      assert.equal(body.replace(guard,''),originals.get(routine.name))
    }
    const project=randomUUID()
    // Explicit family overrides old type. Null-family SB is deliberately not
    // guessed because it could mean the OB status variant.
    for(const [family,type] of [['EB','EB'],['EB','OB'],['EB','SB'],[null,'SLB'],[null,'FB'],[null,'GB'],[null,'KSB'],[null,'SAB']] as const) {
      const id=await moduleParent(db,family,type)
      await db.query('insert into eb_inspection_details(inspection_id,org_id,eb_project_id) values($1,$2,$3)',[id,ORG,project])
      await db.query("insert into inspection_report_links(inspection_id,org_id,pdf_base64,snapshot_payload) values($1,$2,'published-original','{\"original\":true}')",[id,ORG])
      const links=(await db.query('select * from inspection_report_links where inspection_id=$1',[id])).rows
      await asRole(db,'service_role',async()=>{
        const lock=(await db.query<{value:string}>('select lock_eb_inspection_report($1,$2,$3,$4) value',[ORG,project,id,ACTOR])).rows[0].value
        assert.ok(lock)
        assert.deepEqual((await db.query<{value:string}>('select lock_eb_inspection_report($1,$2,$3,$4) value',[ORG,project,id,ACTOR])).rows[0].value,lock)
        await assert.rejects(db.query('select unlock_eb_inspection_report($1,$2,$3,$4,$5)',[ORG,project,id,'short',ACTOR]),/UNLOCK_REASON_REQUIRED/)
        assert.deepEqual((await db.query<{value:string}>('select unlock_eb_inspection_report($1,$2,$3,$4,$5) value',[ORG,project,id,'Legitimate correction',ACTOR])).rows[0].value,lock)
      })
      assert.equal((await db.query<{locked_at:null}>('select locked_at from inspections where id=$1',[id])).rows[0].locked_at,null)
      assert.equal((await db.query('select * from inspection_lock_events where inspection_id=$1 and performed_by=$2',[id,ACTOR])).rows.length,1)
      assert.deepEqual((await db.query('select * from inspection_report_links where inspection_id=$1',[id])).rows,links)
    }
    for(const family of ['TU',null]) {
      const id=await moduleParent(db,family,'TU')
      await db.query('insert into technical_investigation_details(inspection_id,org_id,report_locked_at,report_locked_by) values($1,$2,now(),$3)',[id,ORG,ACTOR])
      await db.query('update inspections set locked_at=now(),locked_by=$2 where id=$1',[id,ACTOR])
      await db.query("insert into inspection_report_links(inspection_id,org_id,pdf_base64) values($1,$2,'frozen-TU')",[id,ORG])
      const links=(await db.query('select * from inspection_report_links where inspection_id=$1',[id])).rows
      await asRole(db,'service_role',async()=>{
        await assert.rejects(db.query('select unlock_tu_investigation_report($1,$2,$3,$4)',[ORG,id,'short',ACTOR]),/UNLOCK_REASON_REQUIRED/)
        await db.query('select unlock_tu_investigation_report($1,$2,$3,$4)',[ORG,id,'Legitimate correction',ACTOR])
      })
      assert.equal((await db.query<{locked_at:null}>('select locked_at from inspections where id=$1',[id])).rows[0].locked_at,null)
      assert.equal((await db.query<{report_locked_at:null}>('select report_locked_at from technical_investigation_details where inspection_id=$1',[id])).rows[0].report_locked_at,null)
      assert.equal((await db.query('select * from inspection_lock_events where inspection_id=$1',[id])).rows.length,1)
      assert.deepEqual((await db.query('select * from inspection_report_links where inspection_id=$1',[id])).rows,links)
    }
  } finally {await db.close()}
})

test('legacy inconsistent EB/TU detail rows cannot unlock or lock a bound OB, and all client RPC bypasses are denied',async()=>{
  const db=await runtimeDb(false)
  try {
    const id=await moduleParent(db,'OB','OB'),project=randomUUID()
    await db.query("insert into ob_organization_bindings(inspection_id,org_id,attribution_source) values($1,$2,'recorded_sources')",[id,ORG])
    await db.exec('insert into ob_organization_binding_audit select * from ob_organization_bindings')
    await db.query('insert into eb_inspection_details(inspection_id,org_id,eb_project_id) values($1,$2,$3)',[id,ORG,project])
    await db.query('insert into technical_investigation_details(inspection_id,org_id) values($1,$2)',[id,ORG])
    await db.query("insert into inspection_report_links(inspection_id,org_id,snapshot_payload,pdf_base64) values($1,$2,'{\"frozen\":true}','original-OB')",[id,ORG])
    const beforeInstall=await moduleState(db)
    await db.exec(runtimeSql)
    assert.deepEqual(await moduleState(db),beforeInstall)
    const calls:[string,unknown[]][]=[
      ['select lock_eb_inspection_report($1,$2,$3,$4)',[ORG,project,id,ACTOR]],
      ['select unlock_eb_inspection_report($1,$2,$3,$4,$5)',[ORG,project,id,'Legitimate-looking reason',ACTOR]],
      ['select unlock_tu_investigation_report($1,$2,$3,$4)',[ORG,id,'Legitimate-looking reason',ACTOR]],
    ]
    for(const locked of [false,true]) {
      if(locked) await db.query('update inspections set locked_at=now(),locked_by=$2 where id=$1',[id,ACTOR])
      const before=await moduleState(db)
      for(const [query,args] of calls) await asRole(db,'service_role',async()=>{
        await assert.rejects(db.query(query,args),/INSPECTION_REPORT_MODULE_MISMATCH/)
      })
      assert.deepEqual(await moduleState(db),before)
    }
    for(const role of ['anon','authenticated'] as const) await asRole(db,role,async()=>{
      for(const [query,args] of calls) await assert.rejects(db.query(query,args),/permission denied for function/)
    })
    for(const role of ['anon','authenticated','service_role'] as const) await asRole(db,role,async()=>{
      await assert.rejects(db.query("select assert_inspection_report_module($1,'EB')",[id]),/permission denied for function/)
    })
    await db.exec('begin read only')
    const checks=(await db.query<{check_name:string;ok:boolean}>(sql('2026-10-02_06_ob_organization_runtime_postflight.sql'))).rows
    await db.exec('commit')
    assert.deepEqual(checks.filter(x=>!x.ok).map(x=>x.check_name),['module_detail_family_mismatch'])
  } finally {await db.close()}
})

test('new detail relations, reparenting and parent reclassification reject cross-module and ambiguous families without blocking same-family variants',async()=>{
  const db=await runtimeDb()
  try {
    const ob=await create(db),eb=await moduleParent(db,'EB','EB'),tu=await moduleParent(db,'TU','TU'),ambiguous=await moduleParent(db,null,'SB')
    const project=randomUUID()
    await db.query('insert into eb_inspection_details(inspection_id,org_id,eb_project_id) values($1,$2,$3)',[eb,ORG,project])
    await db.query('insert into technical_investigation_details(inspection_id,org_id) values($1,$2)',[tu,ORG])
    for(const id of [ob.inspectionId,tu,ambiguous]) await assert.rejects(
      db.query('insert into eb_inspection_details(inspection_id,org_id,eb_project_id) values($1,$2,$3)',[id,ORG,project]),/INSPECTION_REPORT_MODULE_MISMATCH/)
    for(const id of [ob.inspectionId,eb,ambiguous]) await assert.rejects(
      db.query('insert into technical_investigation_details(inspection_id,org_id) values($1,$2)',[id,ORG]),/INSPECTION_REPORT_MODULE_MISMATCH/)
    await assert.rejects(db.query('update eb_inspection_details set inspection_id=$1 where inspection_id=$2',[ob.inspectionId,eb]),/INSPECTION_REPORT_MODULE_MISMATCH/)
    await assert.rejects(db.query('update technical_investigation_details set inspection_id=$1 where inspection_id=$2',[ob.inspectionId,tu]),/INSPECTION_REPORT_MODULE_MISMATCH/)
    await assert.rejects(db.query("update inspections set inspection_family='TU' where id=$1",[eb]),/INSPECTION_REPORT_MODULE_MISMATCH/)
    await assert.rejects(db.query("update inspections set inspection_family='EB' where id=$1",[tu]),/INSPECTION_REPORT_MODULE_MISMATCH/)
    await db.query("update inspections set type='SB',inspection_variant='SLB' where id=$1",[eb])
    await assert.rejects(db.query('update inspections set inspection_family=null where id=$1',[eb]),/INSPECTION_REPORT_MODULE_MISMATCH/)
    assert.deepEqual((await db.query('select inspection_family,type from inspections where id=$1',[eb])).rows[0],{inspection_family:'EB',type:'SB'})
  } finally {await db.close()}
})

test('runtime atomic create/list isolates organizations AND property owners, preserves frozen snapshots, and is rerunnable',async()=>{
  const db=await runtimeDb()
  try {
    const a=await create(db),b=await create(db,OTHER),colleague=await create(db,ORG,COLLEAGUE)
    assert.equal(a.orgId,ORG)
    assert.equal((await db.query('select * from inspection_interior_rooms where inspection_id=$1',[a.inspectionId])).rows.length,1)
    assert.deepEqual(await counts(db),{properties:3,inspections:3,bindings:3,audit:3,snapshots:3,conditions:3})
    const second=await create(db,ORG,ACTOR,a.propertyId)
    assert.equal(second.propertyId,a.propertyId)
    await db.query("insert into inspection_report_links(inspection_id,org_id,pdf_status,pdf_base64,snapshot_payload) values($1,$2,'ready','legacy-pdf','{\"frozen\":true}')",[a.inspectionId,ORG])
    const before=(await db.query('select * from ob_property_snapshot order by inspection_id')).rows
    const list=await asRole(db,'service_role',async()=>(await db.query<{value:{id:string;hasReadyPdf:boolean;property:{id:string};snapshot:{inspection_id:string}}[]}>(
      'select ob_list_organization_inspections($1,$2,null) value',[ORG,ACTOR])).rows[0].value)
    assert.deepEqual(list.map(x=>x.id).sort(),[a.inspectionId,second.inspectionId].sort())
    assert.ok(list.find(x=>x.id===a.inspectionId)?.hasReadyPdf)
    assert.equal(list[0].snapshot.inspection_id,list[0].id)
    assert.ok(!list.some(x=>x.id===b.inspectionId || x.id===colleague.inspectionId))
    await assert.rejects(create(db,ORG,ACTOR,colleague.propertyId),/OB_ORGANIZATION_FORBIDDEN/)
    await db.exec(runtimeSql)
    assert.deepEqual((await db.query('select * from ob_property_snapshot order by inspection_id')).rows,before)
    assert.deepEqual((await db.query('select * from ob_organization_binding_audit order by inspection_id')).rows,
      (await db.query('select * from ob_organization_bindings order by inspection_id')).rows)
    assert.equal((await db.query('select * from organization_enabled_modules')).rows.length,0)
    assert.equal((await db.query('select * from platform_access_assignments')).rows.length,0)
  } finally {await db.close()}
})

test('list preserves stored and legacy PDF availability without exposing document contents or accepting empty ready rows',async()=>{
  const db=await runtimeDb()
  try {
    const cases:[string|null,string|null,string|null,string|null,boolean,boolean][]=[
      ['ready',null,'reports','a.pdf',false,true],[' READY ',null,' reports ',' a.pdf ',false,true],
      ['pending','legacy-private-content',null,null,false,true],[null,'legacy-private-content',null,null,false,true],
      ['ready','   ',' ','',false,false],['ready',null,'reports',null,false,false],['ready',null,null,'a.pdf',false,false],
      ['pending',null,'reports','a.pdf',false,false],['ready','legacy-private-content','reports','a.pdf',true,false],
    ]
    const expected=new Map<string,boolean>()
    for(const [status,base64,bucket,path,revoked,ready] of cases) {
      const a=await create(db)
      expected.set(a.inspectionId,ready)
      await db.query(`insert into inspection_report_links(inspection_id,org_id,pdf_status,pdf_base64,pdf_storage_bucket,pdf_storage_path,revoked_at)
        values($1,$2,$3,$4,$5,$6,case when $7 then now() else null end)`,[a.inspectionId,ORG,status,base64,bucket,path,revoked])
    }
    const rows=await asRole(db,'service_role',async()=>(await db.query<{value:{id:string;hasReadyPdf:boolean}[]}>(
      'select ob_list_organization_inspections($1,$2,null) value',[ORG,ACTOR])).rows[0].value)
    assert.equal(rows.length,cases.length)
    for(const row of rows) assert.equal(row.hasReadyPdf,expected.get(row.id))
    assert.ok(!JSON.stringify(rows).includes('legacy-private-content'))
  } finally {await db.close()}
})

test('runtime uses normalized legacy semantics and explicit future entitlement denies global leakage',async()=>{
  const db=await runtimeDb()
  try {
    await create(db) // Member without normalized dashboard grants retains old access.
    await grant(db,{module:'technical_investigations'})
    await assert.rejects(create(db),/OB_ORGANIZATION_FORBIDDEN/)
    await grant(db,{expires:'2000-01-01'})
    await assert.rejects(create(db),/OB_ORGANIZATION_FORBIDDEN/)
    await grant(db,{org:OTHER})
    await assert.rejects(create(db),/OB_ORGANIZATION_FORBIDDEN/)
    await create(db,OTHER)
    await grant(db)
    await create(db)
    await entitlement(db,false)
    await assert.rejects(create(db),/OB_ORGANIZATION_FORBIDDEN/)
    await entitlement(db,true)
    await assert.rejects(create(db),/OB_ORGANIZATION_FORBIDDEN/)
    await grant(db,{org:ORG,role:'dashboard_admin'})
    await assert.rejects(create(db),/OB_ORGANIZATION_FORBIDDEN/)
    await grant(db,{org:ORG})
    await create(db)
    for(const table of ['platform_products','platform_modules','platform_roles']) {
      await db.exec(`update ${table} set is_active=false`)
      await assert.rejects(create(db),/OB_ORGANIZATION_FORBIDDEN/)
      await db.exec(`update ${table} set is_active=true`)
    }
    for(const table of ['platform_modules','platform_roles']) {
      await db.exec(`update ${table} set product_id=(select id from platform_products where key='hushub_admin')`)
      await assert.rejects(create(db),/OB_ORGANIZATION_FORBIDDEN/)
      await db.exec(`update ${table} set product_id=(select id from platform_products where key='dashboard')`)
    }
    await db.query('update org_members set is_active=false where org_id=$1 and profile_id=$2',[ORG,ACTOR])
    await assert.rejects(create(db),/OB_ORGANIZATION_FORBIDDEN/)
    await db.query('update org_members set is_active=true where org_id=$1 and profile_id=$2',[ORG,ACTOR])
    await db.exec('delete from organization_enabled_modules; delete from platform_access_assignments')
    await grant(db,{org:ORG,active:false,source:'organization_administration'})
    await assert.rejects(create(db),/OB_ORGANIZATION_FORBIDDEN/)
  } finally {await db.close()}
})

test('runtime failures roll back the property, inspection, binding, audit and snapshot as one transaction',async()=>{
  const db=await runtimeDb()
  try {
    const before=await counts(db)
    await db.exec("alter table inspection_conditions add constraint force_test_failure check(furnishing_level<>'fullt_moblerad')")
    await assert.rejects(create(db),/force_test_failure/)
    assert.deepEqual(await counts(db),before)
    await db.exec('alter table inspection_conditions drop constraint force_test_failure')
    await db.exec("alter table ob_property_snapshot add constraint force_snapshot_failure check(snapshot_version<>1)")
    await assert.rejects(create(db),/force_snapshot_failure/)
    assert.deepEqual(await counts(db),before)
    await assert.rejects(create(db,randomUUID()),/OB_ORGANIZATION_FORBIDDEN/)
    assert.deepEqual(await counts(db),before)
  } finally {await db.close()}
})

test('real assignment starts retain booked/early/status rules and bind atomically to the assignment organization',async()=>{
  const db=await runtimeDb()
  try {
    const booked=await draft(db)
    const a=await start(db,booked)
    assert.equal(a.orgId,ORG)
    assert.deepEqual(await start(db,booked),a)
    assert.equal((await db.query<{address:string}>('select address from ob_property_snapshot where inspection_id=$1',[a.inspectionId])).rows[0].address,'Frozen street')
    await assert.rejects(start(db,booked,'OB',OTHER),/ASSIGNMENT_NOT_FOUND/)
    const early=await draft(db)
    await db.query("update assignments set status='sent',accepted_at=null,terms_version=null,booked_at=null where id=$1",[early])
    await assert.rejects(start(db,early),/OB_EARLY_REASON_REQUIRED/)
    await db.query("insert into assignment_links(assignment_id,org_id,token_hash,expires_at) values($1,$2,repeat('a',64),now()+interval '1 day')",[early,ORG])
    const e=(await db.query<{value:{inspectionId:string}}>('select ob_start_assignment_inspection($1,$2,$3,$4) value',[early,ORG,ACTOR,'Explicit early reason'])).rows[0].value
    assert.equal((await db.query('select * from ob_organization_bindings where inspection_id=$1',[e.inspectionId])).rows.length,1)
    assert.equal((await db.query('select * from ob_assignment_workflows where inspection_id=$1',[e.inspectionId])).rows.length,1)
    const status=await draft(db,'STATUS')
    await assert.rejects(start(db,status,'STATUS'),/OB_APPROVAL_REQUIRED/)
    const hash=createHash('sha256').update('Frozen legal terms').digest('hex')
    const source={schemaVersion:'ob-confirmation-v1',statusObjectType:'property',statusScopeDescription:'Frozen scope',statusPriceAmount:1500,
      inspector:{name:'Frozen inspector'},terms:{role:'status',version:'v-test',documentHash:hash,text:'Frozen legal terms',verbatim:true,sourceId:'OB_STATUS_2026_1'}}
    const link=(await db.query<{id:string}>(`insert into assignment_links(assignment_id,org_id,token_hash,expires_at,terms_version,status_document_source)
      values($1,$2,repeat('b',64),now()+interval '1 day','v-test',$3) returning id`,[status,ORG,JSON.stringify(source)])).rows[0].id
    await db.query(`insert into assignment_acceptances(assignment_id,org_id,accepted_at,terms_version,terms_document_hash,payload,assignment_link_id)
      select id,org_id,accepted_at,'v-test',$2,$3,$4 from assignments where id=$1`,[status,hash,JSON.stringify({
        ob_document_source:source,assignment_details:{objectType:'property'},
      }),link])
    const frozen=(await db.query('select * from assignment_confirmation_snapshots where assignment_id=$1',[status])).rows[0]
    await db.query("update assignments set scope_description='Later live edit' where id=$1",[status])
    const s=await start(db,status,'STATUS')
    const row=(await db.query<{type:string;inspection_variant:string;scope:string}>('select * from inspections where id=$1',[s.inspectionId])).rows[0]
    assert.equal(row.type,'STATUS');assert.equal(row.inspection_variant,'SB');assert.equal(row.scope,'Frozen scope')
    assert.deepEqual((await db.query('select * from assignment_confirmation_snapshots where assignment_id=$1',[status])).rows[0],frozen)
    assert.equal((await db.query('select * from ob_organization_bindings where inspection_id=$1 and org_id=$2',[s.inspectionId,ORG])).rows.length,1)
    await db.query("update org_members set role='admin' where org_id=$1 and profile_id=$2",[ORG,COLLEAGUE])
    const before=await counts(db)
    await assert.rejects(start(db,booked,'OB',ORG,COLLEAGUE),/OB_ORGANIZATION_FORBIDDEN/)
    await assert.rejects(start(db,status,'STATUS',ORG,COLLEAGUE),/OB_ORGANIZATION_FORBIDDEN/)
    const colleagueOwned=await draft(db,'OB',ORG,ACTOR)
    await assert.rejects(start(db,colleagueOwned,'OB',ORG,COLLEAGUE),/OB_ORGANIZATION_FORBIDDEN/)
    assert.deepEqual(await counts(db),before)
  } finally {await db.close()}
})

test('all reviewed service RPC guards reject wrong org/actor before their original side effects and keep valid calls',async()=>{
  const db=await runtimeDb()
  try {
    const a=await create(db)
    for(const fn of guardedFunctions) {
      await asRole(db,'service_role',async()=>{
        await assert.rejects(db.query(`select ${fn}($1,$2,$3)`,[a.inspectionId,OTHER,ACTOR]),/OB_ORGANIZATION_FORBIDDEN/)
        await assert.rejects(db.query(`select ${fn}($1,$2,$3)`,[a.inspectionId,ORG,COLLEAGUE]),/OB_ORGANIZATION_FORBIDDEN/)
        const result=(await db.query<{value:{original:string}}>(`select ${fn}($1,$2,$3) value`,[a.inspectionId,ORG,ACTOR])).rows[0].value
        assert.equal(result.original,'preserve-original-function-body')
      })
    }
    assert.equal((await db.query<{n:number}>('select count(*)::int n from runtime_guard_sentinel')).rows[0].n,guardedFunctions.length)
    await asRole(db,'service_role',async()=>{
      await assert.rejects(db.query('select ob_building_access($1,$2,$3,false)',[a.inspectionId,OTHER,ACTOR]),/OB_ORGANIZATION_FORBIDDEN/)
      await assert.rejects(db.query("select ob_building_write_rows($1,$2,$3,'{}')",[a.inspectionId,OTHER,ACTOR]),/OB_ORGANIZATION_FORBIDDEN/)
      await assert.rejects(db.query("select ob_building_write_rows($1,$2,$3,'{}')",[a.inspectionId,ORG,ACTOR]),/OB_ROUND_INVALID/)
      await assert.rejects(db.query('select ob_review_assignment_workflow($1,$2,$3,null)',[a.inspectionId,OTHER,ACTOR]),/OB_ORGANIZATION_FORBIDDEN/)
      await assert.rejects(db.query('select ob_reconcile_assignment_workflow($1,$2,$3,null,null,array[]::text[])',[a.inspectionId,OTHER,ACTOR]),/OB_ORGANIZATION_FORBIDDEN/)
    })
  } finally {await db.close()}
})

test('authenticated data/storage RLS is owner AND org bounded while EB inserts and shared property media remain unchanged',async()=>{
  const db=await runtimeDb()
  try {
    const a=await create(db),b=await create(db,OTHER),c=await create(db,ORG,COLLEAGUE)
    await asRole(db,'authenticated',async()=>{
      await assert.rejects(db.query("insert into inspections(property_id,type,inspection_family) values($1,'OB','OB')",[a.propertyId]),/row-level security/)
      const eb=(await db.query<{id:string}>("insert into inspections(property_id,type,inspection_family) values($1,'SB','EB') returning id",[a.propertyId])).rows[0].id
      assert.ok(eb)
      await db.query("insert into inspection_optional_fixture(note) values('unrelated optional row')")
      assert.equal((await db.query('select * from inspection_optional_fixture')).rows.length,1)
      await db.query("insert into storage.objects(bucket_id,name) values('inspection-images',$1)",[a.inspectionId+'/image.jpg'])
      assert.ok((await db.query<{id:string}>('select id from inspections')).rows.some(x=>x.id===a.inspectionId))
      assert.ok(!(await db.query<{id:string}>('select id from inspections')).rows.some(x=>x.id===c.inspectionId))
    })
    await db.query('update org_members set is_active=false where org_id=$1 and profile_id=$2',[ORG,ACTOR])
    await asRole(db,'authenticated',async()=>{
      const ids=(await db.query<{id:string}>('select id from inspections')).rows.map(x=>x.id)
      assert.ok(!ids.includes(a.inspectionId));assert.ok(ids.includes(b.inspectionId))
      assert.equal((await db.query('select * from inspection_conditions where inspection_id=$1',[a.inspectionId])).rows.length,0)
      await assert.rejects(db.query("insert into inspection_conditions values($1,'none')",[a.inspectionId]),/row-level security/)
      assert.equal((await db.query("select * from storage.objects where bucket_id='inspection-images'")).rows.length,0)
      await assert.rejects(db.query("insert into storage.objects(bucket_id,name) values('inspection-images',$1)",[a.inspectionId+'/new.jpg']),/row-level security/)
      await db.query("insert into storage.objects(bucket_id,name) values('property-media','unchanged-shared.jpg')")
    })
  } finally {await db.close()}
})

test('bindings, source organization, cleanup cascade and API-role privileges cannot be bypassed directly',async()=>{
  const db=await runtimeDb()
  try {
    const a=await create(db),b=await create(db,OTHER)
    await assert.rejects(db.query('update inspections set property_id=$1 where id=$2',[b.propertyId,a.inspectionId]),/OB_ORGANIZATION_BINDING_IMMUTABLE/)
    await assert.rejects(db.query("update inspections set inspection_family='EB' where id=$1",[a.inspectionId]),/OB_ORGANIZATION_BINDING_IMMUTABLE/)
    await assert.rejects(db.query("insert into inspection_report_links(inspection_id,org_id) values($1,$2)",[a.inspectionId,OTHER]),/OB_ORGANIZATION_MISMATCH/)
    const foreignAssignment=await draft(db,'OB',OTHER)
    await assert.rejects(db.query('insert into inspection_report_links(inspection_id,org_id,assignment_id) values($1,$2,$3)',
      [a.inspectionId,ORG,foreignAssignment]),/OB_ORGANIZATION_MISMATCH/)
    const assignment=await draft(db)
    await db.query('update assignments set inspection_id=$1 where id=$2',[a.inspectionId,assignment])
    await assert.rejects(db.query('update assignments set org_id=$1 where id=$2',[OTHER,assignment]),/OB_ORGANIZATION_MISMATCH/)
    await assert.rejects(db.query('update assignments set inspection_id=$1 where id=$2',[b.inspectionId,assignment]),/OB_ORGANIZATION_MISMATCH/)
    await db.query('update assignments set inspection_id=null where id=$1',[assignment])
    await assert.rejects(db.query('update assignments set org_id=$1 where id=$2',[OTHER,assignment]),/OB_ORGANIZATION_MISMATCH/)
    await assert.rejects(db.query("insert into inspections(property_id,type,inspection_family) values($1,'OB','OB')",[a.propertyId]),/OB_ORGANIZATION_BINDING_REQUIRED/)
    for(const role of ['anon','authenticated','service_role'] as const) await asRole(db,role,async()=>{
      await assert.rejects(db.query('select ob_bind_created_inspection($1,$2)',[a.inspectionId,OTHER]),/permission denied/)
      await assert.rejects(db.query('select ob_start_assignment_inspection_before_organization($1,$2,$3,null)',[assignment,ORG,ACTOR]),/permission denied/)
      await assert.rejects(db.query('insert into ob_organization_bindings values($1,$2,$3,now())',[randomUUID(),ORG,'explicit_creation']),/permission denied/)
      if(role!=='service_role') {
        await assert.rejects(db.query('select ensure_inspection_default_other_room_and_points($1)',[a.inspectionId]),/permission denied/)
        await assert.rejects(db.query('select ob_create_organization_inspection($1,$2,null)',[ORG,ACTOR]),/permission denied/)
        await assert.rejects(db.query('select ob_list_organization_inspections($1,$2,null)',[ORG,ACTOR]),/permission denied/)
      }
    })
    await db.query('delete from inspections where id=$1',[b.inspectionId])
    assert.equal((await db.query('select * from ob_organization_bindings where inspection_id=$1',[b.inspectionId])).rows.length,0)
    assert.equal((await db.query('select * from ob_organization_binding_audit where inspection_id=$1',[b.inspectionId])).rows.length,1)
  } finally {await db.close()}
})

test('real early-start reissue may unlink the cancelled assignment but never moves ownership or historical attribution',async()=>{
  const db=await runtimeDb()
  try {
    const original=await draft(db)
    await db.query("update assignments set status='sent',accepted_at=null,terms_version=null,booked_at=null where id=$1",[original])
    await db.query("insert into assignment_links(assignment_id,org_id,token_hash,expires_at) values($1,$2,repeat('c',64),now()+interval '1 day')",[original,ORG])
    const started=await asRole(db,'service_role',async()=>(await db.query<{value:{inspectionId:string}}>(
      'select ob_start_assignment_inspection($1,$2,$3,$4) value',[original,ORG,ACTOR,'Waiting for customer approval'])).rows[0].value)
    const before=await counts(db)
    const binding=(await db.query('select * from ob_organization_bindings where inspection_id=$1',[started.inspectionId])).rows[0]
    const audit=(await db.query('select * from ob_organization_binding_audit where inspection_id=$1',[started.inspectionId])).rows[0]
    const snapshot=(await db.query('select * from ob_property_snapshot where inspection_id=$1',[started.inspectionId])).rows[0]
    const reissue=async(id:string)=>asRole(db,'service_role',async()=>(await db.query<{id:string}>(
      'select ob_reissue_started_assignment($1,$2,$3) id',[id,ORG,ACTOR])).rows[0].id)
    const replacement=await reissue(original)
    const cancelled=(await db.query<{status:string;inspection_id:string|null;org_id:string}>('select * from assignments where id=$1',[original])).rows[0]
    assert.equal(cancelled.status,'cancelled');assert.equal(cancelled.inspection_id,null);assert.equal(cancelled.org_id,ORG)
    const current=(await db.query<{status:string;inspection_id:string;org_id:string}>('select * from assignments where id=$1',[replacement])).rows[0]
    assert.equal(current.status,'draft');assert.equal(current.inspection_id,started.inspectionId);assert.equal(current.org_id,ORG)
    assert.ok((await db.query<{revoked_at:string}>('select revoked_at from assignment_links where assignment_id=$1',[original])).rows[0].revoked_at)
    assert.deepEqual((await db.query('select initial_assignment_id,current_assignment_id from ob_assignment_workflows where inspection_id=$1',[started.inspectionId])).rows[0],
      {initial_assignment_id:original,current_assignment_id:replacement})
    // Exercise an intermediate version that is no longer initial/current after
    // the second reissue, but still has a historical workflow event.
    await db.query("update assignments set status='sent',last_sent_at=now() where id=$1",[replacement])
    await db.query("insert into assignment_links(assignment_id,org_id,token_hash,expires_at) values($1,$2,repeat('d',64),now()+interval '1 day')",[replacement,ORG])
    const next=await reissue(replacement)
    assert.notEqual(next,replacement)
    assert.equal((await db.query<{n:number}>("select count(*)::int n from ob_assignment_workflow_events where inspection_id=$1 and event_type='reissued'",[started.inspectionId])).rows[0].n,2)
    await db.query("update assignments set assignment_type='UHP' where id=$1",[replacement])
    await assert.rejects(db.query('update assignments set org_id=$1 where id=$2',[OTHER,replacement]),/OB_ORGANIZATION_MISMATCH/)
    assert.deepEqual(await counts(db),before)
    assert.deepEqual((await db.query('select * from ob_organization_bindings where inspection_id=$1',[started.inspectionId])).rows[0],binding)
    assert.deepEqual((await db.query('select * from ob_organization_binding_audit where inspection_id=$1',[started.inspectionId])).rows[0],audit)
    assert.deepEqual((await db.query('select * from ob_property_snapshot where inspection_id=$1',[started.inspectionId])).rows[0],snapshot)
  } finally {await db.close()}
})

test('runtime SQL06 is read-only and detects missing guards/ACL drift after a passing installation',async()=>{
  const db=await runtimeDb()
  try {
    const postflight=sql('2026-10-02_06_ob_organization_runtime_postflight.sql')
    await create(db)
    const before=await counts(db)
    await db.exec('begin read only')
    const checks=(await db.query<{check_name:string;ok:boolean}>(postflight)).rows
    await db.exec('commit')
    assert.equal(checks.length,20)
    assert.deepEqual(checks.filter(x=>!x.ok),[])
    assert.deepEqual(await counts(db),before)
    await db.exec('grant execute on function ob_create_organization_inspection(uuid,uuid,uuid) to authenticated')
    const drift=(await db.query<{check_name:string;ok:boolean}>(postflight)).rows
    assert.equal(drift.find(x=>x.check_name==='service_entrypoints_ready')?.ok,false)
    await db.exec('grant execute on function unlock_tu_investigation_report(uuid,uuid,text,uuid) to authenticated; drop trigger inspection_report_detail_module_guard on eb_inspection_details')
    const moduleDrift=(await db.query<{check_name:string;ok:boolean}>(postflight)).rows
    assert.equal(moduleDrift.find(x=>x.check_name==='module_RPC_guards_ready')?.ok,false)
    assert.equal(moduleDrift.find(x=>x.check_name==='module_relation_guards_ready')?.ok,false)
    assert.equal(moduleDrift.find(x=>x.check_name==='legacy_RPC_client_execute_review')?.ok,false)
  } finally {await db.close()}
})

test('module cutover fails atomically for changed/missing RPCs, overloads, unexpected detail schema and inherited client ACL',async t=>{
  for(const scenario of ['body-drift','missing','overload','detail-schema','inherited-execute'] as const) await t.test(scenario,async()=>{
    const db=await runtimeDb(false)
    try {
      if(scenario==='body-drift') {
        const row=(await db.query<{definition:string;prosrc:string}>("select pg_get_functiondef(oid) definition,prosrc from pg_proc where oid='lock_eb_inspection_report(uuid,uuid,uuid,uuid)'::regprocedure")).rows[0]
        await db.exec(row.definition.replace(row.prosrc,row.prosrc+'\n-- newer unreviewed implementation'))
      } else if(scenario==='missing') await db.exec('drop function unlock_tu_investigation_report(uuid,uuid,text,uuid)')
      else if(scenario==='overload') await db.exec("create function lock_eb_inspection_report(uuid) returns void language plpgsql as $$ begin null; end $$")
      else if(scenario==='detail-schema') await db.exec('alter table technical_investigation_details rename column inspection_id to unexpected_id')
      else await db.exec('create role unexpected_module_rpc; grant execute on function lock_eb_inspection_report(uuid,uuid,uuid,uuid) to unexpected_module_rpc; grant unexpected_module_rpc to authenticated')
      const before=(await db.query("select prosrc,proacl from pg_proc where oid='lock_eb_inspection_report(uuid,uuid,uuid,uuid)'::regprocedure")).rows
      await assert.rejects(db.exec(runtimeSql),/OB_RUNTIME_(MODULE_FUNCTION_REVIEW_REQUIRED|MODULE_DETAIL_SCHEMA_REVIEW_REQUIRED|INHERITED_EXECUTE_REVIEW_REQUIRED)/)
      await db.exec('rollback')
      assert.deepEqual((await db.query("select prosrc,proacl from pg_proc where oid='lock_eb_inspection_report(uuid,uuid,uuid,uuid)'::regprocedure")).rows,before)
      assert.equal((await db.query<{fn:string|null}>("select to_regprocedure('assert_inspection_report_module(uuid,text)') fn")).rows[0].fn,null)
    } finally {await db.close()}
  })
})

test('latest overview keeps STATUS support and filters only matching organization inspections',async()=>{
  const db=await runtimeDb()
  try {
    const a=await create(db),b=await create(db,OTHER)
    await db.query("update inspections set type='STATUS',inspection_variant='SB' where id=$1",[a.inspectionId])
    await asRole(db,'authenticated',async()=>{
      const value=(await db.query<{value:unknown}>('select ob_overview_page($1) value',[ORG])).rows[0].value
      assert.ok(JSON.stringify(value).includes(a.inspectionId))
      assert.ok(!JSON.stringify(value).includes(b.inspectionId))
    })
    const body=(await db.query<{prosrc:string}>("select prosrc from pg_proc where oid='ob_overview_page(uuid,text,text,text,boolean,boolean,integer,integer)'::regprocedure")).rows[0].prosrc
    assert.ok(body.includes("'STATUS'"))
    assert.equal(body.split('ob_inspection_matches_organization(i.id,p_org_id)').length,2)
  } finally {await db.close()}
})

test('cutover refuses unreviewed OB data, missing guarded RPCs, and incompatible overview without partial migration',async t=>{
  for(const scenario of ['unbound','missing-function','changed-overview'] as const) await t.test(scenario,async()=>{
    const db=await runtimeDb(false)
    try {
      if(scenario==='unbound') {
        const property=(await db.query<{id:string}>('insert into properties(owner) values($1) returning id',[ACTOR])).rows[0].id
        await db.query("insert into inspections(property_id,type,inspection_family) values($1,'OB','OB')",[property])
      } else if(scenario==='missing-function') await db.exec('drop function ob_environmental_command(uuid,uuid,uuid,text,jsonb)')
      else await db.exec("drop function ob_overview_page(uuid,text,text,text,boolean,boolean,integer,integer); create function ob_overview_page(uuid,text,text,text,boolean,boolean,integer,integer) returns jsonb language plpgsql as $$ begin return '{}'; end $$")
      await assert.rejects(db.exec(runtimeSql),/OB_RUNTIME_(UNBOUND_INSPECTIONS_REVIEW_REQUIRED|FUNCTION_REVIEW_REQUIRED|OVERVIEW_REVIEW_REQUIRED)/)
      await db.exec('rollback')
      assert.equal((await db.query<{fn:string|null}>("select to_regprocedure('ob_create_organization_inspection(uuid,uuid,uuid)') fn")).rows[0].fn,null)
    } finally {await db.close()}
  })
})
