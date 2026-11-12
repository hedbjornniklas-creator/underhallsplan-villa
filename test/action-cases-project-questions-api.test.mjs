import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { emptyQuestion, questionMutation, questionUuid, questionParticipantSelection, questionParticipantDifference } from '../src/lib/action-cases/projectQuestions.ts'
import * as questionModel from '../src/lib/action-cases/projectQuestions.ts'
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const ctx={orgId:id(1),userId:id(2)},caseId=id(3)
function load(path,deps) {
  const code=ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
  const m={exports:{}};new Function('require','module','exports',code)(key=>{assert.ok(key in deps,key);return key === './projectQuestions' ? { ...questionModel, ...deps[key] } : deps[key]},m,m.exports);return m.exports
}
test('dispatch requirements distinguish missing fields, recipient email and invalid follow-up order', () => {
  const { questionSendRequirements } = questionModel
  const empty = { assignee: null, dueAt: null, followupAt: null, confirmed: false }
  assert.deepEqual(questionSendRequirements(empty).map(item => item.field), ['assignee', 'due', 'confirmation'])
  const complete = { assignee: { id: id(8), kind: 'contact', name: 'Test', email: 'test@example.invalid' }, dueAt: '2026-11-09T15:00:00Z', followupAt: '2026-11-06T08:00:00Z', confirmed: true }
  assert.deepEqual(questionSendRequirements(complete), [])
  assert.deepEqual(questionSendRequirements({ ...complete, followupAt: null }), [])
  assert.equal(questionSendRequirements({ ...complete, hasFollowup: true, followupAt: null })[0].field, 'followup')
  assert.match(questionSendRequirements({ ...complete, assignee: { ...complete.assignee, email: '' } })[0].message, /e-post/)
  assert.deepEqual(questionSendRequirements({ ...complete, assignee: { ...complete.assignee, kind: 'profile', email: null } }), [])
  assert.equal(questionSendRequirements({ ...complete, followupAt: '2026-11-10T08:00:00Z' })[0].field, 'followup')
})
test('participant history never invents a first baseline or changes the saved selection', () => {
  const person = { kind: 'contact', id: id(8) }, key = `contact:${person.id}`
  const names = new Map([[key, 'Testperson']]), request = [person, person]
  const selected = questionParticipantSelection(request, names)
  assert.deepEqual(selected, [{ key, name: 'Testperson' }])
  assert.equal(request.length, 2)
  assert.deepEqual(questionParticipantDifference(null, selected), { added: null, removed: null })
  assert.deepEqual(questionParticipantDifference(selected, []), { added: [], removed: selected })
  assert.equal(questionParticipantSelection([{ ...person, kind: 'unknown' }], names), null)
  assert.equal(questionParticipantSelection(null, names), null)
})
test('questions route requires session/module and same-origin body before mutation; only sends enqueue followup',async()=>{
  for(const deny of ['UNAUTHORIZED','MODULE_ACCESS_REQUIRED',null]) {
    const calls=[],followups=[]
    const next={NextResponse:{json:(body,init={})=>({body,...init})},after:fn=>followups.push(fn)}
    const http=load('../src/lib/action-cases/customerOffersHttp.ts',{'next/server':next,'@/lib/assignments/server':{async requireOrgContext(){if(deny==='UNAUTHORIZED')throw Error(deny);return ctx}},'@/lib/access/server':{async requireModuleAccess(){if(deny==='MODULE_ACCESS_REQUIRED')throw Error(deny)}}})
    const route=load('../src/app/api/action-cases/[caseId]/questions/route.ts',{'next/server':next,'@/lib/action-cases/customerOffersHttp':http,'@/lib/action-cases/projectQuestionsServer':{async mutateProjectQuestion(...args){calls.push(args);return {questionId:id(4)}},async getProjectQuestions(...args){calls.push(args);return {questions:[]}}},'@/lib/tasks/automation':{async runTaskFollowupBatch(){}}})
    const req=(operation,origin='https://hushub.se')=>new Request(`https://hushub.se/api/action-cases/${caseId}/questions`,{method:'POST',headers:{origin},body:JSON.stringify({operation})})
    const r=await route.POST(req('create'),{params:Promise.resolve({caseId})})
    if(deny){assert.equal(r.status,deny==='UNAUTHORIZED'?401:403);assert.equal(calls.length,0)}
    else {
      assert.equal(r.headers['Cache-Control'],'no-store');assert.deepEqual(calls[0].slice(0,2),[ctx,caseId]);assert.equal(followups.length,0)
      await route.POST(req('send'),{params:Promise.resolve({caseId})});assert.equal(followups.length,1)
      const bad=await route.POST(req('create','https://foreign.invalid'),{params:Promise.resolve({caseId})});assert.equal(bad.status,410);assert.equal(calls.length,2)
    }
  }
})
test('writer uses only scoped project reads and the atomic question RPC; assignees must be in the authorized task directory',async()=>{
  const calls=[]
  const db={from(table){assert.equal(table,'action_cases');const c={table,filters:[]};calls.push(c);const q={select(){return q},eq(...v){c.filters.push(v);return q},async maybeSingle(){return {data:{id:caseId}}}};return q},async rpc(name,args){if(name==='project_question_customers'){assert.deepEqual(args,{p_org_id:ctx.orgId,p_case_id:caseId});return {data:[]}}calls.push({name,args});return {data:id(4)}}}
  const server=load('../src/lib/action-cases/projectQuestionsServer.ts',{'server-only':{},'@/lib/supabase/admin':{createSupabaseAdminClient:()=>db},'@/lib/tasks/server':{async getTaskPeople(){return [{id:ctx.userId,kind:'profile',name:'Test',isActive:true}]}},'@/lib/tasks/attachments':{createTaskAttachmentSignedUrl(){throw Error('unexpected')}},'./projectQuestions':{questionMutation,questionUuid}})
  const body={questionId:id(4),requestId:id(5),revision:0,operation:'create',body:{...emptyQuestion(),title:'VVB',description:'Kan den monteras här?',assignee:{id:ctx.userId,kind:'profile',name:'spoof'}},fileIds:[]}
  await server.mutateProjectQuestion(ctx,caseId,body)
  assert.deepEqual(calls[0].filters,[['org_id',ctx.orgId],['id',caseId]])
  assert.equal(calls[1].name,'mutate_project_question');assert.equal(calls[1].args.p_actor_id,ctx.userId);assert.equal(calls[1].args.p_request.body.assignee.name,'')
  await assert.rejects(server.mutateProjectQuestion(ctx,caseId,{...body,body:{...body.body,assignee:{id:id(9),kind:'profile',name:'Test'}}}),/ASSIGNEE/)
  assert.equal(calls.filter(c=>c.name).length,1)
  await assert.rejects(server.mutateProjectQuestion(ctx,caseId,{...body,operation:'send',confirmed:true}),/DATES/)
})
test('task file access requires the exact project/task relationship before signing, not an arbitrary task UUID',async()=>{
  const calls=[],signed=[]
  const db={from(table){const c={table,filters:[]};calls.push(c);const q={select(){return q},eq(...v){c.filters.push(v);return q},async maybeSingle(){return {data:table==='action_cases'?{id:caseId}:null}}};return q}}
  const server=load('../src/lib/action-cases/projectQuestionsServer.ts',{'server-only':{},'@/lib/supabase/admin':{createSupabaseAdminClient:()=>db},'@/lib/tasks/server':{},'@/lib/tasks/attachments':{async createTaskAttachmentSignedUrl(v){signed.push(v)}},'./projectQuestions':{questionMutation,questionUuid}})
  await assert.rejects(server.projectQuestionTaskFile(ctx,caseId,id(5),id(6)),/NOT_FOUND/)
  assert.deepEqual(calls[1].filters,[['org_id',ctx.orgId],['action_case_id',caseId],['task_id',id(5)]])
  assert.equal(signed.length,0)
})

test('creation dates come from the immutable create event, never the latest update or meeting date', async () => {
  const created = '2026-10-17T08:00:00Z', updated = '2026-10-19T10:00:00Z'
  const questions = [4, 5].map(n => ({ id: id(n), number: n, revision: 2, updated_at: updated, body: { ...emptyQuestion(), meetingDate: '2026-10-01' } }))
  const events = [
    { id: id(40), question_id: id(4), revision: 2, operation: 'update', created_at: updated, task_id: null },
    { id: id(41), question_id: id(4), revision: 1, operation: 'create', created_at: created, task_id: null }
  ]
  const calls = []
  const db = { async rpc() { return { data: [] } }, from(table) {
    const call = { table, filters: [] }; calls.push(call)
    const q = { select() { return q }, eq(...args) { call.filters.push(args); return q }, in(...args) { call.filters.push(args); return q }, order() { return q },
      async maybeSingle() { return { data: { id: caseId, manager_profile_id: ctx.userId } } },
      async range(from, to) { return { data: (table === 'action_case_questions' ? questions : table === 'action_case_attachments' || table === 'action_case_question_messages' ? [] : table === 'action_case_question_participants' ? questions.map(row => ({ id: id(100 + row.number), question_id: row.id, person_kind: 'profile', person_id: ctx.userId, name: 'Test', active: true })) : events).slice(from, to + 1) } } }
    return q
  } }
  const server = load('../src/lib/action-cases/projectQuestionsServer.ts', { 'server-only': {}, '@/lib/supabase/admin': { createSupabaseAdminClient: () => db }, '@/lib/tasks/server': { async getTaskPeople() { return [] } }, '@/lib/tasks/attachments': {}, './projectQuestions': { questionMutation, questionUuid } })
  const result = await server.getProjectQuestions(ctx, caseId)
  assert.equal(result.questions[0].createdAt, created)
  assert.equal(result.questions[0].updatedAt, updated)
  assert.equal(result.questions[1].createdAt, null)
  for (const call of calls) assert.ok(call.table === 'action_case_question_messages' ? call.filters.some(([key, value]) => key === 'question_id' && value.every(q => questions.some(row => row.id === q))) : call.filters.some(([key, value]) => key === 'org_id' && value === ctx.orgId))
})

test('history reads immutable participant selections and dispatch evidence only for questions the actor participates in', async () => {
  const questionId = id(4), foreign = id(5)
  const manager = { kind: 'profile', id: ctx.userId }, jn = { kind: 'contact', id: id(6) }, nh = { kind: 'contact', id: id(7) }
  const request = participants => ({ participants, privateToken: 'NEVER EXPOSE' })
  const rows = {
    action_case_question_participants: [manager, jn, nh].map((p, i) => ({ id: id(20 + i), org_id: ctx.orgId, action_case_id: caseId, question_id: questionId, person_kind: p.kind, person_id: p.id, name: ['Manager', 'jn', 'nh'][i], active: i !== 2, shared: true })),
    action_case_questions: [questionId, foreign].map(q => ({ id: q, number: 1, revision: 1, org_id: ctx.orgId, action_case_id: caseId, body: { ...emptyQuestion(), title: 'Test', description: 'Body' }, updated_at: '2026-11-05T10:00:00Z' })),
    action_case_question_events: [], action_case_attachments: [],
    action_case_question_messages: [
      { id: id(30), question_id: questionId, operation: 'participants', actor_name: 'Manager', created_at: '2026-11-05T10:01:00Z', request: request([manager, jn]) },
      { id: id(31), question_id: questionId, operation: 'participants', actor_name: 'Manager', created_at: '2026-11-05T10:02:00Z', request: request([manager, jn, nh]) },
      { id: id(32), question_id: questionId, operation: 'share', actor_name: 'Manager', created_at: '2026-11-05T10:03:00Z', snapshot: { title: 'Shared title', description: 'Shared body' }, files: [{ attachment_id: id(60), file_name: 'Original.pdf' }] },
      { id: id(33), question_id: questionId, operation: 'participants', actor_name: 'Manager', created_at: '2026-11-05T10:04:00Z', request: request([manager, jn]) },
      { id: id(34), question_id: foreign, operation: 'participants', actor_name: 'PRIVATE', created_at: '2026-11-05T10:04:00Z', request: request([manager]) }
    ],
    action_case_question_deliveries: [{ id: id(40), message_id: id(32), recipient_name: 'nh', status: 'sent', sent_at: '2026-11-05T10:03:10Z', provider_message_id: 'PRIVATE' }]
  }
  const calls = []
  const db = { async rpc() { return { data: [] } }, from(table) {
    const filters = [], call = { table, filters }; calls.push(call)
    const query = { select() { return query }, eq(key, value) { filters.push([key, value]); return query }, in(key, value) { filters.push([key, value]); return query }, order() { return query },
      async maybeSingle() { return { data: { id: caseId, manager_profile_id: ctx.userId } } },
      async range(from, to) { return { data: (rows[table] || []).filter(row => filters.every(([key, value]) => Array.isArray(value) ? value.includes(row[key]) : row[key] === value)).slice(from, to + 1) } }
    }
    return query
  } }
  const server = load('../src/lib/action-cases/projectQuestionsServer.ts', { 'server-only': {}, '@/lib/supabase/admin': { createSupabaseAdminClient: () => db }, '@/lib/tasks/server': { async getTaskPeople() { return [] } }, '@/lib/tasks/attachments': {}, './projectQuestions': questionModel })
  const result = await server.getProjectQuestions(ctx, caseId)
  assert.equal(result.questions.length, 1)
  const q = result.questions[0], history = q.dialogueHistory
  assert.equal(q.participants.some(p => p.name === 'nh'), false)
  assert.equal(history.length, 4)
  assert.equal(history[0].added, null)
  assert.deepEqual(history[1].added.map(p => p.name), ['nh'])
  assert.deepEqual(history[3].removed.map(p => p.name), ['nh'])
  assert.deepEqual(history[2].snapshot, { title: 'Shared title', description: 'Shared body' })
  assert.equal(history[2].files[0].name, 'Original.pdf')
  assert.equal(history[2].deliveries[0].status, 'sent')
  assert.doesNotMatch(JSON.stringify(result), /NEVER EXPOSE|PRIVATE|link_nonce|request/)
  for (const call of calls.filter(c => c.table === 'action_case_question_messages')) assert.ok(call.filters.some(([key, value]) => key === 'question_id' && value.length === 1 && value[0] === questionId))
  // No membership means no reads of question history, messages or deliveries.
  rows.action_case_question_participants.forEach(p => { p.active = false }); calls.length = 0
  assert.equal((await server.getProjectQuestions(ctx, caseId)).questions.length, 0)
  assert.equal(calls.some(c => ['action_case_question_messages', 'action_case_question_deliveries', 'action_case_question_events'].includes(c.table)), false)
})

test('customer directory is read-only and missing migration preserves existing contacts without hiding other failures', async () => {
  let failure = null
  const customer = { id: id(8), name: 'Beställare', email: 'customer@example.invalid', phone: 'unused' }
  const db = { async rpc(name, args) {
    assert.equal(name, 'project_question_customers')
    assert.deepEqual(args, { p_org_id: ctx.orgId, p_case_id: caseId })
    return failure ? { error: failure } : { data: [customer] }
  } }
  const server = load('../src/lib/action-cases/projectQuestionsServer.ts', { 'server-only': {}, '@/lib/supabase/admin': { createSupabaseAdminClient: () => db }, '@/lib/tasks/server': { async getTaskPeople() { return [{ id: id(9), kind: 'contact', name: 'Befintlig kontakt', isActive: true }, { id: id(10), kind: 'contact', name: 'Avstängd', isActive: false }] } }, '@/lib/tasks/attachments': {}, './projectQuestions': { questionMutation, questionUuid } })
  const result = await server.questionAssignees(ctx, caseId)
  assert.equal(result.customersAvailable, true)
  assert.deepEqual(result.assignees[0], { id: customer.id, name: customer.name, email: customer.email, kind: 'customer' })
  assert.equal(result.assignees.length, 2)
  failure = { code: 'PGRST202' }
  const legacy = await server.questionAssignees(ctx, caseId)
  assert.equal(legacy.customersAvailable, false); assert.equal(legacy.assignees.length, 1)
  failure = { code: '42501' }
  await assert.rejects(server.questionAssignees(ctx, caseId), /FAILED/)
})
test('abort and complete retries cannot delete registered originals, including originals pinned by question history',async()=>{
  for(const state of ['registered','read-error','pending']) {
    const removed=[],calls=[]
    const db={from(table){calls.push(table);const q={select(){return q},eq(){return q},async maybeSingle(){return {data:{id:caseId}}},async limit(){return state==='read-error'?{error:{message:'unavailable'}}:{data:state==='registered'?[{id:id(6),file_name:'Ritning.pdf',content_type:'application/pdf',file_size_bytes:120}]:[]}}};return q},storage:{from(){return {async remove(paths){removed.push(paths);return {error:null}}}}}}
    const deps=Object.fromEntries(['server-only','@/lib/assignments/tokens','./scopeAttachments','./projectScheduleServer','./lumpSum','./domain','./costing','./quotes','./quoteRequests','./quotePackages','./rfqDelivery','./quotesServer','./customerOffersServer','./customerSharing','./customerSharingServer','./calculationSave','./customerOffers'].map(name=>[name,{}]))
    const server=load('../src/lib/action-cases/server.ts',{...deps,'./contractWorkServer':{},'node:crypto':{},'@/lib/supabase/admin':{createSupabaseAdminClient:()=>db}})
    const filePath=`${ctx.orgId}/${caseId}/original.pdf`
    if(state==='pending')await server.abortActionCaseUpload(ctx,{caseId,filePath})
    else await assert.rejects(server.abortActionCaseUpload(ctx,{caseId,filePath}),state==='registered'?/FILE_IN_USE/:/DELETE_FAILED/)
    if(state==='registered') {
      await server.completeActionCaseUpload(ctx,{caseId,filePath,fileName:'Ritning.pdf',contentType:'application/pdf',fileSize:120})
      await assert.rejects(server.completeActionCaseUpload(ctx,{caseId,filePath,fileName:'Other.pdf',contentType:'application/pdf',fileSize:120}),/FILE_IN_USE/)
    }
    assert.equal(removed.length,state==='pending'?1:0)
    assert.ok(calls.every(table=>['action_cases','action_case_attachments'].includes(table)))
  }
})
