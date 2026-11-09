import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID as id } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { emptyBillingFlow, applyBillingCommand } from '../src/lib/action-cases/billingFlow.ts'

const db = new PGlite(), org = id(), foreign = id(), manager = id(), staff = id(), outsider = id()
const sql = readFileSync(new URL('../docs/db/2026-11-09_02_project_billing_flow.sql', import.meta.url), 'utf8')
const ctx = { candidates: [], suppliers: [], canManage: true, cancelled: false, legacyCount: 0, openQuestions: 0, baseFixedGrossOre: null, issuer: 'Test AB', recipient: 'Testkund' }
const read = async (c, actor = manager, organization = org) => (await db.query('select read_project_billing_flow($1,$2,$3) result', [organization, c, actor])).rows[0].result
async function write(c, command, patch = {}) {
  const current = await read(c), after = applyBillingCommand(current.body || emptyBillingFlow(), command, { ...ctx, ...patch.context }, '2026-11-09T12:00:00.000Z')
  const params = { actor: manager, organization: org, revision: current.revision, requestId: id(), hash: current.contextHash, after, ...patch }
  const result = (await db.query('select write_project_billing_flow($1,$2,$3,$4,$5,$6,$7,$8) result', [params.organization, c, params.actor, params.revision, params.requestId, params.hash, command, params.after])).rows[0].result
  return { result, params, command }
}
async function fixture(status = 'in_progress') {
  const c = id(); await db.query('insert into action_cases values($1,$2,$3,$4,$5,$6)', [c, org, 'Fiktivt projekt', status, manager, 'Testkund']); return c
}
before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth;
    create function auth.role() returns text language sql as $$select coalesce(current_setting('request.jwt.claim.role',true),'service_role')$$;
    create table organizations(id uuid primary key); create table profiles(id uuid primary key,full_name text,email text);
    create table org_members(org_id uuid,profile_id uuid,is_active boolean);
    create table action_cases(id uuid primary key,org_id uuid,title text,status text,manager_profile_id uuid,customer_name text);
    create table action_case_questions(id uuid primary key,org_id uuid,action_case_id uuid,body jsonb);
    create table action_case_contract_signing_documents(id uuid primary key,org_id uuid,action_case_id uuid,version integer,snapshot jsonb,released_at timestamptz);
    create table action_case_customer_offers(id uuid primary key,org_id uuid,action_case_id uuid,version integer,snapshot jsonb,status text);
    create table action_case_customer_contract_drafts(org_id uuid,action_case_id uuid,body jsonb);
    create table action_case_customer_planning(org_id uuid,action_case_id uuid,items jsonb);
    create table action_case_customer_prices(org_id uuid,action_case_id uuid,item_id uuid,revision integer,terms jsonb);
    create table action_case_items(id uuid primary key,org_id uuid,action_case_id uuid,title text,sort_order integer);
    create table supplier_invoices(id uuid primary key,org_id uuid,revision integer,body jsonb);
    create table supplier_invoice_attachments(id uuid primary key,org_id uuid,invoice_id uuid);
    create table supplier_invoice_basis_sources(org_id uuid,invoice_id uuid,allocation_id uuid,action_case_id uuid,basis_id uuid,line_id uuid);
    create table action_case_contract_senders(org_id uuid,action_case_id uuid,snapshot jsonb);
    create table action_case_billing(org_id uuid,action_case_id uuid,customer_id uuid);
    create table organization_customers(id uuid primary key,org_id uuid,name text,address text,postal_code text,city text,invoice_same_as_customer boolean,invoice_name text,invoice_address text,invoice_postal_code text,invoice_city text);
    create table action_case_invoice_basis(id uuid primary key,org_id uuid,action_case_id uuid,revision integer,body jsonb);
    create table sentinel(id text primary key,body jsonb);
    insert into sentinel values('contract','{"locked":true,"price":12345}'),('calculation','{"cost":456}'),('customer-price','{"fixed":777}');`)
  await db.query('insert into organizations values($1),($2)', [org, foreign])
  await db.query("insert into profiles values($1,'Projektansvarig','m@example.invalid'),($2,'Medarbetare','s@example.invalid'),($3,'Främmande','x@example.invalid')", [manager, staff, outsider])
  await db.query('insert into org_members values($1,$2,true),($1,$3,true),($4,$5,true)', [org, manager, staff, foreign, outsider])
  const before = (await db.query('select * from sentinel order by id')).rows
  await db.exec(sql); await db.exec(sql)
  assert.deepEqual((await db.query('select * from sentinel order by id')).rows, before)
  assert.equal((await db.query('select count(*)::int n from action_case_billing_flows')).rows[0].n, 0)
})
after(() => db.close())
test('read is read-only, no backfill or implicit activation', async () => {
  const c = await fixture(), result = await read(c)
  assert.equal(result.body, null); assert.equal(result.revision, 0)
  assert.equal((await db.query('select count(*)::int n from action_case_billing_flows')).rows[0].n, 0)
})
test('manager and tenant are checked again inside the RPC', async () => {
  const c = await fixture(), command = { operation: 'confirm_legacy', note: 'Avstämt' }
  for (const actor of [staff, outsider]) await assert.rejects(write(c, command, { actor }), /FORBIDDEN/)
  await assert.rejects(read(c, outsider, foreign), /NOT_FOUND/)
  await db.query('update org_members set is_active=false where profile_id=$1', [manager])
  await assert.rejects(read(c), /FORBIDDEN/)
  await db.query('update org_members set is_active=true where profile_id=$1', [manager])
})
test('CAS, exact retry and changed retry are authoritative', async () => {
  const c = await fixture(), op = { operation: 'confirm_legacy', note: 'Avstämt mot Fortnox' }, saved = await write(c, op)
  const { params: p } = saved
  const retry = await db.query('select write_project_billing_flow($1,$2,$3,$4,$5,$6,$7,$8) result', [org, c, manager, p.revision, p.requestId, p.hash, op, p.after])
  assert.deepEqual(retry.rows[0].result, saved.result)
  await assert.rejects(write(c, op, { revision: 0 }), /STALE/)
  await assert.rejects(write(c, { ...op, note: 'Changed' }, { requestId: p.requestId }), /STALE/)
  await assert.rejects(db.query('delete from action_case_billing_events where id=$1', [p.requestId]), /IMMUTABLE/)
})
test('a source change between load and commit rejects the entire command', async () => {
  const c = await fixture(), loaded = await read(c)
  await db.query("update action_cases set title='Ny titel' where id=$1", [c])
  await assert.rejects(write(c, { operation: 'confirm_legacy', note: 'Avstämt' }, { hash: loaded.contextHash }), /SOURCE_CHANGED/)
  assert.equal((await read(c)).revision, 0)
})
test('legacy documents stay readable but old editors cannot create or rewrite charges after activation', async () => {
  const c = await fixture(), bid = id(), original = { note: 'Gammalt underlag', amount: 1234 }
  await db.query('insert into action_case_invoice_basis values($1,$2,$3,1,$4)', [bid, org, c, original])
  await write(c, { operation: 'confirm_legacy', note: 'Tidigare fakturering kontrollerad' })
  await assert.rejects(db.query('insert into action_case_invoice_basis values($1,$2,$3,1,$4)', [id(), org, c, original]), /USE_FLOW/)
  await assert.rejects(db.query("update action_case_invoice_basis set body='{}' where id=$1", [bid]), /USE_FLOW/)
  assert.deepEqual((await db.query('select body from action_case_invoice_basis where id=$1', [bid])).rows[0].body, original)
})
test('old project completion paths cannot bypass open billing reconciliation', async () => {
  const c = await fixture()
  await write(c, { operation: 'confirm_legacy', note: 'Avstämt' })
  await assert.rejects(db.query("update action_cases set status='completed' where id=$1", [c]), /INCOMPLETE/)
  await write(c, { operation: 'close_economy', confirmed: true })
  await db.query("update action_cases set status='completed' where id=$1", [c])
  assert.equal((await db.query('select status from action_cases where id=$1', [c])).rows[0].status, 'completed')
})
test('unprivileged roles cannot invoke or read the new private ledger', async () => {
  await db.exec('set role authenticated')
  for (const table of ['action_case_billing_flows', 'action_case_billing_events', 'action_case_billing_supplier_claims']) await assert.rejects(db.query(`select * from ${table}`), /permission denied/)
  await assert.rejects(read(id()), /permission denied/)
  await db.exec('reset role')
  await db.exec("select set_config('request.jwt.claim.role','authenticated',false)")
  await assert.rejects(read(id()), /FORBIDDEN/)
  await db.exec("select set_config('request.jwt.claim.role','service_role',false)")
})

test('supplier claims are unique, protect final financial state and tolerate the existing two-step writer', async () => {
  const c = await fixture(), invoiceId = id(), allocationId = id(), changeId = id(), costId = id(), agreementId = id()
  const allocation = { id: allocationId, caseId: c, changeId, itemId: null, amountOre: 100000, category: 'material', description: 'Fiktiv vara' }
  const body = { supplierName: 'Fiktiv leverantör', invoiceNumber: 'TEST-100', invoiceDate: '2026-11-09', netAmountOre: 100000, vatAmountOre: 25000, documentKind: 'invoice', approvalStatus: 'approved', notes: '', sourceText: '', allocations: [allocation] }
  await db.query('insert into supplier_invoices values($1,$2,1,$3)', [invoiceId, org, body])
  const candidate = { key: `change:${changeId}:running`, title: 'Test-ÄTA', group: 'change', mode: 'running', fixedGrossOre: null, hourlyGrossOre: null, markupPercent: 15, budgetGrossOre: null, reference: 'Test', conditions: '', fingerprint: 'test-1' }
  const source = { key: `${invoiceId}:${allocationId}`, invoiceId, allocationId, revision: 1, targetKey: `change:${changeId}`, title: 'Test', date: '2026-11-09', netOre: 100000, reviewed: true, original: true, legacy: false }
  const patch = { context: { candidates: [candidate], suppliers: [source] } }
  await write(c, { operation: 'register_agreement', id: agreementId, key: candidate.key, fingerprint: candidate.fingerprint, vatRate: 25, evidence: 'Testmejl', approvedBy: 'Testkund', approvedOn: '2026-11-09' }, patch)
  await write(c, { operation: 'save_cost', id: costId, agreementId, supplierKey: source.key, kind: 'purchase', description: 'Fiktiv vara', date: '2026-11-09', internalNetOre: 100000, evidence: '', missingEvidenceReason: '' }, patch)
  await assert.rejects(db.query('insert into supplier_invoice_basis_sources values($1,$2,$3,$4,$5,$6)', [org, invoiceId, allocationId, c, id(), id()]), /SOURCE_IN_USE/)
  await write(c, { operation: 'review_cost', id: costId, confirmed: true }, patch)
  const entryId = id(), basisId = id()
  await write(c, { operation: 'create_entry', id: entryId, agreementId, costId, date: '2026-11-09' }, patch)
  await write(c, { operation: 'reserve_basis', id: basisId, title: 'Testunderlag', date: '2026-11-09', note: '', lines: [{ id: id(), entryId, netOre: 115000 }] }, patch)
  assert.equal((await db.query('select protected from action_case_billing_supplier_claims where invoice_id=$1', [invoiceId])).rows[0].protected, true)
  await assert.rejects(db.query("update supplier_invoices set body=jsonb_set(body,'{netAmountOre}','200000') where id=$1", [invoiceId]), /SOURCE_IN_USE/)
  await assert.rejects(db.query('delete from supplier_invoices where id=$1', [invoiceId]), /SOURCE_IN_USE|foreign key/)
  // Emulates write_supplier_invoice_v1 followed by the wrapper's identity restore.
  await db.exec('begin')
  await db.query('update supplier_invoices set body=$2 where id=$1', [invoiceId, { ...body, notes: 'En intern notering', allocations: [{ ...allocation, id: undefined, changeId: undefined }] }])
  await db.query('update supplier_invoices set revision=2,body=$2 where id=$1', [invoiceId, { ...body, notes: 'En intern notering' }])
  await db.exec('commit')
  assert.equal((await db.query('select revision from supplier_invoices where id=$1', [invoiceId])).rows[0].revision, 2)
  await db.query("update supplier_invoices set body=body || '{\"paymentStatus\":\"paid\",\"paidOn\":\"2026-11-09\"}'::jsonb where id=$1", [invoiceId])
  const saved = await read(c), changed = structuredClone(saved.body); changed.bases[0].lines[0].netOre = 1
  await assert.rejects(write(c, { operation: 'confirm_legacy', note: 'Test' }, { ...patch, after: changed }), /IMMUTABLE/)
  changed.bases = structuredClone(saved.body.bases); changed.agreements[0].markupPercent = 99
  await assert.rejects(write(c, { operation: 'confirm_legacy', note: 'Test' }, { ...patch, after: changed }), /IMMUTABLE/)
})
