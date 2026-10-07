import assert from 'node:assert/strict'
import { before, after, test } from 'node:test'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { emptyPropertyDetails, propertyIdentityKey, normalizePropertyDetails } from '../src/lib/properties/identity.ts'
import { editContractProperty, emptyContractDetails, normalizeContractDetails, contractDetailsIssues } from '../src/lib/action-cases/customerContract.ts'

const details = (patch = {}) => ({ municipality: 'Danderyd', cadastralDesignation: 'BYLGIA 24', street: 'Lokevägen 6', postalCode: '182 75', city: 'Djursholm', ...patch })
const db = new PGlite(), org = randomUUID(), otherOrg = randomUUID(), actor = randomUUID(), colleague = randomUUID(), stranger = randomUUID()
const migration = (name) => readFileSync(new URL(`../docs/db/${name}`, import.meta.url), 'utf8').replace('create extension if not exists pgcrypto;', '')
before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create table organizations(id uuid primary key); create table profiles(id uuid primary key);
    create table org_members(org_id uuid, profile_id uuid, is_active boolean);
    create table properties(id uuid primary key default gen_random_uuid(), owner uuid references profiles(id), name text,
      municipality text, cadastral_id text, address text, postal_code text, city text);
    create table action_cases(id uuid primary key, org_id uuid references organizations(id), title text default 'Projekt',
      property_address text default 'Gatan 1', customer_name text default 'Test', customer_email text);
    create table action_case_participants(id uuid primary key default gen_random_uuid(), org_id uuid, action_case_id uuid, role text, name text, email text);
    create table action_case_access_links(id uuid primary key default gen_random_uuid(), org_id uuid, action_case_id uuid, participant_id uuid,
      token_hash text, expires_at timestamptz, revoked_at timestamptz, created_by uuid);
    create table action_case_events(org_id uuid, action_case_id uuid, event_type text, message text, performed_by uuid);
    create schema storage; create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint);
    insert into organizations values('${org}'),('${otherOrg}');
    insert into profiles values('${actor}'),('${colleague}'),('${stranger}');
    insert into org_members values('${org}','${actor}',true),('${org}','${colleague}',true),('${otherOrg}','${stranger}',true);`)
  for (const file of ['2026-09-29_01_action_case_customer_offers.sql', '2026-09-29_03_customer_offer_internal_costing.sql',
    '2026-09-29_04_customer_offer_planning.sql', '2026-10-07_02_action_case_property.sql', '2026-10-07_02_action_case_property.sql']) await db.exec(migration(file))
})
after(() => db.close())
async function project() {
  const id = randomUUID()
  await db.query('insert into action_cases(id,org_id) values($1,$2)', [id, org])
  return id
}
function payload(property = details()) {
  return { revision: 0, requestId: randomUUID(), property,
    body: { title: 'Test', baseAmountOre: 10000, items: [], contractDetails: editContractProperty(emptyContractDetails(), property) }, costing: {} }
}
async function bind(id, data, mode = 'create', user = actor, organization = org) {
  return db.query('select write_action_case_property($1,$2,$3,$4,$5::jsonb)', [organization, id, user, mode, JSON.stringify(data)])
}
async function state(id) {
  return (await db.query('select c.property_id,c.property_address,d.body,d.revision from action_cases c left join action_case_customer_offer_drafts d on c.id=d.action_case_id where c.id=$1', [id])).rows[0]
}
async function options(id, user = actor, organization = org) {
  return (await db.query('select action_case_property_options($1,$2,$3) data', [organization, id, user])).rows[0].data
}

test('property identity combines municipality and designation, not address or project name', async () => {
  for (const value of [details(), details({ municipality: ' DANDERYD ', cadastralDesignation: ' bylgia24 ' }), details({ municipality: '\tDanderyd\n', cadastralDesignation: 'BYLGIA\t24' })]) {
    assert.equal(propertyIdentityKey(value), 'danderyd|bylgia24')
    assert.equal((await db.query('select property_identity_key($1,$2) key', [value.municipality, value.cadastralDesignation])).rows[0].key, propertyIdentityKey(value))
  }
  assert.notEqual(propertyIdentityKey(details()), propertyIdentityKey(details({ municipality: 'Täby' })))
  assert.equal(propertyIdentityKey(emptyPropertyDetails()), null)
  assert.equal((await db.query('select property_identity_key($1,$2) key', ['\t', '\n'])).rows[0].key, null)
})

test('separate contract fields normalize, validate completion and preserve original legacy snapshot', () => {
  const legacy = emptyContractDetails()
  legacy.fields.property = { status: 'specified', text: 'BYLGIA 24, Lokevägen 6, 39,06 m²' }
  const original = structuredClone(legacy)
  const draft = editContractProperty(legacy, details())
  assert.deepEqual(normalizeContractDetails(draft), draft)
  assert.equal(draft.propertyReference, original.fields.property.text)
  assert.equal(normalizeContractDetails(editContractProperty(legacy, { municipality: 'Danderyd' })).propertyReference, original.fields.property.text)
  assert.match(draft.fields.property.text, /Kommun: Danderyd\nFastighetsbeteckning: BYLGIA 24\nGata: Lokevägen 6/)
  assert.deepEqual(legacy, original)
  assert.deepEqual(normalizeContractDetails(legacy), legacy)
  assert.equal(contractDetailsIssues(editContractProperty(draft, { municipality: '' })).some((issue) => issue.includes('kommun')), true)
  assert.throws(() => normalizePropertyDetails({ ...details(), city: 123 }), /PROPERTY_INVALID/)
  assert.throws(() => normalizeContractDetails({ ...draft, property: { ...draft.property, sourcePropertyId: 'bad' } }), /INVALID/)
  assert.throws(() => normalizeContractDetails({ ...draft, property: { ...draft.property, street: 'x'.repeat(251) } }), /INVALID/)
  assert.throws(() => normalizeContractDetails({ ...draft, propertyReference: 'x'.repeat(6001) }), /INVALID/)
})

test('creation saves the existing shared properties row, project UUID and contract draft atomically with retry protection', async () => {
  const id = await project(), data = payload(details({ cadastralDesignation: 'TEST 1:1' }))
  data.body.contractDetails = emptyContractDetails()
  data.body.contractDetails.fields.property = { status: 'specified', text: 'Tidigare uppgift, area 39 m²' }
  await bind(id, data)
  const saved = await state(id)
  assert.ok(saved.property_id)
  assert.equal(saved.revision, 1)
  assert.equal(saved.property_address, 'Lokevägen 6')
  assert.equal(saved.body.contractDetails.property.sourcePropertyId, saved.property_id)
  assert.equal(saved.body.contractDetails.propertyReference, 'Tidigare uppgift, area 39 m²')
  await assert.rejects(db.query('select assert_contract_property($1::jsonb, false)', [JSON.stringify({ ...saved.body,
    contractDetails: { ...saved.body.contractDetails, propertyReference: 123 } })]), /PROPERTY_INVALID/)
  const property = (await db.query('select owner,cadastral_id from properties where id=$1', [saved.property_id])).rows[0]
  assert.deepEqual(property, { owner: actor, cadastral_id: 'TEST 1:1' })
  await bind(id, data)
  assert.deepEqual(await state(id), saved)
  await assert.rejects(bind(id, { ...data, property: details() }), /PROPERTY_STALE/)
  const other = await project(), broken = payload(details({ cadastralDesignation: 'ROLLBACK 1' }))
  broken.costing = []
  await assert.rejects(bind(other, broken), /INVALID/)
  assert.equal((await state(other)).property_id, null)
  assert.equal((await db.query("select count(*)::int n from properties where cadastral_id='ROLLBACK 1'")).rows[0].n, 0)
})

test('an existing property is reused across projects and members, never overwritten; foreign properties are not exposed', async () => {
  const first = await project(), data = payload(details({ cadastralDesignation: 'SHARED 2' }))
  await bind(first, data)
  const propertyId = (await state(first)).property_id
  const next = await project(), choice = (await options(next, colleague)).find((row) => row.id === propertyId)
  assert.ok(choice)
  await bind(next, { ...payload(choice), propertyId, property: normalizePropertyDetails(choice) }, 'existing', colleague)
  assert.equal((await state(next)).property_id, propertyId)
  assert.equal((await db.query('select owner from properties where id=$1', [propertyId])).rows[0].owner, actor)
  const foreign = randomUUID()
  await db.query('insert into properties(id,owner,name,municipality,cadastral_id) values($1,$2,$3,$4,$5)', [foreign, stranger, 'Private', 'Danderyd', 'SECRET 1'])
  assert.equal((await options(next)).some((row) => row.id === foreign), false)
  await assert.rejects(bind(await project(), { ...payload(details({ cadastralDesignation: 'SECRET 1' })), propertyId: foreign }, 'existing'), /PROPERTY_FORBIDDEN/)
  await assert.rejects(options(next, stranger), /PROPERTY_FORBIDDEN/)
  await assert.rejects(options(next, stranger, otherOrg), /CUSTOMER_OFFER_NOT_FOUND/)
})

test('duplicate cadastral identities are not guessed or merged, and other municipalities remain distinct', async () => {
  const id = await project(), data = payload(details({ cadastralDesignation: 'DUP 1' }))
  await bind(id, data)
  await assert.rejects(bind(await project(), payload(details({ cadastralDesignation: 'dup1' }))), /PROPERTY_EXISTS/)
  await bind(await project(), payload(details({ cadastralDesignation: 'DUP 1', municipality: 'Täby' })))
  await db.query('insert into properties(owner,name,municipality,cadastral_id) values($1,$2,$3,$4)', [actor, 'Legacy duplicate', 'Danderyd', 'DUP1'])
  await assert.rejects(bind(await project(), payload(details({ cadastralDesignation: 'DUP 1' }))), /PROPERTY_AMBIGUOUS/)
})

test('stale drafts and property data, accepted and outstanding contracts cannot be relinked', async () => {
  const id = await project(), data = payload(details({ cadastralDesignation: 'STALE 1' }))
  await assert.rejects(bind(id, { ...data, revision: 2 }), /CUSTOMER_OFFER_STALE/)
  await bind(id, data)
  const saved = await state(id), choice = (await options(id)).find((row) => row.id === saved.property_id)
  await db.query("update properties set address='Ny gata' where id=$1", [choice.id])
  await assert.rejects(bind(await project(), { ...payload(choice), property: normalizePropertyDetails(choice), propertyId: choice.id }, 'existing'), /PROPERTY_STALE/)
  for (const status of ['published', 'accepted']) {
    const p = await project(), participant = randomUUID()
    await db.query("insert into action_case_participants(id,org_id,action_case_id,role,name,email) values($1,$2,$3,'customer','Test','test@example.test')", [participant, org, p])
    await db.query("insert into action_case_customer_offers(id,org_id,action_case_id,participant_id,version,draft_revision,snapshot,published_by,email_payload,status) values($1,$2,$3,$4,1,1,'{}',$5,'{}',$6)", [randomUUID(), org, p, participant, actor, status])
    await assert.rejects(bind(p, payload(details({ cadastralDesignation: 'LOCK ' + status }))), /CUSTOMER_OFFER_(ACCEPTED|WITHDRAW_FIRST)/)
    assert.deepEqual((await db.query('select snapshot from action_case_customer_offers where action_case_id=$1', [p])).rows[0].snapshot, {})
  }
})

test('autosave uses existing writer, identity edits detach only the project, forged identity links and fields are rejected', async () => {
  const id = await project(), data = payload(details({ cadastralDesignation: 'EDIT 1' }))
  await bind(id, data)
  const saved = await state(id), original = saved.body.contractDetails
  assert.equal(editContractProperty(original, { street: 'Annan gata' }).property.sourcePropertyId, saved.property_id)
  const changed = editContractProperty(original, { cadastralDesignation: 'EDIT 2' })
  assert.equal(changed.property.sourcePropertyId, undefined)
  const forged = { ...changed, property: { ...changed.property, sourcePropertyId: saved.property_id } }
  const write = (body) => db.query("select write_customer_offer($1,$2,$3,'save',$4::jsonb)", [org, id, actor, JSON.stringify({ revision: 1, body })])
  await assert.rejects(write({ ...saved.body, contractDetails: forged }), /PROPERTY_STALE/)
  const bad = structuredClone(saved.body)
  bad.contractDetails.fields.property.text = 'Falsk uppgift'
  await assert.rejects(write(bad), /PROPERTY_INVALID/)
  const oldClient = structuredClone(saved.body)
  delete oldClient.contractDetails.property
  await assert.rejects(write(oldClient), /PROPERTY_INVALID/)
  await write({ ...saved.body, contractDetails: changed })
  assert.equal((await state(id)).property_id, null)
  assert.equal((await db.query('select cadastral_id from properties where id=$1', [saved.property_id])).rows[0].cadastral_id, 'EDIT 1')
})

test('RPC and direct-link permissions cannot bypass property ownership', async () => {
  const rights = (await db.query("select has_function_privilege('authenticated','write_action_case_property(uuid,uuid,uuid,text,jsonb)','execute') browser, has_function_privilege('service_role','write_action_case_property(uuid,uuid,uuid,text,jsonb)','execute') server")).rows[0]
  assert.deepEqual(rights, { browser: false, server: true })
  const id = await project()
  await db.exec('grant update,select on action_cases to authenticated; set role authenticated')
  try { await assert.rejects(db.query('update action_cases set property_id=$1 where id=$2', [randomUUID(), id]), /PROPERTY_FORBIDDEN/) }
  finally { await db.exec('reset role') }
})
