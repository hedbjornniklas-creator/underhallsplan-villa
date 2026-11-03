import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import * as offers from '../src/lib/action-cases/customerOffers.ts'
import { publicContractParties } from '../src/lib/action-cases/customerContractParties.ts'
import { contractSigningHeading, contractSigningSections, offerIntroductionBlocks, renderContractSigningPdf, renderOfferPresentationPdf } from '../src/lib/action-cases/contractSigningPdf.ts'
import { signingSnapshot } from './fixtures/contract-signing.ts'
import { contractSenderFixture } from './fixtures/contract-sender-profile.ts'
import { HF17_TERMS, withStandardContractTerms } from '../src/lib/action-cases/standardContractTerms.ts'
import * as offerDocuments from '../src/lib/action-cases/offerDocuments.ts'
import { normalizeContractPricing, contractBudgetAmount, offerCompensationText } from '../src/lib/action-cases/contractPricing.ts'

const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`
const ctx = { orgId: id(1), userId: id(2) }, caseId = id(3)

test('editorial offer presentation accepts explicit sections without changing saved data or allowing a contract override', async () => {
  const snapshot = signingSnapshot(), before = structuredClone(snapshot)
  const input = { id: caseId, version: 0, kind: 'offer', createdAt: '2026-11-03T10:00:00Z', snapshot, files: [] }
  const sections = [
    ...contractSigningSections(input).filter(part => ['parties', 'property'].includes(part.group)),
    { group: 'assignment', title: 'Arbeten', paragraphs: ['FIKTIV beskrivning.'] },
    { group: 'price', title: 'Priser', paragraphs: [], columns: ['Arbete', 'Exkl. moms'], rows: [['Testarbete', '0 kr']] },
    { group: 'schedule', title: 'Tid', paragraphs: ['FIKTIV tidplan.'] },
    { group: 'payments', title: 'Betalningsvillkor', paragraphs: ['FIKTIVA betalningsvillkor.'] },
    { group: 'changes', title: 'Ändringar och tilläggsarbeten (ÄTA)', paragraphs: ['FIKTIVA ändringsvillkor.'] },
  ]
  const beforeSections = structuredClone(sections)
  const bytes = await renderOfferPresentationPdf(input, sections)
  assert.equal(bytes.subarray(0, 5).toString(), '%PDF-')
  assert.deepEqual(snapshot, before)
  assert.deepEqual(sections, beforeSections)
  await assert.rejects(renderOfferPresentationPdf({ ...input, kind: undefined }, sections), /OFFER_PRESENTATION_REQUIRED/)
})

test('numbered offer paragraphs get separate headings without interpreting prices or changing their text', () => {
  const introduction = 'Tre valbara delar. Del 3 ersätter del 2.\n\n1. Gångbrygga\nPris: 108 000 kr exklusive moms.\nArbete och material.\n\n2. Lagning\nPris: 8 400 kr exklusive moms.\n\n3. Alternativ\nPris: 98 400 kr exklusive moms.'
  const blocks = offerIntroductionBlocks(introduction)
  assert.deepEqual(blocks.map(block => block.label), [undefined, '1. Gångbrygga', '2. Lagning', '3. Alternativ'])
  assert.equal(blocks.map(block => [block.label, block.text].filter(Boolean).join('\n')).join('\n\n'), introduction)
  assert.deepEqual(offerIntroductionBlocks('En vanlig inledning.\nNästa rad.'), [{ text: 'En vanlig inledning.\nNästa rad.' }])
  assert.deepEqual(offerIntroductionBlocks(''), [])
})

test('offer document table has a descriptive heading even when it is the first assignment content', async () => {
  const snapshot = signingSnapshot()
  snapshot.introduction = ''
  snapshot.contractDetails.assignment = { documents: [{ fileId: id(41), type: 'Ritning', name: 'Fiktiv planritning', date: '2026-11-03' }], additionalScope: '', exclusions: '', documentNotes: '' }
  const files = [{ id: id(41), fileName: 'FIKTIV-planritning.pdf', contentType: 'application/pdf', fileSizeBytes: 100 }]
  const before = structuredClone(snapshot)
  const input = { id: caseId, kind: 'offer', version: 0, createdAt: '2026-11-03T10:00:00Z', snapshot, files }
  const documents = contractSigningSections(input).filter(section => section.group === 'assignment')[0]
  assert.equal(documents.title, 'Handlingar och bilagor som hör till offerten')
  assert.deepEqual(documents.rows, [['Ritning', 'Fiktiv planritning', '2026-11-03']])
  assert.equal(contractSigningSections({ ...input, kind: undefined }).filter(section => section.group === 'assignment')[0].title, 'Handlingar som ingår i uppdraget')
  const renderer = readFileSync(new URL('../src/lib/action-cases/contractSigningPdf.ts', import.meta.url), 'utf8')
  assert.match(renderer, /const hideHeading = part.title === 'Uppdraget' \|\| i === 0 && \(!offer \|\| Boolean\(presentation\)\)/)
  const bytes = await renderContractSigningPdf(input)
  assert.equal(bytes.subarray(0, 5).toString(), '%PDF-')
  assert.deepEqual(snapshot, before)
})

test('offers without structured prices omit the empty total but keep real zero amounts and incomplete work rows', () => {
  const snapshot = { ...signingSnapshot(), introduction: '1. Valbar del\nPris enligt beskrivning.', items: [], baseAmountOre: null }
  delete snapshot.contractPricing
  const before = structuredClone(snapshot), input = { snapshot, files: [], kind: 'offer' }
  assert.equal(contractSigningSections(input).some(part => part.group === 'price'), false)
  assert.equal(contractSigningSections(input).find(part => part.title === 'Uppdraget').blocks[0].label, '1. Valbar del')
  assert.equal(contractSigningSections({ ...input, kind: undefined }).some(part => part.group === 'price'), true)
  assert.equal(contractSigningSections({ ...input, kind: undefined }).find(part => part.title === 'Uppdraget').blocks, undefined)
  assert.deepEqual(snapshot, before)
  assert.equal(contractSigningSections({ ...input, snapshot: { ...snapshot, baseAmountOre: 0 } }).find(part => part.group === 'price').rows.at(-1)[1], offers.money(0))
  assert.equal(contractSigningSections({ ...input, snapshot: { ...snapshot, items: [{ id: id(10), kind: 'included', title: 'Ofullständig rad', scope: '', amountOre: null }] } }).some(part => part.group === 'price'), true)
})
test('mixed offer keeps fixed compensation and running budget separate without a combined cost plan', async () => {
  const snapshot = signingSnapshot()
  snapshot.contractPricing = normalizeContractPricing({ ...snapshot.contractPricing, mode: 'mixed', display: 'priced', basis: 'rows',
    rows: snapshot.contractPricing.rows.map((row, index) => ({ ...row, kind: index ? 'running' : 'fixed' })),
    budget: { version: 1, rows: [{ id: id(11), amountOre: 3000000 }], assumptions: 'Fiktiv budgetgrund.', reviewTerms: 'Fiktivt samråd.' } })
  const before = structuredClone(snapshot), input = { snapshot, files: [], kind: 'offer' }
  const parts = contractSigningSections(input).filter(part => part.group === 'price')
  assert.deepEqual(parts.map(part => part.title), ['Ersättningsmodell', 'Fasta priser', 'Löpande räkning - prisgrunder', 'Planeringsbudget för löpande arbeten och inköp', 'Budgetens förutsättningar och uppföljning'])
  assert.match(parts[0].paragraphs[0], /kombinerar fast pris och löpande/)
  assert.deepEqual(parts[1].rows, [['Mark och grund', offers.money(6000000)], ['Summa fasta priser inkl. moms', offers.money(6000000)]])
  assert.deepEqual(parts[3].rows, [['Tak', offers.money(3000000)], ['Summa budget, löpande del inkl. moms', offers.money(3000000)]])
  assert.equal(parts.some(part => part.title === 'Samlad kostnadsplan'), false)
  assert.equal(JSON.stringify(parts).includes(offers.money(9000000)), false)
  const ui = readFileSync(new URL('../src/components/tasks/CustomerContractPricing.tsx', import.meta.url), 'utf8')
  assert.doesNotMatch(ui, /Samlad kostnadsplan|Fasta priser \+ budgeterade poster/)
  assert.equal(contractBudgetAmount(snapshot.contractPricing), 9000000)
  const contract = contractSigningSections({ ...input, kind: undefined }).filter(part => part.group === 'price')
  assert.equal(contract.some(part => part.title === 'Ersättningsmodell' || part.title === 'Samlad kostnadsplan'), false)
  assert.equal(contract[0].title, 'Fast del av priset')
  await renderContractSigningPdf({ ...input, id: caseId, version: 0, createdAt: '2026-11-03T10:00:00Z' })
  assert.deepEqual(snapshot, before)
})
test('missing running budgets stay unknown, while explicit zero and fixed-only offers keep their meaning', () => {
  const snapshot = signingSnapshot(), p = snapshot.contractPricing
  snapshot.contractPricing = normalizeContractPricing({ ...p, mode: 'mixed', rows: p.rows.map((row, index) => ({ ...row, kind: index ? 'running' : 'fixed' })),
    budget: { version: 1, rows: [{ id: id(11), amountOre: null }], assumptions: '', reviewTerms: '' } })
  const parts = () => contractSigningSections({ snapshot, files: [], kind: 'offer' }).filter(part => part.group === 'price')
  assert.equal(parts().find(part => part.title.startsWith('Planeringsbudget för')).rows.at(-1)[1], '')
  assert.match(parts().find(part => part.title.startsWith('Planeringsbudget för')).afterTable[0], /Tak/)
  assert.equal(parts().find(part => part.title.startsWith('Planeringsbudget för')).rows[0][1], 'Ej budgeterat')
  assert.equal(contractBudgetAmount(snapshot.contractPricing), null)
  snapshot.contractPricing.budget.rows[0].amountOre = 0
  assert.equal(parts().find(part => part.title.startsWith('Planeringsbudget för')).rows[0][1], offers.money(0))
  assert.equal(parts().find(part => part.title.startsWith('Planeringsbudget för')).rows.at(-1)[1], offers.money(0))
  assert.equal(parts().some(part => part.title === 'Samlad kostnadsplan'), false)
  assert.doesNotMatch(offerCompensationText(p), /löpande|Budget/)
})
test('offer exclusions keep the work separate from excluded materials and from entirely excluded work', () => {
  const snapshot = signingSnapshot()
  snapshot.items[0].title = 'Plattsättning'
  snapshot.items[0].scopeExclusions = 'Kakel och klinker.'
  snapshot.items.push({ id: id(12), title: 'Köksleverans', kind: 'excluded', scope: 'Beställaren köper in köket själv.', amountOre: null })
  const before = structuredClone(snapshot), input = { snapshot, files: [], kind: 'offer' }
  const part = contractSigningSections(input).find(part => part.title === 'Avgränsningar - detta ingår inte')
  assert.deepEqual(part.columns, ['Berörd arbetsdel', 'Undantaget från åtagandet'])
  assert.deepEqual(part.rows, [['Plattsättning', 'Kakel och klinker.'], ['Köksleverans', 'Arbetsdelen ingår inte.\n\nBeställaren köper in köket själv.']])
  assert.equal(part.blocks, undefined)
  const contract = contractSigningSections({ ...input, kind: undefined }).find(part => part.title === 'Entreprenörens åtagande omfattar inte')
  assert.equal(contract.blocks[0].label, 'Plattsättning')
  assert.deepEqual(snapshot, before)
})
test('offer running-price fields stay blank when unknown, while zero rates remain explicit', () => {
  const snapshot = signingSnapshot()
  snapshot.contractPricing.mode = 'running'
  const input = { snapshot, files: [], kind: 'offer' }
  const part = () => contractSigningSections(input).find(section => section.title === 'Löpande räkning - prisgrunder')
  assert.deepEqual(part().rows.map(row => row[1]), ['', '', ''])
  snapshot.contractPricing.running.hourlyOre = 0
  snapshot.contractPricing.running.markupPercent = 0
  assert.deepEqual(part().rows.map(row => row[1]), [`${offers.money(0)}/tim`, `${offers.money(0)}/tim`, '0 %'])
  assert.equal(contractSigningSections({ ...input, kind: undefined }).find(section => section.title === 'Löpande räkning').columns, undefined)
})
test('HF17 offer document list describes the included terms page, not the unused blank contract form', () => {
  const snapshot = signingSnapshot()
  Object.assign(snapshot, withStandardContractTerms({ ...snapshot, contractForm: 'hf17' }, { id: id(41), fileName: HF17_TERMS.fileName, contentType: 'application/pdf', fileSizeBytes: HF17_TERMS.size }))
  const before = structuredClone(snapshot), input = { snapshot, files: [], kind: 'offer' }
  const documents = contractSigningSections(input).find(section => section.title === 'Handlingar och bilagor som hör till offerten')
  assert.deepEqual(documents.rows[0].slice(0, 2), ['Allmänna bestämmelser', 'Allmänna bestämmelser för Hantverkarformuläret 17'])
  assert.deepEqual(snapshot, before)
  const contractDocuments = contractSigningSections({ ...input, kind: undefined }).find(section => section.title === 'Handlingar som ingår i uppdraget')
  assert.equal(contractDocuments.rows[0][1], HF17_TERMS.name)
})
function load(path,deps) {
  const compiled = { exports: {} }, source = ts.transpileModule(readFileSync(new URL(`../${path}`,import.meta.url),'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
  new Function('require','module','exports',source)(name => { assert.ok(name in deps,name); return deps[name] },compiled,compiled.exports)
  return compiled.exports
}
function harness(options = {}) {
  const reads = [], rendered = [], workspaces = [], auth = [], verifiedTerms = [], appendedTerms = [], mergedDocuments = [], downloads = [], order = []
  const draft = signingSnapshot()
  draft.senderProfile = { ...contractSenderFixture(), organizationId: ctx.orgId, profileId: id(4), name: 'Projektets frysta avsändare', email: 'sender@example.test' }
  Object.assign(draft.contractParties.contractor, { companyName: draft.senderProfile.name, organizationNumber: draft.senderProfile.organizationNumber })
  const standardTermsFile = { id: id(41), fileName: HF17_TERMS.fileName, contentType: 'application/pdf', fileSizeBytes: HF17_TERMS.size }
  if (options.hf17) Object.assign(draft, withStandardContractTerms({ ...draft, contractForm: 'hf17' }, standardTermsFile))
  const appendixBytes = Buffer.from('%PDF-1.7\nFIKTIV TESTBILAGA')
  const appendixFile = { id: id(42), file_name: 'FIKTIV ritning.pdf', content_type: options.imageAppendix ? 'image/png' : 'application/pdf',
    file_size_bytes: options.largeAppendix ? 20_000_001 : options.wrongSize ? 1 : appendixBytes.length, storage_bucket: 'action-case-files',
    file_path: `${options.foreignAppendix ? id(99) : ctx.orgId}/${caseId}/fiktiv.pdf`, question_id: options.questionAppendix ? id(43) : null }
  if (options.appendix) {
    draft.attachmentIds.push(appendixFile.id)
    draft.offerDocuments = { version: 1, modes: { [appendixFile.id]: options.referenceOnly ? 'reference' : 'pdf' } }
  }
  const db = { from(table) {
    const read = { table, filters: [] }; reads.push(read)
    const result = () => ({ error: null, data: table === 'action_cases' ? options.caseMissing ? null : { id: caseId,title: 'Internt projektnamn',property_address: 'Testvägen 1',customer_name: 'Testkund' }
      : table === 'action_case_customer_offer_drafts' ? { revision: options.changedDuringRender ? 8 : 7 }
      : table === 'organizations' ? { name: 'Inte projektets valda avsändare' } : table === 'profiles' ? { email: 'account@example.test' }
      : table === 'action_case_attachments' ? [
        ...(options.hf17 ? [{ id: standardTermsFile.id, file_name: standardTermsFile.fileName, content_type: standardTermsFile.contentType, file_size_bytes: standardTermsFile.fileSizeBytes }] : []),
        ...(options.appendix && !options.missingAppendix ? [appendixFile] : []),
      ] : table === 'action_case_work_quotes' && options.privateAppendix ? [{ document_id: appendixFile.id }] : [] })
    const query = { select() { return query },eq(...args) { read.filters.push(args);return query },in(...args) { read.filters.push(args);return query },maybeSingle:async()=>result(),then:done=>Promise.resolve(result()).then(done) }
    return query
  }, storage: {
    from(bucket) {
      return { async download(path) {
        downloads.push({ bucket, path })
        return options.downloadFailed ? { error: new Error('failed') } : { data: new Blob([appendixBytes]) }
      } }
    }
  } }
  const server = load('src/lib/action-cases/offerPdfServer.ts', {
    'server-only': {}, '@/lib/supabase/admin': { createSupabaseAdminClient:()=>db }, './customerOffers': offers,
    './customerOffersServer': { async getCustomerOfferWorkspace(context,project,target) { workspaces.push({context,project,target}); return { draft,revision:7,offers:[],costing:{secret:'private'},standardTermsFile:options.hf17&&!options.missingTerms?standardTermsFile:null } } },
    './customerContractParties': { publicContractParties }, './contractSigningPdf': { async renderContractSigningPdf(input) { rendered.push(input); return Buffer.alloc(options.tooSmall ? 10 : 200,1) } },
    './standardContractTermsServer': { async verifyStandardTermsFile(...args) { verifiedTerms.push(args); if(options.corruptTerms) throw Error('CUSTOMER_OFFER_STANDARD_TERMS') } },
    './standardContractTermsPdf': { async appendHf17TermsPdf(bytes) { order.push('hf17'); appendedTerms.push(bytes); return Buffer.concat([bytes,Buffer.alloc(100)]) } },
    '../pdf/appendPages': { async appendPdfDocuments(bytes, documents) { order.push('selected'); mergedDocuments.push(documents); if(options.invalidAppendix) throw Error('invalid PDF'); return Buffer.concat([bytes,Buffer.alloc(50)]) } },
    './offerDocuments': offerDocuments,
  })
  const route = load('src/app/api/action-cases/[caseId]/customer-offers/pdf/route.ts', {
    '@/lib/action-cases/customerOffersHttp': { async customerOfferContext() {auth.push(true); if(options.forbidden)throw Error('MODULE_ACCESS_REQUIRED');return ctx}, customerOfferError: error=>Response.json({error:error.message},{status:error.message==='MODULE_ACCESS_REQUIRED'?403:409}) },
    '@/lib/action-cases/offerPdfServer': server,
  })
  return {server,route,reads,rendered,workspaces,auth,draft,verifiedTerms,appendedTerms,mergedDocuments,downloads,order}
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

test('HF17 offer PDF verifies the selected standard edition and appends its general terms without changing drafts', async () => {
  const h = harness({ hf17: true }), before = structuredClone(h.draft)
  const result = await h.server.downloadCurrentOfferPdf(ctx, caseId, 7)
  assert.equal(result.bytes.length, 300)
  assert.deepEqual(h.verifiedTerms, [[ctx.orgId, caseId, 'hf17']])
  assert.equal(h.appendedTerms.length, 1)
  assert.deepEqual(h.draft, before)
  for (const options of [{ hf17: true, missingTerms: true }, { hf17: true, corruptTerms: true }]) {
    const invalid = harness(options)
    await assert.rejects(invalid.server.downloadCurrentOfferPdf(ctx, caseId, 7), /CUSTOMER_OFFER_STANDARD_TERMS/)
    assert.equal(invalid.appendedTerms.length, 0)
  }
  await assert.rejects(harness({ hf17: true, changedDuringRender: true }).server.downloadCurrentOfferPdf(ctx, caseId, 7), /CUSTOMER_OFFER_STALE/)
  const normal = harness()
  await normal.server.downloadCurrentOfferPdf(ctx, caseId, 7)
  assert.equal(normal.appendedTerms.length, 0)
})

test('only explicitly included offer PDFs are read from scoped storage and HF17 remains last', async () => {
  const h = harness({ hf17: true, appendix: true }), before = structuredClone(h.draft)
  await h.server.downloadCurrentOfferPdf(ctx, caseId, 7)
  assert.deepEqual(h.order, ['selected', 'hf17'])
  assert.equal(h.mergedDocuments[0].length, 1)
  assert.deepEqual(h.downloads, [{ bucket: 'action-case-files', path: `${ctx.orgId}/${caseId}/fiktiv.pdf` }])
  for (const read of h.reads.filter(read => ['action_case_work_quotes', 'action_case_quote_requests', 'action_case_attachments'].includes(read.table))) {
    assert(read.filters.some(([key, value]) => key === 'org_id' && value === ctx.orgId))
    assert(read.filters.some(([key, value]) => key === 'action_case_id' && value === caseId))
  }
  assert.deepEqual(h.draft, before)
  const reference = harness({ appendix: true, referenceOnly: true })
  await reference.server.downloadCurrentOfferPdf(ctx, caseId, 7)
  assert.equal(reference.downloads.length, 0)
  assert.equal(reference.mergedDocuments.length, 0)
})

test('foreign, private, missing, oversized and invalid selected PDFs cannot produce a partial offer export', async () => {
  for (const option of ['foreignAppendix', 'questionAppendix', 'privateAppendix', 'missingAppendix', 'largeAppendix', 'wrongSize', 'imageAppendix', 'downloadFailed', 'invalidAppendix']) {
    const h = harness({ appendix: true, [option]: true })
    await assert.rejects(h.server.downloadCurrentOfferPdf(ctx, caseId, 7), /CUSTOMER_OFFER_PDF_ATTACHMENTS/, option)
  }
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
