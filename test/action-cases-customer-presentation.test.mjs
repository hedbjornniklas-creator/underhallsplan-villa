import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
import { readFileSync } from 'node:fs'
import * as presentation from '../src/lib/action-cases/customerPresentation.ts'
import { emptyCustomerOffer, normalizeCustomerOffer, customerPriceLabel } from '../src/lib/action-cases/customerOffers.ts'
import { emptyContractParties } from '../src/lib/action-cases/customerContractParties.ts'
import { contractSigningSections, offerAlternativeSections } from '../src/lib/action-cases/contractSigningPdf.ts'
import { workItemSum } from '../src/lib/action-cases/workSums.ts'

const business = presentation.defaultCustomerPresentation('business'), privateBuyer = presentation.defaultCustomerPresentation('private')
test('three customer kinds have explicit defaults; consumers cannot select net; malformed settings fail closed', () => {
  assert.equal(business.vatBasis, 'excl'); assert.equal(privateBuyer.vatBasis, 'incl')
  assert.equal(presentation.defaultCustomerPresentation('association').vatBasis, 'incl')
  for (const vatBasis of ['incl', 'excl']) assert.equal(presentation.normalizeCustomerPresentation({ version: 1, customerType: 'association', vatBasis }).vatBasis, vatBasis)
  for (const value of [null, [], {}, { ...privateBuyer, vatBasis: 'excl' }, { ...business, extra: true }, { ...business, customerType: 'other' }]) assert.throws(() => presentation.normalizeCustomerPresentation(value), /INVALID/)
})
test('VAT display is pure, preserves null and zero, handles different rates and never converts already-net fields twice', () => {
  const original = { amountOre: 1250000 }, before = structuredClone(original)
  assert.equal(presentation.displayedCustomerAmount(original.amountOre, 'excl'), 1000000)
  assert.equal(presentation.storedCustomerAmount(1000000, 'excl'), original.amountOre)
  assert.equal(presentation.displayedCustomerAmount(10600, 'excl', 6), 10000)
  assert.equal(presentation.displayedCustomerAmount(10000, 'excl', 25, 'excl'), 10000)
  assert.equal(presentation.displayedCustomerAmount(10000, 'incl', 25, 'excl'), 12500)
  assert.equal(presentation.displayedCustomerAmount(null, 'excl'), null)
  assert.equal(presentation.displayedCustomerAmount(0, 'excl'), 0)
  assert.deepEqual(presentation.customerVatBreakdown(101), { netOre: 81, vatOre: 20, grossOre: 101 })
  assert.deepEqual(original, before)
})
const draft = () => ({ ...emptyCustomerOffer('Fiktiv offert'), contractForm: 'custom', baseAmountOre: 1250000,
  contractParties: emptyContractParties('Fiktiv beställare', 'test@example.test'),
  paymentPlan: { version: 1, installments: [{ id: randomUUID(), title: 'Delbetalning', condition: 'Efter arbete', plannedDate: '', amountOre: 1250000 }] },
  items: [{ id: randomUUID(), title: 'Arbete', kind: 'included', scope: 'Oförändrad omfattning', amountOre: 1250000 }] })
const snapshot = d => ({ ...d, projectTitle: 'Fiktivt projekt', propertyAddress: 'Testgatan 1', customerName: 'Test', customerEmail: 'test@example.test', issuerName: 'Bygg AB', replyEmail: 'test@example.test' })
test('offer and contract PDF sections use the saved presentation, never mutate prices or rewrite customer free text', () => {
  const d = draft(); d.introduction = 'Särskilt villkor: 12 500 kr inklusive moms.'
  const before = structuredClone(d)
  for (const kind of [undefined, 'offer']) {
    const sections = contractSigningSections({ snapshot: snapshot({ ...d, customerPresentation: business }), files: [], kind })
    const fixed = sections.find(s => s.title === (kind ? 'Fasta priser' : 'Priset'))
    assert.match(fixed.columns.join(' '), /exkl/); assert.match(fixed.rows.at(-1).join(' '), /10\s000/)
    assert.match(JSON.stringify(sections.filter(s => s.group === 'payments')), /10\s000/)
    assert.match(JSON.stringify(sections), /Särskilt villkor: 12 500 kr inklusive moms/)
    assert.deepEqual(sections.find(s => s.title === 'Momsredovisning').rows.map(r => r[0]), ['Exklusive moms', 'Moms 25 %', 'Inklusive moms'])
  }
  assert.deepEqual(d, before)
  assert.match(customerPriceLabel({ ...d, customerPresentation: business }), /10\s000/)
  const legacy = contractSigningSections({ snapshot: snapshot(d), files: [] })
  assert.match(JSON.stringify(legacy.find(s => s.title === 'Priset')), /12\s500/)
  assert.equal(legacy.some(s => s.title === 'Momsredovisning'), false)
  assert.deepEqual(normalizeCustomerOffer({ ...d, customerPresentation: business, contractParties: { ...d.contractParties, business: { organizationNumber: '', contactName: '', signatoryName: '' } } }).items, d.items)
  assert.throws(() => normalizeCustomerOffer({ ...d, customerPresentation: business }), /PRESENTATION_INVALID/)
})
test('B2B alternatives remain net in storage and legacy documents, including after choosing inclusive presentation', () => {
  const d = { ...emptyCustomerOffer('Företag'), contractForm: 'ab04', offerAlternatives: { version: 1, issuedOn: '', selectionTerms: '', parts: [{ id: randomUUID(), title: 'Del', scope: 'Arbete', amountExVatOre: 1000000 }] } }
  for (const [settings, expected] of [[undefined, /10\s000/], [business, /10\s000/], [{ ...business, vatBasis: 'incl' }, /12\s500/]]) {
    const sections = offerAlternativeSections({ snapshot: snapshot({ ...d, customerPresentation: settings }), kind: 'offer', files: [] })
    assert.match(JSON.stringify(sections.find(s => s.group === 'price')), expected)
  }
  assert.equal(d.offerAlternatives.parts[0].amountExVatOre, 1000000)
})
test('internal calculation display uses its actual VAT rates, without changing the worksheet', () => {
  const item = { costLines: [{ quantity: 1, unitCost: 100, markupPercent: 0, vatRate: 6 }, { quantity: 1, unitCost: 100, markupPercent: 0, vatRate: 25 }] }
  const before = structuredClone(item)
  assert.equal(workItemSum(item).amountOre, 23100)
  assert.equal(workItemSum(item, 'excl').amountOre, 20000)
  assert.deepEqual(item, before)
})

test('SQL selection is scoped, atomic, retryable and guarded; migration never rewrites stored prices, calculations or locked documents', async () => {
  const db = new PGlite(), org = randomUUID(), actor = randomUUID(), other = randomUUID(), project = randomUUID()
  const migration = readFileSync(new URL('../docs/db/2026-11-26_01_project_customer_presentation.sql', import.meta.url), 'utf8')
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create table organizations(id uuid primary key); create table profiles(id uuid primary key);
      create table org_members(org_id uuid,profile_id uuid);
      create table action_cases(id uuid primary key,org_id uuid,title text,customer_name text,customer_email text,customer_phone text,organization_customer_id uuid,customer_link_request_id uuid);
      create table organization_customers(id uuid primary key,org_id uuid,customer_type text,organization_number text,personal_identity_number text,name text,email text,phone text,address text,address_line_2 text,postal_code text,city text,version bigint,is_active boolean,
        constraint organization_customers_type_check check(customer_type in ('private','business')),
        constraint organization_customers_identity_type_check check((customer_type='business' and organization_number is not null and personal_identity_number is null) or (customer_type='private' and organization_number is null)));
      create table action_case_customer_contract_drafts(action_case_id uuid primary key,org_id uuid,revision integer,body jsonb,internal_costing jsonb,updated_by uuid,updated_at timestamptz);
      create table action_case_customer_offer_drafts(like action_case_customer_contract_drafts including all);
      create table action_case_customer_offers(action_case_id uuid,status text,snapshot jsonb);
      create table action_case_contract_signing_documents(action_case_id uuid,released_at timestamptz,snapshot jsonb);
      create table action_case_contract_signing_delivery(action_case_id uuid,signed_copy jsonb);
      create table action_case_contract_senders(action_case_id uuid,org_id uuid,snapshot jsonb);
      create table action_case_events(org_id uuid,action_case_id uuid,event_type text,message text,performed_by uuid);
      create table action_case_access_links(org_id uuid,action_case_id uuid,revoked_at timestamptz);
      create table action_case_attachment_grants(participant_id uuid);
      create table action_case_participants(id uuid,action_case_id uuid,role text);
      create table action_case_customer_planning(action_case_id uuid,org_id uuid,shared_items jsonb,participant_id uuid,revision integer,shared_revision integer);
      create table action_case_schedules(action_case_id uuid,org_id uuid,shared_rows jsonb,revision integer);
      create function assert_contract_sender_actor(o uuid,u uuid) returns void language plpgsql as $$ begin if not exists(select 1 from public.org_members where org_id=o and profile_id=u) then raise exception 'FORBIDDEN'; end if; end $$;
      create function customer_choices_snapshot(uuid,uuid,uuid) returns jsonb language sql as $$ select '{}'::jsonb $$;`)
    await db.query('insert into organizations values($1),($2)', [org, other]); await db.query('insert into profiles values($1)', [actor])
    await db.query('insert into org_members values($1,$2)', [org, actor])
    await db.query('insert into action_cases(id,org_id,title) values($1,$2,$3)', [project, org, 'Fiktivt projekt'])
    const d = draft(), original = structuredClone(d), costing = { internal: 'Får inte ändras', amount: 12345 }
    for (const table of ['action_case_customer_contract_drafts', 'action_case_customer_offer_drafts']) await db.query(`insert into ${table}(action_case_id,org_id,revision,body,internal_costing) values($1,$2,1,$3,$4)`, [project, org, d, costing])
    const state = async () => (await db.query('select revision,body,internal_costing from action_case_customer_contract_drafts where action_case_id=$1', [project])).rows[0]
    const before = await state()
    await db.exec(migration); await db.exec(migration)
    assert.deepEqual(await state(), before)
    const request = { requestId: randomUUID(), revision: 0, contractRevision: 1, offerRevision: 1, value: business, customerId: null, customerVersion: null }
    const write = (payload = request, organization = org) => db.query('select select_project_customer_presentation($1,$2,$3,$4::jsonb)', [organization, project, actor, payload])
    await assert.rejects(write(request, other), /FORBIDDEN/)
    await write(); const saved = await state(); await write(); assert.deepEqual(await state(), saved)
    assert.deepEqual(saved.body.customerPresentation, business)
    for (const key of ['baseAmountOre', 'items', 'paymentPlan']) assert.deepEqual(saved.body[key], original[key])
    assert.deepEqual(saved.internal_costing, costing)
    assert.deepEqual((await db.query('select body->\'customerPresentation\' value from action_case_customer_offer_drafts')).rows[0].value, business)
    await assert.rejects(write({ ...request, value: privateBuyer }), /STALE/)
    await assert.rejects(db.query('update action_case_customer_contract_drafts set body=$1 where action_case_id=$2', [original, project]), /STALE/)
    const next = { ...request, requestId: randomUUID(), revision: 1, contractRevision: 2, offerRevision: 2, value: privateBuyer }
    await db.query('insert into action_case_contract_signing_documents values($1,null,$2)', [project, original])
    await assert.rejects(write(next), /LOCKED/)
    assert.deepEqual(await state(), saved)
    assert.deepEqual((await db.query('select snapshot from action_case_contract_signing_documents')).rows[0].snapshot, original)
    await db.exec('update action_case_contract_signing_documents set released_at=now()')
    await db.query('insert into action_case_contract_signing_delivery values($1,$2)', [project, { fileName: 'signerat.pdf' }])
    await assert.rejects(write(next), /LOCKED/)
    assert.equal((await db.query("select has_function_privilege('authenticated','select_project_customer_presentation(uuid,uuid,uuid,jsonb)','execute') allowed")).rows[0].allowed, false)
    await db.query('delete from action_case_contract_signing_delivery where action_case_id=$1', [project]); await write(next)
    assert.equal((await state()).body.baseAmountOre, original.baseAmountOre)
    const blocked = { ...next, requestId: randomUUID(), revision: 2, contractRevision: 3, offerRevision: 3, value: business }
    const privateData = await state(); privateData.body.contractParties.customers[0].personalNumber = '700101-1234'
    await db.query('update action_case_customer_contract_drafts set body=$1 where action_case_id=$2', [privateData.body, project])
    await assert.rejects(write(blocked), /IDENTITY/)
  } finally { await db.close() }
})
