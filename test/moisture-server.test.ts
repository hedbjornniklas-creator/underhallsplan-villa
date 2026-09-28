import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'
import type * as Server from '../src/lib/moisture/server'
// @ts-expect-error Node strip-types requires an explicit source extension.
import * as domain from '../src/lib/moisture/domain.ts'

const orgId='11111111-1111-4111-8111-111111111111', userId='22222222-2222-4222-8222-222222222222', projectId='33333333-3333-4333-8333-333333333333'
const context={orgId,userId,orgName:'Test'}
const input={projectId,title:'Fukt',description:null,scopes:['inventory'],pricingMode:'fixed',customerId:null,property:{mode:'existing',id:projectId},buildingIds:[],newBuildings:[]}
const view={id:projectId,orgId,title:'Fukt',property:{id:projectId},buildings:[],scopes:['inventory'],revision:1}
function harness({ data = view as unknown, dbError = null as unknown, allowed = true, orgError = null as Error | null,
  grantedOrg = null as string | null, memberships = [] as Array<{org_id:string}>, membershipError = null as unknown } = {}) {
  const calls: Array<{name:string;args:Record<string,unknown>}> = []
  const checks: Array<Record<string,unknown>> = []
  const orgSelections: unknown[] = []
  const memberQueries: Array<{table:string;filters:Array<[string,unknown]>}> = []
  const admin={
    rpc:async(name:string,args:Record<string,unknown>)=>{calls.push({name,args});return {data,error:dbError}},
    from:(table:string)=>{
      const query={table,filters:[] as Array<[string,unknown]>};memberQueries.push(query)
      const builder={select:()=>builder,eq:(key:string,value:unknown)=>{query.filters.push([key,value]);return builder},order:()=>builder,
        then:(resolve:(value:unknown)=>unknown)=>Promise.resolve({data:memberships,error:membershipError}).then(resolve)}
      return builder
    },
  }
  const deps: Record<string,unknown>={
    'server-only':{},
    './domain':domain,
    '@/lib/supabase/admin':{createSupabaseAdminClient:()=>admin},
    '@/lib/assignments/server':{requireOrgContext:async(selected:unknown)=>{orgSelections.push(selected);if(orgError)throw orgError;return {...context,orgId:selected??orgId}}},
    '@/lib/access/server':{hasCurrentUserAccess:async(check:Record<string,unknown>)=>{checks.push(check);return grantedOrg?check.scopeType==='organization'&&check.scopeId===grantedOrg:allowed}},
  }
  const source=readFileSync(new URL('../src/lib/moisture/server.ts',import.meta.url),'utf8')
  const output=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
  const compiled={exports:{}}
  new Function('require','module','exports',output)((name:string)=>{if(name in deps)return deps[name];throw new Error(`Unexpected import ${name}`)},compiled,compiled.exports)
  return {server:compiled.exports as typeof Server,calls,checks,orgSelections,memberQueries}
}

test('request context requires one explicit org, active membership and the independent module grant',async()=>{
  const h=harness()
  for(const suffix of ['',`?orgId=${orgId}&orgId=${orgId}`])await assert.rejects(h.server.requireMoistureRequestContext(new Request(`https://local.test/api${suffix}`)),/ORG_SELECTION_INVALID/)
  assert.deepEqual(await h.server.requireMoistureRequestContext(new Request(`https://local.test/api?orgId=${orgId}`)),context)
  assert.deepEqual(h.orgSelections,[orgId])
  assert.equal(h.checks.length,2)
  assert.ok(h.checks.every(c=>c.moduleKey==='moisture_safety'))
  await assert.rejects(harness({allowed:false}).server.requireMoistureContext(orgId),/MODULE_ACCESS_REQUIRED/)
  const revoked=harness({orgError:new Error('ORG_MEMBERSHIP_REQUIRED')})
  await assert.rejects(revoked.server.requireMoistureContext(orgId),/ORG_MEMBERSHIP_REQUIRED/)
  assert.equal(revoked.checks.length,0)
})

test('unscoped entry selects an active granted organization; an explicit denied organization never falls back',async()=>{
  const orgB='44444444-4444-4444-8444-444444444444'
  const h=harness({grantedOrg:orgB,memberships:[{org_id:orgId},{org_id:orgB}]})
  assert.deepEqual(await h.server.requireMoistureContext(),{...context,orgId:orgB})
  assert.deepEqual(h.orgSelections,[undefined,orgB])
  assert.deepEqual(h.memberQueries,[{table:'org_members',filters:[['profile_id',userId],['is_active',true]]}])
  const explicit=harness({grantedOrg:orgB,memberships:[{org_id:orgB}]})
  await assert.rejects(explicit.server.requireMoistureContext(orgId),/MODULE_ACCESS_REQUIRED/)
  assert.equal(explicit.memberQueries.length,0)
  assert.deepEqual(await explicit.server.requireMoistureContext(orgB),{...context,orgId:orgB})
  await assert.rejects(harness({allowed:false,memberships:[]}).server.requireMoistureContext(),/MODULE_ACCESS_REQUIRED/)
})

test('create is one scoped atomic RPC using the supplied idempotency key, not independent property inserts',async()=>{
  const h=harness()
  await h.server.createMoistureProject(context,{...input,title:' Fukt '})
  assert.equal(h.calls.length,1)
  assert.deepEqual(h.calls[0],{name:'moisture_project_write',args:{p_org_id:orgId,p_actor_id:userId,p_project_id:projectId,p_operation:'create',p_input:input}})
})

test('invalid writes stop before database calls; update forwards revision and cannot change property',async()=>{
  const h=harness()
  await assert.rejects(h.server.createMoistureProject(context,{...input,orgId}),/MOISTURE_INVALID_INPUT/)
  assert.equal(h.calls.length,0)
  const {projectId:ignored,property,...fields}=input
  void ignored;void property
  await h.server.updateMoistureProject(context,projectId,{...fields,revision:1})
  assert.equal(h.calls[0].args.p_operation,'update')
  assert.equal((h.calls[0].args.p_input as {revision:number}).revision,1)
  await assert.rejects(h.server.updateMoistureProject(context,projectId,{...fields,revision:1,property}),/MOISTURE_INVALID_INPUT/)
  assert.equal(h.calls.length,1)
})

test('read and options retain org/actor context and refuse unexpected cross-org RPC output',async()=>{
  const list=harness({data:[view]})
  assert.equal((await list.server.listMoistureProjects(context)).length,1)
  assert.deepEqual(list.calls[0].args,{p_org_id:orgId,p_actor_id:userId,p_project_id:null})
  const options=harness({data:{properties:[],customers:[]}})
  assert.deepEqual(await options.server.getMoistureOptions(context),{properties:[],customers:[]})
  assert.deepEqual(options.calls[0].args,{p_org_id:orgId,p_actor_id:userId})
  await assert.rejects(harness({data:{...view,orgId:userId}}).server.getMoistureProject(context,projectId),/MOISTURE_OPERATION_FAILED/)
})

test('known RPC failures are normalized and unexpected database strings never reach clients',async()=>{
  for(const [dbError,expected,status] of [
    [{code:'P0001',message:'MOISTURE_CONFLICT'},'MOISTURE_CONFLICT',409],
    [{code:'PGRST202',message:'RPC missing schema details'},'MOISTURE_SCHEMA_REQUIRED',503],
    [{code:'42P01',message:'private schema table name'},'MOISTURE_SCHEMA_REQUIRED',503],
    [{code:'PGRST204',message:'private schema column name'},'MOISTURE_SCHEMA_REQUIRED',503],
    [{code:'23505',message:'secret customer identity'},'MOISTURE_OPERATION_FAILED',500],
  ] as const){
    await assert.rejects(harness({dbError}).server.createMoistureProject(context,input),(error:unknown)=>{
      assert.equal((error as Error).message,expected)
      assert.equal(domain.getMoistureError(error).status,status)
      assert.doesNotMatch(JSON.stringify(domain.getMoistureError(error)),/secret|private|schema details/)
      return true
    })
  }
})
