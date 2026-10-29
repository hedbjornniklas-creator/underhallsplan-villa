import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { contractWorkPriceInput } from '../src/lib/action-cases/contractWork.ts'
import { offerId } from '../src/lib/action-cases/customerOffers.ts'

const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
function load(path,deps){
  const code=ts.transpileModule(readFileSync(new URL(`../${path}`,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
  const m={exports:{}};new Function('require','module','exports',code)(name=>{assert.ok(name in deps,name);return deps[name]},m,m.exports)
  return m.exports
}
const ctx={orgId:id(1),userId:id(2)}
function harness({locked=false,error=null}={}){
  const calls=[], reads=[], links={[id(4)]:{revision:3,locked,version:null,documentId:null,price:{editable:true,split:'combined',amountOre:0,labourOre:null,materialOre:null},differences:[]}}
  const admin={async rpc(name,args){calls.push({name,args});return {data:{available:true,links},error}},from(table){
    const filters=[],q={select(){return q},eq(k,v){filters.push([k,v]);return q},async maybeSingle(){reads.push({table,filters});return {data:table==='action_case_quote_requests'?{lines:[{itemId:id(4)}]}:{action_case_item_id:id(4)},error:null}}};return q
  }}
  return {...load('src/lib/action-cases/contractWorkServer.ts',{'server-only':{},'@/lib/supabase/admin':{createSupabaseAdminClient:()=>admin},'./customerOffers':{offerId},'./contractWork':{contractWorkPriceInput}}),calls,reads}
}

test('price input keeps zero distinct from missing and rejects malformed or unsafe values',()=>{
  for(const amountOre of [0,1,100000000000,null]) assert.deepEqual(contractWorkPriceInput({amountOre,labourOre:null,materialOre:null}),{amountOre,labourOre:null,materialOre:null})
  for(const input of [null,[],{}, {amountOre:'0',labourOre:null,materialOre:null}, {amountOre:NaN,labourOre:null,materialOre:null}, {amountOre:-1,labourOre:null,materialOre:null}]) assert.throws(()=>contractWorkPriceInput(input))
})
test('price writes use only the canonical revisioned contract RPC and trusted actor, not calculation or supplied organization',async()=>{
  const h=harness();await h.writeContractWorkPrice(ctx,{caseId:id(3),itemId:id(4),revision:3,orgId:id(99),price:{amountOre:0,labourOre:null,materialOre:null},unitCost:1})
  assert.deepEqual(h.calls,[{name:'write_contract_work_price',args:{p_org_id:id(1),p_case_id:id(3),p_user_id:id(2),p_item_id:id(4),p_revision:3,p_price:{amountOre:0,labourOre:null,materialOre:null}}}])
  await assert.rejects(h.writeContractWorkPrice(ctx,{caseId:id(3),itemId:id(4),revision:0,price:{amountOre:0}}),/INVALID/)
  assert.equal(h.calls.length,1)
})
test('unavailable lock reads fail closed, while known database conflicts remain actionable',async()=>{
  for(const [error,pattern] of [[{code:'PGRST202'},/CONTRACT_SCHEMA/],[{code:'40001'},/STALE/],[{message:'ACTION_CASE_CONTRACT_LOCKED'},/CONTRACT_LOCKED/],[{message:'private failure'},/CONTRACT_READ_FAILED/]])
    await assert.rejects(harness({error}).getContractWorkLinks(ctx,id(3)),pattern)
})
test('preflight prevents AI and mail side effects for direct, line-derived and grouped request locks',async()=>{
  const h=harness({locked:true})
  for(const [action,payload] of [['generate_cost_suggestions',{itemId:id(4)}],['send_quote_request',{itemId:id(4)}],['update_cost_line',{costLineId:id(5)}],['quote_request',{lines:[{itemId:id(4)}]}],['send_grouped_quote_request',{requestId:id(6)}],['quote_package',{requestId:id(6)}]])
    await assert.rejects(h.assertContractWorkMutation(ctx,action,{caseId:id(3),...payload}),/CONTRACT_LOCKED/)
  assert.ok(h.reads.every(r=>r.filters.some(([k,v])=>k==='org_id'&&v===ctx.orgId)))
  const before=h.calls.length;await h.assertContractWorkMutation(ctx,'purchase_list',{})
  assert.equal(h.calls.length,before)
})
test('HTTP rejects locked mutations before running AI, writing or emailing, and price revisions map to conflicts',async()=>{
  const calls=[], deps=Object.fromEntries(['server','costingAiAlerts','quotesServer','quoteRequestsServer','workPartsServer','quotePackagesServer','rfqDeliveryServer','scopeDraft','costCompletionServer'].map(n=>[`@/lib/action-cases/${n}`,{}]))
  const api=load('src/app/api/action-cases/route.ts',{...deps,'next/server':{NextResponse:{json:(body,init)=>Response.json(body,init)}},'@/lib/access/server':{requireModuleAccess:async()=>{}},'@/lib/assignments/server':{requireOrgContext:async()=>ctx},
    '@/lib/action-cases/costingAiServer':{generateActionCaseCosts:async()=>calls.push('ai')},
    '@/lib/action-cases/contractWorkServer':{assertContractWorkMutation:async(_,action)=>{if(action!=='update_contract_work_price')throw Error('ACTION_CASE_CONTRACT_LOCKED')},writeContractWorkPrice:async()=>{throw Error('CUSTOMER_OFFER_STALE')}}})
  for(const action of ['generate_cost_suggestions','send_grouped_quote_request','update_contract_work_price']){
    const response=await api.POST(new Request('https://example.test/api/action-cases',{method:'POST',body:JSON.stringify({action,payload:{caseId:id(3),itemId:id(4)}})}))
    assert.equal(response.status,409)
    assert.match((await response.json()).error,/låst|ändrats/)
  }
  assert.deepEqual(calls,[])
})
