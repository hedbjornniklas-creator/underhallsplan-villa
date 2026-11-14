import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID as id } from 'node:crypto'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import * as domain from '../src/lib/action-cases/workInstructions.ts'

function load(path, deps) {
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const module = { exports: {} }
  new Function('require','module','exports',code)(name => { assert.ok(name in deps, name); return deps[name] }, module, module.exports)
  return module.exports
}
test('instructions accept text, documents, diary images and explicit clearing without accepting business fields or duplicates', () => {
  const file = { source: 'project', id: id() }, diary = { source: 'diary', id: id() }, body = { text: '\nFiktiv instruktion\n', files: [file, diary] }
  assert.deepEqual(domain.normalizeInstructionBody(body), body)
  assert.deepEqual(domain.normalizeInstructionBody({ text: '', files: [] }), { text: '', files: [] })
  assert.equal(domain.instructionFileKey(diary), `diary:${diary.id}`)
  assert.equal(domain.instructionSaveRequest({ requestId: id(), revision: 0, body }).revision, 0)
  for (const patch of [{ scope: 'No' }, { text: null }, { text: 'x'.repeat(12001) }, { text: '\0' }, { files: [file,file] }, { files: [{ ...file, grant: true }] }, { files: [{ ...file, source: 'url' }] }, { files: [{ ...file, id: '../file' }] }, { files: Array.from({ length: 51 }, () => ({ source: 'project', id: id() })) }]) assert.throws(() => domain.normalizeInstructionBody({ ...body, ...patch }), /WORK_INSTRUCTIONS_INVALID/)
  for (const patch of [{ revision: -1 }, { revision: '0' }, { revision: 1.1 }, { revision: 2147483647 }, { requestId: 'bad' }, { amount: 123 }, { operation: 'update_scope' }]) assert.throws(() => domain.instructionSaveRequest({ requestId: id(), revision: 0, body, ...patch }), /INVALID/)
})

function fixture() {
  const orgId = id(), userId = id(), caseId = id(), itemId = id(), fileId = id(), photoId = id(), calls = []
  const stamp = new Date().toISOString(), body = { text: 'Befintlig instruktion', files: [{ source: 'project', id: fileId }] }
  const tables = {
    org_members: [{ org_id: orgId, profile_id: userId, is_active: true }], action_cases: [{ id: caseId, org_id: orgId, status: 'in_progress' }],
    action_case_items: [{ id: itemId, org_id: orgId, action_case_id: caseId, locked: true }],
    action_case_instruction_versions: [{ item_id: itemId, org_id: orgId, action_case_id: caseId, revision: 1, body, actor_name: 'Test', created_at: stamp }],
    action_case_instruction_files: [{ item_id: itemId, revision: 1, attachment_id: fileId, diary_photo_id: null, position: 1, file_name: 'Montering.pdf', content_type: 'application/pdf', file_size_bytes: 100 }],
    action_case_attachments: [{ id: fileId, org_id: orgId, action_case_id: caseId, question_id: null, file_name: 'Montering.pdf', title: null, content_type: 'application/pdf', file_size_bytes: 100, created_at: stamp }],
  }
  const db = { from(table) {
    assert.ok(table in tables, `Unexpected business table: ${table}`)
    let filters = [], count = Infinity, offset = 0
    const rows = () => tables[table].filter(row => filters.every(fn => fn(row))).sort((a,b) => (b.revision || 0) - (a.revision || 0)).slice(offset, offset + count)
    const query = { select(...args) { calls.push([table,'select',...args]); return query }, eq(key,value) { calls.push([table,'eq',key,value]); filters.push(row => row[key] === value); return query },
      is(key,value) { filters.push(row => row[key] === value); return query }, in(key,values) { filters.push(row => values.includes(row[key])); return query }, lt(key,value) { filters.push(row => row[key] < value); return query }, order() { return query }, limit(value) { count = value; return query }, range(from,to) { calls.push([table,'range',from,to]); offset=from; count=to-from+1; return query }, async maybeSingle() { return { data: rows()[0] || null, error: null } }, then(resolve) { return Promise.resolve({ data: rows(), error: null }).then(resolve) } }
    return query
  }, async rpc(name,args) { calls.push(['rpc',name,args]); assert.equal(name,'write_work_instructions'); return { data: { requestId: args.p_data.requestId, revision: 1, createdAt: stamp, actorName: 'Test' }, error: null } } }
  const uploads = []
  const server = load('../src/lib/action-cases/workInstructionsServer.ts', {
    'server-only': {}, '@/lib/supabase/admin': { createSupabaseAdminClient: () => db }, './workInstructions': domain,
    './server': { async createActionCaseSignedUpload(ctx,payload) { uploads.push(['prepare',ctx,payload]); return { bucket: 'action-case-files', filePath: 'private/path', token: 'synthetic' } }, async completeActionCaseUpload(ctx,payload) { uploads.push(['complete',ctx,payload]); return fileId } },
  })
  return { orgId,userId,caseId,itemId,fileId,photoId,tables,calls,db,server,uploads,body,ctx:{orgId,userId} }
}
test('read, save and history use a separate model, stable project/file scope and never write work, costing or contracts', async () => {
  const f = fixture(), result = await f.server.getWorkInstructions(f.ctx,f.caseId,f.itemId)
  assert.equal(result.revision,1); assert.equal(result.readOnly,false); assert.equal(result.files[0].fileName,'Montering.pdf')
  assert.equal(result.files[0].url,`/api/action-cases/${f.caseId}/attachments/${f.fileId}`)
  assert.deepEqual(result.body,f.body); assert.equal(result.projectFiles.length,1)
  const request = { requestId:id(), revision:0, body:f.body }, saved = await f.server.saveWorkInstructions(f.ctx,f.caseId,f.itemId,request)
  assert.equal(saved.requestId,request.requestId); assert.equal(saved.files.length,1)
  const rpc = f.calls.find(call => call[0] === 'rpc')
  assert.deepEqual(rpc[2],{p_org_id:f.orgId,p_case_id:f.caseId,p_item_id:f.itemId,p_actor_id:f.userId,p_data:request})
  assert.equal((await f.server.getWorkInstructionHistory(f.ctx,f.caseId,f.itemId,null)).versions.length,1)
  for (const before of ['0','-1','abc','1.1','2147483648']) await assert.rejects(f.server.getWorkInstructionHistory(f.ctx,f.caseId,f.itemId,before),/INVALID/)
  await assert.rejects(f.server.getWorkInstructions(f.ctx,f.caseId,id()),/NOT_FOUND/)
  await assert.rejects(f.server.getWorkInstructions({...f.ctx,userId:id()},f.caseId,f.itemId),/FORBIDDEN/)
})

test('history is bounded, paginated and retains diary photo provenance without making it a project scope attachment', async () => {
  const f=fixture(), base=f.tables.action_case_instruction_versions[0], file=f.tables.action_case_instruction_files[0]
  f.tables.action_case_instruction_versions=Array.from({length:23},(_,n)=>({...base,revision:n+1,body:{text:`V${n+1}`,files:[{source:'diary',id:f.photoId}]}}))
  f.tables.action_case_instruction_files=Array.from({length:23},(_,n)=>({...file,revision:n+1,attachment_id:null,diary_photo_id:f.photoId,file_name:'Dagbok.jpg',content_type:'image/jpeg'}))
  const first=await f.server.getWorkInstructionHistory(f.ctx,f.caseId,f.itemId,null)
  assert.equal(first.versions.length,20); assert.equal(first.nextBeforeRevision,4)
  assert.equal(first.versions[0].files[0].id,`diary:${f.photoId}`)
  assert.equal(first.versions[0].files[0].url,`/api/action-cases/${f.caseId}/diary/photos/${f.photoId}`)
  const next=await f.server.getWorkInstructionHistory(f.ctx,f.caseId,f.itemId,'4')
  assert.deepEqual(next.versions.map(v=>v.revision),[3,2,1]); assert.equal(next.nextBeforeRevision,null)
})

test('uploads reuse the existing project file pipeline but cannot assign scope, question ownership or portal grants', async () => {
  const f=fixture(), meta={fileName:'Montering.pdf',contentType:'application/pdf',fileSize:100}
  await f.server.uploadWorkInstructionFile(f.ctx,f.caseId,f.itemId,{operation:'prepare',...meta})
  const result=await f.server.uploadWorkInstructionFile(f.ctx,f.caseId,f.itemId,{operation:'complete',...meta,filePath:'private/path'})
  assert.equal(result.file.id,f.fileId)
  assert.deepEqual(f.uploads[1][2],{caseId:f.caseId,...meta,filePath:'private/path',itemId:null,participantIds:[]})
  for (const extra of [{itemId:f.itemId},{questionId:id()},{participantIds:[id()]}]) await assert.rejects(f.server.uploadWorkInstructionFile(f.ctx,f.caseId,f.itemId,{operation:'prepare',...meta,...extra}),/INVALID/)
  f.tables.action_cases[0].status='completed'
  assert.equal((await f.server.getWorkInstructions(f.ctx,f.caseId,f.itemId)).readOnly,true)
  await assert.rejects(f.server.uploadWorkInstructionFile(f.ctx,f.caseId,f.itemId,{operation:'prepare',...meta}),/CLOSED/)
})

test('a full history page loads all 1000 file snapshots in bounded batches', async () => {
  const f=fixture(), version=f.tables.action_case_instruction_versions[0], file=f.tables.action_case_instruction_files[0]
  const refs=Array.from({length:50},()=>({source:'project',id:id()}))
  f.tables.action_case_instruction_versions=Array.from({length:21},(_,n)=>({...version,revision:n+1,body:{text:`V${n+1}`,files:refs}}))
  f.tables.action_case_instruction_files=f.tables.action_case_instruction_versions.flatMap(version=>refs.map((ref,index)=>({...file,revision:version.revision,attachment_id:ref.id,position:index+1})))
  const result=await f.server.getWorkInstructionHistory(f.ctx,f.caseId,f.itemId,null)
  assert.equal(result.versions.length,20);assert.ok(result.versions.every(version=>version.files.length===50))
  assert.deepEqual(f.calls.filter(call=>call[0]==='action_case_instruction_files'&&call[1]==='range').map(call=>call.slice(2)),[[0,499],[500,999]])
})

test('HTTP routes require Gizmo access, reject cross-origin or oversized writes and expose no internal errors', async () => {
  const calls=[], next={NextResponse:{json:(body,init)=>({body,...init})}}, caseId=id(),itemId=id()
  let denied=false
  const route=load('../src/app/api/action-cases/[caseId]/items/[itemId]/instructions/route.ts',{
    'next/server':next,'@/lib/action-cases/customerOffersHttp':{async customerOfferContext(){if(denied)throw Error('MODULE_ACCESS_REQUIRED');return{orgId:id(),userId:id()}}},
    '@/lib/action-cases/workInstructionsServer':{
      async getWorkInstructions(...args){calls.push(['read',...args]);return{revision:0}},
      async getWorkInstructionHistory(...args){calls.push(['history',...args]);return{versions:[]}},
      async saveWorkInstructions(...args){calls.push(['save',...args]);return{revision:1}},
      async uploadWorkInstructionFile(...args){calls.push(['upload',...args]);return{file:{id:id()}}},
    },
  })
  const url=`https://hushub.se/api/action-cases/${caseId}/items/${itemId}/instructions`, params={params:Promise.resolve({caseId,itemId})}
  assert.equal((await route.GET(new Request(url),params)).status,200)
  assert.equal((await route.GET(new Request(`${url}?history=1&before=3`),params)).status,200)
  const post=(body,origin='https://hushub.se')=>route.POST(new Request(url,{method:'POST',headers:{origin,'content-type':'application/json'},body}),params)
  assert.equal((await post('{"requestId":"test"}')).status,200)
  assert.equal((await post('{"operation":"prepare"}')).status,200)
  const count=calls.length
  assert.equal((await post('{}','https://outside.invalid')).status,403)
  assert.equal((await post('{"text":"'+'x'.repeat(100001)+'"}')).status,400)
  assert.equal((await post('[]')).status,400);assert.equal(calls.length,count)
  denied=true
  assert.equal((await route.GET(new Request(url),params)).status,403)
  assert.equal((await post('{}')).status,403);assert.equal(calls.length,count)
})
