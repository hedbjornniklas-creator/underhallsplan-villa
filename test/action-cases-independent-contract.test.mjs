import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { emptyCustomerOffer, normalizeCustomerOffer } from '../src/lib/action-cases/customerOffers.ts'
import { importContractParts } from '../src/lib/action-cases/contractImport.ts'
import { editContractProperty, emptyContractDetails } from '../src/lib/action-cases/customerContract.ts'
import { contractPricingForEditing } from '../src/lib/action-cases/contractPricing.ts'

const db = new PGlite(), org = randomUUID(), actor = randomUUID(), caseId = randomUUID(), participant = randomUUID()
const migration = (name) => readFileSync(new URL(`../docs/db/${name}.sql`, import.meta.url), 'utf8').replace('create extension if not exists pgcrypto;', '')
const ownMigration = () => migration('2026-10-08_01_independent_customer_contract')
const draft = () => ({ ...emptyCustomerOffer('Testavtal'), contractForm: 'custom', baseAmountOre: 10000,
  validUntil: '2099-01-01', items: [{ id: randomUUID(), title: 'Mark', scope: 'Ursprunglig text', scopeConditions: '', scopeExclusions: '', scopeAdvice: '', kind: 'included', amountOre: 10000 }] })
const write = (operation, data, user = actor, organization = org) => db.query('select write_customer_contract($1,$2,$3,$4,$5::jsonb)', [organization, caseId, user, operation, JSON.stringify(data)])
const state = async (table) => (await db.query(`select body,revision,internal_costing from ${table} where action_case_id=$1`, [caseId])).rows[0]
before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table organizations(id uuid primary key); create table profiles(id uuid primary key);
    create table org_members(org_id uuid,profile_id uuid,role text,is_active boolean);
    create table properties(id uuid primary key default gen_random_uuid(),owner uuid,name text,municipality text,cadastral_id text,address text,postal_code text,city text);
    create table organization_contacts(id uuid primary key);
    create function is_org_member(uuid) returns boolean language sql as $$select true$$;
    create function is_valid_swedish_organization_number(text) returns boolean language sql as $$select true$$;
    create function operational_tasks_set_updated_at() returns trigger language plpgsql as $$begin new.updated_at=clock_timestamp(); return new; end$$;
    create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`)
  for (const name of ['2026-09-08_01_action_cases_foundation','2026-09-08_02_action_case_files_and_participants',
    '2026-09-08_03_action_case_costing','2026-09-08_04_action_case_ai_costing','2026-09-08_05_action_case_work_quotes',
    '2026-09-08_09_action_case_grouped_requests','2026-09-10_05_organization_customers',
    '2026-09-29_01_action_case_customer_offers','2026-09-29_02_customer_offer_pricing',
    '2026-09-29_03_customer_offer_internal_costing','2026-09-29_04_customer_offer_planning',
    '2026-10-01_02_customer_contract_choices','2026-10-01_03_customer_payment_plan','2026-10-01_04_action_case_schedule',
    '2026-10-05_01_action_case_scope_notes','2026-10-06_01_action_case_scope_conditions',
    '2026-10-06_01_action_case_organization_customer','2026-10-07_02_action_case_property','2026-10-07_03_contract_assignment_documents']) await db.exec(migration(name))
  await db.query('insert into organizations values($1)', [org])
  await db.query('insert into profiles values($1)', [actor])
  await db.query("insert into org_members values($1,$2,'admin',true)", [org, actor])
  await db.query("insert into action_cases(id,org_id,title,property_address,customer_name) values($1,$2,'Testprojekt','Testgatan','Test')", [caseId, org])
  await db.query("insert into action_case_participants(id,org_id,action_case_id,role,name,email) values($1,$2,$3,'customer','Test','test@example.test')", [participant, org, caseId])
  await db.query("select write_customer_offer($1,$2,$3,'save',$4::jsonb)", [org, caseId, actor, JSON.stringify({ revision: 0, body: draft() })])
  await db.exec(ownMigration())
  await db.exec(migration('2026-10-08_02_contract_other_agreements'))
})
after(() => db.close())

test('explicit imports replace selected texts only, preserve price and copy all editable notes', () => {
  const existing = draft().items
  const other = { ...existing[0], id: randomUUID(), title: 'Tak', scope: 'Behåll' }
  const source = { ...existing[0], id: randomUUID(), scope: 'Ny text', scopeConditions: 'Fri tillgång', scopeExclusions: '', scopeAdvice: 'Avrådan', amountOre: 20000 }
  const result = importContractParts([...existing, other], [source], [source.id], false)
  assert.equal(result.length, 2)
  assert.equal(result[0].id, existing[0].id)
  assert.equal(result[0].amountOre, 10000)
  assert.equal(result[0].scopeConditions, 'Fri tillgång')
  assert.equal(result[0].scopeAdvice, 'Avrådan')
  assert.deepEqual(result[1], other)
  source.scope = 'Senare ändring'
  assert.equal(result[0].scope, 'Ny text')
  assert.equal(existing[0].scope, 'Ursprunglig text')
  assert.equal(importContractParts(result, [{ ...source, title: 'Omnamnad' }], [source.id], true)[0].amountOre, 20000)
})

test('new contract rows have independent UUIDs; omitted choices are never ordered', () => {
  const source = draft().items[0], generated = randomUUID()
  const result = importContractParts([], [source, { ...source, id: randomUUID(), kind: 'option' }], [source.id], true, () => generated)
  assert.equal(result.length, 1)
  assert.equal(result[0].id, generated)
  assert.notEqual(result[0].id, source.id)
  assert.equal(result[0].sourceItemId, source.id)
  assert.deepEqual(importContractParts(result, [source], [], true), result)
})

test('migration copies legacy data once; offer writes cannot overwrite contract and vice versa', async () => {
  const original = await state('action_case_customer_offer_drafts')
  assert.deepEqual(await state('action_case_customer_contract_drafts'), original)
  const changedOffer = { ...original.body, items: original.body.items.map((row) => ({ ...row, scope: 'Bara i Offert' })) }
  await db.query("select write_customer_offer($1,$2,$3,'save',$4::jsonb)", [org, caseId, actor, JSON.stringify({ revision: 1, body: changedOffer })])
  assert.deepEqual(await state('action_case_customer_contract_drafts'), original)
  const own = { ...original.body, items: original.body.items.map((row) => ({ ...row, scope: 'Bara i Avtal' })) }
  await write('save', { revision: 1, body: own })
  assert.equal((await state('action_case_customer_offer_drafts')).body.items[0].scope, 'Bara i Offert')
  assert.equal((await state('action_case_customer_contract_drafts')).body.items[0].scope, 'Bara i Avtal')
  await db.exec(ownMigration())
  assert.equal((await state('action_case_customer_contract_drafts')).revision, 2)
  await assert.rejects(write('save', { revision: 1, body: own }), /STALE/)
  await assert.rejects(write('save', { revision: 2, body: own }, randomUUID()), /NOT_FOUND/)
  await assert.rejects(write('save', { revision: 2, body: own }, actor, randomUUID()), /NOT_FOUND/)
  const rights = (await db.query("select has_table_privilege('authenticated','action_case_customer_contract_drafts','update') browser, has_function_privilege('authenticated','write_customer_contract(uuid,uuid,uuid,text,jsonb)','execute') rpc")).rows[0]
  assert.deepEqual(rights, { browser: false, rpc: false })
})

test('manual recipient save writes only the contract draft, leaving offer text and revision intact', async () => {
  const saved = await state('action_case_customer_contract_drafts'), beforeOffer = await state('action_case_customer_offer_drafts')
  const body = { ...saved.body, contractDetails: undefined, contractParties: { version: 1, customers: [{ name: 'Test', personalNumber: '' }],
    email: 'test@example.test', phone: '', mobile: '', street: '', postalCode: '', city: '', contractor: { companyName: 'Bygg AB' } } }
  await db.query("select write_action_case_contract_parties($1,$2,$3,'save',$4::jsonb)", [org, caseId, actor, JSON.stringify({ revision: saved.revision, body, costing: {} })])
  assert.deepEqual(await state('action_case_customer_offer_drafts'), beforeOffer)
  assert.equal((await state('action_case_customer_contract_drafts')).revision, saved.revision + 1)
})

test('saving a legacy offer property snapshot cannot unlink the independently connected contract property', async () => {
  const project = randomUUID(), propertyId = randomUUID()
  await db.query("insert into properties(id,owner,municipality,cadastral_id,address,city) values($1,$2,'Stockholm','TEST 1:1','Testgatan','Stockholm')", [propertyId,actor])
  await db.query("insert into action_cases(id,org_id,title,property_address,customer_name,property_id) values($1,$2,'Fastighetstest','Testgatan','Test',$3)", [project,org,propertyId])
  const details = editContractProperty(emptyContractDetails(), { municipality: 'Stockholm', cadastralDesignation: 'TEST 1:1', street: 'Testgatan', postalCode: '', city: 'Stockholm' })
  details.property.sourcePropertyId = propertyId
  const contract = { ...draft(), contractDetails: details }
  await db.query("select write_customer_contract($1,$2,$3,'save',$4::jsonb)", [org,project,actor,JSON.stringify({ revision:0,body:contract })])
  const offer = { ...contract, contractDetails: editContractProperty(details, { cadastralDesignation: 'ANNAN 2:2' }) }
  await db.query("select write_customer_offer($1,$2,$3,'save',$4::jsonb)", [org,project,actor,JSON.stringify({ revision:0,body:offer })])
  assert.equal((await db.query('select property_id from action_cases where id=$1',[project])).rows[0].property_id,propertyId)
  assert.equal((await db.query('select body from action_case_customer_contract_drafts where action_case_id=$1',[project])).rows[0].body.contractDetails.property.cadastralDesignation,'TEST 1:1')
  await db.query("select write_customer_contract($1,$2,$3,'save',$4::jsonb)", [org,project,actor,JSON.stringify({ revision:1,body:contract })])
})

test('published snapshot and own revision are immutable; signing locks every contract write and deletion', async () => {
  const saved = await state('action_case_customer_contract_drafts'), offerId = randomUUID()
  const body = { ...saved.body, contractDetails: undefined, contractParties: undefined }
  await write('save', { revision: saved.revision, body })
  const revision = saved.revision + 1
  const snapshot = { ...body, projectTitle: 'Testprojekt', propertyAddress: 'Testgatan', customerName: 'Test', customerEmail: 'test@example.test', issuerName: 'Bygg AB', replyEmail: 'bygg@example.test' }
  const publication = { id: offerId, revision, confirmed: true, participantId: participant, email: 'test@example.test', issuerName: 'Bygg AB', replyEmail: 'bygg@example.test',
    snapshot, files: [], emailPayload: { to: 'test@example.test' }, tokenHash: randomUUID() }
  await write('publish', publication)
  await write('publish', publication)
  const frozen = (await db.query('select * from action_case_customer_offers where id=$1', [offerId])).rows[0]
  assert.equal(frozen.contract_revision, revision)
  await assert.rejects(db.query('update action_case_customer_offers set contract_revision=100 where id=$1', [offerId]), /IMMUTABLE/)
  await write('save', { revision, body: { ...body, title: 'Nytt utkast' } })
  assert.deepEqual((await db.query('select snapshot from action_case_customer_offers where id=$1', [offerId])).rows[0].snapshot, JSON.parse(JSON.stringify(snapshot)))
  await db.query("update action_case_customer_offers set status='accepted',accepted_total_ore=10000 where id=$1", [offerId])
  await assert.rejects(write('save', { revision: revision + 1, body }), /ACCEPTED/)
  await assert.rejects(db.query("update action_case_customer_contract_drafts set body=jsonb_set(body,'{title}','\"Olovligt\"') where action_case_id=$1", [caseId]), /ACCEPTED/)
  await assert.rejects(db.query('delete from action_case_customer_contract_drafts where action_case_id=$1', [caseId]), /ACCEPTED/)
  await db.exec(ownMigration())
  assert.equal((await state('action_case_customer_contract_drafts')).body.title, 'Nytt utkast')
})

test('fixed, running and mixed price migration validates drafts, publish and signing without changing legacy contracts', async () => {
  const legacy = await state('action_case_customer_contract_drafts')
  await db.exec(migration('2026-10-08_03_contract_advice_fields'))
  await db.exec(migration('2026-10-08_04_contract_pricing'))
  await db.exec(migration('2026-10-08_04_contract_pricing'))
  assert.deepEqual(await state('action_case_customer_contract_drafts'), legacy)
  for (const mode of ['fixed','running','mixed']) {
    const project = randomUUID(), recipient = randomUUID(), id = randomUUID()
    await db.query("insert into action_cases(id,org_id,title,property_address,customer_name) values($1,$2,'Testprojekt','Testgatan','Test')", [project,org])
    await db.query("insert into action_case_participants(id,org_id,action_case_id,role,name,email) values($1,$2,$3,'customer','Test','test@example.test')", [recipient,org,project])
    const raw = draft(), pricing = contractPricingForEditing(raw)
    pricing.mode = mode; pricing.basis = 'rows'; pricing.display = 'priced'
    pricing.running = { hourlyOre:65000,managementOre:null,markupPercent:10,approximateOre:500000 }
    if (mode === 'mixed') pricing.rows.push({ ...pricing.rows[0],id:randomUUID(),title:'El',kind:'running',amountOre:null })
    const body = normalizeCustomerOffer({ ...raw,contractPricing:pricing })
    const call = (operation,data) => db.query('select write_customer_contract($1,$2,$3,$4,$5::jsonb)',[org,project,actor,operation,JSON.stringify(data)])
    await call('save',{ revision:0,body })
    await assert.rejects(call('save',{ revision:1,body:raw }),/STALE/)
    const invalid = structuredClone(body); invalid.baseAmountOre=999
    await assert.rejects(call('save',{ revision:1,body:invalid }),/INVALID/)
    for (const patch of [{ hourlyOre:-1 },{ hourlyOre:1.5 },{ markupPercent:1001 },{ markupPercent:1.001 }]) {
      const bad=structuredClone(body); Object.assign(bad.contractPricing.running,patch)
      await assert.rejects(call('save',{ revision:1,body:bad }),/INVALID/)
    }
    if (mode !== 'fixed') {
      const incomplete=structuredClone(body); incomplete.contractPricing.running.hourlyOre=null
      await assert.rejects(db.query('select assert_customer_offer_pricing($1::jsonb,null,true)',[JSON.stringify(incomplete)]),/INCOMPLETE/)
    }
    const snapshot={ ...body,projectTitle:'Testprojekt',propertyAddress:'Testgatan',customerName:'Test',customerEmail:'test@example.test',issuerName:'Bygg AB',replyEmail:'bygg@example.test' }
    await call('publish',{ id,revision:1,confirmed:true,participantId:recipient,email:'test@example.test',issuerName:'Bygg AB',replyEmail:'bygg@example.test',
      snapshot,files:[],emailPayload:{ to:'test@example.test' },tokenHash:randomUUID() })
    await assert.rejects(db.query('select assert_customer_offer_pricing($1::jsonb,$2::jsonb,true)',[JSON.stringify(snapshot),JSON.stringify([randomUUID()])]),/INVALID/)
    await db.query("update action_case_customer_offers set status='accepted',accepted_total_ore=$2 where id=$1",[id,body.baseAmountOre])
    assert.equal((await db.query('select accepted_total_ore from action_case_customer_offers where id=$1',[id])).rows[0].accepted_total_ore,mode==='running'?null:10000)
    await assert.rejects(call('save',{ revision:1,body }),/ACCEPTED/)
    await assert.rejects(db.query("update action_case_customer_offers set snapshot=jsonb_set(snapshot,'{contractPricing,mode}',$2::jsonb) where id=$1",[id,JSON.stringify(mode==='fixed'?'running':'fixed')]),/IMMUTABLE/)
  }
})

test('SQL computes the same fixed part for each presentation, split and basis and rejects incomplete price disclosures', async () => {
  for (const mode of ['fixed','running','mixed']) for (const split of ['combined','separate'])
    for (const basis of ['rows','total']) for (const display of ['priced','unpriced','total']) {
      const raw=draft(), pricing=contractPricingForEditing(raw)
      Object.assign(pricing,{mode,split,basis,display,labourOre:9000,materialOre:1000})
      pricing.rows[0].labourOre=0; pricing.rows[0].materialOre=10000
      pricing.running={hourlyOre:65000,managementOre:null,markupPercent:0,approximateOre:null}
      if (mode==='mixed') pricing.rows.push({...pricing.rows[0],id:randomUUID(),title:'El',kind:'running'})
      const body=normalizeCustomerOffer({...raw,contractPricing:pricing}), encoded=JSON.stringify(body)
      assert.equal((await db.query('select assert_customer_offer_pricing($1::jsonb,null,false) amount',[encoded])).rows[0].amount,body.baseAmountOre)
      if (mode!=='running' && basis==='total' && display==='priced')
        await assert.rejects(db.query('select assert_customer_offer_pricing($1::jsonb,null,true)',[encoded]),/INCOMPLETE/)
      else await db.query('select assert_customer_offer_pricing($1::jsonb,null,true)',[encoded])
      const incomplete=structuredClone(body); incomplete.contractPricing.rows[0].title=''
      await assert.rejects(db.query('select assert_customer_offer_pricing($1::jsonb,null,true)',[JSON.stringify(incomplete)]),/INCOMPLETE/)
    }
})
