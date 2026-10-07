import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import ts from 'typescript'
import * as assignment from '../src/lib/action-cases/contractAssignment.ts'
import { emptyContractDetails, normalizeContractDetails } from '../src/lib/action-cases/customerContract.ts'
import { emptyCustomerOffer, normalizeCustomerOffer, offerPublishIssues } from '../src/lib/action-cases/customerOffers.ts'
import * as offers from '../src/lib/action-cases/customerOffers.ts'
import { id } from './fixtures/customer-offer-data.ts'

const files = [{ id: id(4), fileName: 'Ritning A.pdf', contentType: 'application/pdf', fileSizeBytes: 10 },
  { id: id(6), fileName: 'Beskrivning.pdf', contentType: 'application/pdf', fileSizeBytes: 10 }]
function draft() { return { ...emptyCustomerOffer(), contractDetails: emptyContractDetails(), attachmentIds: [id(4)], termsAttachmentId: id(4) } }
function structured() {
  const d = draft(), a = assignment.assignmentForEditing(d, files)
  a.documents[0] = { ...a.documents[0], type: 'Ritning', date: '2026-10-07' }
  a.additionalScope = 'Extra anslutning'; a.exclusions = 'Ingen målning'; a.documentNotes = 'Revision B gäller.'
  return { ...d, ...assignment.assignmentPatch(d, a) }
}

test('uploaded files supply names, not guessed types or upload dates, and old notes are retained without mutating the snapshot', () => {
  const d = draft(); d.contractDetails.fields.documents.text = 'Tidigare uppgifter'
  const original = structuredClone(d), a = assignment.assignmentForEditing(d, files)
  assert.deepEqual(a.documents, [{ fileId: id(4), type: '', name: 'Ritning A.pdf', date: '' }])
  assert.equal(a.documentNotes, 'Tidigare uppgifter')
  assert.deepEqual(d, original)
  assert.deepEqual(normalizeCustomerOffer(d), d)
})
test('structured assignment round-trips and incomplete references block delivery, not background save', () => {
  const d = structured()
  assert.deepEqual(normalizeCustomerOffer(d), d)
  const a = { ...d.contractDetails.assignment, documents: [{ ...d.contractDetails.assignment.documents[0], date: '' }] }
  const incomplete = { ...d, ...assignment.assignmentPatch(d, a) }
  assert.equal(normalizeCustomerOffer(incomplete).contractDetails.fields.documents.status, 'unreviewed')
  assert(offerPublishIssues(incomplete).includes('Komplettera handling 1: datum.'))
  assert.equal(normalizeCustomerOffer(d).contractDetails.fields.documents.status, 'specified')
})
test('add/remove saves file inclusion, reference and agreement selection atomically, without deleting a project file', () => {
  const d = structured(), a = d.contractDetails.assignment
  const next = { ...d, ...assignment.assignmentPatch(d, { ...a, documents: [...a.documents, { fileId: id(6), type: 'Beskrivning', name: 'Beskrivning.pdf', date: '2026-10-06' }] }) }
  assert.deepEqual(next.attachmentIds, [id(4), id(6)])
  const removed = { ...next, ...assignment.assignmentPatch(next, { ...next.contractDetails.assignment, documents: [next.contractDetails.assignment.documents[1]] }) }
  assert.deepEqual(removed.attachmentIds, [id(6)])
  assert.equal(removed.termsAttachmentId, null)
  assert.equal(files.length, 2)
  assert.deepEqual(normalizeCustomerOffer(removed), removed)
})
test('invalid references, duplicate ids, bad dates and excess text fail closed; incomplete legacy documents remain readable', () => {
  const a = structured().contractDetails.assignment
  for (const documents of [null, [{ ...a.documents[0], fileId: 'bad' }], [...a.documents, ...a.documents],
    [{ ...a.documents[0], date: '2026-02-30' }], [{ ...a.documents[0], type: 'x'.repeat(101) }],
    [{ ...a.documents[0], name: 12 }], Array.from({ length: 31 }, (_, n) => ({ ...a.documents[0], fileId: id(100+n) }))]) {
    assert.throws(() => assignment.normalizeAssignment({ ...a, documents }), /INVALID/)
  }
  assert.throws(() => normalizeCustomerOffer({ ...structured(), attachmentIds: [], termsAttachmentId: null }), /INVALID/)
  assert.throws(() => normalizeContractDetails({ ...structured().contractDetails, assignment: { ...a, exclusions: 'x'.repeat(6001) } }), /INVALID/)
})

function editor() {
  const code = ts.transpileModule(readFileSync(new URL('../src/components/tasks/CustomerContractAssignmentEditor.tsx', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 }
  }).outputText
  const loaded = { exports: {} }, jsx = (type, props) => ({ type, props })
  new Function('require','module','exports',code)((name) => {
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx }
    if (name === 'lucide-react') return { ArrowDown:'svg', ArrowUp:'svg', ExternalLink:'svg', Trash2:'svg' }
    if (name === '@/lib/action-cases/contractAssignment') return assignment
    throw Error(name)
  }, loaded, loaded.exports)
  return loaded.exports.default
}
const flatten = (node) => Array.isArray(node) ? node.flatMap(flatten) : !node || typeof node !== 'object' ? [node] : [node,...flatten(node.props?.children)]
test('the real editor supports free types, dates, ordered files and secure separate-window opening', () => {
  let patch; const d = structured(), nodes = flatten(editor()({ draft:d, files, caseId:id(1), onChange:(p) => { patch=p } }))
  const find = (label) => nodes.find((n) => n?.props?.['aria-label'] === label)
  const link = find('Öppna Ritning A.pdf i ny flik')
  assert.equal(link.props.target, '_blank'); assert.equal(link.props.rel, 'noopener noreferrer')
  assert.equal(link.props.href, `/api/action-cases/${id(1)}/attachments/${id(4)}`)
  find('Typ av handling 1').props.onChange({ target:{value:'Specialhandling'} })
  assert.equal(patch.contractDetails.assignment.documents[0].type, 'Specialhandling')
  find('Lägg till handling från projektet').props.onChange({target:{value:id(6)}})
  assert.equal(patch.contractDetails.assignment.documents.length, 2)
  assert.equal(patch.contractDetails.assignment.documents[1].date, '')
  find('Ta bort handling 1 från avtalet').props.onClick()
  assert.deepEqual(patch.attachmentIds, []); assert.equal(patch.termsAttachmentId, null)
})

test('one file picker and PDF row radios replace the duplicate agreement picker, retaining metadata and file inclusion', () => {
  let d = structured()
  const a = d.contractDetails.assignment
  d = { ...d, ...assignment.assignmentPatch(d, { ...a, documents: [...a.documents,
    { fileId: id(6), type: 'Allmänna bestämmelser', name: 'Villkor', date: '2026-10-06' },
    { fileId: id(7), type: 'Foto', name: 'Foto.jpg', date: '2026-10-07' }] }) }
  const library = [...files, { id: id(7), fileName: 'Foto.jpg', contentType: 'image/jpeg', fileSizeBytes: 10 }]
  const render = () => flatten(editor()({ draft: d, files: library, caseId: id(1), onChange: (p) => { d = { ...d, ...p } } }))
  let nodes = render()
  assert.equal(nodes.filter((n) => n?.type === 'select').length, 2)
  assert.equal(nodes.includes('Avtalshandling (PDF)'), false)
  const radios = nodes.filter((n) => n?.type === 'input' && n.props.type === 'radio')
  assert.equal(radios.length, 2)
  assert.equal(radios[0].props.checked, true)
  assert.equal(radios[1].props.checked, false)
  assert.equal(radios[0].props.name, radios[1].props.name)
  const original = structuredClone(d)
  radios[1].props.onChange()
  assert.equal(d.termsAttachmentId, id(6))
  assert.deepEqual(d.attachmentIds, original.attachmentIds)
  assert.deepEqual(d.contractDetails, original.contractDetails)
  nodes = render()
  assert.equal(nodes.find((n) => n?.props?.['aria-label'] === 'Använd handling 1 som avtalsvillkor').props.checked, false)
  assert.equal(nodes.find((n) => n?.props?.['aria-label'] === 'Använd handling 2 som avtalsvillkor').props.checked, true)
  nodes.find((n) => n?.props?.['aria-label'] === 'Ta bort handling 2 från avtalet').props.onClick()
  assert.equal(d.termsAttachmentId, null)
  assert.deepEqual(d.attachmentIds, [id(4), id(7)])
  assert(offerPublishIssues(d).includes('Markera en PDF-handling som avtalsvillkor i handlingsförteckningen för ABS 18.'))
})

test('legacy terms selection materializes references atomically; custom contracts can clear the role without removing documents', () => {
  let d = { ...draft(), contractForm: 'custom' }
  const render = () => flatten(editor()({ draft: d, files, caseId: id(1), onChange: (p) => { d = { ...d, ...p } } }))
  let nodes = render()
  nodes.find((n) => n?.props?.['aria-label'] === 'Ingen separat villkorsbilaga').props.onChange()
  assert.equal(d.termsAttachmentId, null)
  assert.deepEqual(d.attachmentIds, [id(4)])
  assert.equal(d.contractDetails.assignment.documents[0].fileId, id(4))
  nodes = render()
  assert.equal(nodes.find((n) => n?.props?.['aria-label'] === 'Ingen separat villkorsbilaga').props.checked, true)
  nodes.find((n) => n?.props?.['aria-label'] === 'Använd handling 1 som avtalsvillkor').props.onChange()
  assert.equal(d.termsAttachmentId, id(4))
  assert.deepEqual(normalizeCustomerOffer(d), d)
})

test('the real contract document prints ordered metadata, extra scope and exclusions outside the price header; old snapshots keep their layout', () => {
  const code = ts.transpileModule(readFileSync(new URL('../src/components/tasks/CustomerOfferDocument.tsx', import.meta.url),'utf8'), {
    compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}
  }).outputText
  const loaded={exports:{}}, jsx=(type,props)=>({type,props})
  new Function('require','module','exports',code)((name)=>{
    if(name==='react/jsx-runtime') return {jsx,jsxs:jsx}
    if(name==='react') return {useId:()=> 'test'}
    if(name==='lucide-react') return {Check:'svg',Download:'svg',FileText:'svg'}
    if(name==='./CustomerContractFields') return {CustomerContractDocument:'contract-details'}
    if(name==='./CustomerPaymentPlan') return {PaymentPlanDocument:'payment-plan'}
    if(name==='./CustomerContractPartiesEditor') return {ContractPartiesDocument:'parties'}
    if(name==='@/lib/action-cases/customerOffers') return offers
    throw Error(name)
  },loaded,loaded.exports)
  const d=structured(), view=(body)=>loaded.exports.default({offer:{id:'draft',version:0,status:'published',snapshot:body,files:[],publishedAt:''}, selected:[], purpose:'contract', fileUrl:(id)=>`/file/${id}`})
  const tree=view(d), nodes=flatten(tree)
  for(const text of ['Uppdraget','Samt enligt följande','Extra anslutning','Ingen målning','Revision B gäller.','Ritning','Ritning A.pdf','2026-10-07','Datum vid publicering']) assert(nodes.includes(text),text)
  const link=nodes.find(n=>n?.type==='a'&&n.props.href===`/file/${id(4)}`)
  assert.equal(link.props.target,'_blank')
  const header=nodes.find(n=>n?.type==='div'&&n.props.className==='flex flex-wrap items-baseline justify-between gap-3')
  assert.equal(flatten(header).some(n=>n?.type==='table'),false)
  const legacy=flatten(view(draft()))
  assert(legacy.includes('Grundåtagande')); assert.equal(legacy.some(n=>n?.type==='table'),false)
})

const db = new PGlite()
before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table action_case_customer_offer_drafts(id uuid primary key,org_id uuid,action_case_id uuid,body jsonb);
    create table action_case_customer_offers(id uuid primary key,org_id uuid,action_case_id uuid,snapshot jsonb,files jsonb);
    create table action_case_attachments(id uuid primary key,org_id uuid,action_case_id uuid);
    create table action_case_work_quotes(document_id uuid);
    create table action_case_quote_requests(response_document_id uuid);
    insert into action_case_attachments values('${id(4)}','${id(90)}','${id(1)}'),('${id(6)}','${id(91)}','${id(1)}');`)
  const migration = readFileSync(new URL('../docs/db/2026-10-07_03_contract_assignment_documents.sql', import.meta.url), 'utf8')
  await db.exec(migration); await db.exec(migration)
})
after(() => db.close())
test('SQL accepts structured drafts and requires complete rows before publication; migration is rerunnable', async () => {
  const d = structured()
  await db.query('select assert_contract_assignment($1::jsonb,true)', [JSON.stringify(d)])
  const a = assignment.assignmentForEditing(draft(),files), incomplete = { ...draft(), ...assignment.assignmentPatch(draft(),a) }
  await db.query('select assert_contract_assignment($1::jsonb,false)', [JSON.stringify(incomplete)])
  await assert.rejects(db.query('select assert_contract_assignment($1::jsonb,true)', [JSON.stringify(incomplete)]), /INCOMPLETE/)
  for (const bad of [{ ...d,attachmentIds:[] }, { ...d,contractDetails:{...d.contractDetails,assignment:{...d.contractDetails.assignment,documents:[{...a.documents[0],date:'2026-02-30'}]}} }]) {
    await assert.rejects(db.query('select assert_contract_assignment($1::jsonb,false)',[JSON.stringify(bad)]), /INVALID/)
  }
})
test('SQL prevents foreign/private/missing documents, stale clients discarding the structure and snapshots without frozen file copies', async () => {
  const d = structured()
  await db.query('insert into action_case_customer_offer_drafts values($1,$2,$3,$4::jsonb)',[id(30),id(90),id(1),JSON.stringify(d)])
  await assert.rejects(db.query('update action_case_customer_offer_drafts set body=$1::jsonb where id=$2',[JSON.stringify(draft()),id(30)]), /INVALID/)
  const foreign = { ...d, ...assignment.assignmentPatch(d,{...d.contractDetails.assignment,documents:[{fileId:id(6),type:'Ritning',name:'Private',date:'2026-10-07'}]}) }
  await assert.rejects(db.query('update action_case_customer_offer_drafts set body=$1::jsonb where id=$2',[JSON.stringify(foreign),id(30)]), /FILES/)
  await db.exec(`insert into action_case_work_quotes values('${id(4)}')`)
  await assert.rejects(db.query('update action_case_customer_offer_drafts set body=$1::jsonb where id=$2',[JSON.stringify(d),id(30)]), /FILES/)
  await db.exec('delete from action_case_work_quotes')
  await assert.rejects(db.query('insert into action_case_customer_offers values($1,$2,$3,$4::jsonb,$5::jsonb)',[id(40),id(90),id(1),JSON.stringify(d),'[]']), /FILES/)
  await db.query('insert into action_case_customer_offers values($1,$2,$3,$4::jsonb,$5::jsonb)',[id(40),id(90),id(1),JSON.stringify(d),JSON.stringify([{id:id(4)}])])
})
