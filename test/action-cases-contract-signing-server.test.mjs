import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as crypto from 'node:crypto'
import ts from 'typescript'
import * as domain from '../src/lib/action-cases/customerOffers.ts'
import * as signing from '../src/lib/action-cases/contractSigning.ts'
import { signingDraft, signingId as id } from './fixtures/contract-signing.ts'

const code = ts.transpileModule(readFileSync(new URL('../src/lib/action-cases/contractSigningServer.ts',import.meta.url),'utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
const ctx={orgId:id(90),userId:id(91)}, caseId=id(1), fileId=id(4)
function harness(options={}) {
  const draft=options.empty?domain.normalizeCustomerOffer(domain.emptyCustomerOffer()):signingDraft(), sourcePath=`${ctx.orgId}/${caseId}/source.pdf`, stored=[], calls=[], reads=[], removed=[], rendered=[]
  if (!options.empty) draft.attachmentIds=[fileId]
  if (options.abs18) { draft.contractForm='abs18'; draft.termsAttachmentId=fileId }
  const file={id:fileId,file_name:'Ritning.pdf',content_type:'application/pdf',file_size_bytes:1000,storage_bucket:'action-case-files',file_path:sourcePath}
  const blobs=new Map([[sourcePath,Buffer.alloc(1000,1)]])
  const admin={
    from(table) {
      const read={table,filters:[]}; reads.push(read)
      const result=()=>{
        if (table==='action_cases') return {data:options.otherTenant?null:{id:caseId,title:'Fiktivt projekt',property_address:'Testgatan 1'}}
        if (table==='action_case_customer_contract_drafts') return {data:{body:draft,revision:1}}
        if (table==='action_case_attachments') return {data:options.missingAttachment?[]:[file]}
        if (table==='action_case_customer_offers') return {data:options.online?[{status:options.online}]:[]}
        if (table==='action_case_contract_signing_delivery') return {data:[]}
        if (table==='action_case_contract_signing_documents') {
          if (options.schemaMissing) return {error:{code:'42P01'}}
          if (read.filters.some(([k])=>k==='id')) return {data:stored.find((r)=>read.filters.every(([k,v])=>r[k]===v))??null}
          return {data:stored}
        }
        throw Error(table)
      }
      const query={select(){return query},eq(k,v){read.filters.push([k,v]);return query},in(){return query},order(){return query},limit(){return query},
        maybeSingle:async()=>result(),then:(resolve,reject)=>Promise.resolve(result()).then(resolve,reject)}
      return query
    },
    storage:{from(){return {
      async copy(from,to){if(options.copyFailed)return {error:{message:'private storage failure'}};blobs.set(to,Buffer.from(blobs.get(from)));return {data:{}}},
      async download(path){const b=blobs.get(path);return b?{data:new Blob([b])}:{error:{message:'not found'}}},
      async upload(path,bytes){if(options.uploadFailed)return {error:{message:'private storage failure'}};blobs.set(path,Buffer.from(bytes));return {data:{}}},
      async remove(paths){removed.push(...paths);for(const path of paths)blobs.delete(path);return {data:{}}},
    }}},
    async rpc(name,args){calls.push({name,...args});const p=args.p_data
      if(options.rpcFailed)return {error:{message:'CUSTOMER_OFFER_STALE'}}
      if(args.p_operation==='freeze')stored.unshift({id:p.id,org_id:ctx.orgId,action_case_id:caseId,version:p.version,draft_revision:p.revision,snapshot:p.snapshot,files:p.files,pdf_path:p.pdfPath,pdf_sha256:p.pdfSha256,pdf_size:p.pdfSize,created_at:p.createdAt,released_at:null})
      if(options.uncertain)return {error:{message:'network error'}}
      return {data:{id:p.id}}
    },
  }
  const deps={ 'server-only':{},'node:crypto':crypto,'@/lib/supabase/admin':{createSupabaseAdminClient:()=>admin},'./customerOffers':domain,'./contractSigning':signing,
    './standardContractTermsServer':{standardTermsFileId:()=>fileId,async verifyStandardTermsFile(){if(options.corruptTerms)throw Error('CUSTOMER_OFFER_STANDARD_TERMS')}},
    './contractSigningPdf':{async renderContractSigningPdf(input){rendered.push(input);if(options.pdfFailed)throw Error('PDF failed');return Buffer.from('%PDF-'+'.'.repeat(1000))}} }
  const mod={exports:{}};new Function('module','exports','require',code)(mod,mod.exports,(name)=>{assert.ok(name in deps,name);return deps[name]})
  return {...mod.exports,stored,calls,reads,removed,rendered,blobs,draft}
}
const freeze=(h,p={})=>h.freezeContractForSigning(ctx,caseId,{revision:1,confirmed:true,...p})
test('freeze archives exact bytes and attachment copies; retries do not rerender or send',async()=>{
  const h=harness();await freeze(h);await freeze(h)
  assert.equal(h.rendered.length,1);assert.equal(h.stored.length,1);assert.equal(h.calls.length,1)
  const row=h.stored[0]
  assert.equal(row.snapshot.contractParties.customers.length,2)
  assert.match(row.pdf_sha256,/^[a-f0-9]{64}$/)
  assert.equal(row.files[0].path,`${ctx.orgId}/${caseId}/signing/${row.id}/${fileId}`)
  assert.doesNotMatch(JSON.stringify(row),/internal_costing|emailPayload|acceptedBy/)
  h.draft.title='Changed live draft'
  const pdf=await h.downloadContractSigningFile(ctx,caseId,row.id,'pdf')
  assert.equal(pdf.bytes.toString(),'%PDF-'+'.'.repeat(1000));assert.equal(pdf.contentType,'application/pdf')
  const attachment=await h.downloadContractSigningFile(ctx,caseId,row.id,fileId)
  assert.equal(attachment.bytes.length,1000)
  assert.equal(h.rendered.length,1)
  assert.ok(h.reads.filter((r)=>r.table==='action_case_contract_signing_documents').every((r)=>r.filters.some(([k,v])=>k==='org_id'&&v===ctx.orgId)&&r.filters.some(([k,v])=>k==='action_case_id'&&v===caseId)))
})
test('downloads reject other versions, file IDs, tenants, altered bytes and paths',async()=>{
  const h=harness();await freeze(h);const row=h.stored[0]
  await assert.rejects(h.downloadContractSigningFile(ctx,caseId,id(999),'pdf'),/NOT_FOUND/)
  await assert.rejects(h.downloadContractSigningFile(ctx,caseId,row.id,id(999)),/NOT_FOUND/)
  h.blobs.set(row.pdf_path,Buffer.alloc(row.pdf_size,2))
  await assert.rejects(h.downloadContractSigningFile(ctx,caseId,row.id,'pdf'),/FILES/)
  row.pdf_path='other-org/private.pdf'
  await assert.rejects(h.downloadContractSigningFile(ctx,caseId,row.id,'pdf'),/FILES/)
  await assert.rejects(freeze(harness({otherTenant:true})),/NOT_FOUND/)
})
test('schema, stale revision, online versions and corrupt selected ABS terms fail before PDF creation',async()=>{
  for(const [options,pattern] of [[{schemaMissing:true},/SIGNING_SCHEMA/],[{online:'accepted'},/ACCEPTED/],[{online:'published'},/WITHDRAW_FIRST/],[{abs18:true,corruptTerms:true},/STANDARD_TERMS/]]){
    const h=harness(options);await assert.rejects(freeze(h),pattern);assert.equal(h.rendered.length,0);assert.equal(h.calls.length,0)
  }
  const h=harness();await assert.rejects(freeze(h,{revision:2}),/STALE/);await assert.rejects(freeze(h,{confirmed:false}),/CONFIRM/)
})

test('paper locking accepts empty ABS18 contracts and blank names, dates, prices and conditions',async()=>{
  const empty=harness({empty:true});await freeze(empty)
  assert.equal(empty.stored.length,1);assert.equal(empty.stored[0].snapshot.customerName,'')
  assert.equal(empty.stored[0].snapshot.issuerName,'');assert.deepEqual(empty.stored[0].files,[])
  const partial=harness()
  partial.draft.contractParties.customers.forEach((c)=>c.name='')
  partial.draft.contractParties.contractor.companyName='';partial.draft.contractParties.contractor.organizationNumber=''
  partial.draft.paymentPlan.installments[0].condition=''
  partial.draft.paymentPlan.installments[0].amountOre=null
  partial.draft.contractPricing.rows[0].labourOre=null
  partial.draft.contractDetails.advice.reason=''
  partial.draft.contractDetails.assignment={documents:[{fileId,type:'',name:'',date:''}],additionalScope:'',exclusions:'',documentNotes:''}
  await freeze(partial);assert.equal(partial.stored.length,1)
})

test('draft PDF uses only saved contract data and does not archive, lock, send or mutate anything',async()=>{
  const h=harness({empty:true}), before=JSON.stringify(h.draft)
  const pdf=await h.downloadCurrentContractPdf(ctx,caseId,1)
  assert.equal(pdf.fileName,'Avtal-utkast-r1.pdf');assert.equal(pdf.contentType,'application/pdf')
  assert.equal(h.rendered[0].draftRevision,1);assert.equal(h.rendered[0].snapshot.customerName,'')
  assert.equal(JSON.stringify(h.draft),before);assert.equal(h.calls.length,0);assert.equal(h.stored.length,0)
  assert.equal(h.blobs.size,1);assert.equal(h.removed.length,0)
  const noSchema=harness({schemaMissing:true});await noSchema.downloadCurrentContractPdf(ctx,caseId,1)
  await assert.rejects(h.downloadCurrentContractPdf(ctx,caseId,2),/STALE/)
  for (const revision of [0,-1,NaN,1.5]) await assert.rejects(h.downloadCurrentContractPdf(ctx,caseId,revision),/INVALID/)
  await assert.rejects(harness({otherTenant:true}).downloadCurrentContractPdf(ctx,caseId,1),/NOT_FOUND/)
  await assert.rejects(harness({online:'accepted'}).downloadCurrentContractPdf(ctx,caseId,1),/ACCEPTED/)
  await assert.rejects(harness({missingAttachment:true}).downloadCurrentContractPdf(ctx,caseId,1),/FILES/)
  const selected=harness();await selected.downloadCurrentContractPdf(ctx,caseId,1)
  assert.equal(selected.rendered[0].files[0].fileName,'Ritning.pdf')
  assert.equal(selected.blobs.size,1);assert.equal(selected.calls.length,0)
})

test('current PDF endpoint returns the immutable archive once locked, not a new rendering',async()=>{
  const h=harness();await freeze(h)
  const old=await h.downloadContractSigningFile(ctx,caseId,h.stored[0].id,'pdf')
  h.draft.title='Changed draft';h.draft.contractParties.customers[0].name='Changed person'
  const pdf=await h.downloadCurrentContractPdf(ctx,caseId,1)
  assert.deepEqual(pdf,old);assert.equal(h.rendered.length,1)
  await assert.rejects(h.downloadCurrentContractPdf(ctx,caseId,2),/STALE/)
})
test('failed render, upload or rolled-back write cleans only its own temporary copies; uncertain committed PDF is retained',async()=>{
  for(const options of [{pdfFailed:true},{uploadFailed:true},{rpcFailed:true}]){
    const h=harness(options);await assert.rejects(freeze(h));assert.ok(h.removed.length>0)
    assert.ok(h.removed.every((path)=>path.startsWith(`${ctx.orgId}/${caseId}/signing/`)))
    assert.ok(h.blobs.has(`${ctx.orgId}/${caseId}/source.pdf`));assert.equal(h.stored.length,0)
  }
  const h=harness({uncertain:true});await assert.rejects(freeze(h),/PDF_FAILED/)
  assert.equal(h.stored.length,1);assert.equal(h.removed.length,0)
  await freeze(h);assert.equal(h.rendered.length,1)
})
