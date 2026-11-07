import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID as id } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
const db = new PGlite(), org = id(), other = id(), actor = id(), stranger = id(), project = id(), foreign = id(), item = id(), change = id()
const sql = name => readFileSync(new URL(`../docs/db/${name}.sql`, import.meta.url), 'utf8')
const migration = sql('2026-11-07_02_project_supplier_invoices')
const invoice = (patch = {}) => ({ supplierName: 'Fiktiv Leverantör AB', supplierOrgNumber: '', invoiceNumber: id(), invoiceDate: '2026-11-07', dueDate: '', documentKind: 'invoice', creditReferenceInvoiceId: null, currency: 'SEK', netAmountOre: 100000, vatAmountOre: 25000, approvalStatus: 'registered', paymentStatus: 'unpaid', paidOn: null, notes: '', sourceText: '', allocations: [{ id: id(), caseId: project, itemId: item, changeId: null, category: 'material', description: '', amountOre: 100000 }], ...patch })
const write = async (body, invoiceId = id(), rev = 0, organization = org, user = actor) => (await db.query('select write_supplier_invoice($1,$2,$3,$4,$5) result', [organization, user, invoiceId, rev, body])).rows[0].result
async function stored(invoiceId) { return (await db.query('select body,revision from supplier_invoices where id=$1', [invoiceId])).rows[0] }
async function original(invoiceId) { const fid = id(); await db.query('select add_supplier_invoice_attachment($1,$2,$3,$4,$5,$6,$7,$8)', [org, actor, invoiceId, fid, 'fiktiv.pdf', 'application/pdf', 100, `${org}/${invoiceId}/${fid}`]) }
const body = () => ({ version: 1, title: 'Fakturaunderlag', date: '2026-11-07', period: '', issuer: 'Fiktivt bolag', recipient: 'Testkund', note: '', lines: [] })
const request = (invoiceId, draft, patch = {}) => ({ id: id(), requestId: id(), confirmed: true, body: body(), sources: [{ invoiceId, revision: 1, allocationId: draft.allocations[0].id, lineId: id(), markupPercent: 15, vatRate: 25, description: 'Material enligt överenskommelse', agreement: 'Testavtal punkt 6, prisvillkor' }], ...patch })
const create = async (req, organization = org, caseId = project, user = actor) => (await db.query('select create_supplier_invoice_basis($1,$2,$3,$4) result', [organization, caseId, user, req])).rows[0].result
before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth;
    create function auth.role() returns text language sql as $$select coalesce(current_setting('request.jwt.claim.role',true),'service_role')$$;
    create table organizations(id uuid primary key); create table profiles(id uuid primary key,full_name text,email text);
    create table org_members(org_id uuid,profile_id uuid,is_active boolean);
    create table action_cases(id uuid primary key,org_id uuid,title text,status text,manager_profile_id uuid,updated_by uuid);
    create table action_case_items(id uuid primary key,org_id uuid,action_case_id uuid,title text,sort_order integer);
    create table action_case_questions(id uuid primary key,org_id uuid,action_case_id uuid,body jsonb);
    create table action_case_customer_planning(org_id uuid,action_case_id uuid,items jsonb);
    create table action_case_customer_prices(org_id uuid,action_case_id uuid,item_id uuid,terms jsonb);
    create table action_case_contract_signing_documents(org_id uuid,action_case_id uuid,version integer,released_at timestamptz,snapshot jsonb);
    create table action_case_customer_offers(org_id uuid,action_case_id uuid,version integer,status text,snapshot jsonb);
    create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table protected_data(id text primary key,body jsonb);
    insert into protected_data values('contract','{"locked":true}'),('calculation','{"cost":42}'),('payment_plan','{"amount":123}');`)
  await db.query('insert into organizations values($1),($2)', [org, other])
  await db.query("insert into profiles values($1,'Test User','test@example.invalid'),($2,'Other','other@example.invalid')", [actor, stranger])
  await db.query('insert into org_members values($1,$2,true),($3,$4,true)', [org, actor, other, stranger])
  await db.query("insert into action_cases values($1,$2,'Test','in_progress',$3,null),($4,$5,'Foreign','in_progress',$6,null)", [project, org, actor, foreign, other, stranger])
  await db.query("insert into action_case_items values($1,$2,$3,'Grundarbete',100)", [item, org, project])
  await db.query('insert into action_case_customer_prices values($1,$2,$3,$4)', [org, project, item, { split: 'combined', combined: { mode: 'running', markupPercent: 15 } }])
  await db.query('insert into action_case_customer_planning values($1,$2,$3)', [org, project, [{ id: change, title: 'ÄTA test', offer: { kind: 'change', pricing: { mode: 'running', running: { markupPercent: 15 } } } }]])
  await db.exec(sql('2026-11-05_01_supplier_invoices'))
  await db.exec(sql('2026-11-07_01_project_completion_and_invoice_basis'))
  const old = invoice({ dueDate: '2026-11-30', allocations: [] }); await write(old)
  await db.exec(migration); await db.exec(migration)
})
after(() => db.close())
test('optional due date and stable allocation identities survive CAS and exact retry', async () => {
  const draft = invoice(), invoiceId = id()
  assert.deepEqual(await write(draft, invoiceId), { id: invoiceId, revision: 1 })
  assert.deepEqual(await write(draft, invoiceId), { id: invoiceId, revision: 1 })
  assert.deepEqual((await stored(invoiceId)).body, draft)
  const next = { ...draft, notes: 'Intern notering' }
  await write(next, invoiceId, 1)
  await assert.rejects(write({ ...next, notes: 'Old tab' }, invoiceId, 1), /STALE/)
  const legacy = { ...next, allocations: next.allocations.map(({ id: _id, changeId: _change, ...r }) => r) }
  await assert.rejects(write(legacy, invoiceId, 2), /STALE/)
})
test('moment, ÄTA and tenant checks reject foreign or invalid allocations', async () => {
  const draft = invoice()
  await write({ ...draft, allocations: [{ ...draft.allocations[0], itemId: null, changeId: change }] })
  for (const patch of [{ itemId: item, changeId: change }, { itemId: null, changeId: id() }, { caseId: foreign }, { id: null }]) await assert.rejects(write({ ...draft, invoiceNumber: id(), allocations: [{ ...draft.allocations[0], ...patch }] }), /INVALID/)
  await assert.rejects(write(draft, id(), 0, org, stranger), /FORBIDDEN/)
  await assert.rejects(write(draft, id(), 0, other, stranger), /INVALID/)
})
test('basis creation is atomic, idempotent and protects against charging the same source twice', async () => {
  const draft = invoice(), invoiceId = id(); await write(draft, invoiceId); await original(invoiceId)
  const req = request(invoiceId, draft), result = await create(req)
  assert.equal(result.id, req.id); assert.deepEqual(await create(req), result)
  const saved = (await db.query('select body from action_case_invoice_basis where id=$1', [result.id])).rows[0].body
  assert.equal(saved.lines.length, 1); assert.equal(saved.lines[0].unitPriceOre, 115000)
  assert.ok(!JSON.stringify(saved).includes('supplierName')); assert.ok(!JSON.stringify(saved).includes('agreement'))
  await assert.rejects(create(request(invoiceId, draft)), /ALREADY_IN_BASIS/)
  const link = (await db.query('select * from supplier_invoice_basis_sources where basis_id=$1', [req.id])).rows[0]
  assert.equal(link.snapshot.allocation.id, draft.allocations[0].id); assert.equal(link.created_by, actor)
  await assert.rejects(write({ ...draft, netAmountOre: 90000 }, invoiceId, 1), /SOURCE_IN_USE/)
  await assert.rejects(write({ ...draft, allocations: [] }, invoiceId, 1), /SOURCE_IN_USE/)
  await write({ ...draft, notes: 'Notering tillåten' }, invoiceId, 1)
  await assert.rejects(db.query('update action_case_invoice_basis set body=$2 where id=$1', [req.id, { ...saved, lines: [] }]), /SOURCE_IN_USE/)
  await db.query('update action_case_invoice_basis set body=$2 where id=$1', [req.id, { ...saved, period: 'November' }])
})
test('missing originals, stale revisions, unknown sources and unconfirmed requests cannot create bases', async () => {
  const draft = invoice(), invoiceId = id(); await write(draft, invoiceId)
  await assert.rejects(create(request(invoiceId, draft)), /STALE/)
  await original(invoiceId)
  const r = request(invoiceId, draft)
  for (const patch of [{ confirmed: false }, { sources: [{ ...r.sources[0], revision: 0 }] }, { sources: [{ ...r.sources[0], allocationId: id() }] }, { sources: [{ ...r.sources[0], agreement: '' }] }, { sources: [{ ...r.sources[0], markupPercent: 20 }] }]) await assert.rejects(create({ ...r, ...patch }), /INVALID|STALE|REQUIRED|TERMS_CHANGED/)
  assert.equal((await db.query('select count(*)::int n from action_case_invoice_basis where id=$1', [r.id])).rows[0].n, 0)
})
test('fixed terms and frozen contract terms are authoritative, not live calculation or edited project prices', async () => {
  const draft = invoice(), invoiceId = id(); await write(draft, invoiceId); await original(invoiceId)
  await db.query('insert into action_case_contract_signing_documents values($1,$2,1,null,$3)', [org, project, { contractPricing: { mode: 'fixed', rows: [{ sourceItemId: item, kind: 'fixed' }] } }])
  await assert.rejects(create(request(invoiceId, draft)), /FIXED_COST/)
  const snapshot = { contractPricing: { mode: 'running', running: { markupPercent: 10 }, rows: [{ sourceItemId: item, kind: 'running' }] } }
  await db.query('update action_case_contract_signing_documents set snapshot=$1', [snapshot])
  const req = request(invoiceId, draft)
  await assert.rejects(create(req), /TERMS_CHANGED/)
  await create({ ...req, sources: [{ ...req.sources[0], markupPercent: 10 }] })
  await db.query('delete from action_case_contract_signing_documents')
})
test('ÄTA needs an explicit approval reference; cost allocation itself grants no approval', async () => {
  const draft = invoice(), invoiceId = id(); draft.allocations[0].itemId = null; draft.allocations[0].changeId = change
  await write(draft, invoiceId); await original(invoiceId)
  const req = request(invoiceId, draft)
  await assert.rejects(create({ ...req, sources: [{ ...req.sources[0], agreement: '' }] }), /AGREEMENT_REQUIRED/)
  await create({ ...req, sources: [{ ...req.sources[0], agreement: 'Kundens mejlgodkännande 2026-11-06, test' }] })
  const planning = (await db.query('select items from action_case_customer_planning')).rows[0].items
  assert.equal(planning[0].offer.kind, 'change'); assert.equal(planning[0].approved, undefined)
})
test('split customer terms require a price part and reject the fixed labour part', async () => {
  await db.query('update action_case_customer_prices set terms=$1 where item_id=$2', [{ split: 'separate', labour: { mode: 'fixed', markupPercent: null }, material: { mode: 'budget', markupPercent: 15 } }, item])
  try {
    const draft = invoice(), invoiceId = id(); await write(draft, invoiceId); await original(invoiceId)
    const req = request(invoiceId, draft)
    await assert.rejects(create(req), /TERMS_CHANGED/)
    await assert.rejects(create({ ...req, sources: [{ ...req.sources[0], part: 'labour' }] }), /FIXED_COST/)
    await create({ ...req, sources: [{ ...req.sources[0], part: 'material' }] })
  } finally { await db.query('update action_case_customer_prices set terms=$1 where item_id=$2', [{ split: 'combined', combined: { mode: 'running', markupPercent: 15 } }, item]) }
})
test('credits create negative source-linked customer amounts without mutating the debit invoice', async () => {
  const debit = invoice(), debitId = id(); await write(debit, debitId)
  const credit = invoice({ documentKind: 'credit', creditReferenceInvoiceId: debitId }), creditId = id()
  await write(credit, creditId); await original(creditId); const req = request(creditId, credit); await create(req)
  const saved = (await db.query('select body from action_case_invoice_basis where id=$1', [req.id])).rows[0].body
  assert.equal(saved.lines[0].unitPriceOre, -115000); assert.deepEqual((await stored(debitId)).body, debit)
})
test('private sources, closed projects and unrelated protected data remain protected', async () => {
  const ctx = (await db.query('select project_supplier_invoice_context($1,$2,$3) result', [org, project, actor])).rows[0].result
  assert.equal(ctx.targets.length, 2)
  await assert.rejects(db.query('select project_supplier_invoice_context($1,$2,$3)', [org, foreign, actor]), /NOT_FOUND/)
  for (const role of ['anon', 'authenticated']) {
    await db.exec(`set role ${role}`)
    await assert.rejects(db.query('select * from supplier_invoice_basis_sources'), /permission denied/)
    await assert.rejects(create({}), /permission denied/)
    await db.exec('reset role')
  }
  assert.deepEqual((await db.query('select * from protected_data order by id')).rows, [{ id: 'calculation', body: { cost: 42 } }, { id: 'contract', body: { locked: true } }, { id: 'payment_plan', body: { amount: 123 } }])
})
