import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const ctx = { orgId: id(1), userId: id(2) }, caseId = id(3)
const original = 'Lokevägen 6 - Tillbyggnad (test)', desired = 'Lokevägen 6 - Tillbyggnad'
function load(path, deps) {
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  const mod = { exports: {} }
  new Function('require','module','exports',code)(name => { assert.ok(name in deps, name); return deps[name] },mod,mod.exports)
  return mod.exports
}
function harness(options = {}) {
  const calls = [], record = { id: caseId, org_id: ctx.orgId, title: original, updated_at: '2026-10-18T12:00:00Z', status: 'accepted', property_id: id(8), ...options.record }
  const frozen = { contract: { title: original, amount: 123456, paymentPlan: [123456] }, offer: { title: original }, pdf: 'immutable bytes', planning: { categories: [] } }
  const db = { from(table) {
    assert.equal(table,'action_cases','Renaming must never access agreement, offer, planning, property or file tables')
    const call = { table, filters: [] }; calls.push(call)
    const chain = { select(columns) { call.columns = columns; return chain }, update(patch) { call.patch = patch; return chain }, eq(...f) { call.filters.push(f); return chain }, async maybeSingle() {
      if (call.patch && options.raceTitle) record.title = options.raceTitle
      if (options.readFailed && !call.patch) return { error: { message: 'private database detail' } }
      const matches = !options.missing && call.filters.every(([key,value]) => record[key] === value)
      if (!matches) return { data: null }
      if (call.patch) {
        if (!options.writeFailed || options.committed) Object.assign(record, call.patch, { updated_at: '2026-10-19T12:00:00Z' })
        if (options.writeFailed) return { error: { message: 'private database detail' } }
      }
      return { data: { id: record.id, title: record.title, updated_at: record.updated_at } }
    } }; return chain
  } }
  return { ...load('../src/lib/action-cases/projectNameServer.ts', { 'server-only': {}, '@/lib/supabase/admin': { createSupabaseAdminClient: () => db } }), calls, record, frozen }
}
test('rename changes only the existing project title, including for accepted contracts, without writing agreement data', async () => {
  const h = harness(), before = structuredClone(h.frozen)
  const result = await h.renameActionCase(ctx,caseId,{title:`  ${desired}  `,expectedTitle:original,contract:{title:'must be ignored'},propertyId:id(9)})
  assert.deepEqual(result,{id:caseId,title:desired,updatedAt:'2026-10-19T12:00:00Z'})
  assert.deepEqual(h.calls[1].patch,{title:desired})
  assert.deepEqual(h.calls[1].filters,[['org_id',ctx.orgId],['id',caseId],['title',original]])
  assert.equal(h.record.status,'accepted'); assert.equal(h.record.property_id,id(8))
  assert.deepEqual(h.frozen,before)
})
test('unknown or foreign projects cannot be renamed; every read and write includes tenant and project scope', async () => {
  for (const options of [{missing:true},{record:{org_id:id(9)}}]) {
    const h = harness(options)
    await assert.rejects(h.renameActionCase(ctx,caseId,{title:desired,expectedTitle:original}),/NOT_FOUND/)
    assert.ok(h.calls.every(c => !c.patch))
  }
})
test('invalid IDs, blank/oversized/control-character names and missing expected names cause no database calls', async () => {
  for (const patch of [{title:''},{title:'  '},{title:'x'.repeat(251)},{title:'A\nB'},{title:2},{expectedTitle:undefined},{expectedTitle:''}]) {
    const h = harness(); await assert.rejects(h.renameActionCase(ctx,caseId,{title:desired,expectedTitle:original,...patch}),/INVALID/); assert.equal(h.calls.length,0)
  }
  const h = harness(); await assert.rejects(h.renameActionCase(ctx,'wrong',{title:desired,expectedTitle:original}),/INVALID/); assert.equal(h.calls.length,0)
})
test('stale and racing names never overwrite another writer; matching retries are idempotent', async () => {
  for (const options of [{record:{title:'Nytt namn'}},{raceTitle:'Nytt namn'}]) {
    const h=harness(options); await assert.rejects(h.renameActionCase(ctx,caseId,{title:desired,expectedTitle:original}),/STALE/)
    assert.equal(h.record.title,'Nytt namn')
  }
  const h=harness(); await h.renameActionCase(ctx,caseId,{title:desired,expectedTitle:original})
  await h.renameActionCase(ctx,caseId,{title:desired,expectedTitle:original})
  assert.equal(h.calls.filter(c=>c.patch).length,1)
  const race=harness({raceTitle:desired}); assert.equal((await race.renameActionCase(ctx,caseId,{title:desired,expectedTitle:original})).title,desired)
})
test('uncertain committed responses can be retried without another write and private errors are never exposed', async () => {
  const h=harness({writeFailed:true,committed:true})
  await assert.rejects(h.renameActionCase(ctx,caseId,{title:desired,expectedTitle:original}),/^Error: PROJECT_NAME_FAILED$/)
  assert.equal((await h.renameActionCase(ctx,caseId,{title:desired,expectedTitle:original})).title,desired)
  assert.equal(h.calls.filter(c=>c.patch).length,1)
  await assert.rejects(harness({readFailed:true}).renameActionCase(ctx,caseId,{title:desired,expectedTitle:original}),/^Error: PROJECT_NAME_FAILED$/)
})
test('the name route requires login, module access and same-origin JSON before calling the writer', async () => {
  for (const error of ['UNAUTHORIZED','MODULE_ACCESS_REQUIRED',null]) {
    const writes=[], access=[]
    const next={NextResponse:{json:(body,init={})=>({body,...init})}}
    const http=load('../src/lib/action-cases/customerOffersHttp.ts', {'next/server':next,'@/lib/assignments/server':{async requireOrgContext(){if(error==='UNAUTHORIZED')throw Error(error); return ctx}},'@/lib/access/server':{async requireModuleAccess(value){access.push(value);if(error==='MODULE_ACCESS_REQUIRED')throw Error(error)}}})
    const route=load('../src/app/api/action-cases/[caseId]/name/route.ts',{'next/server':next,'@/lib/action-cases/customerOffersHttp':http,'@/lib/action-cases/projectNameServer':{async renameActionCase(...args){writes.push(args);return{id:caseId,title:desired}}}})
    const request=(origin='https://hushub.se')=>new Request(`https://hushub.se/api/action-cases/${caseId}/name`,{method:'POST',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify({title:desired,expectedTitle:original})})
    const response=await route.POST(request(),{params:Promise.resolve({caseId})})
    if(error){assert.equal(response.status,error==='UNAUTHORIZED'?401:403); assert.equal(writes.length,0)}
    else{
      assert.equal(response.body.project.title,desired); assert.equal(response.headers['Cache-Control'],'no-store')
      assert.equal(access[0].scopeId,ctx.orgId); assert.deepEqual(writes[0].slice(0,2),[ctx,caseId])
      const rejected=await route.POST(request('https://other.test'),{params:Promise.resolve({caseId})})
      assert.equal(rejected.status,410); assert.equal(writes.length,1)
    }
  }
})
