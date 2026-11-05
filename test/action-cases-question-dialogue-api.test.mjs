import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { questionUuid, questionTaskReplyMutation } from '../src/lib/action-cases/projectQuestions.ts'

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const ctx = { orgId: id(1), userId: id(2) }, caseId = id(3), questionId = id(4)
function load(path, deps) {
  const m = { exports: {} }, source = readFileSync(new URL(path, import.meta.url),'utf8')
  new Function('require','module','exports',ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(key=>{ assert.ok(key in deps,key); return deps[key] },m,m.exports)
  return m.exports
}
const base = { 'server-only': {}, './projectQuestions': { questionUuid, questionTaskReplyMutation }, '@/lib/tasks/server': {}, '@/lib/tasks/automation': {}, '@/lib/tasks/emailTemplates': {}, './questionDialogue': {}, './questionDialogueLinks': {} }

test('question-to-task reply validates trusted scope and recipient and leaves retry identity to the atomic RPC', async () => {
  let member=true
  const calls=[],db={ async rpc(name,args){calls.push({name,args});return {data:name==='project_question_internal_participant'?member:args.p_request_id}} }
  const server=load('../src/lib/action-cases/questionDialogueServer.ts',{...base,'@/lib/supabase/admin':{createSupabaseAdminClient:()=>db}})
  const payload={operation:'task_reply',taskId:id(20),requestId:id(21),recipient:{kind:'contact',id:id(22),email:'recipient@example.invalid'},text:'Test',fileIds:[],actorId:id(99)}
  member=false;await assert.rejects(server.replyQuestionTask(ctx,caseId,questionId,payload),/NOT_FOUND/)
  assert.equal(calls.filter(c=>c.name==='reply_project_question_task').length,0)
  member=true
  assert.deepEqual(await server.replyQuestionTask(ctx,caseId,questionId,payload),{messageId:payload.requestId,questionId})
  assert.equal(calls.at(-1).args.p_actor_id,ctx.userId)
  assert.equal(calls.at(-1).args.p_task_id,payload.taskId)
  assert.deepEqual(calls.at(-1).args.p_recipient,payload.recipient)
  await assert.rejects(server.replyQuestionTask(ctx,caseId,questionId,{...payload,fileIds:[id(25)]}),/INVALID/)
  await assert.rejects(server.replyQuestionTask(ctx,caseId,questionId,{...payload,text:''}),/INVALID/)
})
test('individual reply route uses module context and the task outbox, not group publication', async () => {
  const calls=[],after=[]
  let conflict=false
  const next={NextResponse:{json:(body,options={})=>({body,...options})},after:fn=>after.push(fn)}
  const http=load('../src/lib/action-cases/customerOffersHttp.ts',{'next/server':next,'@/lib/assignments/server':{async requireOrgContext(){return ctx}},'@/lib/access/server':{async requireModuleAccess(){}}})
  const route=load('../src/app/api/action-cases/[caseId]/questions/[questionId]/dialogue/route.ts',{'next/server':next,'@/lib/action-cases/customerOffersHttp':http,'@/lib/action-cases/questionDialogueServer':{async replyQuestionTask(...args){if(conflict)throw Error('PROJECT_QUESTION_TASK_RECIPIENT_CHANGED');calls.push(args);return {messageId:id(21),questionId}},async writeQuestionDialogue(){throw Error('must not share')},async deliverQuestionMessages(){throw Error('must not notify group')}},'@/lib/tasks/automation':{async runTaskFollowupBatch(){calls.push('task outbox')}}})
  const request=origin=>new Request(`https://hushub.se/api/action-cases/${caseId}/questions/${questionId}/dialogue`,{method:'POST',headers:{origin},body:JSON.stringify({operation:'task_reply'})})
  const result=await route.POST(request('https://hushub.se'),{params:Promise.resolve({caseId,questionId})})
  assert.deepEqual(calls[0].slice(0,3),[ctx,caseId,questionId])
  assert.equal(result.body.messageId,id(21));assert.equal(after.length,1)
  await after[0]();assert.equal(calls.at(-1),'task outbox')
  const before=calls.length
  const blocked=await route.POST(request('https://foreign.invalid'),{params:Promise.resolve({caseId,questionId})})
  assert.equal(blocked.status,410);assert.equal(calls.length,before)
  conflict=true
  const rejected=await route.POST(request('https://hushub.se'),{params:Promise.resolve({caseId,questionId})})
  assert.equal(rejected.status,409)
  assert.equal(rejected.body.code,'PROJECT_QUESTION_TASK_RECIPIENT_CHANGED')
  assert.equal(after.length,1)
})
test('group email identifies the project and question without including private communication', async () => {
  const previous=process.env.APP_BASE_URL;process.env.APP_BASE_URL='https://hushub.test'
  try {
    const sent=[],finished=[];let claimed=false
    const member={id:id(10),person_kind:'profile',person_id:ctx.userId,org_id:ctx.orgId,action_case_id:caseId,question_id:questionId,email:'test@example.invalid'}
    const delivery={id:id(11),participant_id:member.id,link_nonce:id(12),recipient_name:'Test',recipient_email:member.email,question_title:'Fiktiv fraga',body_text:'Open the question to read the reply.',attempts:1}
    const db={async rpc(name,args){if(name==='claim_project_question_delivery'){const data=claimed?[]:[delivery];claimed=true;return {data}}if(name==='finish_project_question_delivery'){finished.push(args);return {data:null}}return {data:true}},from(table){const q={select(){return q},eq(){return q},async maybeSingle(){return {data:table==='action_case_question_participants'?member:table==='action_cases'?{title:'TEST project'}:{number:13}}}};return q}}
    const server=load('../src/lib/action-cases/questionDialogueServer.ts',{...base,'@/lib/supabase/admin':{createSupabaseAdminClient:()=>db},'@/lib/tasks/automation':{async sendTaskAccessLinkEmail(value){sent.push(value);return {providerMessageId:'provider-id'}}},'@/lib/tasks/emailTemplates':{buildTaskEmailHtml:value=>`${value.contextLabel}|${value.taskTitle}`}})
    assert.equal((await server.deliverQuestionMessages(questionId)).sent,1)
    assert.match(sent[0].subject,/F-013.*TEST project/)
    assert.match(sent[0].html,/TEST project\|F-013/)
    assert.match(sent[0].text,/Projekt: TEST project/)
    assert.equal(finished[0].p_provider_id,'provider-id')
    assert.equal(sent[0].to,member.email)
  }finally{if(previous===undefined)delete process.env.APP_BASE_URL;else process.env.APP_BASE_URL=previous}
})
test('individual mail obtains question project context read-only without changing versions or reminder scheduling', async () => {
  const calls=[];let failure=null
  const db={from(table){const filters=[],query={select(){return query},eq(...args){filters.push(args);return query},async maybeSingle(){calls.push({table,filters});return failure?{error:failure}:{data:table==='action_case_question_events'?{action_case_id:caseId}:{title:'TEST project'}}}};return query}}
  const automation=load('../src/lib/tasks/automation.ts',{'node:crypto':{},'@/lib/supabase/admin':{},'@/lib/tasks/domain':{DEFAULT_TASK_CALENDAR_POLICY:{},DEFAULT_TASK_REMINDER_POLICY:{}},'@/lib/tasks/dateTime':{},'@/lib/tasks/emailTemplates':{},'@/lib/tasks/internalAccess':{},'@/lib/tasks/branding':{},'@/lib/tasks/recipientAuth':{}})
  const task={id:id(30),org_id:ctx.orgId,context_label:'Projektfråga',version:7,next_followup_at:'2026-11-10T08:00:00Z'}
  const result=await automation.withProjectQuestionContext(db,task)
  assert.equal(result.context_label,'TEST project')
  assert.equal(result.version,7);assert.equal(result.next_followup_at,task.next_followup_at)
  assert.equal(task.context_label,'Projektfråga')
  assert.deepEqual(calls[0].filters,[['org_id',ctx.orgId],['task_id',task.id],['operation','send']])
  assert.deepEqual(calls[1].filters,[['org_id',ctx.orgId],['id',caseId]])
  calls.length=0
  assert.equal((await automation.withProjectQuestionContext(db,{...task,context_label:'Other task'})).context_label,'Other task')
  assert.equal(calls.length,0)
  failure={code:'42P01'}
  assert.equal(await automation.withProjectQuestionContext(db,task),task)
  failure={code:'500'}
  await assert.rejects(automation.withProjectQuestionContext(db,task),/QUESTION_CONTEXT_READ_FAILED/)
})

test('new question contacts use the task contact service only after participant and project-manager checks, without sharing or delivery', async () => {
  let participant = true, manager = false
  const writes = [], db = { async rpc() { return { data: participant } }, from(table) { assert.equal(table, 'action_cases'); const query = { select() { return query }, eq() { return query }, async maybeSingle() { return { data: { manager_profile_id: manager ? ctx.userId : id(90) } } } }; return query } }
  const server = load('../src/lib/action-cases/questionDialogueServer.ts', { ...base, '@/lib/supabase/admin': { createSupabaseAdminClient: () => db }, '@/lib/tasks/server': { async createTaskContact(input) { writes.push(input); return { id: input.requestId, name: input.contact.name, email: input.contact.email } } } })
  const input = { requestId: id(40), contact: { name: 'Ny Testperson', email: 'test@example.invalid', companyName: 'Test AB', phone: '' } }
  await assert.rejects(server.createQuestionContact(ctx, caseId, questionId, input), /FORBIDDEN/)
  participant = false; manager = true
  await assert.rejects(server.createQuestionContact(ctx, caseId, questionId, input), /NOT_FOUND/)
  participant = true
  await assert.rejects(server.createQuestionContact(ctx, caseId, questionId, { ...input, contact: { ...input.contact, email: 'invalid' } }), /INVALID/)
  assert.equal(writes.length, 0)
  const result = await server.createQuestionContact(ctx, caseId, questionId, input)
  assert.equal(result.kind, 'contact'); assert.equal(result.id, input.requestId)
  assert.deepEqual(writes, [{ orgId: ctx.orgId, requestId: input.requestId, contact: input.contact }])
})

test('the shared task contact creator reuses its request id and cannot change another organization or an existing contact', async () => {
  const contacts = new Map(), writes = []
  const db = { from(table) { assert.equal(table, 'organization_contacts'); let org, id, record; const query = { select() { return query }, eq(key, value) { if (key === 'org_id') org = value; if (key === 'id') id = value; return query }, async maybeSingle() { const row = contacts.get(id); return { data: row?.org_id === org ? row : null } }, insert(value) { record = value; return query }, async single() { if (contacts.has(record.id)) return { error: { code: '23505' } }; writes.push(record); contacts.set(record.id, record); return { data: { id: record.id } } } }; return query } }
  const source = readFileSync(new URL('../src/lib/tasks/server.ts', import.meta.url), 'utf8'), module = { exports: {} }
  new Function('require', 'module', 'exports', ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText)(name => name === '@/lib/supabase/admin' ? { createSupabaseAdminClient: () => db } : name === './domain' ? { DEFAULT_TASK_AUTOMATION_LIMITS: {} } : {}, module, module.exports)
  const input = { orgId: ctx.orgId, requestId: id(40), contact: { name: ' Testperson ', email: 'TEST@example.invalid', companyName: '', phone: '' } }
  const first = await module.exports.createTaskContact(input)
  assert.equal(first.name, 'Testperson'); assert.equal(first.email, 'test@example.invalid')
  assert.deepEqual(await module.exports.createTaskContact(input), first); assert.equal(writes.length, 1)
  await assert.rejects(module.exports.createTaskContact({ ...input, orgId: id(99) }), /CREATE_FAILED/)
  await assert.rejects(module.exports.createTaskContact({ ...input, contact: { ...input.contact, name: 'Annan person' } }), /CREATE_FAILED/)
  contacts.get(input.requestId).is_active = false
  await assert.rejects(module.exports.createTaskContact(input), /CREATE_FAILED/)
  assert.equal(writes.length, 1)
})

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

test('a disabled recipient identity or mismatched contact email blocks an otherwise valid personal link',async()=>{
  for (const changedEmail of [false,true]) {
    const reads=[],db={from(table){reads.push(table);const q={select(){return q},eq(){return q},gt(){return q},async maybeSingle(){return {data: table==='action_case_question_participants'?{id:id(8),org_id:ctx.orgId,action_case_id:caseId,question_id:questionId,person_kind:'contact',contact_id:id(9),email:'test@example.invalid'}:table==='organization_contacts'?{email:changedEmail?'other@example.invalid':'test@example.invalid',recipient_identity_id:id(10)}:{status:'disabled'}}}};return q}}
    const server=load('../src/lib/action-cases/questionDialogueServer.ts',{...base,'./questionDialogueLinks':{parseQuestionLink(){return {participantId:id(8),nonce:id(11)}}},'@/lib/supabase/admin':{createSupabaseAdminClient:()=>db}})
    await assert.rejects(server.getPublicQuestionDialogue('signed-token'),/NOT_FOUND/)
    assert.ok(!reads.includes('action_case_question_messages'))
  }
})

test('question notifications reuse the email shell without inventing a deadline; ordinary task mail remains unchanged',()=>{
  const {buildTaskEmailHtml}=load('../src/lib/tasks/emailTemplates.ts',{'server-only':{}})
  const input={previewText:'Ny fråga',eyebrow:'Frågor',heading:'Frågan',recipientName:'Test',lead:'Nytt meddelande',taskTitle:'F-001 <test>',dueLabel:'30 oktober'}
  const ordinary=buildTaskEmailHtml(input)
  assert.match(ordinary,/Uppdrag/);assert.match(ordinary,/Slutdatum/);assert.match(ordinary,/30 oktober/)
  const question=buildTaskEmailHtml({...input,itemLabel:'Fråga',dueLabel:null})
  assert.doesNotMatch(question,/Slutdatum/);assert.match(question,/F-001 &lt;test&gt;/);assert.doesNotMatch(question,/<test>/)
})

test('public dialogue projects only shared content and names, never internal draft text, email or directory identities',async()=>{
  const member={id:id(8),org_id:ctx.orgId,action_case_id:caseId,question_id:questionId,person_kind:'contact',person_id:id(9),contact_id:id(9),name:'Testmottagare',email:'private@example.invalid',shared:true}
  const reads=[],db={from(table){reads.push(table);const q={select(){return q},eq(){return q},gt(){return q},order(){return q},in(key,value){assert.equal(key,'operation');assert.deepEqual(value,['share','reply']);return q},async maybeSingle(){return {data:table==='action_case_question_participants'?member:table==='organization_contacts'?{email:member.email,recipient_identity_id:null}:table==='action_case_questions'?{body:{status:'open',description:'HEMLIG INTERN ÄNDRING'}}:{version:2,shared_body:{title:'Delad fråga',description:'Delat underlag'},shared_at:'2026-10-19T10:00:00Z'}}},async range(){return {data:table==='action_case_question_participants'?[member]:[{id:id(20),participant_id:member.id,actor_name:member.name,actor_method:'personal_link',operation:'reply',message:'Delat svar',created_at:'2026-10-19T10:01:00Z',snapshot:null,files:[]}]}}};return q}}
  const server=load('../src/lib/action-cases/questionDialogueServer.ts',{...base,'./questionDialogueLinks':{parseQuestionLink(){return {participantId:member.id,nonce:id(11)}}},'@/lib/supabase/admin':{createSupabaseAdminClient:()=>db}})
  const result=await server.getPublicQuestionDialogue('signed-token')
  assert.equal(result.snapshot.description,'Delat underlag');assert.equal(result.messages[0].text,'Delat svar')
  assert.equal(result.participants[0].email,null);assert.equal(result.participants[0].personId,'');assert.equal(result.canManage,false)
  assert.doesNotMatch(JSON.stringify(result),/HEMLIG|private@example|00000000-0000-4000-8000-000000000009/)
  assert.ok(!reads.includes('action_case_question_events'));assert.ok(!reads.includes('action_case_question_deliveries'))
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
  const deps=Object.fromEntries(['server-only','@/lib/assignments/tokens','./scopeAttachments','./projectScheduleServer','./lumpSum','./domain','./costing','./quotes','./quoteRequests','./quotePackages','./rfqDelivery','./quotesServer','./customerOffersServer','./customerSharing','./customerSharingServer','./calculationSave','./customerOffers'].map(name=>[name,{}]))
  const server=load('../src/lib/action-cases/server.ts',{...deps,'./contractWorkServer':{},'node:crypto':{},'@/lib/supabase/admin':{createSupabaseAdminClient:()=>db}})
  const filePath=`${ctx.orgId}/${caseId}/questions/${questionId}/test.pdf`,payload={caseId,questionId,fileName:'Test.pdf',contentType:'application/pdf',fileSize:100,filePath}
  await assert.rejects(server.createActionCaseSignedUpload(ctx,payload),/NOT_FOUND/)
  await assert.rejects(server.completeActionCaseUpload(ctx,{...payload,questionId:null}),/INVALID/)
  await assert.rejects(server.createActionCaseAttachmentUrl(ctx,caseId,id(5)),/NOT_FOUND/)
  await assert.rejects(server.updateActionCaseAttachmentGrants(ctx,{caseId,attachmentId:id(5),participantIds:[id(6)]}),/NOT_FOUND/)
  assert.deepEqual(signed,[])
})
