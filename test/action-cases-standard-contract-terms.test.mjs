import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as fs from 'node:fs/promises'
import * as crypto from 'node:crypto'
import * as path from 'node:path'
import ts from 'typescript'
import * as terms from '../src/lib/action-cases/standardContractTerms.ts'
import * as offers from '../src/lib/action-cases/customerOffers.ts'
import { emptyContractDetails } from '../src/lib/action-cases/customerContract.ts'
import { retainNewerDraft } from '../src/lib/action-cases/draftSave.ts'
import { id } from './fixtures/customer-offer-data.ts'

const file = { id: id(140), fileName: terms.ABS18_TERMS.fileName, contentType: 'application/pdf', fileSizeBytes: terms.ABS18_TERMS.size }
const base = () => ({ ...offers.emptyCustomerOffer('Grundavtal'), contractDetails: emptyContractDetails() })
test('ABS18 adds the official edition once and preserves existing scope, instructions, references and prices', () => {
  const d = base(); d.terms = 'Särskilda projektspecifika uppgifter'; d.attachmentIds = [id(4)]
  d.items = [{ id: id(10), kind: 'included', title: 'Mark', scope: 'Schakt', amountOre: 10000 }]
  d.contractDetails.assignment = { documents: [{ fileId: id(4), type: 'Ritning', name: 'Plan', date: '2026-10-07' }],
    additionalScope: 'Tillägg', exclusions: 'Berg ingår inte', documentNotes: 'Revision B' }
  const original = structuredClone(d), next = terms.withStandardContractTerms(d, file)
  assert.equal(next.termsAttachmentId, file.id)
  assert.deepEqual(next.attachmentIds, [id(4), file.id])
  assert.equal(next.contractDetails.assignment.documents[0].name, terms.ABS18_TERMS.name)
  assert.deepEqual(next.contractDetails.assignment.documents[1], d.contractDetails.assignment.documents[0])
  for (const key of ['additionalScope', 'exclusions', 'documentNotes']) assert.equal(next.contractDetails.assignment[key], d.contractDetails.assignment[key])
  assert.deepEqual(next.items, original.items); assert.equal(next.terms, original.terms)
  assert.deepEqual(d, original)
  assert.deepEqual(terms.withStandardContractTerms(next, file), next)
  assert.deepEqual(offers.normalizeCustomerOffer(next), next)
})
test('default reference is filled only when empty; custom form removes only the automatic edition', () => {
  const initial = terms.withStandardContractTerms(base(), file)
  assert.equal(initial.terms, terms.ABS18_TERMS.reference)
  const next = terms.withStandardContractTerms({ ...initial, contractForm: 'custom',
    attachmentIds: [...initial.attachmentIds, id(4)], termsAttachmentId: id(4), terms: 'Egen text' }, file)
  assert.deepEqual(next.attachmentIds, [id(4)])
  assert.equal(next.termsAttachmentId, id(4)); assert.equal(next.terms, 'Egen text')
  assert.deepEqual(next.contractDetails.assignment.documents, [])
  const cleared = terms.withStandardContractTerms({ ...initial, contractForm: 'custom' }, file)
  assert.equal(cleared.termsAttachmentId, null); assert.equal(cleared.terms, '')
  assert.deepEqual(terms.withStandardContractTerms(cleared, file), cleared)
  assert.equal(terms.withStandardContractTerms({ ...cleared, contractForm: 'abs18' }, file).termsAttachmentId, file.id)
})
test('legacy file references are materialized and the 30-file limit fails without silently discarding files', () => {
  const d = offers.emptyCustomerOffer('Legacy'); d.attachmentIds = [id(4), id(5)]
  const next = terms.withStandardContractTerms(d, file, [
    { id: id(4), fileName: 'Ritning.pdf', contentType: 'application/pdf' },
    { id: id(5), fileName: 'Foto.jpg', contentType: 'image/jpeg' }])
  assert.deepEqual(next.contractDetails.assignment.documents.map(d=>d.fileId), [file.id, id(4)])
  assert.deepEqual(next.attachmentIds, [id(4), id(5), file.id])
  const full = { ...base(), attachmentIds: Array.from({length:30},(_,n)=>id(200+n)) }
  assert.throws(()=>terms.withStandardContractTerms(full,file), /TERMS_LIMIT/)
  assert.equal(full.attachmentIds.length,30)
})
test('background terms preparation preserves edits made while the save was in flight', () => {
  const submitted = base(), saved = terms.withStandardContractTerms(submitted, file)
  const current = structuredClone(submitted); current.introduction = 'Ny text'; current.contractDetails.assignment = {
    documents: [{fileId:id(4),type:'Ritning',name:'Ny ritning',date:'2026-10-07'}], additionalScope:'Ny omfattning', exclusions:'Berg', documentNotes:'' }
  current.attachmentIds = [id(4)]
  const retained = retainNewerDraft(current, submitted, saved)
  const canonical = terms.withStandardContractTerms(retained, file)
  assert.equal(canonical.introduction, 'Ny text'); assert.equal(canonical.contractDetails.assignment.additionalScope, 'Ny omfattning')
  assert.equal(canonical.contractDetails.assignment.documents[1].name, 'Ny ritning')
  assert(canonical.attachmentIds.includes(file.id))
})

function storageHarness(options={}) {
  const rows=new Map(), objects=new Map(), uploads=[], events=[], reads=[]
  const db={ from(table) {
    const filters=[]
    const chain={ select(){return chain}, eq(key,value){filters.push([key,value]);return chain},
      async maybeSingle(){reads.push(filters);return {data:[...rows.values()].find(r=>filters.every(([k,v])=>r[k]===v))??null}},
      async insert(row){
        if(table==='action_case_events'){events.push(row);return {}}
        if(options.insertFailed)return {error:{code:'unknown'}}
        if(rows.has(row.id))return {error:{code:'23505'}}
        rows.set(row.id,row);return {}
      } }
    return chain
  }, storage:{from(bucket){return {
    async upload(key,bytes,settings){uploads.push({bucket,key,settings});if(options.uploadFailed)return {error:{message:'private storage error'}}
      if(objects.has(key))return {error:{message:'exists'}};objects.set(key,Buffer.from(bytes));return {}},
    async download(key){return objects.has(key)?{data:new Blob([objects.get(key)])}:{error:{message:'not found'}}},
  }}} }
  const code=ts.transpileModule(readFileSync(new URL('../src/lib/action-cases/standardContractTermsServer.ts',import.meta.url),'utf8'),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
  const deps={'server-only':{},'node:crypto':crypto,'node:fs/promises':fs,'node:path':path,
    './standardContractTerms':terms,'./customerOffers':offers,'@/lib/supabase/admin':{createSupabaseAdminClient:()=>db}}
  const mod={exports:{}}
  new Function('require','module','exports',code)(name=>{assert(name in deps,name);return deps[name]},mod,mod.exports)
  return {api:mod.exports,rows,objects,uploads,events,reads}
}
const ctx={orgId:id(90),userId:id(91)}
test('the bundled unmodified four-page original is pinned by size/hash and included in serverless tracing', () => {
  const bytes=readFileSync(new URL('../public/abs18-2018-06.pdf',import.meta.url))
  assert.equal(bytes.length,terms.ABS18_TERMS.size)
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),terms.ABS18_TERMS.sha256)
  assert.equal(bytes.subarray(0,5).toString(),'%PDF-')
  assert.match(readFileSync(new URL('../next.config.ts',import.meta.url),'utf8'), /customer-offers.*public\/abs18-2018-06\.pdf/)
})
test('standard attachment creation is idempotent, organization/case scoped and never publicly granted or overwritten', async () => {
  const h=storageHarness(), expected=h.api.standardTermsFileId(ctx.orgId,id(1))
  assert.notEqual(expected,h.api.standardTermsFileId(id(92),id(1)))
  assert.notEqual(expected,h.api.standardTermsFileId(ctx.orgId,id(2)))
  const first=await h.api.ensureStandardTermsFile(ctx,id(1)), again=await h.api.ensureStandardTermsFile(ctx,id(1))
  assert.deepEqual(first,again);assert.equal(first.id,expected);assert.equal(h.rows.size,1);assert.equal(h.uploads.length,1)
  assert.equal(h.events.length,1);assert.equal(h.uploads[0].settings.upsert,false)
  assert.equal(h.rows.get(first.id).storage_bucket,'action-case-files')
  assert(h.reads.every(f=>f.some(([k,v])=>k==='org_id'&&v===ctx.orgId)&&f.some(([k,v])=>k==='action_case_id'&&v===id(1))))
  await h.api.verifyStandardTermsFile(ctx.orgId,id(1))
})
test('concurrent preparations converge and a failed database registration can be safely retried', async () => {
  const h=storageHarness()
  const results=await Promise.all([h.api.ensureStandardTermsFile(ctx,id(1)),h.api.ensureStandardTermsFile(ctx,id(1))])
  assert.deepEqual(results[0],results[1]);assert.equal(h.rows.size,1);assert.equal(h.events.length,1)
  const options={insertFailed:true}, failed=storageHarness(options)
  await assert.rejects(failed.api.ensureStandardTermsFile(ctx,id(1)),/STANDARD_TERMS/)
  assert.equal(failed.rows.size,0);options.insertFailed=false
  const retried=await failed.api.ensureStandardTermsFile(ctx,id(1));assert.equal(retried.contentType,'application/pdf')
})
test('missing/corrupt bytes or foreign metadata fail closed without registering or replacing the edition', async () => {
  const failed=storageHarness({uploadFailed:true})
  await assert.rejects(failed.api.ensureStandardTermsFile(ctx,id(1)),/STANDARD_TERMS/)
  assert.equal(failed.rows.size,0)
  const h=storageHarness(), f=await h.api.ensureStandardTermsFile(ctx,id(1)), row=h.rows.get(f.id)
  h.objects.set(row.file_path,Buffer.from('not the original'))
  await assert.rejects(h.api.verifyStandardTermsFile(ctx.orgId,id(1)),/STANDARD_TERMS/)
  row.file_path='foreign/project/terms.pdf'
  await assert.rejects(h.api.findStandardTermsFile(ctx.orgId,id(1)),/STANDARD_TERMS/)
})
