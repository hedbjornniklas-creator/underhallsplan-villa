import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { PGlite } from '@electric-sql/pglite'
import { emptyCustomerOffer, normalizeCustomerOffer, mapCustomerOffer, offerPublishIssues } from '../src/lib/action-cases/customerOffers.ts'
import { emptyContractParties, normalizeContractParties, contractPartiesIssues } from '../src/lib/action-cases/customerContractParties.ts'
import { emptyContractDetails } from '../src/lib/action-cases/customerContract.ts'
import { ABS18_TERMS, changeContractForm, selectManualContractTerms, withAbs18ContractDefaults, withStandardContractTerms } from '../src/lib/action-cases/standardContractTerms.ts'
import { contractSigningHeading, contractSigningSections, renderContractSigningPdf } from '../src/lib/action-cases/contractSigningPdf.ts'
import { contractCustomerInput, copyRegistryCustomer } from '../src/lib/action-cases/customerRegistry.ts'
import { signingSnapshot, signingId as id } from './fixtures/contract-signing.ts'

const source = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
const parties = () => ({ ...emptyContractParties('Brf Exempel', 'styrelsen@example.test'),
  business: { organizationNumber: '769600-0000', contactName: 'Anna Test', signatoryName: 'Bo Test' } })
const draft = form => normalizeCustomerOffer({ ...emptyCustomerOffer('Fiktivt byggprojekt'), contractForm: form,
  contractParties: parties(), contractDetails: emptyContractDetails() })

test('AB04 and ABT06 are separate real forms and retain business identity without personal identity numbers', () => {
  for (const form of ['ab04', 'abt06']) {
    const d = draft(form), before = structuredClone(d)
    assert.deepEqual(normalizeCustomerOffer(d), d)
    const projected = mapCustomerOffer({ id: id(1), version: 1, status: 'published', snapshot: d, files: [] })
    assert.deepEqual(projected.snapshot.contractParties.business, d.contractParties.business)
    assert.equal(projected.snapshot.contractForm, form)
    assert.deepEqual(d, before)
    assert.equal(offerPublishIssues(d).some(issue => issue.includes('konsumentformulär')), false)
  }
  assert.throws(() => normalizeContractParties({ ...parties(), customers: [{ name: 'Brf Test', personalNumber: '19000101-0000' }] }), /INVALID/)
  assert.throws(() => normalizeContractParties({ ...parties(), customers: [...parties().customers, { name: 'Anna', personalNumber: '' }] }), /INVALID/)
  for (const business of [false, [], {}, { ...parties().business, organizationNumber: 'x'.repeat(21) }, { ...parties().business, contactName: 'a\nb' }])
    assert.throws(() => normalizeContractParties({ ...parties(), business }), /INVALID/)
  assert.deepEqual(normalizeContractParties({ ...parties(), business: null }).business, null)
})

test('form changes preserve prices, edited prose and frozen snapshots while deselecting the previous standard edition', () => {
  const file = { id: id(140), fileName: ABS18_TERMS.fileName, contentType: 'application/pdf', fileSizeBytes: ABS18_TERMS.size }
  const start = withStandardContractTerms(withAbs18ContractDefaults({ ...emptyCustomerOffer('Bygg'), contractDetails: emptyContractDetails() }), file)
  const before = structuredClone(start), ab = changeContractForm(start, 'ab04', [file])
  assert.deepEqual(start, before)
  assert.deepEqual(ab.attachmentIds, [])
  assert.equal(changeContractForm({ ...start, termsAttachmentId: id(142), attachmentIds: [id(142)] }, 'ab04', []).termsAttachmentId, null)
  assert.match(ab.terms, /AB 04/); assert.doesNotMatch(ab.terms, /ABS 18|Hantverkar/)
  assert.equal(ab.contractDetails.fields.workEnvironment.text, '')
  const own = changeContractForm({ ...ab, terms: 'Egen överenskommelse' }, 'abt06')
  assert.equal(own.terms, 'Egen överenskommelse')
  const manual = { id: id(142), fileName: 'FIKTIV-AB04.pdf', contentType: 'application/pdf', fileSizeBytes: 1234 }
  const withTerms = { ...ab, ...selectManualContractTerms(ab, manual, [manual]) }
  const abt = changeContractForm(withTerms, 'abt06', [manual])
  assert.equal(abt.termsAttachmentId, null)
  assert.equal(abt.attachmentIds.includes(manual.id), false)
  assert.match(abt.terms, /ABT 06/)
  assert.deepEqual(abt.items, ab.items); assert.equal(abt.baseAmountOre, ab.baseAmountOre)
  const removed = { ...withTerms, ...selectManualContractTerms(withTerms, undefined, [manual]) }
  assert.equal(removed.termsAttachmentId, null); assert.equal(removed.attachmentIds.includes(manual.id), false)
})

test('consumer forms and missing organization/signatory details are explicit readiness issues, never fabricated identities', () => {
  const business = parties()
  assert.equal(contractPartiesIssues(business).some(issue => issue.includes('undertecknare')), false)
  assert(contractPartiesIssues({ ...business, business: { ...business.business, organizationNumber: '', signatoryName: '' } }).some(issue => issue.includes('organisationsnummer')))
  assert(offerPublishIssues({ ...draft('hf17') }).some(issue => issue.includes('konsumentformulär')))
  assert(offerPublishIssues({ ...draft('ab04'), contractParties: emptyContractParties() }).some(issue => issue.includes('företag eller förening')))
  assert.throws(() => contractCustomerInput(business), /BUSINESS_UNSUPPORTED/)
  assert.throws(() => copyRegistryCustomer(business, { customerType: 'private', isActive: true }), /BUSINESS_UNSUPPORTED/)
})

test('business PDF uses commercial headings and saved party/scope/pricing fields without rewriting any source data', async () => {
  for (const form of ['ab04', 'abt06']) {
    const snapshot = { ...signingSnapshot(), ...draft(form) }, before = structuredClone(snapshot)
    assert.equal(contractSigningHeading(snapshot).title, 'ENTREPRENADKONTRAKT')
    assert.match(contractSigningHeading(snapshot).form, form === 'ab04' ? /AB 04/ : /ABT 06/)
    assert.equal(contractSigningHeading(snapshot, 'offer').title, 'OFFERT')
    const sections = contractSigningSections({ snapshot, files: [] })
    const p = sections.filter(row => row.group === 'parties').flatMap(row => row.paragraphs).join('\n')
    assert.match(p, /Organisationsnummer: 769600-0000/)
    assert.match(p, /Undertecknare: Bo Test/); assert.doesNotMatch(p, /Personnummer/)
    const bytes = await renderContractSigningPdf({ id: id(700), version: 0, createdAt: '2026-11-03T10:00:00Z', snapshot, files: [] })
    assert.equal(bytes.subarray(0, 5).toString(), '%PDF-')
    assert.deepEqual(snapshot, before)
  }
})

test('real form selector exposes both commercial forms and the customer editor confirms destructive type changes', () => {
  const selector = source('src/components/tasks/CustomerContractFormSelect.tsx')
  assert.match(selector, /value="ab04"/); assert.match(selector, /value="abt06"/)
  const jsx = (type, props) => ({ type, props }), mod = { exports: {} }
  const code = ts.transpileModule(source('src/components/tasks/CustomerContractPartiesEditor.tsx'), { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText
  new Function('require', 'module', 'exports', code)(name => name === 'react/jsx-runtime' ? { jsx, jsxs: jsx } : name === 'react' ? { useState: v => [v, () => {}] } : new Proxy({}, { get: () => 'icon' }), mod, mod.exports)
  const tree = mod.exports.ContractCustomerEditor({ value: parties(), onChange() {} })
  const flatten = node => Array.isArray(node) ? node.flatMap(flatten) : node && typeof node === 'object' ? [node, ...flatten(node.props?.children)] : []
  const fields = flatten(tree).filter(row => row.type === 'input').map(row => row.props['aria-label'])
  assert(fields.includes('Beställare: Organisationsnummer'))
  assert(fields.includes('Beställare: Behörig undertecknare'))
  assert.equal(fields.some(label => label?.includes('Personnummer')), false)
})

test('database protects new forms and organization fields without data migration or broader permissions', async () => {
  const db = new PGlite()
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create table action_case_customer_offer_drafts(id int primary key, body jsonb);
      create table action_case_customer_contract_drafts(id int primary key, body jsonb);
      create table action_case_customer_offers(id int primary key, snapshot jsonb);
      create table action_case_contract_signing_documents(id int primary key, snapshot jsonb);
      insert into action_case_contract_signing_documents values(1,'{"legacy":"untouched"}');`)
    await db.exec(source('docs/db/2026-11-03_03_hf17.sql'))
    const sql = source('docs/db/2026-11-03_04_commercial_contracts.sql')
    await db.exec(sql); await db.exec(sql)
    assert.deepEqual((await db.query('select snapshot from action_case_contract_signing_documents where id=1')).rows[0].snapshot, { legacy: 'untouched' })
    const d = draft('ab04')
    await db.query('insert into action_case_customer_offer_drafts values(2,$1)', [d])
    const stale = structuredClone(d); delete stale.contractParties.business
    await assert.rejects(db.query('update action_case_customer_offer_drafts set body=$1 where id=2', [stale]), /STALE/)
    await db.query('update action_case_customer_offer_drafts set body=$1 where id=2', [{ ...d, contractParties: { ...d.contractParties, business: null } }])
    for (const invalid of [{ ...d, contractForm: 'unknown' }, { ...d, contractParties: { ...d.contractParties, business: {} } },
      { ...d, contractParties: { ...d.contractParties, customers: [{ name: 'A', personalNumber: '19000101-0000' }] } }])
      await assert.rejects(db.query('select assert_commercial_contract($1)', [invalid]), /INVALID/)
    for (const role of ['anon', 'authenticated']) assert.equal((await db.query("select has_function_privilege($1,'assert_commercial_contract(jsonb)','execute') allowed", [role])).rows[0].allowed, false)
  } finally { await db.close() }
})
