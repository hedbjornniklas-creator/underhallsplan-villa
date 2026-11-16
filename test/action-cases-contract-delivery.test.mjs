import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as crypto from 'node:crypto'
import ts from 'typescript'
import * as domain from '../src/lib/action-cases/customerOffers.ts'
import * as parties from '../src/lib/action-cases/customerContractParties.ts'
import { signingSnapshot, signingId as id } from './fixtures/contract-signing.ts'

const code = ts.transpileModule(readFileSync(new URL('../src/lib/action-cases/contractSigningDeliveryServer.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const ctx = { orgId: id(90), userId: id(91) }, caseId = id(1), documentId = id(800), participantId = id(2)
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'fictitious-signed-upload-test-secret-not-a-real-key'
const payload = () => ({ id: documentId, revision: 1, confirmed: true, participantId, recipientName: 'Anna Test', recipientEmail: 'anna@example.test' })
function harness(options = {}) {
  const snapshot = signingSnapshot(), row = { id: documentId, org_id: ctx.orgId, action_case_id: caseId, version: 1, draft_revision: 1, created_at: '2026-10-11T10:00:00Z', released_at: null, snapshot, files: [] }
  snapshot.contractParties.customers[0].personalNumber = '19700101-1234'
  const entries = [], calls = [], renders = [], blobs = new Map(), downloads = [], reads = [], removed = []
  const access = { org_id: ctx.orgId, action_case_id: caseId, participant_id: participantId, expires_at: '2099-01-01', revoked_at: null }
  const admin = {
    from(table) {
      const filters = [], read = { table, filters }; reads.push(read)
      const result = () => {
        if (table === 'action_case_contract_signing_documents') return { data: filters.some(([key]) => key === 'id') ? options.otherTenant || filters.some(([key, value]) => key === 'id' && value !== documentId) ? null : row : [row] }
        if (table === 'action_case_contract_signing_delivery') {
          if (options.schemaMissing) return { error: { code: '42P01' } }
          const selected = entries.filter((entry) => filters.every(([key, value]) => entry[key] === value))
          return { data: filters.some(([key]) => key === 'document_id') ? selected[0] || null : selected }
        }
        if (table === 'action_case_participants') return { data: options.ue ? null : { id: participantId, name: 'Anna Test', email: 'anna@example.test' } }
        if (table === 'action_case_access_links') return { data: access }
        throw Error(table)
      }
      const q = { select(){return q}, eq(k,v){filters.push([k,v]);return q}, is(k,v){filters.push([k,v]);return q}, in(){return q}, order(){return q},
        maybeSingle: async()=>result(), then:(resolve,reject)=>Promise.resolve(result()).then(resolve,reject) }
      return q
    },
    storage: { from() { return {
      async createSignedUploadUrl(path) { return { data: { token: 'fake-upload-token', path } } },
      async createSignedUrl(path, seconds, options) { calls.push({ signedDownload: path, seconds, options }); return { data: { signedUrl: 'https://storage.example.test/private-receipt' } } },
      async upload(path, bytes) { if (blobs.has(path)) return { error: { message: 'exists' } }; blobs.set(path, Buffer.from(bytes)); return {} },
      async download(path) { downloads.push(path); return blobs.has(path) ? { data: new Blob([blobs.get(path)]) } : { error: { message: 'missing' } } },
      async remove(paths) { removed.push(...paths); paths.forEach((path)=>blobs.delete(path)); return {} },
    } } },
    async rpc(name, args) {
      calls.push({ name, ...args }); const p = args.p_data
      if (options.rpcFailed) return { error: { message: 'CUSTOMER_OFFER_STALE' } }
      let entry = entries.find((e)=>e.document_id===documentId)
      if (!entry) { entry = { document_id: documentId, org_id: ctx.orgId, action_case_id: caseId, participant_id: null, shared_at: null, withdrawn_at: null, customer_pdf: null, signed_copy: null, signed_at: null }; entries.push(entry) }
      if (args.p_operation === 'share') Object.assign(entry, { participant_id: participantId, shared_at: entry.shared_at || '2026-10-11T11:00:00Z', withdrawn_at: null, customer_pdf: entry.customer_pdf || p.customerPdf })
      if (args.p_operation === 'withdraw') entry.withdrawn_at='2026-10-11T12:00:00Z'
      if (args.p_operation === 'register_signed') Object.assign(entry, { signed_copy:p.signedCopy, signed_at:'2026-10-11T13:00:00Z' })
      return options.uncertain ? { error: { message:'network timeout' } } : { data:{ id:documentId } }
    },
  }
  const deps = { './customerSharingServer': { async requireCustomerSection() { if(options.hidden) throw Error('CUSTOMER_SHARING_HIDDEN') } }, 'server-only':{}, 'node:crypto':crypto, '@/lib/supabase/admin':{createSupabaseAdminClient:()=>admin},
    '@/lib/assignments/tokens':{generateAssignmentToken:()=> 'a'.repeat(48), hashAssignmentToken:(t)=>crypto.createHash('sha256').update(t).digest('hex')},
    './customerOffers':domain, './customerContractParties':parties,
    './contractSigningServer':{async downloadContractSigningFile(...args){calls.push({attachment:args});return {bytes:Buffer.alloc(100),contentType:'application/pdf',fileName:'Bilaga.pdf'}}},
    './contractSigningPdf':{async renderContractSigningPdf(input){renders.push(input);return Buffer.from('%PDF-'+'.'.repeat(1000))}},
  }
  const mod={exports:{}};new Function('module','exports','require',code)(mod,mod.exports,(name)=>{assert.ok(name in deps,name);return deps[name]})
  return {...mod.exports,row,entries,calls,renders,blobs,access,downloads,reads,removed}
}
const share = (h,p=payload())=>h.shareSigningContract(ctx,caseId,p,'https://example.test')
const upload = (h,p=payload(),text='%PDF-'+'.'.repeat(1000))=>h.registerSignedContract(ctx,caseId,p,new File([text],'Underskrivet.pdf',{type:'application/pdf'}))

test('signing method is optional for old snapshots, validated and independently saved',()=>{
  const old=domain.emptyCustomerOffer();assert.equal(domain.normalizeCustomerOffer(old).signingMethod,undefined)
  for (const value of ['email_code','external']) assert.equal(domain.normalizeCustomerOffer({...old,signingMethod:value}).signingMethod,value)
  for (const value of [null,'bankid','',true]) assert.throws(()=>domain.normalizeCustomerOffer({...old,signingMethod:value}),/INVALID/)
})
test('locking alone reveals nothing; explicit sharing archives redacted customer PDF and never sends or approves',async()=>{
  const h=harness();assert.deepEqual(await h.getSharedSigningContracts(ctx.orgId,caseId,participantId),[])
  assert.equal(await share(h),'https://example.test/atgardsarende/'+'a'.repeat(48))
  assert.equal(h.renders[0].snapshot.contractParties.customers[0].personalNumber,'')
  assert.equal(h.row.snapshot.contractParties.customers[0].personalNumber,'19700101-1234')
  const portal=await h.getSharedSigningContracts(ctx.orgId,caseId,participantId)
  const previewPdf=await h.downloadCustomerSigningPdf(ctx,caseId,documentId)
  assert.match(previewPdf.bytes.toString(),/^%PDF/)
  await assert.rejects(h.downloadCustomerSigningPdf(ctx,caseId,id(801)),/NOT_FOUND/)
  assert.equal(portal.length,1);assert.equal(portal[0].signedCopyRegisteredAt,null)
  assert.doesNotMatch(JSON.stringify(portal),/19700101|pdf_sha256|customer_pdf|sourceItemId|sourceReview|signed_copy|tokenHash/)
  await share(h);assert.equal(h.renders.length,1);assert.equal(h.blobs.size,1)
  assert.ok(h.calls.every((c)=>c.name==='write_contract_signing_delivery'&&c.p_operation==='share'))
})
test('public file access checks expiry, role, participant, tenant, delivery, revocation and integrity',async()=>{
  const h=harness(), token='a'.repeat(48)
  await assert.rejects(h.downloadSharedSigningFile(token,documentId,'pdf'),/NOT_FOUND/)
  await share(h);const pdf=await h.downloadSharedSigningFile(token,documentId,'pdf');assert.match(pdf.bytes.toString(),/^%PDF/)
  h.access.participant_id=id(99);await assert.rejects(h.downloadSharedSigningFile(token,documentId,'pdf'),/NOT_FOUND/);h.access.participant_id=participantId
  h.access.revoked_at='2026-10-11';await assert.rejects(h.downloadSharedSigningFile(token,documentId,'pdf'),/CLOSED/);h.access.revoked_at=null
  h.access.expires_at='2020-01-01';await assert.rejects(h.downloadSharedSigningFile(token,documentId,'pdf'),/CLOSED/);h.access.expires_at='2099-01-01'
  const entry=h.entries[0];entry.withdrawn_at='2026-10-11';await assert.rejects(h.downloadSharedSigningFile(token,documentId,'pdf'),/NOT_FOUND/);entry.withdrawn_at=null
  const path=entry.customer_pdf.path;h.blobs.set(path,Buffer.alloc(entry.customer_pdf.fileSizeBytes));await assert.rejects(h.downloadSharedSigningFile(token,documentId,'pdf'),/FILES/)
  await assert.rejects(h.downloadSharedSigningFile(token,documentId,'signed'),/INVALID/)
  await assert.rejects(harness({ue:true}).downloadSharedSigningFile(token,documentId,'pdf'),/NOT_FOUND/)
  await assert.rejects(share(harness({otherTenant:true})),/NOT_FOUND/)
  await assert.rejects(share(harness({schemaMissing:true})),/DELIVERY_SCHEMA/)
})
test('sharing protects stale recipient/revision, requires confirmation and never serves a live draft',async()=>{
  for (const patch of [{revision:2},{confirmed:false},{recipientEmail:'other@example.test'},{recipientName:'Other'}]) await assert.rejects(share(harness(),{...payload(),...patch}))
  const h=harness();await share(h);h.row.snapshot.title='Changed live data'
  await h.downloadSharedSigningFile('a'.repeat(48),documentId,'pdf');assert.equal(h.renders.length,1)
  h.row.released_at='2026-10-11';await assert.rejects(share(h),/STALE/)
})

test('hiding the contract blocks its old public PDF URL without altering the stored document or internal access',async()=>{
  const h=harness({hidden:true});await share(h)
  const before=JSON.stringify(h.row),downloads=h.downloads.length,calls=h.calls.length
  await assert.rejects(h.downloadSharedSigningFile('a'.repeat(48),documentId,'pdf'),/SHARING_HIDDEN/)
  assert.equal(h.downloads.length,downloads);assert.equal(h.calls.length,calls);assert.equal(JSON.stringify(h.row),before)
  assert.match((await h.downloadCustomerSigningPdf(ctx,caseId,documentId)).bytes.toString(),/^%PDF/)
})
test('signed receipt is private, exact-version scoped, immutable, validated and retained on uncertain outcomes',async()=>{
  const h=harness();await upload(h);assert.equal(h.entries[0].shared_at,null)
  assert.deepEqual(await h.getSharedSigningContracts(ctx.orgId,caseId,participantId),[])
  const file=await h.downloadSignedContract(ctx,caseId,documentId);assert.match(file.bytes.toString(),/^%PDF/)
  await upload(h);assert.equal(h.blobs.size,1)
  await assert.rejects(upload(h,payload(),'%PDF-'+','.repeat(1000)),/IMMUTABLE/)
  await assert.rejects(upload(h,{...payload(),confirmed:false}),/SIGNED_COPY/)
  await assert.rejects(upload(h,payload(),'not a PDF'+'x'.repeat(1000)),/SIGNED_COPY/)
  const failed=harness({rpcFailed:true});await assert.rejects(upload(failed));assert.equal(failed.blobs.size,0)
  const uncertain=harness({uncertain:true});await assert.rejects(upload(uncertain));assert.equal(uncertain.blobs.size,1)
})

const metadata = () => ({ ...payload(), fileName: 'Fiktivt signerat avtal.pdf', fileSizeBytes: 11_487_242, contentType: 'application/pdf' })
test('direct signed upload accepts an 11.5 MB receipt without rewriting the frozen version or sharing it', async () => {
  const h = harness(), before = JSON.stringify(h.row), upload = await h.prepareSignedContractUpload(ctx, caseId, metadata())
  assert.match(upload.filePath, new RegExp(`/signing/${documentId}/signed/[a-f0-9-]{36}\\.pdf$`))
  assert.equal(h.calls.length, 0); assert.equal(h.blobs.size, 0)
  const bytes = Buffer.alloc(metadata().fileSizeBytes, 32); bytes.write('%PDF-')
  h.blobs.set(upload.filePath, bytes)
  const complete = { ...payload(), ticket: upload.ticket }
  await h.completeSignedContractUpload(ctx, caseId, complete)
  assert.equal(h.entries[0].signed_copy.fileSizeBytes, bytes.length)
  assert.equal(h.entries[0].shared_at, null)
  assert.equal(JSON.stringify(h.row), before)
  await h.completeSignedContractUpload(ctx, caseId, complete)
  assert.equal(h.calls.filter(c => c.p_operation === 'register_signed').length, 1)
  assert.equal(await h.signedContractDownloadUrl(ctx, caseId, documentId), 'https://storage.example.test/private-receipt')
  assert.equal(h.calls.at(-1).seconds, 60)
  assert.equal(h.blobs.size, 1)
})

test('direct upload tickets bind actor, tenant, version, name and byte size; invalid or stale files never register', async () => {
  const h = harness(), meta = { ...metadata(), fileSizeBytes: 1000 }, upload = await h.prepareSignedContractUpload(ctx, caseId, meta)
  h.blobs.set(upload.filePath, Buffer.from('%PDF-' + 'x'.repeat(995)))
  for (const [context, project, patch] of [[{...ctx, userId:id(92)},caseId,{}], [{...ctx,orgId:id(93)},caseId,{}], [ctx,id(9),{}], [ctx,caseId,{id:id(801)}], [ctx,caseId,{confirmed:false}], [ctx,caseId,{revision:2}], [ctx,caseId,{ticket:upload.ticket.slice(0,-1)+'!'}]])
    await assert.rejects(h.completeSignedContractUpload(context, project, {...payload(), ticket:upload.ticket, ...patch}))
  h.blobs.set(upload.filePath, Buffer.alloc(1000))
  await assert.rejects(h.completeSignedContractUpload(ctx,caseId,{...payload(),ticket:upload.ticket}),/SIGNED_COPY/)
  h.blobs.set(upload.filePath, Buffer.from('%PDF-'+'x'.repeat(996)))
  await assert.rejects(h.completeSignedContractUpload(ctx,caseId,{...payload(),ticket:upload.ticket}),/SIGNED_COPY/)
  h.row.released_at='2026-11-16'
  await assert.rejects(h.completeSignedContractUpload(ctx,caseId,{...payload(),ticket:upload.ticket}),/STALE/)
  assert.equal(h.entries.length,0)
  for (const patch of [{fileSizeBytes:20_000_001},{fileSizeBytes:99},{fileName:'bad.html'},{confirmed:false},{revision:2}])
    await assert.rejects(harness().prepareSignedContractUpload(ctx,caseId,{...meta,...patch}))
})

test('direct registration retains the uploaded file after failed or uncertain commits for a safe retry', async () => {
  for (const options of [{rpcFailed:true},{uncertain:true}]) {
    const h=harness(options), upload=await h.prepareSignedContractUpload(ctx,caseId,{...metadata(),fileSizeBytes:1000})
    h.blobs.set(upload.filePath,Buffer.from('%PDF-'+'x'.repeat(995)))
    const complete={...payload(),ticket:upload.ticket}
    await assert.rejects(h.completeSignedContractUpload(ctx,caseId,complete))
    assert.equal(h.blobs.size,1)
    options.rpcFailed=false; options.uncertain=false
    await h.completeSignedContractUpload(ctx,caseId,complete)
    assert.equal(h.entries[0].signed_copy.path,upload.filePath)
  }
})

test('expired direct-upload tickets cannot register a receipt and do not alter its locked version', async () => {
  const h=harness(), before=JSON.stringify(h.row), upload=await h.prepareSignedContractUpload(ctx,caseId,{...metadata(),fileSizeBytes:1000}), now=Date.now
  try {
    Date.now=()=>now()+3*60*60*1000
    await assert.rejects(h.completeSignedContractUpload(ctx,caseId,{...payload(),ticket:upload.ticket}),/SIGNED_COPY/)
    assert.equal(h.calls.length,0);assert.equal(JSON.stringify(h.row),before)
  } finally { Date.now=now }
})
