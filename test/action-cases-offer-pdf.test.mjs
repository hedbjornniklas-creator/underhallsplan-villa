import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import * as offers from '../src/lib/action-cases/customerOffers.ts'
import { publicContractParties } from '../src/lib/action-cases/customerContractParties.ts'
import { contractSigningHeading, renderContractSigningPdf } from '../src/lib/action-cases/contractSigningPdf.ts'
import { signingSnapshot } from './fixtures/contract-signing.ts'
import { contractSenderFixture } from './fixtures/contract-sender-profile.ts'

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const ctx = { orgId: id(1), userId: id(2) }, caseId = id(3)
function load(path,deps) {
  const compiled = { exports: {} }, source = ts.transpileModule(readFileSync(new URL(`../${path}`,import.meta.url),'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  new Function('require','module','exports',source)(name => { assert.ok(name in deps,name); return deps[name] },compiled,compiled.exports)
  return compiled.exports
}
function harness(options = {}) {
  const reads = [], rendered = [], workspaces = [], auth = []
  const draft = signingSnapshot()
  draft.senderProfile = { ...contractSenderFixture(), organizationId: ctx.orgId, profileId: id(4), name: 'Projektets frysta avsändare', email: 'sender@example.test' }
  Object.assign(draft.contractParties.contractor, { companyName: draft.senderProfile.name, organizationNumber: draft.senderProfile.organizationNumber })
  const db = { from(table) {
    const read = { table, filters: [] }; reads.push(read)
    const result = () => ({ error: null, data: table === 'action_cases' ? options.caseMissing ? null : { id: caseId,title: 'Internt projektnamn',property_address: 'Testvägen 1',customer_name: 'Testkund' }
      : table === 'action_case_customer_offer_drafts' ? { revision: options.changedDuringRender ? 8 : 7 }
      : table === 'organizations' ? { name: 'Inte projektets valda avsändare' } : table === 'profiles' ? { email: 'account@example.test' } : [] })
    const query = { select() { return query },eq(...args) { read.filters.push(args);return query },in(...args) { read.filters.push(args);return query },maybeSingle:async()=>result(),then:done=>Promise.resolve(result()).then(done) }
    return query
  } }
  const server = load('src/lib/action-cases/offerPdfServer.ts', {
    'server-only': {}, '@/lib/supabase/admin': { createSupabaseAdminClient:()=>db }, './customerOffers': offers,
    './customerOffersServer': { async getCustomerOfferWorkspace(context,project,target) { workspaces.push({context,project,target}); return { draft,revision:7,offers:[],costing:{secret:'private'} } } },
    './customerContractParties': { publicContractParties }, './contractSigningPdf': { async renderContractSigningPdf(input) { rendered.push(input); return Buffer.alloc(options.tooSmall ? 10 : 200,1) } },
  })
  const route = load('src/app/api/action-cases/[caseId]/customer-offers/pdf/route.ts', {
    '@/lib/action-cases/customerOffersHttp': { async customerOfferContext() {auth.push(true); if(options.forbidden)throw Error('MODULE_ACCESS_REQUIRED');return ctx}, customerOfferError: error=>Response.json({error:error.message},{status:error.message==='MODULE_ACCESS_REQUIRED'?403:409}) },
    '@/lib/action-cases/offerPdfServer': server,
  })
  return {server,route,reads,rendered,workspaces,auth,draft}
}

test('offer PDF reads only the saved offer revision, uses its sender and never writes or freezes contracts',async()=> {
  const h=harness(), before=structuredClone(h.draft)
  const file=await h.server.downloadCurrentOfferPdf(ctx,caseId,7)
  assert.equal(file.fileName,'Offert.pdf'); assert.equal(file.contentType,'application/pdf')
  assert.deepEqual(h.workspaces,[{context:ctx,project:caseId,target:'offer'}])
  assert.equal(h.rendered[0].kind,'offer'); assert.equal(h.rendered[0].draftRevision,7)
  assert.equal(h.rendered[0].snapshot.issuerName,'Projektets frysta avsändare')
  assert.equal(h.rendered[0].snapshot.replyEmail,'sender@example.test')
  assert.ok(h.reads.every(read=>!read.table.includes('contract_signing') && !['organizations','profiles'].includes(read.table)))
  assert.ok(h.reads.filter(read=>read.table!=='profiles').every(read=>read.filters.some(([key,value])=>key==='org_id'&&value===ctx.orgId)))
  assert.equal(h.rendered[0].snapshot.contractParties.customers[0].personalNumber,'')
  assert.equal('costing' in h.rendered[0].snapshot,false)
  assert.deepEqual(h.draft,before)
})

test('stale revisions and changes during pagination fail rather than downloading an older offer',async()=> {
  const h=harness()
  await assert.rejects(h.server.downloadCurrentOfferPdf(ctx,caseId,6),/CUSTOMER_OFFER_STALE/)
  assert.equal(h.rendered.length,0)
  await assert.rejects(harness({changedDuringRender:true}).server.downloadCurrentOfferPdf(ctx,caseId,7),/CUSTOMER_OFFER_STALE/)
  await assert.rejects(harness({tooSmall:true}).server.downloadCurrentOfferPdf(ctx,caseId,7),/CUSTOMER_OFFER_PDF_LIMIT/)
  for(const revision of [null,0,-1,1.5,NaN])await assert.rejects(h.server.downloadCurrentOfferPdf(ctx,caseId,revision),/CUSTOMER_OFFER_INVALID/)
})

test('PDF route requires module context and returns a private printable attachment without mutations',async()=> {
  const h=harness(), params={params:Promise.resolve({caseId})}, request=new Request(`https://hushub.se/api/action-cases/${caseId}/customer-offers/pdf?revision=7`)
  const response=await h.route.GET(request,params)
  assert.equal(response.status,200); assert.equal(response.headers.get('content-type'),'application/pdf')
  assert.match(response.headers.get('content-disposition'),/attachment; filename="Offert.pdf"/)
  assert.equal(response.headers.get('cache-control'),'private, no-store')
  assert.equal(response.headers.get('x-content-type-options'),'nosniff')
  const denied=harness({forbidden:true}); assert.equal((await denied.route.GET(request,params)).status,403)
  assert.equal(denied.workspaces.length,0)
})

test('shared PDF renderer has an explicit offer heading and keeps the existing contract heading unchanged',async()=> {
  const snapshot=signingSnapshot(), before=structuredClone(snapshot)
  assert.equal(contractSigningHeading(snapshot,'offer').title,'OFFERT')
  assert.match(contractSigningHeading(snapshot).title,/ENTREPRENAD/)
  const bytes=await renderContractSigningPdf({id:caseId,version:0,kind:'offer',draftRevision:7,createdAt:'2026-11-03T10:00:00Z',snapshot,files:[]})
  assert.equal(bytes.subarray(0,5).toString(),'%PDF-'); assert.ok(bytes.length>8000)
  assert.deepEqual(snapshot,before)
  const source=readFileSync(new URL('../src/components/tasks/CustomerOfferEditor.tsx',import.meta.url),'utf8')
  assert.match(source,/offerPdfBlocked = dirty \|\| Boolean\(busy\)/)
  assert.match(source,/customer-offers\/pdf\?revision=/)
  assert.doesNotMatch(source,/<CustomerContractSenderProfile/)
  const project=readFileSync(new URL('../src/components/tasks/ActionCaseProject.tsx',import.meta.url),'utf8')
  assert.match(project,/senderLocked \? <p/)
  assert.match(project,/CustomerContractSenderProfile project/)
})
