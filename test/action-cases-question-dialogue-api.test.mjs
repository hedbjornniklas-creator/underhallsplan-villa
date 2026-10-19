import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { questionUuid } from '../src/lib/action-cases/projectQuestions.ts'

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const ctx = { orgId: id(1), userId: id(2) }, caseId = id(3), questionId = id(4)
function load(path, deps) {
  const m = { exports: {} }, source = readFileSync(new URL(path, import.meta.url),'utf8')
  new Function('require','module','exports',ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(key=>{ assert.ok(key in deps,key); return deps[key] },m,m.exports)
  return m.exports
}
const base = { 'server-only': {}, './projectQuestions': { questionUuid }, '@/lib/tasks/automation': {}, '@/lib/tasks/emailTemplates': {}, './questionDialogue': {}, './questionDialogueLinks': {} }

test('nonparticipants cannot read dialog or sign a shared file even with valid project and file identifiers',async()=>{
  const calls=[],db={ async rpc(name,args){ calls.push({name,args});return {data:false} },from(){throw Error('private read before authorization')} }
  const server=load('../src/lib/action-cases/questionDialogueServer.ts',{...base,'@/lib/supabase/admin':{createSupabaseAdminClient:()=>db}})
  await assert.rejects(server.getQuestionDialogue(ctx,caseId,questionId),/NOT_FOUND/)
  await assert.rejects(server.questionDialogueFile(caseId,questionId,id(5),ctx),/NOT_FOUND/)
  assert.ok(calls.every(c=>c.name==='project_question_internal_participant'&&c.args.p_question_id===questionId&&c.args.p_profile_id===ctx.userId))
})

test('a forged personal link is rejected before any database read',async()=>{
  let opened=false
  const server=load('../src/lib/action-cases/questionDialogueServer.ts',{...base,'./questionDialogueLinks':{parseQuestionLink(){throw Error('PROJECT_QUESTION_NOT_FOUND')}},'@/lib/supabase/admin':{createSupabaseAdminClient(){opened=true;throw Error('unexpected')}}})
  await assert.rejects(server.getPublicQuestionDialogue('forged'),/NOT_FOUND/)
  await assert.rejects(server.writePublicQuestionDialogue('forged',{operation:'participants'}),/NOT_FOUND/)
  assert.equal(opened,false)
})

test('project manager appointment is administrator-only and rechecked atomically, with a retry-safe expected manager',async()=>{
  let admin=false, current=null;const writes=[]
  const db={from(table){const q={select(){return q},eq(){return q},async maybeSingle(){return {data:table==='org_members'?{role:admin?'admin':'inspector'}:{id:caseId,manager_profile_id:current}}}};return q},async rpc(name,args){writes.push({name,args});current=args.p_manager_id;return {data:caseId}}}
  const server=load('../src/lib/action-cases/projectManagerServer.ts',{'server-only':{},'./projectQuestions':{questionUuid},'@/lib/tasks/server':{async getTaskPeople(){return [{id:ctx.userId,kind:'profile',name:'Testledare',isActive:true}]}},'@/lib/supabase/admin':{createSupabaseAdminClient:()=>db}})
  const payload={managerId:ctx.userId,expectedManagerId:null}
  await assert.rejects(server.setProjectManager(ctx,caseId,payload),/FORBIDDEN/);assert.equal(writes.length,0)
  admin=true
  const result=await server.setProjectManager(ctx,caseId,payload)
  assert.equal(result.managerId,ctx.userId);assert.deepEqual(writes[0],{name:'set_project_manager',args:{p_org_id:ctx.orgId,p_case_id:caseId,p_actor_id:ctx.userId,p_manager_id:ctx.userId,p_expected_manager_id:null}})
  await server.setProjectManager(ctx,caseId,payload);assert.equal(writes.length,1)
  await assert.rejects(server.setProjectManager(ctx,caseId,{...payload,managerId:id(9)}),/INVALID/)
})

test('private question uploads cannot be requested, completed, granted or opened as public project files',async()=>{
  const signed=[],db={from(table){const q={select(){return q},eq(){return q},async maybeSingle(){return {data:table==='action_cases'?{id:caseId}:{question_id:questionId}}}};return q},async rpc(){return {data:false}},storage:{from(){return {async createSignedUploadUrl(){signed.push('upload')},async createSignedUrl(){signed.push('download')}}}}}
  const deps=Object.fromEntries(['server-only','@/lib/assignments/tokens','./scopeAttachments','./projectScheduleServer','./lumpSum','./domain','./costing','./quotes','./quoteRequests','./quotePackages','./rfqDelivery','./quotesServer','./customerOffersServer'].map(name=>[name,{}]))
  const server=load('../src/lib/action-cases/server.ts',{...deps,'node:crypto':{},'@/lib/supabase/admin':{createSupabaseAdminClient:()=>db}})
  const filePath=`${ctx.orgId}/${caseId}/questions/${questionId}/test.pdf`,payload={caseId,questionId,fileName:'Test.pdf',contentType:'application/pdf',fileSize:100,filePath}
  await assert.rejects(server.createActionCaseSignedUpload(ctx,payload),/NOT_FOUND/)
  await assert.rejects(server.completeActionCaseUpload(ctx,{...payload,questionId:null}),/INVALID/)
  await assert.rejects(server.createActionCaseAttachmentUrl(ctx,caseId,id(5)),/NOT_FOUND/)
  await assert.rejects(server.updateActionCaseAttachmentGrants(ctx,{caseId,attachmentId:id(5),participantIds:[id(6)]}),/NOT_FOUND/)
  assert.deepEqual(signed,[])
})
