import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { editContractParticipants, emptyContractDetails, contractDetailsIssues, normalizeContractDetails } from '../src/lib/action-cases/customerContract.ts'
import { normalizePlannedItems } from '../src/lib/action-cases/customerPlanning.ts'
import { normalizePaymentPlan, paymentPlanTotal, paymentPlanIssues } from '../src/lib/action-cases/customerPaymentPlan.ts'
import { emptyContractParties } from '../src/lib/action-cases/customerContractParties.ts'
import {
  normalizeCustomerOffer,
  emptyCustomerOffer,
  customerOfferTotal,
  customerOfferBaseAmount,
  selectCustomerOfferOption,
  offerPublishIssues,
  parseKronor,
  mapCustomerOffer
} from '../src/lib/action-cases/customerOffers.ts'

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const sql = (name) =>
  readFileSync(
    new URL(`../docs/db/${name}.sql`, import.meta.url),
    'utf8'
  ).replace('create extension if not exists pgcrypto;', '')
const db = new PGlite()
const migration = () => sql('2026-09-29_01_action_case_customer_offers')
const get = async (table, key) =>
  (await db.query(`select * from ${table} where id=$1`, [key])).rows[0]
let seq = 100
before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table organizations(id uuid primary key); create table profiles(id uuid primary key);
    create table organization_contacts(id uuid primary key);
    create function is_org_member(uuid) returns boolean language sql as $$ select true $$;
    create function operational_tasks_set_updated_at() returns trigger language plpgsql as $$ begin new.updated_at=clock_timestamp(); return new; end $$;
    create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`)
  for (const name of [
    '2026-09-08_01_action_cases_foundation',
    '2026-09-08_02_action_case_files_and_participants',
    '2026-09-08_03_action_case_costing',
    '2026-09-08_04_action_case_ai_costing',
    '2026-09-08_05_action_case_work_quotes',
    '2026-09-08_09_action_case_grouped_requests'
  ])
    await db.exec(sql(name))
  await db.exec(
    `insert into organizations values('${id(1)}'),('${id(9)}'); insert into profiles values('${id(2)}');`
  )
  await db.exec(migration())
  await db.exec(migration())
  await db.exec(sql('2026-09-29_02_customer_offer_pricing'))
  await db.exec(sql('2026-09-29_02_customer_offer_pricing'))
  await db.exec(sql('2026-09-29_03_customer_offer_internal_costing'))
  await db.exec(sql('2026-09-29_03_customer_offer_internal_costing'))
  await db.exec(sql('2026-09-29_04_customer_offer_planning'))
  await db.exec(sql('2026-09-29_04_customer_offer_planning'))
  await db.exec(sql('2026-10-01_03_customer_payment_plan'))
  await db.exec(sql('2026-10-01_03_customer_payment_plan'))
  for (const name of ['2026-10-01_04_action_case_schedule', '2026-10-05_01_action_case_scope_notes', '2026-10-05_02_action_case_item_deletion', '2026-10-06_01_action_case_scope_conditions']) {
    await db.exec(sql(name)); await db.exec(sql(name))
  }
})
after(async () => {
  await db.close()
})

function completeContract() {
  const result = emptyContractDetails()
  result.advice.status = 'none'
  for (const entry of Object.values(result.fields)) {
    entry.status = 'document'
    entry.text = 'Referens till granskat projektavtal, punkt 1 (test).'
  }
  return editContractParticipants(result, { controlOfficer: 'Anna Test', customerInspector: 'Ingen utsedd' })
}

test('separate contract roles persist and freeze using the existing SQL contract schema', async () => {
  const f = await fixture()
  const details = completeContract()
  details.fields.controls = { status: 'unreviewed', text: '' }
  const completed = editContractParticipants(details, { controlOfficer: 'Anna Test', customerInspector: 'Bo Test' })
  const body = normalizeCustomerOffer({ ...f.draft, contractDetails: completed })
  await f.write('save', { revision: 1, body })
  const saved = (await db.query('select body from action_case_customer_offer_drafts where action_case_id=$1', [f.caseId])).rows[0].body
  assert.deepEqual(saved.contractDetails, completed)
  await f.write('publish', { ...f.publication, revision: 2, snapshot: { ...f.snapshot, ...body } })
  const frozen = await get('action_case_customer_offers', f.offerId)
  assert.deepEqual(frozen.snapshot.contractDetails.controlParticipants, completed.controlParticipants)
  const changed = editContractParticipants(completed, { customerInspector: 'En annan person' })
  await f.write('save', { revision: 2, body: normalizeCustomerOffer({ ...body, contractDetails: changed }) })
  assert.deepEqual((await get('action_case_customer_offers', f.offerId)).snapshot, frozen.snapshot)
  const incomplete = normalizeCustomerOffer({ ...body, contractDetails: editContractParticipants(completed, { customerInspector: '' }) })
  await assert.rejects(db.query('select assert_customer_contract($1,true)', [incomplete]), /INCOMPLETE/)
})

test('structured contract parties round-trip through existing draft storage and freeze with a contract version', async () => {
  const f = await fixture()
  const contractParties = { ...emptyContractParties('Anna Exempel', 'anna@example.test', '', { companyName: 'Exempelbygg AB' }),
    street: 'Testgatan 1', postalCode: '11122', city: 'Stockholm' }
  contractParties.customers[0].personalNumber = '19000101-0000'
  const body = normalizeCustomerOffer({ ...f.draft, contractParties, contractDetails: completeContract() })
  await f.write('save', { revision: 1, body })
  const saved = (await db.query('select body from action_case_customer_offer_drafts where action_case_id=$1', [f.caseId])).rows[0].body
  assert.deepEqual(saved.contractParties, contractParties)
  await f.write('publish', { ...f.publication, revision: 2, snapshot: { ...f.snapshot, ...body } })
  const frozen = await get('action_case_customer_offers', f.offerId)
  assert.deepEqual(frozen.snapshot.contractParties, contractParties)
  const changed = normalizeCustomerOffer({ ...body, contractParties: { ...contractParties, street: 'Ny adress' } })
  await f.write('save', { revision: 2, body: changed })
  assert.deepEqual((await get('action_case_customer_offers', f.offerId)).snapshot, frozen.snapshot)
  assert.equal(JSON.stringify(mapCustomerOffer(frozen)).includes('19000101'), false)
})

test('optional action notes survive normalized, versioned offers without inventing communicated advice', async () => {
  const f = await fixture()
  const notes = { scopeExclusions: 'Sprängning ingår inte.', scopeAdvice: 'Vi avråder från vald lösning.' }
  const body = normalizeCustomerOffer({ ...f.draft, contractDetails: completeContract(), items: f.draft.items.map((r, index) => index ? r : { ...r, ...notes }) })
  assert.equal(body.items[0].scopeAdvice, notes.scopeAdvice)
  assert.equal(body.contractDetails.advice.status, 'none')
  assert.match(offerPublishIssues(body).join(), /arbetsdel innehåller avrådan/)
  await assert.rejects(db.query('select assert_customer_offer_scope_notes($1,true)', [{ ...body, contractDetails: undefined }]), /INCOMPLETE/)
  for (const field of ['scopeExclusions', 'scopeAdvice']) for (const value of [null, 1, {}, 'x'.repeat(6001)]) {
    const invalid = { ...body, items: [{ ...body.items[0], [field]: value }] }
    assert.throws(() => normalizeCustomerOffer(invalid), /INVALID/)
    await assert.rejects(db.query('select assert_customer_offer_scope_notes($1,false)', [invalid]), /INVALID/)
  }
  await f.write('save', { revision: 1, body })
  await assert.rejects(f.write('save', { revision: 2, body: f.draft }), /INVALID/)
  await assert.rejects(f.write('publish', { ...f.publication, revision: 2, snapshot: { ...f.snapshot, ...body } }), /INCOMPLETE/)
  const cleared = { ...body, items: body.items.map((r) => r.scopeAdvice ? { ...r, scopeAdvice: '' } : r) }
  await f.write('save', { revision: 2, body: cleared })
  await f.write('publish', { ...f.publication, revision: 3, snapshot: { ...f.snapshot, ...cleared } })
  const frozen = await get('action_case_customer_offers', f.offerId)
  assert.equal(frozen.snapshot.items[0].scopeExclusions, notes.scopeExclusions)
  await f.write('save', { revision: 3, body })
  assert.deepEqual(await get('action_case_customer_offers', f.offerId), frozen)
  await f.respond('challenge', f.challenge)
  await f.respond('accept', { challengeId: f.challengeId, codeHash: 'good-hash' })
  const accepted = await get('action_case_customer_offers', f.offerId)
  assert.deepEqual(accepted.snapshot, frozen.snapshot)
  await assert.rejects(db.query("update action_case_customer_offers set snapshot=jsonb_set(snapshot,'{items,0,scopeExclusions}','\"changed\"') where id=$1", [f.offerId]), /IMMUTABLE/)
})

test('conditions are optional, validated, protected from old clients and frozen with the offer', async () => {
  const f = await fixture()
  assert.equal('scopeConditions' in normalizeCustomerOffer(f.draft).items[0], false)
  const body = normalizeCustomerOffer({ ...f.draft, items: f.draft.items.map((r, index) => index ? r : { ...r, scopeConditions: 'Fri tillgång till arbetsområdet.' }) })
  assert.equal(body.items[0].scopeConditions, 'Fri tillgång till arbetsområdet.')
  for (const value of [null, 3, {}, 'x'.repeat(6001)]) {
    const invalid = { ...body, items: [{ ...body.items[0], scopeConditions: value }] }
    assert.throws(() => normalizeCustomerOffer(invalid), /INVALID/)
    await assert.rejects(db.query('select assert_customer_offer_scope_conditions($1)', [invalid]), /INVALID/)
    await assert.rejects(f.write('save', { revision: 1, body: invalid }), /INVALID/)
  }
  await f.write('save', { revision: 1, body })
  await assert.rejects(f.write('save', { revision: 2, body: f.draft }), /INVALID/)
  await f.write('publish', { ...f.publication, revision: 2, snapshot: { ...f.snapshot, ...body } })
  const frozen = await get('action_case_customer_offers', f.offerId)
  assert.equal(frozen.snapshot.items[0].scopeConditions, body.items[0].scopeConditions)
  const cleared = { ...body, items: body.items.map((r, index) => index ? r : { ...r, scopeConditions: '' }) }
  await f.write('save', { revision: 2, body: cleared })
  await db.exec(sql('2026-10-06_01_action_case_scope_conditions'))
  assert.deepEqual(await get('action_case_customer_offers', f.offerId), frozen)
  await f.respond('challenge', f.challenge)
  await f.respond('accept', { challengeId: f.challengeId, codeHash: 'good-hash' })
  assert.deepEqual((await get('action_case_customer_offers', f.offerId)).snapshot, frozen.snapshot)
  await assert.rejects(db.query("update action_case_customer_offers set snapshot=jsonb_set(snapshot,'{items,0,scopeConditions}','\"changed\"') where id=$1", [f.offerId]), /IMMUTABLE/)
  const itemId = id(seq++)
  await db.query('insert into action_case_items(id,org_id,action_case_id,title) values($1,$2,$3,$4)', [itemId, id(1), f.caseId, 'Grund'])
  assert.equal((await get('action_case_items', itemId)).scope_conditions, '')
  await assert.rejects(db.query('update action_case_items set scope_conditions=$1 where id=$2', ['x'.repeat(6001), itemId]), /scope_conditions_length/)
  assert.equal((await db.query("select has_function_privilege('authenticated','assert_customer_offer_scope_conditions(jsonb)','execute') as allowed")).rows[0].allowed, false)
})

async function deletionFixture() {
  const f = await fixture(), itemId = id(seq++)
  await db.query('insert into action_case_items(id,org_id,action_case_id,title,status) values($1,$2,$3,$4,$5)', [itemId,id(1),f.caseId,'Raderbar åtgärd','pricing_needed'])
  const item = await get('action_case_items',itemId)
  return { ...f, itemId, item, remove: (org = id(1), expected = item.updated_at) => db.query('select delete_action_case_item($1,$2,$3,$4,$5)',[org,f.caseId,itemId,id(2),expected]) }
}
test('deletion is tenant/revision guarded, atomic, keeps files and preserves audit history', async () => {
  const f = await deletionFixture(), lineId = id(seq++)
  await db.query('insert into action_case_cost_lines(id,org_id,action_case_id,action_case_item_id,category,description,unit) values($1,$2,$3,$4,$5,$6,$7)',[lineId,id(1),f.caseId,f.itemId,'material','Testmaterial','st'])
  await db.query('insert into action_case_events(org_id,action_case_id,action_case_item_id,event_type) values($1,$2,$3,$4)',[id(1),f.caseId,f.itemId,'test_before_delete'])
  await db.query('update action_case_attachments set action_case_item_id=$1 where id=$2',[f.itemId,f.fileId])
  const current = await get('action_case_items',f.itemId)
  await assert.rejects(f.remove(id(9),current.updated_at), /NOT_FOUND/)
  await assert.rejects(f.remove(id(1),'2000-01-01'), /STALE/)
  await f.remove(id(1),current.updated_at)
  assert.equal(await get('action_case_items',f.itemId),undefined)
  assert.equal(await get('action_case_cost_lines',lineId),undefined)
  assert.equal((await get('action_case_attachments',f.fileId)).action_case_item_id,null)
  const events = (await db.query('select * from action_case_events where action_case_id=$1',[f.caseId])).rows
  assert.ok(events.some(e => e.event_type==='test_before_delete' && e.action_case_item_id===null))
  assert.ok(events.some(e => e.event_type==='item_deleted' && e.message.includes(f.itemId)))
  assert.equal((await get('action_cases',f.caseId)).status,'preparing')
  await assert.rejects(f.remove(), /NOT_FOUND/)
  for (const role of ['authenticated','anon']) assert.equal((await db.query(`select has_function_privilege('${role}','delete_action_case_item(uuid,uuid,uuid,uuid,timestamptz)','execute') allowed`)).rows[0].allowed,false)
})
test('deletion protects committed status, UE requests, draft/issued customer offers and shared schedules', async () => {
  const f = await deletionFixture()
  const approvedId = id(seq++)
  await db.query("insert into action_case_items(id,org_id,action_case_id,title,status,sort_order) values($1,$2,$3,'Approved','approved',200)",[approvedId,id(1),f.caseId])
  await assert.rejects(db.query('delete from action_case_items where id=$1',[approvedId]), /DELETE_LOCKED/)
  const requestId = id(seq++)
  await db.query('insert into action_case_quote_requests(id,org_id,action_case_id,supplier_name,supplier_email,subject,body,lines) values($1,$2,$3,$4,$5,$6,$7,$8)',[requestId,id(1),f.caseId,'UE','test@example.test','Test','Test',[{itemId:f.itemId}]])
  await assert.rejects(db.query('delete from action_case_items where id=$1',[f.itemId]), /DELETE_QUOTES/)
  await db.query('delete from action_case_quote_requests where id=$1',[requestId])
  const body = { ...f.draft, items: f.draft.items.map((r,index) => index ? r : {...r,id:f.itemId}) }
  await f.write('save',{revision:1,body})
  await assert.rejects(db.query('delete from action_case_items where id=$1',[f.itemId]), /DELETE_OFFER/)
  await f.write('publish',{...f.publication,revision:2,snapshot:{...f.snapshot,...body}})
  await f.write('save',{revision:2,body:f.draft})
  await assert.rejects(db.query('delete from action_case_items where id=$1',[f.itemId]), /DELETE_OFFER/)
  const g = await deletionFixture()
  await db.query('insert into action_case_schedules(action_case_id,org_id,updated_by,shared_rows) values($1,$2,$3,$4)',[g.caseId,id(1),id(2),[{sourceItemId:g.itemId}]])
  await assert.rejects(db.query('delete from action_case_items where id=$1',[g.itemId]), /DELETE_SCHEDULE/)
  assert.ok(await get('action_case_items',g.itemId))
})

const paymentPlan = (total = 10000000) => ({ version: 1, installments: [
  { id: id(99001), title: 'Grund', condition: 'Efter färdig grund.', plannedDate: '2027-04-30', amountOre: 2500050 },
  { id: id(99002), title: 'Slutdel', condition: 'Efter färdigställt avtalat arbete.', plannedDate: '', amountOre: total - 2500050 }
] })

test('payment plans normalize exact cents, stay opt-in and never manufacture invoice status', () => {
  assert.equal(normalizeCustomerOffer(emptyCustomerOffer()).paymentPlan, undefined)
  assert.equal(normalizePaymentPlan(null), null)
  const p = paymentPlan()
  assert.equal(paymentPlanTotal(p), 10000000)
  assert.deepEqual(paymentPlanIssues(p, 10000000), [])
  assert.deepEqual(normalizePaymentPlan({ ...p, internal: 'private', installments: p.installments.map((r) => ({ ...r, paid: true, invoiceId: 'secret' })) }), p)
  for (const patch of [{ amountOre: -1 }, { amountOre: 0.5 }, { amountOre: 100000000001 }, { amountOre: undefined }, { plannedDate: '2026-02-30' }, { condition: null }, { title: 'x'.repeat(251) }])
    assert.throws(() => normalizePaymentPlan({ ...p, installments: [{ ...p.installments[0], ...patch }] }), /INVALID/)
  assert.throws(() => normalizePaymentPlan({ ...p, installments: [p.installments[0], p.installments[0]] }), /INVALID/)
  assert.throws(() => normalizePaymentPlan({ ...p, installments: Array(61).fill(p.installments[0]) }), /INVALID/)
  assert.throws(() => normalizePaymentPlan({ ...p, version: 2 }), /INVALID/)
  assert.match(paymentPlanIssues(p, 10000001).join(), /summa/)
  assert.match(paymentPlanIssues(p, null).join(), /pris/)
  const incomplete = normalizePaymentPlan({ version: 1, installments: [{ ...p.installments[0], title: '', condition: '', amountOre: null }] })
  assert.equal(paymentPlanTotal(incomplete), 0)
  assert.equal(paymentPlanIssues(incomplete, 10000000).length, 3)
})

test('payment plan publication checklist reacts to base-price changes and empty installments', async () => {
  const f = await fixture()
  const d = { ...f.draft, items: f.draft.items.filter((r) => r.kind !== 'option'), paymentPlan: paymentPlan() }
  assert.deepEqual(offerPublishIssues(d), [])
  assert.match(offerPublishIssues({ ...d, baseAmountOre: 10000001 }).join(), /Betalningsplanens summa/)
  assert.match(offerPublishIssues({ ...d, paymentPlan: { version: 1, installments: [] } }).join(), /delbetalning/)
  const priced = { ...d, pricingMode: 'itemized', baseAmountOre: 10000000, items: d.items.map((r) => ({ ...r, amountOre: r.kind === 'included' ? 11000000 : null })) }
  assert.match(offerPublishIssues(priced).join(), /Betalningsplanens summa/)
})

test('payment SQL allows incomplete private drafts but rejects mismatched totals and malformed rows', async () => {
  const f = await fixture(), p = paymentPlan()
  const body = { ...f.draft, paymentPlan: p }
  await db.query('select assert_customer_payment_plan($1,true)', [body])
  for (const patch of [{ amountOre: -1 }, { amountOre: 1.5 }, { plannedDate: '2026-02-30' }, { amountOre: undefined }, { id: 'bad' }, { condition: null }])
    await assert.rejects(db.query('select assert_customer_payment_plan($1,false)', [{ ...body, paymentPlan: { ...p, installments: [{ ...p.installments[0], ...patch }] } }]), /INVALID/)
  for (const plan of [{ ...p, installments: [] }, { ...p, installments: [{ ...p.installments[0], amountOre: null }] }, paymentPlan(9999999)]) {
    await db.query('select assert_customer_payment_plan($1,false)', [{ ...body, paymentPlan: plan }])
    await assert.rejects(db.query('select assert_customer_payment_plan($1,true)', [{ ...body, paymentPlan: plan }]), /INCOMPLETE/)
  }
  await assert.rejects(db.query('select assert_customer_payment_plan($1,false)', [{ ...body, paymentPlan: { ...p, installments: [p.installments[0], p.installments[0]] } }]), /INVALID/)
  await assert.rejects(db.query('select assert_customer_payment_plan($1,true)', [{ ...body, pricingMode: 'itemized', items: [{ ...f.draft.items[0], amountOre: 10000001 }] }]), /INCOMPLETE/)
})

test('payment plans reuse revision and tenant guards, stay private until issued and freeze on acceptance', async () => {
  const f = await fixture(), p = paymentPlan()
  const body = { ...f.draft, paymentPlan: p }
  await f.write('save', { revision: 1, body })
  assert.equal(await get('action_case_customer_offers', f.offerId), undefined)
  await assert.rejects(f.write('save', { revision: 1, body }), /STALE/)
  await assert.rejects(f.write('save', { revision: 2, body }, id(9)), /NOT_FOUND/)
  await assert.rejects(f.write('save', { revision: 2, body: f.draft }), /INVALID/)
  await f.write('publish', { ...f.publication, revision: 2, snapshot: { ...f.snapshot, paymentPlan: p } })
  const issued = await get('action_case_customer_offers', f.offerId)
  await f.write('save', { revision: 2, body: { ...body, paymentPlan: paymentPlan(9900000) } })
  assert.deepEqual(await get('action_case_customer_offers', f.offerId), issued)
  const nextOfferId = id(seq++)
  await assert.rejects(f.write('publish', { ...f.publication, id: nextOfferId, revision: 3,
    files: [{ ...f.file, path: `${id(1)}/${f.caseId}/${nextOfferId}/${f.fileId}` }],
    snapshot: { ...f.snapshot, paymentPlan: paymentPlan(9900000) } }), /INCOMPLETE/)
  await f.respond('challenge', { ...f.challenge, selection: [] })
  await f.respond('accept', { challengeId: f.challengeId, codeHash: 'good-hash' })
  const accepted = await get('action_case_customer_offers', f.offerId)
  assert.deepEqual(mapCustomerOffer(accepted).snapshot.paymentPlan, p)
  await assert.rejects(f.write('save', { revision: 3, body }), /LOCKED|ACCEPTED/)
  await assert.rejects(db.query("update action_case_customer_offers set snapshot=jsonb_set(snapshot,'{paymentPlan}','null') where id=$1", [f.offerId]), /IMMUTABLE/)
})

test('explicit payment-plan removal preserves old publications and cannot be lost by older clients', async () => {
  const f = await fixture()
  await f.write('save', { revision: 1, body: { ...f.draft, paymentPlan: paymentPlan() } })
  await f.write('save', { revision: 2, body: { ...f.draft, paymentPlan: null } })
  await assert.rejects(f.write('save', { revision: 3, body: f.draft }), /INVALID/)
  await f.write('publish', { ...f.publication, revision: 3, snapshot: { ...f.snapshot, paymentPlan: null } })
  assert.equal((await get('action_case_customer_offers', f.offerId)).snapshot.paymentPlan, null)
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set role ${role}`)
    try { await assert.rejects(db.query('select assert_customer_payment_plan($1,false)', [f.draft]), /permission denied/) }
    finally { await db.exec('reset role') }
  }
})
function planningWrite(f, operation, data, org = id(1)) {
  return db.query('select write_customer_planning($1,$2,$3,$4,$5::jsonb)', [org, f.caseId, id(2), operation, JSON.stringify(data)])
}
const planningRead = async (f) => (await db.query('select * from action_case_customer_planning where action_case_id=$1', [f.caseId])).rows[0]
const planned = () => ({ id: id(seq++), title: 'Senare invändig målning', scope: 'Separat beslut efter huvudavtalet.', status: 'deferred', budgetOre: null, decisionBy: '' })

test('contract details never manufacture advice and preserve legacy snapshots', () => {
  assert.equal(emptyContractDetails().advice.status, 'unreviewed')
  assert.equal(normalizeCustomerOffer(emptyCustomerOffer()).contractDetails, undefined)
  assert.deepEqual(contractDetailsIssues(undefined), [])
  assert.equal(contractDetailsIssues(emptyContractDetails()).length, 14)
  const details = completeContract()
  assert.deepEqual(contractDetailsIssues(details), [])
  details.advice.work = 'Olämpligt arbete'
  assert.match(contractDetailsIssues(details).join(' '), /ingen avrådan/)
  details.advice.status = 'given'
  assert.match(contractDetailsIssues(details).join(' '), /Komplettera avrådan/)
  Object.assign(details.advice, { reason: 'Risk för skada', communicatedAt: '2026-09-29', customerResponse: 'Avstår från arbetet' })
  assert.deepEqual(contractDetailsIssues(details), [])
  assert.deepEqual(normalizeCustomerOffer({ ...emptyCustomerOffer(), contractDetails: details }).contractDetails, details)
  details.advice.communicatedAt = '2026-02-30'
  assert.throws(() => normalizeContractDetails(details), /INVALID/)
})

test('planned items cannot contain binding state, duplicate ids or hidden purchase prices', () => {
  const item = planned()
  assert.deepEqual(normalizePlannedItems([{ ...item, purchaseOre: 10, approved: true }]), [item])
  for (const value of [[{ ...item, status: 'accepted' }], [item, item], [{ ...item, budgetOre: -1 }], [{ ...item, budgetOre: 1.1 }], [{ ...item, decisionBy: '2026-02-30' }]])
    assert.throws(() => normalizePlannedItems(value), /INVALID/)
  assert.doesNotThrow(() => normalizePlannedItems([{ ...item, title: '', scope: '' }]))
  assert.throws(() => normalizePlannedItems([{ ...item, title: '' }], true), /INCOMPLETE|INVALID/)
})

test('contract SQL permits draft work but blocks incomplete publication and loss from older clients', async () => {
  const f = await fixture(), details = emptyContractDetails()
  await f.write('save', { revision: 1, body: { ...f.draft, contractDetails: details } })
  await assert.rejects(f.write('save', { revision: 2, body: f.draft }), /INVALID/)
  await assert.rejects(f.write('publish', { ...f.publication, revision: 2, snapshot: { ...f.snapshot, contractDetails: details } }), /INCOMPLETE/)
  const completed = completeContract()
  await f.write('save', { revision: 2, body: { ...f.draft, contractDetails: completed } })
  await f.write('publish', { ...f.publication, revision: 3, snapshot: { ...f.snapshot, contractDetails: completed } })
  assert.deepEqual((await get('action_case_customer_offers', f.offerId)).snapshot.contractDetails, completed)
})

test('SQL contract validator rejects contradictory advice and invalid dates', async () => {
  const details = completeContract()
  details.advice.reason = 'En kvarvarande avrådan'
  await assert.rejects(db.query('select assert_customer_contract($1,true)', [{ contractDetails: details }]), /INCOMPLETE/)
  details.advice.status = 'given'
  await assert.rejects(db.query('select assert_customer_contract($1,true)', [{ contractDetails: details }]), /INCOMPLETE/)
  details.advice.communicatedAt = '2026-02-30'
  await assert.rejects(db.query('select assert_customer_contract($1,false)', [{ contractDetails: details }]), /INVALID/)
})

test('planning saves privately; sharing needs a confirmed exact revision and supports withdrawal', async () => {
  const f = await fixture(), items = [planned()]
  await planningWrite(f, 'save', { revision: 0, items })
  assert.deepEqual((await planningRead(f)).shared_items, [])
  await assert.rejects(planningWrite(f, 'share', { revision: 1, items }), /CONFIRM/)
  await assert.rejects(planningWrite(f, 'save', { revision: 0, items }), /STALE/)
  await assert.rejects(planningWrite(f, 'save', { revision: 1, items }, id(9)), /NOT_FOUND/)
  await assert.rejects(planningWrite(f, 'share', { revision: 1, items: [], confirmed: true }), /CONFIRM/)
  await planningWrite(f, 'share', { revision: 1, items, confirmed: true })
  assert.deepEqual((await planningRead(f)).shared_items, items)
  assert.equal((await planningRead(f)).participant_id, f.recipientId)
  const changed = [{ ...items[0], scope: 'Intern ändring, ännu inte delad.' }]
  await planningWrite(f, 'save', { revision: 2, items: changed })
  assert.deepEqual((await planningRead(f)).shared_items, items)
  await planningWrite(f, 'unshare', { revision: 3 })
  assert.deepEqual((await planningRead(f)).shared_items, [])
  assert.deepEqual((await planningRead(f)).items, changed)
})

test('planning can change after acceptance without changing the contract, sum or selection', async () => {
  const f = await fixture(), items = [{ ...planned(), budgetOre: 99900000 }]
  await planningWrite(f, 'save', { revision: 0, items })
  await f.write('publish', f.publication)
  await assert.rejects(f.respond('challenge', { ...f.challenge, selection: [items[0].id] }), /SELECTION|INVALID/)
  await f.respond('challenge', f.challenge)
  await f.respond('accept', { challengeId: f.challengeId, codeHash: 'good-hash' })
  const original = await get('action_case_customer_offers', f.offerId)
  await planningWrite(f, 'save', { revision: 1, items: [{ ...items[0], budgetOre: 12000000 }] })
  await planningWrite(f, 'share', { revision: 2, items: [{ ...items[0], budgetOre: 12000000 }], confirmed: true })
  assert.deepEqual(await get('action_case_customer_offers', f.offerId), original)
  assert.equal(Number(original.accepted_total_ore), customerOfferTotal(f.draft, f.challenge.selection))
})

test('anonymous and authenticated clients cannot directly read or write planning', async () => {
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set role ${role}`)
    try {
      await assert.rejects(db.query('select * from action_case_customer_planning'), /permission denied/)
      await assert.rejects(db.query('select write_customer_planning($1,$2,$3,$4,$5)', [id(1), id(2), id(2), 'save', {}]), /permission denied/)
    } finally { await db.exec('reset role') }
  }
})

async function fixture() {
  const n = seq
  seq += 20
  const caseId = id(n),
    recipientId = id(n + 1),
    offerId = id(n + 2),
    fileId = id(n + 3),
    challengeId = id(n + 4)
  const tokenHash = `hash-${n}`
  await db.query(
    "insert into action_cases(id,org_id,title,customer_name,property_address) values($1,$2,'Project','Customer','Address')",
    [caseId, id(1)]
  )
  await db.query(
    "insert into action_case_participants(id,org_id,action_case_id,role,name,email) values($1,$2,$3,'customer','Customer','customer@example.test')",
    [recipientId, id(1), caseId]
  )
  await db.query(
    "insert into action_case_attachments(id,org_id,action_case_id,attachment_type,file_name,content_type,file_size_bytes,file_path) values($1,$2,$3,'document','Terms.pdf','application/pdf',1234,$4)",
    [fileId, id(1), caseId, `${id(1)}/${caseId}/original`]
  )
  const draft = normalizeCustomerOffer({
    ...emptyCustomerOffer('Extension'),
    baseAmountOre: 10000000,
    validUntil: '2099-12-31',
    terms: 'Reviewed terms',
    paymentTerms: 'As agreed',
    schedule: 'Start by agreement',
    attachmentIds: [fileId],
    termsAttachmentId: fileId,
    items: [
      {
        id: id(n + 5),
        title: 'Base work',
        scope: 'Weather-tight extension',
        kind: 'included',
        amountOre: null
      },
      {
        id: id(n + 6),
        title: 'Paint',
        scope: 'Painting inside',
        kind: 'option',
        amountOre: 1500050
      },
      {
        id: id(n + 7),
        title: 'Kitchen',
        scope: 'Customer arranges separately',
        kind: 'excluded',
        amountOre: null
      }
    ]
  })
  const snapshot = {
    ...draft,
    projectTitle: 'Project',
    propertyAddress: 'Address',
    customerName: 'Customer',
    customerEmail: 'customer@example.test',
    issuerName: 'Builder',
    replyEmail: 'builder@example.test'
  }
  const file = {
    id: fileId,
    fileName: 'Terms.pdf',
    contentType: 'application/pdf',
    fileSizeBytes: 1234,
    sourcePath: `${id(1)}/${caseId}/original`,
    path: `${id(1)}/${caseId}/${offerId}/${fileId}`
  }
  const publication = {
    id: offerId,
    revision: 1,
    participantId: recipientId,
    email: 'customer@example.test',
    issuerName: 'Builder',
    replyEmail: 'builder@example.test',
    snapshot,
    files: [file],
    confirmed: true,
    tokenHash,
    emailPayload: {
      to: 'customer@example.test',
      text: 'Link to this offer',
      idempotencyKey: offerId
    }
  }
  const write = async (op, data, org = id(1)) =>
    (
      await db.query(
        'select write_customer_offer($1,$2,$3,$4,$5::jsonb) result',
        [org, caseId, id(2), op, JSON.stringify(data)]
      )
    ).rows[0].result
  const respond = async (op, data, token = tokenHash, offer = offerId) =>
    (
      await db.query(
        'select respond_customer_offer($1,$2,$3,$4::jsonb) result',
        [token, offer, op, JSON.stringify(data)]
      )
    ).rows[0].result
  const challenge = {
    challengeId,
    codeHash: 'good-hash',
    selection: [id(n + 6)],
    signerName: 'Customer Name',
    confirmed: true
  }
  await write('save', { revision: 0, body: draft })
  return {
    caseId,
    recipientId,
    offerId,
    fileId,
    challengeId,
    draft,
    snapshot,
    file,
    publication,
    tokenHash,
    write,
    respond,
    challenge
  }
}

function itemized(draft) {
  return normalizeCustomerOffer({
    ...draft,
    pricingMode: 'itemized',
    baseAmountOre: 1,
    items: [
      { id: id(21), title: 'Grund', scope: 'Grundarbete', kind: 'included', amountOre: 1230050 },
      { id: id(22), title: 'Stomme', scope: 'Stomarbete', kind: 'included', amountOre: 4500000 },
      { id: id(23), title: 'Fönster A', scope: 'Leverantör A', kind: 'option', amountOre: 1000000, optionGroup: 'Fönster' },
      { id: id(24), title: 'Fönster B', scope: 'Leverantör B', kind: 'option', amountOre: 2000000, optionGroup: 'Fönster' },
      { id: id(25), title: 'Altan', scope: 'Tillval', kind: 'option', amountOre: 500000 },
      { id: id(26), title: 'El', scope: 'Projekteras senare. Ingår inte.', kind: 'excluded', amountOre: null }
    ]
  })
}

test('private costing transaction retains revision/organization/acceptance guards and immutable public snapshots', async () => {
  const f = await fixture()
  const costing = { [f.draft.items[1].id]: { purchaseOre: 123456, fixedMarkupOre: 10000, markupBasisPoints: 1000, additions: [] } }
  const save = (revision, privateData = costing, org = id(1)) => db.query(
    'select save_customer_offer_costing($1,$2,$3,$4::jsonb)',
    [org, f.caseId, id(2), JSON.stringify({ revision, body: f.draft, costing: privateData })]
  )
  const stored = async () => (await db.query('select * from action_case_customer_offer_drafts where action_case_id=$1', [f.caseId])).rows[0]
  await save(1)
  const saved = await stored()
  assert.equal(saved.revision, 2)
  assert.deepEqual(saved.internal_costing, costing)
  assert.deepEqual(saved.body, f.draft)
  await assert.rejects(save(1), /STALE/)
  await assert.rejects(save(2, costing, id(9)), /NOT_FOUND/)
  await assert.rejects(save(2, []), /INVALID/)
  assert.deepEqual(await stored(), saved)
  await f.write('publish', { ...f.publication, revision: 2 })
  assert.deepEqual((await get('action_case_customer_offers', f.offerId)).snapshot, f.snapshot)
  await f.respond('challenge', f.challenge)
  await f.respond('accept', { challengeId: f.challengeId, codeHash: 'good-hash' })
  await assert.rejects(save(2), /ACCEPTED/)
  for (const role of ['anon', 'authenticated']) {
    const privilege = (await db.query(`select has_function_privilege('${role}', 'save_customer_offer_costing(uuid,uuid,uuid,jsonb)', 'execute') allowed`)).rows[0]
    assert.equal(privilege.allowed, false)
    const read = (await db.query(`select has_column_privilege('${role}', 'action_case_customer_offer_drafts', 'internal_costing', 'select') allowed`)).rows[0]
    assert.equal(read.allowed, false)
  }
})

test('itemized prices derive the base total; missing is not zero; legacy drafts retain their exact shape', () => {
  const legacy = emptyCustomerOffer('Test')
  assert.deepEqual(normalizeCustomerOffer(legacy), legacy)
  const draft = itemized(legacy)
  assert.equal(draft.baseAmountOre, 5730050)
  assert.equal(customerOfferTotal(draft, [id(23), id(25)]), 7230050)
  draft.items[0].amountOre = null
  assert.equal(customerOfferBaseAmount(draft), null)
  assert.equal(normalizeCustomerOffer(draft).baseAmountOre, null)
  assert.ok(offerPublishIssues(draft).includes('Ange delpris för Grund.'))
  assert.throws(() => customerOfferTotal(draft, []))
  draft.items[0].amountOre = 0
  assert.equal(customerOfferBaseAmount(draft), 4500000)
  assert.equal(normalizeCustomerOffer({ ...draft, pricingMode: 'total', baseAmountOre: 9900 }).baseAmountOre, 9900)
  assert.equal(normalizeCustomerOffer({ ...draft, pricingMode: 'total', baseAmountOre: 9900 }).items[1].amountOre, 4500000)
  for (const invalid of [-1, 0.5, 100000000001, '100']) {
    assert.throws(() => normalizeCustomerOffer({ ...draft, items: [{ ...draft.items[0], amountOre: invalid }] }))
  }
  assert.throws(() => normalizeCustomerOffer({ ...draft, pricingMode: 'estimate' }))
})

test('alternative groups replace only their own selection and reject combinations from the same group', () => {
  const draft = itemized(emptyCustomerOffer())
  assert.deepEqual(selectCustomerOfferOption(draft, [id(23), id(25)], id(24)), [id(25), id(24)])
  assert.deepEqual(selectCustomerOfferOption(draft, [id(24)], id(25)), [id(24), id(25)])
  assert.throws(() => customerOfferTotal(draft, [id(23), id(24)]), /INVALID/)
  assert.equal(customerOfferTotal(draft, []), 5730050)
  assert.equal(normalizeCustomerOffer({ ...draft, items: [{ ...draft.items[2], optionGroup: '  Fönster  ' }] }).items[0].optionGroup, 'Fönster')
  assert.ok(offerPublishIssues({ ...draft, items: draft.items.filter((i) => i.id !== id(24)) }).some((i) => i.includes('minst två alternativ')))
})

test('database checks itemized totals and freezes one alternative plus independent options through acceptance', async () => {
  const f = await fixture()
  const draft = itemized(f.draft)
  await assert.rejects(f.write('save', { revision: 1, body: { ...draft, baseAmountOre: 1 } }), /INVALID/)
  await f.write('save', { revision: 1, body: draft })
  const publication = { ...f.publication, revision: 2, snapshot: { ...f.snapshot, ...draft } }
  await f.write('publish', publication)
  await assert.rejects(f.respond('challenge', { ...f.challenge, selection: [id(23), id(24)] }), /INVALID/)
  await f.respond('challenge', { ...f.challenge, selection: [id(24), id(25)] })
  await f.respond('accept', { challengeId: f.challengeId, codeHash: 'good-hash', selection: [id(23)], total: 1 })
  const accepted = await get('action_case_customer_offers', f.offerId)
  assert.equal(Number(accepted.accepted_total_ore), 8230050)
  assert.deepEqual(accepted.accepted_option_ids, [id(24), id(25)])
  await db.exec(sql('2026-09-29_02_customer_offer_pricing'))
  assert.deepEqual(await get('action_case_customer_offers', f.offerId), accepted)
})

test('incomplete itemized drafts can be saved but not published; acceptance cannot carry a tampered total', async () => {
  const f = await fixture()
  const draft = itemized(f.draft)
  draft.items[0].amountOre = null
  draft.baseAmountOre = null
  await f.write('save', { revision: 1, body: draft })
  await assert.rejects(f.write('publish', { ...f.publication, revision: 2, snapshot: { ...f.snapshot, ...draft } }), /INVALID|INCOMPLETE/)
  const g = await fixture()
  await g.write('publish', g.publication)
  await assert.rejects(db.query("update action_case_customer_offers set status='accepted', accepted_total_ore=1 where id=$1", [g.offerId]), /INVALID/)
  const acl = (await db.query("select has_function_privilege('anon', 'assert_customer_offer_pricing(jsonb,jsonb,boolean)', 'execute') allowed")).rows[0]
  assert.equal(acl.allowed, false)
})

test('money, template normalization, publication readiness and selected option totals', () => {
  for (const [value, expected] of [
    ['10 000,50', 1000050],
    ['0', 0],
    ['', null],
    ['0.29', 29]
  ])
    assert.equal(parseKronor(value), expected)
  for (const value of ['NaN', '-1', '1,234', 'Infinity', '1e4', '1000000001'])
    assert.throws(() => parseKronor(value))
  assert.ok(offerPublishIssues(emptyCustomerOffer(), '2026-09-29').length >= 5)
  const base = {
    ...emptyCustomerOffer('Title'),
    baseAmountOre: 500,
    items: [
      {
        id: id(10),
        title: 'Option',
        scope: 'Scope',
        kind: 'option',
        amountOre: 125
      }
    ]
  }
  assert.equal(customerOfferTotal(base, [id(10)]), 625)
  for (const selection of [[id(10), id(10)], [id(11)]])
    assert.throws(() => customerOfferTotal(base, selection))
  assert.throws(() =>
    normalizeCustomerOffer({ ...base, items: [...base.items, ...base.items] })
  )
  assert.throws(() =>
    normalizeCustomerOffer({ ...base, validUntil: '2026-02-30' })
  )
  assert.throws(() =>
    normalizeCustomerOffer({ ...base, termsAttachmentId: id(99) })
  )
  assert.equal(
    normalizeCustomerOffer({ ...base, internalPrice: 200 }).internalPrice,
    undefined
  )
})

test('publication checklist treats whitespace as missing and identifies each required field', () => {
  const draft = {
    ...emptyCustomerOffer('Offert'),
    baseAmountOre: 0,
    validUntil: '2099-12-31',
    contractForm: 'custom',
    terms: 'Villkor',
    paymentTerms: 'Betalningsplan',
    schedule: 'Tidplan',
    items: [
      {
        id: id(10),
        title: 'Arbete',
        scope: 'Omfattning',
        kind: 'included',
        amountOre: null
      }
    ]
  }
  assert.deepEqual(offerPublishIssues(draft, '2026-09-29'), [])
  for (const [field, message] of [
    ['title', 'Ange en offertrubrik.'],
    ['terms', 'Komplettera villkor och hänvisning till avtalshandling.'],
    ['paymentTerms', 'Ange betalningsvillkor.'],
    ['schedule', 'Ange tider och förutsättningar.']
  ]) {
    const incomplete = { ...draft, [field]: ' \n\t ' }
    assert.deepEqual(offerPublishIssues(incomplete, '2026-09-29'), [message])
    assert.deepEqual(
      offerPublishIssues(incomplete, '2026-09-29'),
      offerPublishIssues(normalizeCustomerOffer(incomplete), '2026-09-29')
    )
  }
  for (const field of ['title', 'scope']) {
    assert.deepEqual(
      offerPublishIssues(
        {
          ...draft,
          items: [{ ...draft.items[0], [field]: '   ' }]
        },
        '2026-09-29'
      ),
      ['Beskriv omfattningen för varje arbete.']
    )
  }
})

test('migration is rerunnable; drafts use revisions and tenant boundaries; publication is frozen and idempotent', async () => {
  const f = await fixture()
  await assert.rejects(f.write('save', { revision: 0, body: f.draft }), /STALE/)
  await assert.rejects(
    f.write('save', { revision: 1, body: f.draft }, id(9)),
    /NOT_FOUND/
  )
  assert.deepEqual(await f.write('publish', f.publication), { id: f.offerId })
  assert.deepEqual(await f.write('publish', f.publication), { id: f.offerId })
  const row = await get('action_case_customer_offers', f.offerId)
  assert.equal(row.version, 1)
  assert.deepEqual(row.snapshot, f.snapshot)
  for (const statement of ["snapshot='{}'", "files='[]'", "email_payload='{}'"])
    await assert.rejects(
      db.query(
        `update action_case_customer_offers set ${statement} where id=$1`,
        [f.offerId]
      ),
      /IMMUTABLE/
    )
  const dto = mapCustomerOffer(row)
  for (const key of [
    'org_id',
    'email_payload',
    'tokenHash',
    'path',
    'sourcePath'
  ])
    assert.ok(!JSON.stringify(dto).includes(`"${key}"`), key)
  await db.query('delete from action_case_attachments where id=$1', [f.fileId])
  assert.equal(
    (await get('action_case_customer_offers', f.offerId)).files.length,
    1
  )
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from action_case_events where action_case_id=$1 and event_type='customer_offer_published'",
        [f.caseId]
      )
    ).rows[0].n,
    1
  )
  const acl = (
    await db.query(
      "select has_table_privilege('authenticated','action_case_customer_offers','select') allowed,has_function_privilege('anon','respond_customer_offer(text,uuid,text,jsonb)','execute') executable"
    )
  ).rows[0]
  assert.equal(acl.allowed, false)
  assert.equal(acl.executable, false)
})

test('tampered recipient, snapshot, files and stale revision cannot publish', async () => {
  const f = await fixture()
  for (const patch of [
    { revision: 2 },
    { email: 'another@example.test' },
    { participantId: id(99) },
    { snapshot: { ...f.snapshot, baseAmountOre: 1 } },
    { files: [] },
    { files: [{ ...f.file, path: 'other/path' }] },
    { files: [{ ...f.file, sourcePath: 'changed' }] },
    { emailPayload: { to: 'other@example.test' } }
  ])
    await assert.rejects(f.write('publish', { ...f.publication, ...patch }))
  assert.equal(await get('action_case_customer_offers', f.offerId), undefined)
  // Supplier-response documents must not become customer offer attachments.
  await db.query(
    "insert into action_case_quote_requests(id,org_id,action_case_id,supplier_name,supplier_email,subject,body,lines,response_document_id) values($1,$2,$3,'UE','ue@example.test','Subject','Body','[{}]',$4)",
    [id(seq++), id(1), f.caseId, f.fileId]
  )
  await assert.rejects(f.write('publish', f.publication), /FILES/)
})

test('email leases prevent double sends and keep retries identical', async () => {
  const f = await fixture()
  await f.write('publish', f.publication)
  const claim = await f.write('claim_send', { id: f.offerId })
  assert.deepEqual(claim.payload, f.publication.emailPayload)
  await assert.rejects(f.write('claim_send', { id: f.offerId }), /BUSY/)
  await assert.rejects(
    f.write('finish_send', { id: f.offerId, leaseId: id(999), success: true }),
    /STALE/
  )
  await f.write('finish_send', {
    id: f.offerId,
    leaseId: claim.leaseId,
    success: false
  })
  const retry = await f.write('claim_send', { id: f.offerId })
  assert.deepEqual(retry.payload, claim.payload)
  await f.write('finish_send', {
    id: f.offerId,
    leaseId: retry.leaseId,
    success: true,
    providerMessageId: 'mail-1'
  })
  assert.deepEqual(await f.write('claim_send', { id: f.offerId }), {
    sent: true
  })
  const g = await fixture()
  await g.write('publish', g.publication)
  await db.query(
    "update action_case_customer_offers set first_attempt_at=now()-interval '25 hours' where id=$1",
    [g.offerId]
  )
  await assert.rejects(g.write('claim_send', { id: g.offerId }), /SEND_UNKNOWN/)
})

test('email-code acceptance binds server-held selection and name; wrong attempts persist, acceptance is idempotent and immutable', async () => {
  const f = await fixture()
  await f.write('publish', f.publication)
  await assert.rejects(
    f.respond('challenge', {
      ...f.challenge,
      selection: [f.draft.items[0].id]
    }),
    /INVALID/
  )
  await f.respond('challenge', f.challenge)
  await assert.rejects(
    f.respond('challenge', { ...f.challenge, challengeId: id(999) }),
    /RATE_LIMIT/
  )
  assert.deepEqual(
    await f.respond('accept', { challengeId: f.challengeId, codeHash: 'bad' }),
    { error: 'CUSTOMER_OFFER_CODE_INVALID' }
  )
  assert.equal(
    (await get('action_case_customer_offer_challenges', f.challengeId))
      .attempts,
    1
  )
  const answer = {
    challengeId: f.challengeId,
    codeHash: 'good-hash',
    selection: [],
    signerName: 'Tampered',
    total: 1
  }
  assert.deepEqual(await f.respond('accept', answer), { accepted: true })
  assert.deepEqual(await f.respond('accept', answer), { accepted: true })
  const row = await get('action_case_customer_offers', f.offerId)
  assert.equal(row.accepted_by, 'Customer Name')
  assert.equal(Number(row.accepted_total_ore), 11500050)
  assert.deepEqual(row.accepted_option_ids, f.challenge.selection)
  assert.ok(row.accepted_at)
  await assert.rejects(
    f.write('save', { revision: 1, body: f.draft }),
    /ACCEPTED/
  )
  await assert.rejects(f.write('withdraw', { id: f.offerId }), /IMMUTABLE/)
  await assert.rejects(
    db.query(
      "update action_case_customer_offers set status='published' where id=$1",
      [f.offerId]
    ),
    /IMMUTABLE/
  )
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from action_case_events where action_case_id=$1 and event_type='customer_offer_accepted'",
        [f.caseId]
      )
    ).rows[0].n,
    1
  )
})

test('five incorrect codes exhaust challenge, expired and revoked access cannot act, foreign and UE links cannot act', async () => {
  const f = await fixture()
  await f.write('publish', f.publication)
  await f.respond('challenge', f.challenge)
  for (let i = 0; i < 5; i++)
    assert.equal(
      (
        await f.respond('accept', {
          challengeId: f.challengeId,
          codeHash: 'bad'
        })
      ).error,
      'CUSTOMER_OFFER_CODE_INVALID'
    )
  assert.equal(
    (
      await f.respond('accept', {
        challengeId: f.challengeId,
        codeHash: 'good-hash'
      })
    ).error,
    'CUSTOMER_OFFER_CODE_EXPIRED'
  )
  const g = await fixture()
  await g.write('publish', g.publication)
  await assert.rejects(
    f.respond('challenge', f.challenge, g.tokenHash),
    /NOT_FOUND/
  )
  await db.query(
    "update action_case_participants set role='subcontractor' where id=$1",
    [g.recipientId]
  )
  await assert.rejects(g.respond('challenge', g.challenge), /RECIPIENT/)
  await db.query(
    'update action_case_access_links set revoked_at=now() where token_hash=$1',
    [f.tokenHash]
  )
  await assert.rejects(f.respond('challenge', f.challenge), /CLOSED/)
  await db.query(
    "update action_case_access_links set revoked_at=null,expires_at=now()-interval '1 second' where token_hash=$1",
    [f.tokenHash]
  )
  await assert.rejects(f.respond('challenge', f.challenge), /CLOSED/)
})

test('new revision supersedes old version; old links can read history but cannot approve replaced/withdrawn offers', async () => {
  const f = await fixture()
  await f.write('publish', f.publication)
  await f.respond('challenge', f.challenge)
  const draft = { ...f.draft, baseAmountOre: 20000000 }
  await f.write('save', { revision: 1, body: draft })
  const nextId = id(seq++),
    next = {
      ...f.publication,
      id: nextId,
      revision: 2,
      snapshot: { ...f.snapshot, baseAmountOre: draft.baseAmountOre },
      tokenHash: 'new-' + f.tokenHash,
      files: [{ ...f.file, path: `${id(1)}/${f.caseId}/${nextId}/${f.fileId}` }]
    }
  await f.write('publish', next)
  assert.equal(
    (await get('action_case_customer_offers', f.offerId)).status,
    'superseded'
  )
  assert.equal((await get('action_case_customer_offers', nextId)).version, 2)
  await assert.rejects(
    f.respond('accept', { challengeId: f.challengeId, codeHash: 'good-hash' }),
    /CLOSED/
  )
  await f.respond(
    'challenge',
    { ...f.challenge, challengeId: id(seq++) },
    f.tokenHash,
    nextId
  )
  await f.write('withdraw', { id: nextId })
  await assert.rejects(
    f.respond('challenge', f.challenge, f.tokenHash, nextId),
    /CLOSED/
  )
})

test('separate choices migration preserves history and protects new base agreements', async (t) => {
  // Issue a legacy version before installing the new publication guard.
  const legacy = await fixture()
  await legacy.write('publish', legacy.publication)
  const original = await get('action_case_customer_offers', legacy.offerId)
  await db.exec(sql('2026-10-01_02_customer_contract_choices'))
  await db.exec(sql('2026-10-01_02_customer_contract_choices'))
  assert.deepEqual(await get('action_case_customer_offers', legacy.offerId), original)
  const stored = async (f) => (await db.query('select * from action_case_customer_offer_drafts where action_case_id=$1', [f.caseId])).rows[0]
  const split = (f, revision, planningRevision, org = id(1)) => db.query(
    'select separate_customer_choices($1,$2,$3,$4,$5)', [org, f.caseId, id(2), revision, planningRevision])

  await t.test('old issued version still accepts its original choices but cannot be silently split', async () => {
    await assert.rejects(split(legacy, 1, 0), /WITHDRAW_FIRST/)
    await legacy.respond('challenge', legacy.challenge)
    await legacy.respond('accept', { challengeId: legacy.challengeId, codeHash: 'good-hash' })
    const accepted = await get('action_case_customer_offers', legacy.offerId)
    assert.deepEqual(accepted.snapshot, original.snapshot)
    assert.deepEqual(accepted.accepted_option_ids, legacy.challenge.selection)
    await assert.rejects(split(legacy, 1, 0), /WITHDRAW_FIRST/)
  })
  await t.test('atomic split retains order, groups, precise amounts, private costs and shared planning', async () => {
    const f = await fixture(), body = itemized(f.draft), existing = [planned()]
    const costing = { [id(23)]: { purchaseOre: 987654, markupBasisPoints: 1000, fixedMarkupOre: null, additions: [] },
      [id(21)]: { purchaseOre: 600000, markupBasisPoints: null, fixedMarkupOre: null, additions: [] } }
    await db.query('select save_customer_offer_costing($1,$2,$3,$4)', [id(1), f.caseId, id(2), { revision: 1, body, costing }])
    await planningWrite(f, 'save', { revision: 0, items: existing })
    await planningWrite(f, 'share', { revision: 1, items: existing, confirmed: true })
    const before = await stored(f)
    await assert.rejects(split(f, 1, 2), /STALE/)
    await assert.rejects(split(f, 2, 1), /STALE/)
    await assert.rejects(split(f, 2, 2, id(9)), /NOT_FOUND/)
    assert.deepEqual(await stored(f), before)
    await split(f, 2, 2)
    const d = await stored(f), p = await planningRead(f)
    assert.equal(d.body.baseAmountOre, body.baseAmountOre)
    assert.deepEqual(d.body.items, body.items.filter((i) => i.kind !== 'option'))
    assert.equal(d.revision, 3)
    assert.deepEqual(p.shared_items, existing)
    assert.equal(p.revision, 3)
    const choices = p.items.slice(existing.length)
    assert.deepEqual(choices.map((i) => i.id), [id(23), id(24), id(25)])
    assert.equal(choices[0].optionGroup, 'Fönster')
    assert.equal(choices[0].budgetOre, 1000000)
    assert.deepEqual(p.internal_costing, { [id(23)]: costing[id(23)] })
    assert.deepEqual(d.internal_costing, { [id(21)]: costing[id(21)] })
    assert.equal(JSON.stringify(p.items).includes('987654'), false)
    await split(f, 3, 3)
    assert.deepEqual(await stored(f), d)
    assert.deepEqual(await planningRead(f), p)
    await f.write('publish', { ...f.publication, revision: 3, snapshot: { ...f.snapshot, ...d.body } })
    await assert.rejects(f.respond('challenge', { ...f.challenge, selection: [id(23)] }), /INVALID|SELECTION/)
    await f.respond('challenge', { ...f.challenge, selection: [] })
    await f.respond('accept', { challengeId: f.challengeId, codeHash: 'good-hash' })
    const accepted = await get('action_case_customer_offers', f.offerId)
    assert.equal(Number(accepted.accepted_total_ore), body.baseAmountOre)
    assert.deepEqual(accepted.accepted_option_ids, [])
    await planningWrite(f, 'save', { revision: 3, items: [{ ...choices[0], budgetOre: 1234567 }] })
    assert.deepEqual(await get('action_case_customer_offers', f.offerId), accepted)
  })
  await t.test('new publication cannot contain optional choices, even through an older client', async () => {
    const f = await fixture()
    await assert.rejects(f.write('publish', f.publication), /SEPARATE_CHOICES/)
    assert.equal(await get('action_case_customer_offers', f.offerId), undefined)
  })
  await t.test('failed planning write rolls back the entire move', async () => {
    const f = await fixture(), items = Array.from({ length: 200 }, planned)
    await planningWrite(f, 'save', { revision: 0, items })
    const before = await stored(f)
    await assert.rejects(split(f, 1, 1), /INVALID/)
    assert.deepEqual(await stored(f), before)
    assert.deepEqual((await planningRead(f)).items, items)
    assert.equal((await planningRead(f)).revision, 1)
  })
  await t.test('duplicate choice identity cannot overwrite an existing planned item', async () => {
    const f = await fixture(), item = { ...planned(), id: f.draft.items[1].id }
    await planningWrite(f, 'save', { revision: 0, items: [item] })
    await assert.rejects(split(f, 1, 1), /STALE/)
    assert.equal((await stored(f)).revision, 1)
  })
  await t.test('new private writers remain inaccessible to browser roles', async () => {
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`)
      try {
        await assert.rejects(split(legacy, 1, 0), /permission denied/)
        await assert.rejects(db.query('select save_customer_planning_costing($1,$2,$3,$4)', [id(1), legacy.caseId, id(2), {}]), /permission denied/)
      } finally { await db.exec('reset role') }
    }
  })
})
