import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import ts from 'typescript'
import { billingCustomerFromBuyer, billingCustomerInput, emptyBillingCustomer } from '../src/lib/action-cases/projectBilling.ts'
import { emptyContractParties } from '../src/lib/action-cases/customerContractParties.ts'
import { normalizeFortnoxOrganizationNumber } from '../src/lib/fortnox/domain.ts'
import { offerId } from '../src/lib/action-cases/customerOffers.ts'

const customerModule = { exports: {} }
const customerCode = ts.transpileModule(readFileSync(new URL('../src/lib/customers/domain.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
new Function('require', 'module', 'exports', customerCode)(() => ({ normalizeFortnoxOrganizationNumber }), customerModule, customerModule.exports)
const { parseOrganizationCustomerInput } = customerModule.exports

test('explicit buyer copy excludes identity and a second signer, registry input excludes metadata', () => {
  const parties = emptyContractParties('First buyer', 'first@example.test', '0701234567')
  parties.customers[0].personalNumber = '19800101-1234'
  parties.customers.push({ name: 'Second signer', personalNumber: '19900101-1234' })
  const result = billingCustomerFromBuyer(parties)
  assert.equal(result.name, 'First buyer')
  assert.equal(result.identityNumber, null)
  assert.equal(result.invoiceSameAsCustomer, true)
  assert.deepEqual(billingCustomerInput({ ...result, id: randomUUID(), customerNumber: '1001', version: 7 }), result)
  result.name = 'Other invoice recipient'
  assert.equal(parties.customers[0].name, 'First buyer')
  assert.equal(parties.customers[1].name, 'Second signer')
})

test('billing UI is independent, persistent across views and excluded from public delivery', () => {
  const editor = readFileSync(new URL('../src/components/tasks/CustomerOfferEditor.tsx', import.meta.url), 'utf8')
  const billing = readFileSync(new URL('../src/components/tasks/ProjectBillingEditor.tsx', import.meta.url), 'utf8')
  const publicDocument = readFileSync(new URL('../src/components/tasks/CustomerOfferDocument.tsx', import.meta.url), 'utf8')
  const route = readFileSync(new URL('../src/app/api/action-cases/[caseId]/billing/route.ts', import.meta.url), 'utf8')
  assert.doesNotMatch(editor, /<ContractCustomerRegistry/)
  assert.match(editor, /dirty \|\| planningDirty \|\| billingDirty/)
  assert.match(editor, /<div hidden=\{view !== 'payments'\}/)
  assert.match(editor, /<ProjectBillingEditor/)
  assert.doesNotMatch(billing, /customer-offers|bind_customer|onCustomerChanged/)
  assert.match(billing, /AbortSignal.timeout\(45000\)/)
  assert.match(billing, /pending.current.id/)
  assert.doesNotMatch(publicDocument, /projectBilling|ProjectBilling|\/billing/)
  assert.match(route, /customerOfferContext\(\)/)
  assert.match(route, /offerRequestBody\(request\)/)
})

const serverCode = ts.transpileModule(readFileSync(new URL('../src/lib/action-cases/projectBillingServer.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const org = randomUUID(), user = randomUUID(), caseId = randomUUID()
function harness(options = {}) {
  const calls = [], reads = [], registry = { organization: { id: options.registryOrg ?? org, canManage: options.canManage ?? true }, customers: [] }
  const admin = {
    from(table) {
      const read = { table, filters: [] }; reads.push(read)
      const chain = { select() { return chain }, eq(...filter) { read.filters.push(filter); return chain }, async maybeSingle() {
        return table === 'action_cases' ? { data: options.noCase ? null : { id: caseId } } : options.billingError ? { error: options.billingError } : { data: { customer_id: null, revision: 3 } }
      } }
      return chain
    },
    async rpc(name, payload) { calls.push({ name, payload }); return { error: options.writeError } },
  }
  const module = { exports: {} }
  new Function('require', 'module', 'exports', serverCode)((name) => {
    if (name === 'server-only') return {}
    if (name.includes('supabase/admin')) return { createSupabaseAdminClient: () => admin }
    if (name.includes('customers/server')) return { getOrganizationCustomerWorkspace: async () => registry }
    if (name.includes('customers/domain')) return { parseOrganizationCustomerInput }
    if (name === './customerOffers') return { offerId }
    throw new Error(name)
  }, module, module.exports)
  return { ...module.exports, calls, reads, registry }
}
const ctx = { orgId: org, userId: user }
test('billing API scopes every read and degrades gracefully without migration', async () => {
  const h = harness()
  assert.equal((await h.getProjectBilling(ctx, caseId)).revision, 3)
  assert.deepEqual(h.reads.map((r) => r.filters), [[['org_id', org], ['id', caseId]], [['org_id', org], ['action_case_id', caseId]]])
  assert.equal((await harness({ billingError: { code: '42P01' } }).getProjectBilling(ctx, caseId)).available, false)
  await assert.rejects(harness({ noCase: true }).getProjectBilling(ctx, caseId), /CUSTOMER_OFFER_NOT_FOUND/)
  await assert.rejects(harness({ registryOrg: randomUUID() }).getProjectBilling(ctx, caseId), /CUSTOMER_REGISTRY_FORBIDDEN/)
  await assert.rejects(harness({ billingError: { code: 'connection' } }).getProjectBilling(ctx, caseId), /PROJECT_BILLING_FAILED/)
})
test('billing writer validates inputs and calls only independent billing RPC', async () => {
  const h = harness(), customerId = randomUUID()
  const request = { mode: 'existing', revision: 0, requestId: randomUUID(), customerId, customerVersion: 1 }
  await h.writeProjectBilling(ctx, caseId, request)
  assert.equal(h.calls[0].name, 'write_action_case_billing')
  assert.deepEqual(h.calls[0].payload.p_data, { revision: 0, requestId: request.requestId, customerId, customerVersion: 1 })
  await h.writeProjectBilling(ctx, caseId, { mode: 'create', revision: 0, requestId: randomUUID(), customer: { ...emptyBillingCustomer(), name: '  Invoice recipient  ' } })
  assert.equal(h.calls[1].payload.p_data.customer.name, 'Invoice recipient')
  await assert.rejects(h.writeProjectBilling(ctx, caseId, { ...request, revision: -1 }), /CUSTOMER_OFFER_INVALID/)
  await assert.rejects(h.writeProjectBilling(ctx, caseId, { ...request, customerVersion: 0 }), /CUSTOMER_OFFER_INVALID/)
  await assert.rejects(harness({ canManage: false }).writeProjectBilling(ctx, caseId, { ...request, mode: 'update' }), /CUSTOMER_REGISTRY_FORBIDDEN/)
  await assert.rejects(harness({ writeError: { code: 'PGRST202' } }).writeProjectBilling(ctx, caseId, request), /PROJECT_BILLING_SCHEMA/)
  await assert.rejects(harness({ writeError: { code: '23505' } }).writeProjectBilling(ctx, caseId, request), /CUSTOMER_IDENTITY_EXISTS/)
})

const db = new PGlite()
const foreignOrg = randomUUID(), inspector = randomUUID(), outsider = randomUUID()
const migration = (name) => readFileSync(new URL(`../docs/db/${name}`, import.meta.url), 'utf8').replace('create extension if not exists pgcrypto;', '')
before(async () => {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table organizations (id uuid primary key, name text);
    create table profiles (id uuid primary key);
    create table org_members (org_id uuid, profile_id uuid, role text, is_active boolean);
    create function is_valid_swedish_organization_number(text) returns boolean language sql immutable as $$ select $1 ~ '^[0-9]{6}-[0-9]{4}$' $$;
    create table action_cases (id uuid primary key, org_id uuid references organizations(id), title text default 'Project', property_address text default 'Street 1', customer_name text, customer_email text, customer_phone text);
    create table action_case_participants (id uuid primary key default gen_random_uuid(), org_id uuid, action_case_id uuid references action_cases(id), role text, name text, email text, phone text, created_by uuid);
    create unique index one_customer on action_case_participants(action_case_id) where role='customer';
    create table action_case_access_links (id uuid primary key default gen_random_uuid(), org_id uuid, action_case_id uuid, participant_id uuid, token_hash text, expires_at timestamptz, revoked_at timestamptz, created_by uuid);
    create table action_case_attachment_grants (attachment_id uuid, participant_id uuid);
    create table action_case_events (org_id uuid, action_case_id uuid, event_type text, message text, performed_by uuid);
    create schema storage; create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint);
    insert into organizations values ('${org}','Own'), ('${foreignOrg}','Other');
    insert into profiles values ('${user}'), ('${inspector}'), ('${outsider}');
    insert into org_members values ('${org}','${user}','admin',true), ('${org}','${inspector}','inspector',true), ('${foreignOrg}','${outsider}','admin',true);
  `)
  for (const name of ['2026-09-10_05_organization_customers.sql', '2026-09-29_01_action_case_customer_offers.sql',
    '2026-09-29_03_customer_offer_internal_costing.sql', '2026-09-29_04_customer_offer_planning.sql', '2026-10-01_04_action_case_schedule.sql',
    '2026-10-07_01_action_case_billing.sql', '2026-10-07_01_action_case_billing.sql']) await db.exec(migration(name))
})
after(() => db.close())
async function project() {
  const id = randomUUID(), participant = randomUUID()
  await db.query('insert into action_cases(id,org_id,customer_name,customer_email) values($1,$2,$3,$4)', [id, org, 'Buyer', 'buyer@example.test'])
  await db.query("insert into action_case_participants(id,org_id,action_case_id,role,name,email) values($1,$2,$3,'customer','Buyer','buyer@example.test')", [participant, org, id])
  return { id, participant }
}
async function registered(options = {}) {
  return (await db.query("insert into organization_customers(org_id,customer_type,name,email,is_active) values($1,'private','Invoice customer','invoice@example.test',$2) returning id", [options.org ?? org, options.active ?? true])).rows[0].id
}
function payload(options = {}) { return { revision: 0, requestId: randomUUID(), customer: { ...emptyBillingCustomer(), name: 'New invoice customer' }, ...options } }
async function write(id, data, mode = 'create', actor = user, organization = org) {
  await db.query('select write_action_case_billing($1,$2,$3,$4,$5::jsonb)', [organization, id, actor, mode, JSON.stringify(data)])
}
async function link(id) { return (await db.query('select * from action_case_billing where action_case_id=$1', [id])).rows[0] }

test('billing migration is repeatable, private and not executable by browser roles', async () => {
  const result = (await db.query("select has_function_privilege('authenticated','write_action_case_billing(uuid,uuid,uuid,text,jsonb)','execute') browser, has_function_privilege('service_role','write_action_case_billing(uuid,uuid,uuid,text,jsonb)','execute') server, has_table_privilege('authenticated','action_case_billing','select') readable")).rows[0]
  assert.deepEqual(result, { browser: false, server: true, readable: false })
  assert.equal((await db.query("select relrowsecurity from pg_class where relname='action_case_billing'")).rows[0].relrowsecurity, true)
})
test('create+link is atomic, numbered, idempotent and does not duplicate on uncertain retry', async () => {
  const p = await project(), data = payload()
  await write(p.id, data)
  const first = await link(p.id), customer = (await db.query('select * from organization_customers where id=$1', [first.customer_id])).rows[0]
  assert.equal(first.revision, 1)
  assert.ok(Number(customer.customer_number) >= 1001)
  await write(p.id, data)
  assert.deepEqual(await link(p.id), first)
  assert.equal((await db.query('select count(*)::int n from organization_customers where id=$1', [first.customer_id])).rows[0].n, 1)
  await assert.rejects(write(p.id, { ...data, customer: { ...data.customer, name: 'Changed payload' } }), /PROJECT_BILLING_STALE/)
  await assert.rejects(write(p.id, payload()), /PROJECT_BILLING_STALE/)
  const other = await project(), invalid = payload({ customer: { ...emptyBillingCustomer(), name: '' } })
  const before = (await db.query('select count(*)::int n from organization_customers')).rows[0].n
  await assert.rejects(write(other.id, invalid), /CUSTOMER_OFFER_INVALID/)
  assert.equal(await link(other.id), undefined)
  assert.equal((await db.query('select count(*)::int n from organization_customers')).rows[0].n, before)
})
test('existing and update honor tenant, member/admin roles, active status and optimistic versions', async () => {
  const p = await project(), id = await registered(), data = payload({ customerId: id, customerVersion: 1 })
  await assert.rejects(write(p.id, { ...data, customerId: await registered({ org: foreignOrg }) }, 'existing'), /PROJECT_BILLING_CUSTOMER/)
  await assert.rejects(write(p.id, { ...data, customerId: await registered({ active: false }) }, 'existing'), /PROJECT_BILLING_CUSTOMER/)
  await assert.rejects(write(p.id, { ...data, customerVersion: 2 }, 'existing'), /PROJECT_BILLING_CUSTOMER/)
  await assert.rejects(write(p.id, data, 'existing', outsider), /CUSTOMER_REGISTRY_FORBIDDEN/)
  await assert.rejects(write(p.id, payload(), 'create', inspector), /CUSTOMER_REGISTRY_FORBIDDEN/)
  await write(p.id, data, 'existing', inspector)
  assert.equal((await link(p.id)).customer_id, id)
  const update = payload({ revision: 1, customerId: id, customerVersion: 1, customer: { ...emptyBillingCustomer(), name: 'Invoice recipient', invoiceSameAsCustomer: false, invoiceName: 'Invoice desk', invoiceEmail: 'billing@example.test', invoiceCountryCode: 'SE', invoiceReference: 'Project 42' } })
  await assert.rejects(write(p.id, update, 'update', inspector), /CUSTOMER_REGISTRY_FORBIDDEN/)
  await write(p.id, update, 'update')
  const row = (await db.query('select name,invoice_email,invoice_reference,version from organization_customers where id=$1', [id])).rows[0]
  assert.deepEqual(row, { name: 'Invoice recipient', invoice_email: 'billing@example.test', invoice_reference: 'Project 42', version: 2 })
  await write(p.id, update, 'update')
  assert.equal((await link(p.id)).revision, 2)
  await assert.rejects(write(p.id, { ...update, revision: 2, requestId: randomUUID() }, 'update'), /PROJECT_BILLING_CUSTOMER/)
})
test('billing changes never rewrite accepted agreement, parties, delivery, sharing or plan', async () => {
  const p = await project(), offer = randomUUID()
  const snapshot = { contractParties: { customers: [{ name: 'Buyer 1' }, { name: 'Buyer 2' }] }, paymentPlan: { installments: [{ amountOre: 100000, condition: 'Work completed' }] }, paymentTerms: 'Agreed terms' }
  await db.query("insert into action_case_customer_offers(id,org_id,action_case_id,participant_id,version,draft_revision,snapshot,published_by,email_payload) values($1,$2,$3,$4,1,1,$5::jsonb,$6,'{}')", [offer, org, p.id, p.participant, JSON.stringify(snapshot), user])
  await db.query("update action_case_customer_offers set status='accepted',accepted_at=now(),accepted_by='Buyer 1',accepted_total_ore=100000 where id=$1", [offer])
  await db.query('insert into action_case_access_links(org_id,action_case_id,participant_id) values($1,$2,$3)', [org, p.id, p.participant])
  await db.query('insert into action_case_attachment_grants values($1,$2)', [randomUUID(), p.participant])
  await db.query("insert into action_case_customer_planning(action_case_id,org_id,shared_items,participant_id) values($1,$2,'[{\"title\":\"Shared choice\"}]',$3)", [p.id, org, p.participant])
  const tables = ['action_cases', 'action_case_participants', 'action_case_customer_offers', 'action_case_access_links', 'action_case_attachment_grants', 'action_case_customer_planning']
  const state = async () => Promise.all(tables.map(async (table) => (await db.query(`select * from ${table} order by 1`)).rows))
  const original = await state()
  await write(p.id, payload())
  await write(p.id, payload({ revision: 1, customerId: await registered(), customerVersion: 1 }), 'existing')
  assert.deepEqual(await state(), original)
})
