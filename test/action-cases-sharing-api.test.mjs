import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import * as sharing from '../src/lib/action-cases/customerSharing.ts'

const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const ctx={orgId:id(1),userId:id(2)},caseId=id(3)
function load(path,deps) {
  const m={exports:{}};new Function('require','module','exports',ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(name=>{assert.ok(name in deps,name);return deps[name]},m,m.exports);return m.exports
}
function harness() {
  const reads=[],writes=[];let row=null,manager=ctx.userId,missing=false,role='customer',revoked=false
  const db={from(table){const r={table,filters:[]};reads.push(r);const q={select(){return q},eq(...v){r.filters.push(v);return q},order(){return q},async range(){return {data:[]}},async maybeSingle(){if(missing&&table==='action_case_customer_visibility')return {error:{code:'42P01'}};return {data:table==='action_cases'?{manager_profile_id:manager}:table==='action_case_customer_visibility'?row:table==='action_case_access_links'?{org_id:ctx.orgId,action_case_id:caseId,participant_id:id(4),expires_at:'2099-01-01',revoked_at:revoked?'2026-10-20':null}:table==='action_case_participants'?role==='customer'?{id:id(4)}:null:null}}};return q},async rpc(name,args){writes.push({name,args});const request=args.p_request;row={revision:request.revision+1,...sharing.defaultCustomerVisibility(),[request.section]:request.visible,updated_at:'2026-10-20T08:00:00Z',updated_by:ctx.userId};return {data:row.revision}}}
  const server=load('../src/lib/action-cases/customerSharingServer.ts',{'server-only':{},'@/lib/supabase/admin':{createSupabaseAdminClient:()=>db},'@/lib/assignments/tokens':{hashAssignmentToken:()=> 'hash'},'./customerSharing':sharing})
  return {server,reads,writes,setRow(value){row=value},setManager(value){manager=value},missing(){missing=true},setRole(value){role=value},revoke(){revoked=true}}
}
test('missing rows retain existing visibility; missing schema and malformed rows fail closed, not visible-by-default',async()=>{
  const h=harness();assert.deepEqual((await h.server.readCustomerVisibility(ctx.orgId,caseId)).tabs,sharing.defaultCustomerVisibility())
  h.setRow({revision:1,contract:'true'});await assert.rejects(h.server.readCustomerVisibility(ctx.orgId,caseId),/SHARING_FAILED/)
  h.missing();await assert.rejects(h.server.requireCustomerSection(ctx.orgId,caseId,'contract'),/SHARING_SCHEMA/)
})
test('sharing writer calls only its own RPC, scopes every read and rejects nonmanagers without writes',async()=>{
  const h=harness(),request={requestId:id(5),revision:0,section:'contract',visible:false}
  const result=await h.server.writeCustomerSharing(ctx,caseId,request)
  assert.equal(result.workspace.tabs.contract,false);assert.equal(result.requestId,id(5));assert.equal(result.acknowledgedRevision,1)
  assert.deepEqual(h.writes,[{name:'set_project_customer_visibility',args:{p_org_id:ctx.orgId,p_case_id:caseId,p_actor_id:ctx.userId,p_request:request}}])
  h.setManager(id(7));await assert.rejects(h.server.writeCustomerSharing(ctx,caseId,{...request,revision:1}),/FORBIDDEN/);assert.equal(h.writes.length,1)
  assert.ok(h.reads.every(r=>r.filters.some(([key,value])=>key==='org_id'&&value===ctx.orgId)))
})
test('customer section checks require a valid active link and exact customer role; hidden sections reject direct access',async()=>{
  const h=harness(),token='a'.repeat(43)
  await h.server.requireCustomerSectionForToken(token,'choices')
  h.setRow({revision:1,...sharing.defaultCustomerVisibility(),choices:false})
  await assert.rejects(h.server.requireCustomerSectionForToken(token,'choices'),/SHARING_HIDDEN/)
  h.setRole('subcontractor');await assert.rejects(h.server.requireCustomerSectionForToken(token,'contract'),/NOT_FOUND/)
  h.setRole('customer');h.revoke();await assert.rejects(h.server.requireCustomerSectionForToken(token,'contract'),/NOT_FOUND/)
})
test('sharing API requires module/session authorization and same-origin writes before invoking the service',async()=>{
  const calls=[],next={NextResponse:{json:(body,init={})=>({body,...init})}}
  const http=load('../src/lib/action-cases/customerOffersHttp.ts',{'next/server':next,'@/lib/assignments/server':{async requireOrgContext(){return ctx}},'@/lib/access/server':{async requireModuleAccess(){}}})
  const route=load('../src/app/api/action-cases/[caseId]/sharing/route.ts',{'next/server':next,'@/lib/action-cases/customerOffersHttp':http,'@/lib/action-cases/customerSharingServer':{async getCustomerSharing(...args){calls.push(args);return {}},async writeCustomerSharing(...args){calls.push(args);return {}}}})
  const params={params:Promise.resolve({caseId})}
  const good=await route.POST(new Request('https://hushub.se/api/x',{method:'POST',headers:{origin:'https://hushub.se'},body:'{}'}),params)
  assert.equal(good.headers['Cache-Control'],'no-store');assert.deepEqual(calls[0].slice(0,2),[ctx,caseId])
  const bad=await route.POST(new Request('https://hushub.se/api/x',{method:'POST',headers:{origin:'https://foreign.invalid'},body:'{}'}),params)
  assert.equal(bad.status,410);assert.equal(calls.length,1)
})

function portalHarness() {
  const reads=[],writes=[],signed=[];let role='customer',hidden=false
  const participantId=id(4),fileId=id(5)
  const db={from(table){const r={table,filters:[]};reads.push(r)
    const result=()=>({data:table==='action_cases'?{id:caseId,title:'Internal project',property_address:'Testgatan',status:'open'}:
      table==='action_case_participants'?r.filters.some(([k,v])=>k==='id'&&v!==participantId)?null:{id:participantId,role,name:'Anna',email:'anna@example.test'}:
      table==='action_case_access_links'?{id:id(9),org_id:ctx.orgId,action_case_id:caseId,participant_id:participantId,expires_at:'2099-01-01',revoked_at:null}:
      table==='action_case_attachment_grants'?r.filters.some(([k])=>k==='attachment_id')?{attachment_id:fileId}:[{attachment_id:fileId}]:
      table==='action_case_attachments'?r.filters.some(([k])=>k==='id')?{storage_bucket:'action-case-files',file_path:'scoped.pdf',file_name:'Shared.pdf',content_type:'application/pdf'}:[{id:fileId,file_name:'Shared.pdf',file_size_bytes:100}]:[]})
    const q={select(){return q},eq(...f){r.filters.push(f);return q},in(key,values){r.filters.push([`${key}:in`,values]);return q},order(){return q},update(...v){writes.push({table,v});return q},async maybeSingle(){return result()},then(resolve,reject){return Promise.resolve(result()).then(resolve,reject)}};return q},
    storage:{from(){return {async createSignedUrl(...v){signed.push(v);return {data:{signedUrl:'https://example.test/scoped'}}}}}}}
  const deps=Object.fromEntries(['server-only','./scopeAttachments','./lumpSum','./costing','./quotes','./quoteRequests','./quotePackages','./rfqDelivery','./quotesServer'].map(n=>[n,{}]))
  const server=load('../src/lib/action-cases/server.ts',{...deps,'./contractWorkServer':{},'node:crypto':{},'@/lib/supabase/admin':{createSupabaseAdminClient:()=>db},'@/lib/assignments/tokens':{hashAssignmentToken:()=> 'hash'},
    './projectScheduleServer':{async getSharedProjectSchedule(){return []}},'./domain':{filterActionCasePortalItems:(_role,items)=>items},
    './customerOffersServer':{async getSharedCustomerOffers(org,project,recipient){assert.deepEqual([org,project,recipient],[ctx.orgId,caseId,participantId]);return {enabled:true,offers:[]}}},
    './customerSharing':sharing,'./customerSharingServer':{async readCustomerVisibility(){return {revision:1,tabs:{...sharing.defaultCustomerVisibility(),files:!hidden}}},async requireCustomerSection(org,project,key){assert.deepEqual([org,project,key],[ctx.orgId,caseId,'files']);if(hidden)throw Error('CUSTOMER_SHARING_HIDDEN')}}})
  return {server,reads,writes,signed,hide(){hidden=true},role(value){role=value},participantId,fileId}
}

test('preview uses the exact registered customer and only shared sources, without link creation or last-opened writes',async()=>{
  const h=portalHarness()
  const portal=await h.server.getActionCaseCustomerPreview(ctx,caseId,h.participantId)
  assert.equal(portal.participant.id,h.participantId);assert.equal(portal.actionCase.attachments[0].fileName,'Shared.pdf')
  assert.deepEqual(h.writes,[]);assert.deepEqual(h.signed,[])
  assert.ok(h.reads.every(r=>!r.table.includes('draft')&&!r.table.includes('cost')&&r.table!=='action_case_access_links'))
  await assert.rejects(h.server.getActionCaseCustomerPreview(ctx,caseId,id(99)),/NOT_FOUND/)
  h.role('subcontractor');await assert.rejects(h.server.getActionCaseCustomerPreview(ctx,caseId,h.participantId),/NOT_FOUND/)
  assert.deepEqual(h.writes,[])
})

test('a hidden files page blocks generic direct file URLs before a grant lookup or signed URL is issued',async()=>{
  const h=portalHarness();h.hide()
  await assert.rejects(h.server.createActionCasePortalAttachmentUrl('a'.repeat(43),h.fileId),/SHARING_HIDDEN/)
  assert.deepEqual(h.signed,[]);assert.ok(!h.reads.some(r=>r.table==='action_case_attachment_grants'))
  h.role('subcontractor')
  assert.equal(await h.server.createActionCasePortalAttachmentUrl('a'.repeat(43),h.fileId),'https://example.test/scoped')
  assert.equal(h.signed.length,1)
})
