import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { PGlite } from '@electric-sql/pglite'
import { emptyCustomerOffer, normalizeCustomerOffer, offerPublishIssues } from '../src/lib/action-cases/customerOffers.ts'
import { emptyContractDetails } from '../src/lib/action-cases/customerContract.ts'
import { assignmentIssues } from '../src/lib/action-cases/contractAssignment.ts'
import { ABS18_TERMS, HF17_TERMS, ABS18_WORK_ENVIRONMENT, changeContractForm, withAbs18ContractDefaults, withStandardContractTerms } from '../src/lib/action-cases/standardContractTerms.ts'
import { abs18PaymentText } from '../src/lib/action-cases/customerPaymentPlan.ts'
import { contractSigningHeading, renderContractSigningPdf } from '../src/lib/action-cases/contractSigningPdf.ts'
import { signingSnapshot, signingId as id } from './fixtures/contract-signing.ts'

const abs={id:id(140),fileName:ABS18_TERMS.fileName,contentType:'application/pdf',fileSizeBytes:ABS18_TERMS.size}
const hf={id:id(141),fileName:HF17_TERMS.fileName,contentType:'application/pdf',fileSizeBytes:HF17_TERMS.size}
const source=path=>readFileSync(new URL(`../${path}`,import.meta.url),'utf8')
const draft=()=>withStandardContractTerms({...emptyCustomerOffer('Renovering'),contractForm:'hf17',contractDetails:emptyContractDetails()},hf)

test('HF17 round-trips as a real document form with the original edition and without an invented publication date',()=>{
  const d=draft(), before=structuredClone(d)
  assert.deepEqual(normalizeCustomerOffer(d),d)
  assert.equal(d.termsAttachmentId,hf.id)
  assert.equal(d.terms,HF17_TERMS.reference)
  assert.equal(d.contractDetails.assignment.documents[0].date,'')
  assert.deepEqual(assignmentIssues(d.contractDetails.assignment),[])
  assert.deepEqual(withStandardContractTerms(d,hf),d)
  assert.deepEqual(d,before)
  assert.equal(JSON.stringify(d).includes('ABS 18'),false)
  assert(offerPublishIssues({...d,termsAttachmentId:null}).some(issue=>issue.includes('Hantverkarformuläret 17')))
  assert.throws(()=>normalizeCustomerOffer({...d,contractForm:'hf18'}),/INVALID/)
})

test('explicit form changes remove only automatic ABS conditions and preserve personal edits, costs, scope and old snapshots',()=>{
  const start=withStandardContractTerms(withAbs18ContractDefaults({...emptyCustomerOffer('Renovering'),contractDetails:emptyContractDetails(),paymentConditions:{version:1,days:30,standardText:abs18PaymentText}}),abs)
  const frozen=structuredClone(start), changed=changeContractForm(start,'hf17',[abs,hf]), result=withStandardContractTerms(changed,hf)
  assert.deepEqual(start,frozen)
  for(const key of ['items','contractPricing','baseAmountOre','title'])assert.deepEqual(result[key],start[key])
  assert.equal(result.contractDetails.assignment.standardConditions,undefined)
  assert.equal(result.contractDetails.fields.workEnvironment.text,'')
  assert.equal(result.paymentConditions.standardText,'')
  assert.deepEqual(result.attachmentIds,[hf.id])
  assert.equal(result.terms,HF17_TERMS.reference)
  const customized=structuredClone(start)
  customized.terms='Egen projektspecifik text'
  customized.paymentConditions.standardText='Egen betalningstext'
  customized.contractDetails.fields.workEnvironment.text='Egen arbetsmiljötext'
  const retained=changeContractForm(customized,'hf17',[abs])
  assert.equal(retained.terms,customized.terms)
  assert.equal(retained.paymentConditions.standardText,customized.paymentConditions.standardText)
  assert.equal(retained.contractDetails.fields.workEnvironment.text,customized.contractDetails.fields.workEnvironment.text)
  customized.contractDetails.assignment.standardConditions.text='Egen ansvarsfördelning som inte får försvinna'
  assert.match(changeContractForm(customized,'hf17',[abs]).terms,/Egen ansvarsfördelning/)
  assert.equal(frozen.contractDetails.fields.workEnvironment.text,ABS18_WORK_ENVIRONMENT.text)
  assert.deepEqual(withStandardContractTerms(changeContractForm(result,'abs18',[abs,hf]),abs).attachmentIds,[abs.id])
})

test('HF17 uses the shared PDF renderer with explicit offer and contract headings and no ABS-specific price or responsibility clauses',async()=>{
  const snapshot={...signingSnapshot(),...draft()}
  assert.deepEqual(contractSigningHeading(snapshot),{title:'HANTVERKARAVTAL',form:'Hantverkarformuläret 17'})
  assert.deepEqual(contractSigningHeading(snapshot,'offer'),{title:'OFFERT',form:'Med hänvisning till Hantverkarformuläret 17'})
  const bytes=await renderContractSigningPdf({id:id(700),kind:'offer',version:0,createdAt:'2026-11-03T10:00:00Z',snapshot,files:[hf]})
  assert(bytes.length>1000);assert.equal(bytes.subarray(0,5).toString(),'%PDF-')
  assert.match(source('next.config.ts'),/customer-offers.*public\/hf17-2017\.pdf/)
})

test('both editors expose HF17 through the same explicit form-change component',()=>{
  const code=ts.transpileModule(source('src/components/tasks/CustomerContractFormSelect.tsx'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText
  const mod={exports:{}}, jsx=(type,props)=>({type,props})
  new Function('require','module','exports',code)(name=>name==='react/jsx-runtime'?{jsx,jsxs:jsx}:name==='react'?{useState:v=>[v,()=>{}]}:{changeContractForm},mod,mod.exports)
  let applied
  const d=withStandardContractTerms({...emptyCustomerOffer('Test'),contractDetails:emptyContractDetails()},abs)
  const tree=mod.exports.default({draft:d,files:[abs,hf],onChange:value=>{applied=value}})
  const select=tree.props.children[1]
  assert(select.props.children.some(option=>option.props.value==='hf17'))
  select.props.onChange({target:{value:'hf17'}})
  assert.equal(applied.contractForm,'hf17');assert.equal(applied.attachmentIds.includes(abs.id),false)
  for(const path of ['src/components/tasks/CustomerOfferEditor.tsx','src/components/tasks/CustomerContractAssignmentEditor.tsx'])assert.match(source(path),/<CustomerContractFormSelect/)
})

test('database installs without changing history and accepts only HF17 edition metadata as an undated selected standard document',async()=>{
  const db=new PGlite()
  try{
    await db.exec(`create role anon;create role authenticated;create role service_role;
      create table action_case_customer_offer_drafts(id int primary key,body jsonb);
      create table action_case_customer_contract_drafts(id int primary key,body jsonb);
      create table action_case_customer_offers(id int primary key,snapshot jsonb);
      create table action_case_contract_signing_documents(id int primary key,snapshot jsonb);
      insert into action_case_contract_signing_documents values(1,'{"historical":"unchanged"}');`)
    const sql=source('docs/db/2026-11-03_03_hf17.sql')
    await db.exec(sql);await db.exec(sql)
    assert.deepEqual((await db.query('select snapshot from action_case_contract_signing_documents where id=1')).rows[0].snapshot,{historical:'unchanged'})
    const d=draft()
    await db.query('select assert_contract_assignment($1,true)',[d])
    for(const table of ['action_case_customer_offer_drafts','action_case_customer_contract_drafts']){
      await db.query(`insert into ${table} values(2,$1)`,[d])
      await assert.rejects(db.query(`insert into ${table} values(3,$1)`,[{...d,contractForm:'unknown'}]),/INVALID/)
    }
    const invalid=structuredClone(d);invalid.contractDetails.assignment.documents[0].name='Godtycklig handling'
    await assert.rejects(db.query('select assert_contract_assignment($1,true)',[invalid]),/INVALID|INCOMPLETE/)
    const mixed=structuredClone(d);mixed.contractDetails.assignment.standardConditions={version:'abs18-2018-06',text:'ABS'}
    await assert.rejects(db.query('select assert_standard_contract_form($1)',[mixed]),/INVALID/)
    for(const role of ['anon','authenticated'])assert.equal((await db.query("select has_function_privilege($1,'assert_standard_contract_form(jsonb)','execute') value",[role])).rows[0].value,false)
  }finally{await db.close()}
})
