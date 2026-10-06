import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { emptyContractDetails } from '../src/lib/action-cases/customerContract.ts'

const db = new PGlite()
const org = randomUUID(), foreignOrg = randomUUID(), admin = randomUUID(), inspector = randomUUID(), outsider = randomUUID()
const migration = (name) => readFileSync(new URL(`../docs/db/${name}`, import.meta.url), 'utf8').replace('create extension if not exists pgcrypto;', '')
before(async () => {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table organizations (id uuid primary key, name text);
    create table profiles (id uuid primary key);
    create table org_members (org_id uuid, profile_id uuid, role text, is_active boolean);
    create function is_valid_swedish_organization_number(text) returns boolean language sql immutable as $$ select $1 ~ '^[0-9]{6}-[0-9]{4}$' $$;
    create table action_cases (id uuid primary key, org_id uuid references organizations(id), title text default 'Projekt', property_address text default 'Gatan 1', customer_name text, customer_email text, customer_phone text);
    create table action_case_participants (id uuid primary key default gen_random_uuid(), org_id uuid, action_case_id uuid references action_cases(id), role text, name text, email text, phone text, created_by uuid);
    create unique index one_customer on action_case_participants(action_case_id) where role='customer';
    create table action_case_access_links (id uuid primary key default gen_random_uuid(), org_id uuid, action_case_id uuid, participant_id uuid, token_hash text, expires_at timestamptz, revoked_at timestamptz, created_by uuid);
    create table action_case_attachment_grants (attachment_id uuid, participant_id uuid);
    create table action_case_events (org_id uuid, action_case_id uuid, event_type text, message text, performed_by uuid);
    create schema storage; create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint);
    insert into organizations values ('${org}','Egen'), ('${foreignOrg}','Annan');
    insert into profiles values ('${admin}'), ('${inspector}'), ('${outsider}');
    insert into org_members values ('${org}','${admin}','admin',true), ('${org}','${inspector}','inspector',true), ('${foreignOrg}','${outsider}','admin',true);
  `)
  await db.exec(migration('2026-09-10_05_organization_customers.sql'))
  await db.exec(migration('2026-09-29_01_action_case_customer_offers.sql'))
  await db.exec(migration('2026-09-29_03_customer_offer_internal_costing.sql'))
  await db.exec(migration('2026-09-29_04_customer_offer_planning.sql'))
  await db.exec(migration('2026-10-01_04_action_case_schedule.sql'))
  await db.exec(migration('2026-10-06_01_action_case_organization_customer.sql'))
  await db.exec(migration('2026-10-06_01_action_case_organization_customer.sql'))
})
after(() => db.close())
const parties = () => ({ version: 1, customers: [{ name: 'Anna Test', personalNumber: '' }], email: 'anna@example.test', mobile: '0701234567', phone: '', street: 'Testgatan 1', postalCode: '12345', city: 'Teststad', contractor: { companyName: 'Bygg AB' } })
const body = () => ({ contractParties: parties(), contractDetails: emptyContractDetails(), items: [], title: 'Test', baseAmountOre: 10000 })
async function project() {
  const id = randomUUID(), participantId = randomUUID()
  await db.query('insert into action_cases(id,org_id,customer_name,customer_email) values($1,$2,$3,$4)', [id, org, 'Förra kunden', 'old@example.test'])
  await db.query("insert into action_case_participants(id,org_id,action_case_id,role,name,email) values($1,$2,$3,'customer',$4,$5)", [participantId, org, id, 'Förra kunden', 'old@example.test'])
  return { id, participantId }
}
async function customer(options = {}) {
  const id = randomUUID()
  await db.query(`insert into organization_customers(id,org_id,customer_type,name,email,phone,address,postal_code,city,personal_identity_number,is_active)
    values($1,$2,'private',$3,$4,'0700000000','Registergatan 2','54321','Registerstad',$5,$6)`,
    [id, options.org ?? org, options.name ?? 'Kund i registret', 'registry@example.test', options.identity ?? null, options.active ?? true])
  return id
}
function data(mode = 'create') {
  const draft = body()
  return { revision: 0, body: draft, costing: {}, requestId: randomUUID(), includeIdentity: true,
    binding: { mode }, customerInput: { customerType: 'private', name: 'Anna Test', email: 'anna@example.test', invoiceSameAsCustomer: true } }
}
async function write(id, payload, mode = 'create', user = admin, organization = org) {
  return db.query('select write_action_case_contract_customer($1,$2,$3,$4,$5::jsonb)', [organization, id, user, mode, JSON.stringify(payload)])
}
async function state(id) {
  return (await db.query(`select c.organization_customer_id, c.customer_name, c.customer_email, d.revision, d.body, d.internal_costing
    from action_cases c left join action_case_customer_offer_drafts d on d.action_case_id=c.id where c.id=$1`, [id])).rows[0]
}

test('migration is repeatable, only server can call writer or change link, foreign-org FK enforced', async () => {
  const rights = (await db.query("select has_function_privilege('authenticated','write_action_case_contract_customer(uuid,uuid,uuid,text,jsonb)','execute') browser, has_function_privilege('service_role','write_action_case_contract_customer(uuid,uuid,uuid,text,jsonb)','execute') server")).rows[0]
  assert.deepEqual(rights, { browser: false, server: true })
  const p = await project(), foreign = await customer({ org: foreignOrg })
  await assert.rejects(db.query('update action_cases set organization_customer_id=$1 where id=$2', [foreign, p.id]), /action_cases_org_customer_fk/)
  await db.exec('grant update,select on action_cases to authenticated; set role authenticated;')
  try { await assert.rejects(db.query('update action_cases set organization_customer_id=$1 where id=$2', [randomUUID(), p.id]), /CUSTOMER_REGISTRY_FORBIDDEN/) }
  finally { await db.exec('reset role') }
})

test('create stores shared numbered customer, project, recipient and draft atomically; retries do not duplicate', async () => {
  const p = await project(), payload = data()
  await write(p.id, payload)
  const saved = await state(p.id)
  assert.equal(saved.customer_email, 'anna@example.test')
  assert.equal(saved.revision, 1)
  const registered = (await db.query('select * from organization_customers where id=$1', [saved.organization_customer_id])).rows[0]
  assert.equal(registered.name, 'Anna Test')
  assert.ok(Number(registered.customer_number) >= 1001)
  await write(p.id, payload)
  assert.deepEqual(await state(p.id), saved)
  assert.equal((await db.query('select count(*)::int n from organization_customers where id=$1', [saved.organization_customer_id])).rows[0].n, 1)
  const broken = await project(), invalid = data()
  invalid.costing = []
  const count = (await db.query('select count(*)::int n from organization_customers')).rows[0].n
  await assert.rejects(write(broken.id, invalid), /CUSTOMER_OFFER_INVALID/)
  assert.equal((await db.query('select count(*)::int n from organization_customers')).rows[0].n, count)
  assert.equal((await state(broken.id)).organization_customer_id, null)
})

test('existing selection copies current registry values, retains buyer 2 and contractor, never updates registry', async () => {
  const p = await project(), id = await customer({ identity: '900101-1234' }), payload = data('existing')
  payload.binding = { mode: 'existing', customerId: id, customerVersion: 1 }
  payload.body.contractParties.customers.push({ name: 'Andra beställaren', personalNumber: '' })
  await write(p.id, payload, 'existing')
  const saved = await state(p.id)
  assert.equal(saved.customer_name, 'Kund i registret')
  assert.equal(saved.body.contractParties.street, 'Registergatan 2')
  assert.equal(saved.body.contractParties.customers[0].personalNumber, '900101-1234')
  assert.equal(saved.body.contractParties.customers[1].name, 'Andra beställaren')
  assert.equal(saved.body.contractParties.contractor.companyName, 'Bygg AB')
  payload.revision = 1
  payload.body = saved.body
  payload.body.contractParties.customers[0].name = 'Avtalets anpassning'
  payload.body.contractParties.email = 'new@example.test'
  await write(p.id, payload, 'save')
  assert.equal((await state(p.id)).customer_email, 'new@example.test')
  const row = (await db.query('select name,email,version from organization_customers where id=$1', [id])).rows[0]
  assert.deepEqual(row, { name: 'Kund i registret', email: 'registry@example.test', version: 1 })
})

test('organization, inactive customers, stale versions and non-admin creation/identity reads are rejected', async () => {
  const p = await project(), payload = data('existing'), id = await customer()
  payload.binding = { mode: 'existing', customerId: await customer({ org: foreignOrg }), customerVersion: 1 }
  await assert.rejects(write(p.id, payload, 'existing'), /CUSTOMER_REGISTRY_NOT_FOUND/)
  payload.binding.customerId = await customer({ active: false })
  await assert.rejects(write(p.id, payload, 'existing'), /CUSTOMER_REGISTRY_NOT_FOUND/)
  payload.binding.customerId = id
  payload.binding.customerVersion = 2
  await assert.rejects(write(p.id, payload, 'existing'), /CUSTOMER_REGISTRY_STALE/)
  payload.binding.customerVersion = 1
  await assert.rejects(write(p.id, payload, 'existing', inspector), /CUSTOMER_REGISTRY_FORBIDDEN/)
  payload.includeIdentity = false
  await write(p.id, payload, 'existing', inspector)
  assert.equal((await state(p.id)).body.contractParties.customers[0].personalNumber, '')
  await assert.rejects(write((await project()).id, data(), 'create', inspector), /CUSTOMER_REGISTRY_FORBIDDEN/)
  await assert.rejects(write(p.id, payload, 'existing', outsider), /CUSTOMER_REGISTRY_FORBIDDEN/)
  await assert.rejects(write(p.id, payload, 'existing', admin, foreignOrg), /CUSTOMER_REGISTRY_FORBIDDEN/)
})

test('buyer change revokes old links and grants; published and accepted versions cannot be rewritten', async () => {
  const p = await project(), payload = data()
  await db.query('insert into action_case_access_links(org_id,action_case_id,participant_id) values($1,$2,$3)', [org, p.id, p.participantId])
  await db.query('insert into action_case_attachment_grants values($1,$2)', [randomUUID(), p.participantId])
  await db.query("insert into action_case_customer_planning(action_case_id,org_id,shared_items,participant_id) values($1,$2,'[{\"id\":\"old\"}]',$3)", [p.id, org, p.participantId])
  await db.query("insert into action_case_schedules(action_case_id,org_id,shared_rows,updated_by) values($1,$2,'[{\"title\":\"old\"}]',$3)", [p.id, org, admin])
  await write(p.id, payload)
  assert.equal((await db.query('select count(*)::int n from action_case_access_links where action_case_id=$1 and revoked_at is null', [p.id])).rows[0].n, 0)
  assert.equal((await db.query('select count(*)::int n from action_case_attachment_grants where participant_id=$1', [p.participantId])).rows[0].n, 0)
  assert.deepEqual((await db.query('select shared_items,participant_id from action_case_customer_planning where action_case_id=$1', [p.id])).rows[0], { shared_items: [], participant_id: null })
  assert.deepEqual((await db.query('select shared_rows from action_case_schedules where action_case_id=$1', [p.id])).rows[0].shared_rows, [])
  const offer = randomUUID(), saved = await state(p.id)
  const snapshot = structuredClone(saved.body)
  snapshot.contractDetails.advice.status = 'none'
  for (const entry of Object.values(snapshot.contractDetails.fields)) {
    entry.status = 'specified'
    entry.text = 'Fiktiva testvillkor'
  }
  await db.query("insert into action_case_customer_offers(id,org_id,action_case_id,participant_id,version,draft_revision,snapshot,published_by,email_payload) values($1,$2,$3,$4,1,1,$5::jsonb,$6,'{}')", [offer, org, p.id, p.participantId, JSON.stringify(snapshot), admin])
  payload.revision = 1
  payload.body.contractParties.email = 'different@example.test'
  await assert.rejects(write(p.id, payload, 'save'), /CUSTOMER_REGISTRY_WITHDRAW_FIRST/)
  await assert.rejects(write(p.id, { ...payload, requestId: randomUUID() }), /CUSTOMER_REGISTRY_WITHDRAW_FIRST/)
  assert.deepEqual((await db.query('select snapshot from action_case_customer_offers where id=$1', [offer])).rows[0].snapshot, snapshot)
  await db.query("update action_case_customer_offers set status='withdrawn' where id=$1", [offer])
  await assert.rejects(write(p.id, payload, 'save'), /CUSTOMER_REGISTRY_HISTORY_LOCKED/)
  // Use a second project to verify accepted protection through the real immutable-offer trigger.
  const accepted = await project()
  await db.query("insert into action_case_customer_offers(id,org_id,action_case_id,participant_id,version,draft_revision,snapshot,published_by,email_payload,status) values($1,$2,$3,$4,1,1,'{}',$5,'{}','accepted')", [randomUUID(), org, accepted.id, accepted.participantId, admin])
  await assert.rejects(write(accepted.id, payload, 'save'), /CUSTOMER_OFFER_ACCEPTED/)
})

test('stale draft and duplicate identity roll back without new customers or contact changes', async () => {
  const p = await project(), payload = data()
  payload.revision = 4
  await assert.rejects(write(p.id, payload), /CUSTOMER_OFFER_STALE/)
  assert.equal((await state(p.id)).customer_email, 'old@example.test')
  await customer({ identity: '850101-1234' })
  payload.revision = 0
  payload.customerInput.identityNumber = '850101-1234'
  await assert.rejects(write(p.id, payload), /organization_customers_personal_identity_number_uidx/)
  assert.equal((await state(p.id)).revision, null)
})

test('ordinary save with unchanged buyer preserves grants; incomplete contact cannot replace delivery recipient', async () => {
  const p = await project(), payload = data()
  payload.body.contractParties.customers[0].name = 'Förra kunden'
  payload.body.contractParties.email = 'old@example.test'
  await db.query('insert into action_case_access_links(org_id,action_case_id,participant_id) values($1,$2,$3)', [org, p.id, p.participantId])
  await db.query('insert into action_case_attachment_grants values($1,$2)', [randomUUID(), p.participantId])
  await write(p.id, payload, 'save')
  assert.equal((await db.query('select count(*)::int n from action_case_access_links where action_case_id=$1 and revoked_at is null', [p.id])).rows[0].n, 1)
  assert.equal((await db.query('select count(*)::int n from action_case_attachment_grants where participant_id=$1', [p.participantId])).rows[0].n, 1)
  payload.revision = 1
  payload.body.contractParties.email = ''
  await write(p.id, payload, 'save')
  const saved = await state(p.id)
  assert.equal(saved.customer_email, 'old@example.test')
  assert.equal(saved.body.contractParties.email, '')
  assert.equal(saved.organization_customer_id, null)
})
