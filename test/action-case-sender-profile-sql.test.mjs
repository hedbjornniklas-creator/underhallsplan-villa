import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { platformOrganizationDb, sql, person, organization, grant, asRole } from './helpers/platform-organization-db.ts'
import { emptyCustomerOffer, normalizeCustomerOffer } from '../src/lib/action-cases/customerOffers.ts'
import { emptyContractParties } from '../src/lib/action-cases/customerContractParties.ts'
import { emptyContractDetails } from '../src/lib/action-cases/customerContract.ts'
import { signingDraft } from './fixtures/contract-signing.ts'

const migration = name => sql(`${name}.sql`).replace('create extension if not exists pgcrypto;', '')
const contractMigrations = [
  '2026-09-08_01_action_cases_foundation', '2026-09-08_02_action_case_files_and_participants',
  '2026-09-08_03_action_case_costing', '2026-09-08_04_action_case_ai_costing', '2026-09-08_05_action_case_work_quotes',
  '2026-09-08_09_action_case_grouped_requests', '2026-09-10_05_organization_customers',
  '2026-09-29_01_action_case_customer_offers', '2026-09-29_02_customer_offer_pricing',
  '2026-09-29_03_customer_offer_internal_costing', '2026-09-29_04_customer_offer_planning',
  '2026-10-01_02_customer_contract_choices', '2026-10-01_03_customer_payment_plan', '2026-10-01_04_action_case_schedule',
  '2026-10-05_01_action_case_scope_notes', '2026-10-06_01_action_case_scope_conditions',
  '2026-10-06_01_action_case_organization_customer', '2026-10-07_02_action_case_property', '2026-10-07_03_contract_assignment_documents',
  '2026-10-08_01_independent_customer_contract', '2026-10-08_02_contract_other_agreements',
  '2026-10-08_03_contract_advice_fields', '2026-10-08_04_contract_pricing', '2026-10-10_01_contract_change_pricing',
  '2026-10-10_02_payment_plan_automation', '2026-10-10_03_optional_final_payment', '2026-10-11_01_contract_site_facilities',
  '2026-10-11_02_contract_signing_documents', '2026-10-11_03_optional_contract_locking', '2026-10-11_04_contract_signing_delivery',
]
const values = (name = 'Selected sender') => ({ name, address: 'Test street 1', postalCode: '12345', city: 'Test city',
  email: 'sender@example.test', phone: '0701234567', website: 'https://example.test', logoPath: null, reportFooterText: 'Frozen footer', isActive: true })
const body = () => ({ ...emptyCustomerOffer('Sender test'), contractForm: 'custom', baseAmountOre: 10000, validUntil: '2099-01-01',
  contractParties: emptyContractParties('Buyer', 'buyer@example.test', '', { companyName: 'Legacy company', organizationNumber: '5592810823', contactName: 'Contact', fTax: 'yes' }),
  items: [{ id: randomUUID(), title: 'Work', scope: 'Existing scope', kind: 'included', amountOre: 10000 }] })
const saved = async (db, project) => (await db.query('select * from action_case_customer_contract_drafts where action_case_id=$1', [project])).rows[0]
const write = (db, org, project, actor, operation, data) => db.query('select write_customer_contract($1,$2,$3,$4,$5::jsonb) result', [org, project, actor, operation, JSON.stringify(data)])
const senderMigration = () => migration('2026-10-12_03_action_case_contract_sender_profiles')
const selection = (sender, revision = 1, extra = {}) => ({ requestId: randomUUID(), revision, profileId: sender, profileVersion: 1, legalNameVersion: 1, organizationNumber: '559281-0823', confirmed: true, ...extra })
const select = (f, project, data = selection(f.sender), actor = f.actor, org = f.org, logo = null) => f.db.query(
  'select select_action_case_contract_sender($1,$2,$3,$4::jsonb,$5) result', [org, project, actor, JSON.stringify(data), logo])
function snapshot(stored) {
  // Exercise the same normalization seam as the real workspace/PDF/publish server.
  const draft = normalizeCustomerOffer(stored)
  return { ...draft, projectTitle: 'Sender project', propertyAddress: 'Project address',
    customerName: draft.contractParties?.customers[0]?.name ?? '', customerEmail: draft.contractParties?.email ?? '',
    issuerName: draft.contractParties?.contractor.companyName ?? '', replyEmail: draft.contractParties?.contractor.email ?? '' }
}
async function paper(f, project) {
  const d = await saved(f.db, project), id = randomUUID()
  const payload = { id, version: 1, revision: d.revision, confirmed: true, createdAt: '2026-10-12T12:00:00Z', snapshot: snapshot(d.body), files: [],
    pdfPath: `${f.org}/${project}/signing/${id}/contract.pdf`, pdfSha256: 'a'.repeat(64), pdfSize: 1000 }
  await f.db.query("select write_contract_signing_document($1,$2,$3,'freeze',$4::jsonb)", [f.org, project, f.actor, JSON.stringify(payload)])
  return { id, payload }
}
async function online(f, project, changes = {}) {
  const d = await saved(f.db, project.id), id = randomUUID(), s = snapshot(d.body)
  const payload = { id, revision: d.revision, confirmed: true, participantId: project.recipient, email: 'buyer@example.test',
    issuerName: s.issuerName, replyEmail: s.replyEmail, snapshot: s, files: [], tokenHash: randomUUID().replaceAll('-', '').repeat(2),
    emailPayload: { to: 'buyer@example.test', replyTo: s.replyEmail, text: 'Frozen email', idempotencyKey: `test-${id}` }, ...changes }
  await write(f.db, f.org, project.id, f.actor, 'publish', payload)
  return { id, payload }
}

async function fixture() {
  const db = await platformOrganizationDb()
  try {
    await db.exec(`
      create table properties(id uuid primary key default gen_random_uuid(),owner uuid,name text,municipality text,cadastral_id text,address text,postal_code text,city text);
      create table organization_contacts(id uuid primary key);
      create function operational_tasks_set_updated_at() returns trigger language plpgsql as $$begin new.updated_at=clock_timestamp(); return new; end$$;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      insert into platform_modules(product_id,key,label) select id,'tasks','Tasks' from platform_products where key='dashboard';
    `)
    for (const name of contractMigrations) await db.exec(migration(name))
    await db.exec(migration('2026-10-12_02_organization_sender_profiles'))
    const actor = await person(db), org = await organization(db, actor), otherAdmin = await person(db), otherOrg = await organization(db, otherAdmin)
    const inspector = await person(db), outsider = await person(db)
    await db.query("insert into org_members(org_id,profile_id,role,is_active) values($1,$2,'inspector',true)", [org, inspector])
    for (const [admin, organizationId] of [[actor, org], [otherAdmin, otherOrg]]) {
      await db.query('update organizations set organization_number=$2 where id=$1', [organizationId, '559281-0823'])
      await db.query('select organization_legal_name_save($1,$2,0,$3)', [admin, organizationId, `Legal ${organizationId} AB`])
    }
    const actorGrant = await grant(db, actor, { product: 'dashboard', module: 'tasks', role: 'inspector', scope: 'organization', scopeId: org })
    const inspectorGrant = await grant(db, inspector, { product: 'dashboard', module: 'tasks', role: 'inspector', scope: 'organization', scopeId: org })
    const otherGrant = await grant(db, otherAdmin, { product: 'dashboard', module: 'tasks', role: 'inspector', scope: 'organization', scopeId: otherOrg })
    const sender = randomUUID(), otherSender = randomUUID()
    for (const [admin, organizationId, id] of [[actor, org, sender], [otherAdmin, otherOrg, otherSender]]) {
      await db.query('select organization_sender_profile_save($1,$2,$3,0,$4::jsonb)', [admin, organizationId, id, JSON.stringify(values())])
    }
    const project = async (organizationId = org, owner = actor, initial = body()) => {
      const id = randomUUID(), recipient = randomUUID()
      await db.query("insert into action_cases(id,org_id,title,property_address,customer_name) values($1,$2,'Sender project','Project address','Buyer')", [id, organizationId])
      await db.query("insert into action_case_participants(id,org_id,action_case_id,role,name,email) values($1,$2,$3,'customer','Buyer','buyer@example.test')", [recipient, organizationId, id])
      await write(db, organizationId, id, owner, 'save', { revision: 0, body: initial })
      return { id, recipient }
    }
    return { db, actor, org, otherAdmin, otherOrg, inspector, outsider, actorGrant, inspectorGrant, otherGrant, sender, otherSender, project }
  } catch (error) { await db.close(); throw error }
}

test('sender selection SQL preserves authority, immutable document identity and exact retries', async t => {
  const f = await fixture()
  try {
    const legacy = await f.project(), legacyPaper = await paper(f, legacy.id), legacyOnline = await f.project()
    await online(f, legacyOnline)
    const history = async () => (await f.db.query(`select 'draft' kind,action_case_id id,to_jsonb(d) value from action_case_customer_contract_drafts d
      union all select 'online',id,to_jsonb(o) from action_case_customer_offers o
      union all select 'paper',id,to_jsonb(p) from action_case_contract_signing_documents p order by kind,id`)).rows
    await t.test('additive installation and rerun do not rewrite legacy drafts, online versions or signed PDF evidence', async () => {
      const before = await history()
      await f.db.exec(senderMigration())
      await f.db.exec(senderMigration())
      assert.deepEqual(await history(), before)
      assert.equal((await f.db.query('select count(*)::int n from action_case_contract_senders')).rows[0].n, 0)
      const blank = await f.project(f.org, f.actor, emptyCustomerOffer())
      await paper(f, blank.id)
      assert.equal((await saved(f.db, blank.id)).body.senderProfile, undefined)
    })
    await t.test('anonymous and browser roles cannot invoke selection or read/write binding/request ledgers; service cannot bypass RPC with direct writes', async () => {
      for (const role of ['anon', 'authenticated']) await asRole(f.db, role, async () => {
        await assert.rejects(select(f, legacy.id), /permission denied/)
        for (const table of ['action_case_contract_senders', 'action_case_contract_sender_requests']) {
          await assert.rejects(f.db.query(`select * from ${table}`), /permission denied/)
          await assert.rejects(f.db.query(`delete from ${table}`), /permission denied/)
        }
        await assert.rejects(f.db.query('select assert_contract_sender_actor($1,$2)', [f.org, f.actor]), /permission denied/)
        await assert.rejects(f.db.query('select assert_action_case_contract_sender_body($1,$2,$3,$4::jsonb)', [f.org, legacy.id, f.actor, '{}']), /permission denied/)
      })
      await asRole(f.db, 'service_role', async () => {
        for (const table of ['action_case_contract_senders', 'action_case_contract_sender_requests']) {
          await assert.rejects(f.db.query(`delete from ${table}`), /permission denied/)
          await assert.rejects(f.db.query(`update ${table} set org_id=$1`, [f.otherOrg]), /permission denied/)
        }
      })
    })
    await t.test('active membership plus correct organization-scoped tasks permission is required; cross-tenant profile cannot be chosen', async () => {
      const p = await f.project(), data = selection(f.sender)
      for (const actor of [f.outsider, f.otherAdmin, randomUUID()]) await assert.rejects(select(f, p.id, data, actor), /FORBIDDEN/)
      await assert.rejects(select(f, p.id, data, f.otherAdmin, f.otherOrg), /NOT_FOUND/)
      await assert.rejects(select(f, p.id, selection(f.otherSender)), /CUSTOMER_SENDER_PROFILE/)
      await f.db.query('update org_members set is_active=false where org_id=$1 and profile_id=$2', [f.org, f.actor])
      await assert.rejects(select(f, p.id, data), /FORBIDDEN/)
      await f.db.query('update org_members set is_active=true where org_id=$1 and profile_id=$2', [f.org, f.actor])
      await f.db.query("update platform_access_assignments set source_system='organization_administration',expires_at=now()-interval '1 second' where id=$1", [f.actorGrant])
      await assert.rejects(select(f, p.id, data), /FORBIDDEN/)
      await f.db.query('update platform_access_assignments set expires_at=null,is_active=false where id=$1', [f.actorGrant])
      await assert.rejects(select(f, p.id, data), /FORBIDDEN/)
      await f.db.query("update platform_access_assignments set is_active=true,scope_type='global',scope_id=null where id=$1", [f.actorGrant])
      await assert.rejects(select(f, p.id, data), /FORBIDDEN/)
      await f.db.query("update platform_access_assignments set scope_type='organization',scope_id=$2 where id=$1", [f.actorGrant, f.otherOrg])
      await assert.rejects(select(f, p.id, data), /FORBIDDEN/)
      await f.db.query('update platform_access_assignments set scope_id=$2 where id=$1', [f.actorGrant, f.org])
      // Choosing a previously administered sender is project work, not admin work.
      await asRole(f.db, 'service_role', () => select(f, p.id, data, f.inspector))
      const d = await saved(f.db, p.id)
      assert.equal(d.revision, 2)
      assert.equal(d.body.senderProfile.organizationId, f.org)
      assert.equal(d.body.senderProfile.profileId, f.sender)
      assert.equal(d.body.contractParties.contractor.companyName, values().name)
      assert.equal(d.body.contractParties.contractor.contactName, 'Contact')
    })
    await t.test('selection validates exact request shape, draft/profile/legal versions, active sender, and legal identity', async () => {
      const p = await f.project(), original = await saved(f.db, p.id), good = selection(f.sender)
      for (const input of [null, [], {}, { ...good, confirmed: false }, { ...good, orgId: f.otherOrg }, { ...good, revision: '1' },
        { ...good, revision: 0 }, { ...good, revision: 1.5 }, { ...good, requestId: 'invalid' }, { ...good, profileId: 'invalid' }]) {
        await assert.rejects(select(f, p.id, input), /CUSTOMER_SENDER_INVALID/)
      }
      await assert.rejects(select(f, p.id, { ...good, revision: 2 }), /CUSTOMER_OFFER_STALE/)
      await assert.rejects(select(f, p.id, { ...good, profileVersion: 2 }), /CUSTOMER_SENDER_STALE/)
      await assert.rejects(select(f, p.id, { ...good, legalNameVersion: 2 }), /CUSTOMER_SENDER_STALE/)
      await assert.rejects(select(f, p.id, { ...good, organizationNumber: '556016-0680' }), /CUSTOMER_SENDER_STALE/)
      await f.db.query('update organization_sender_profiles set is_active=false where id=$1', [f.sender])
      await assert.rejects(select(f, p.id, good), /CUSTOMER_SENDER_PROFILE/)
      await f.db.query('update organization_sender_profiles set is_active=true where id=$1', [f.sender])
      await f.db.query('update organizations set organization_number=null where id=$1', [f.org])
      await assert.rejects(select(f, p.id, good), /CUSTOMER_SENDER_IDENTITY_REQUIRED/)
      await f.db.query("update organizations set organization_number='559281-0823' where id=$1", [f.org])
      assert.deepEqual(await saved(f.db, p.id), original)
      assert.equal((await f.db.query('select count(*)::int n from action_case_contract_sender_requests where action_case_id=$1', [p.id])).rows[0].n, 0)
    })
    await t.test('ordinary save, costing save and direct service writes cannot forge, remove or change sender snapshot/protected contractor data', async () => {
      const p = await f.project()
      await select(f, p.id)
      const d = await saved(f.db, p.id), badBodies = []
      const removed = structuredClone(d.body); delete removed.senderProfile; badBodies.push(removed)
      const changed = structuredClone(d.body); changed.senderProfile.legalName = 'Forged legal entity'; badBodies.push(changed)
      const crossTenant = structuredClone(d.body); crossTenant.senderProfile.organizationId = f.otherOrg; badBodies.push(crossTenant)
      for (const field of ['companyName', 'organizationNumber', 'street', 'postalCode', 'city', 'email', 'phone']) {
        const next = structuredClone(d.body); next.contractParties.contractor[field] = 'Forged'; badBodies.push(next)
      }
      for (const next of badBodies) {
        await assert.rejects(write(f.db, f.org, p.id, f.actor, 'save', { revision: d.revision, body: next }), /CUSTOMER_SENDER_IMMUTABLE/)
        await assert.rejects(asRole(f.db, 'service_role', () => f.db.query('select assert_action_case_contract_sender_body($1,$2,$3,$4::jsonb)',
          [f.org, p.id, f.actor, JSON.stringify(next)])), /CUSTOMER_SENDER_IMMUTABLE/)
        await assert.rejects(f.db.query('select save_customer_contract_costing($1,$2,$3,$4::jsonb)', [f.org, p.id, f.actor,
          JSON.stringify({ revision: d.revision, body: next, costing: {} })]), /CUSTOMER_SENDER_IMMUTABLE/)
      }
      await assert.rejects(asRole(f.db, 'service_role', () => f.db.query('update action_case_customer_contract_drafts set body=$2::jsonb where action_case_id=$1', [p.id, JSON.stringify(removed)])), /CUSTOMER_SENDER_IMMUTABLE/)
      await assert.rejects(asRole(f.db, 'service_role', () => f.db.query('delete from action_case_customer_contract_drafts where action_case_id=$1', [p.id])), /CUSTOMER_SENDER_IMMUTABLE/)
      const unselected = await f.project()
      await assert.rejects(write(f.db, f.org, unselected.id, f.actor, 'save', { revision: 1, body: d.body }), /CUSTOMER_SENDER_IMMUTABLE/)
      // A new (unbound) key with the snapshot removed must not escape the old
      // draft's immutable case/org guard or orphan the selected binding.
      await f.db.query('delete from action_case_customer_contract_drafts where action_case_id=$1', [unselected.id])
      await assert.rejects(f.db.query('update action_case_customer_contract_drafts set action_case_id=$2,body=$3::jsonb where action_case_id=$1',
        [p.id, unselected.id, JSON.stringify(removed)]), /CUSTOMER_OFFER_IMMUTABLE/)
      const otherProject = await f.project(f.otherOrg, f.otherAdmin)
      await f.db.query('delete from action_case_customer_contract_drafts where action_case_id=$1', [otherProject.id])
      await assert.rejects(f.db.query('update action_case_customer_contract_drafts set action_case_id=$2,org_id=$3,body=$4::jsonb where action_case_id=$1',
        [p.id, otherProject.id, f.otherOrg, JSON.stringify(removed)]), /CUSTOMER_OFFER_IMMUTABLE/)
      await assert.rejects(f.db.query('update action_cases set org_id=$2 where id=$1', [p.id, f.otherOrg]), /foreign key constraint/)
      assert.deepEqual(await saved(f.db, p.id), d)
      const editable = structuredClone(d.body)
      editable.title = 'Changed agreement title'; editable.contractParties.contractor.contactName = 'New contact'; editable.contractParties.contractor.fTax = 'no'
      await asRole(f.db, 'service_role', () => f.db.query('select assert_action_case_contract_sender_body($1,$2,$3,$4::jsonb)', [f.org, p.id, f.inspector, JSON.stringify(editable)]))
      await assert.rejects(f.db.query('select assert_action_case_contract_sender_body($1,$2,$3,$4::jsonb)', [f.org, p.id, f.otherAdmin, JSON.stringify(editable)]), /FORBIDDEN/)
      await write(f.db, f.org, p.id, f.actor, 'save', { revision: d.revision, body: editable })
      assert.equal((await saved(f.db, p.id)).body.title, editable.title)
      assert.deepEqual((await saved(f.db, p.id)).body.senderProfile, d.body.senderProfile)
    })
    await t.test('unknown-response retry is exact actor/scope/payload idempotent and never re-applies an old sender over newer edits', async () => {
      const p = await f.project(), data = selection(f.sender)
      assert.deepEqual((await select(f, p.id, data)).rows[0].result, { saved: true, revision: 2 })
      const d = await saved(f.db, p.id)
      await write(f.db, f.org, p.id, f.actor, 'save', { revision: d.revision, body: { ...d.body, title: 'Newer draft edit' } })
      await f.db.query('update organization_sender_profiles set is_active=false,version=version+1 where id=$1', [f.sender])
      const before = await saved(f.db, p.id)
      assert.deepEqual((await select(f, p.id, data)).rows[0].result, { saved: true, revision: 2 })
      assert.deepEqual(await saved(f.db, p.id), before)
      await assert.rejects(select(f, p.id, { ...data, revision: 3 }), /CUSTOMER_SENDER_STALE/)
      await assert.rejects(select(f, p.id, data, f.inspector), /CUSTOMER_SENDER_STALE/)
      const otherProject = await f.project()
      await assert.rejects(select(f, otherProject.id, data), /CUSTOMER_SENDER_STALE/)
      assert.equal((await f.db.query('select count(*)::int n from action_case_contract_sender_requests where action_case_id=$1', [p.id])).rows[0].n, 1)
      assert.equal((await f.db.query("select count(*)::int n from action_case_events where action_case_id=$1 and event_type='contract_sender_selected'", [p.id])).rows[0].n, 1)
      await f.db.query('update org_members set is_active=false where org_id=$1 and profile_id=$2', [f.org, f.actor])
      await assert.rejects(select(f, p.id, data), /CUSTOMER_SENDER_FORBIDDEN/)
      await f.db.query('update org_members set is_active=true where org_id=$1 and profile_id=$2', [f.org, f.actor])
      await f.db.query('update organization_sender_profiles set is_active=true,version=1 where id=$1', [f.sender])
    })
    await t.test('selected sender updates derived parties text so normalized workspace snapshots can freeze and publish without a stale mismatch', async () => {
      const draft = normalizeCustomerOffer({ ...body(), contractDetails: emptyContractDetails() })
      const p = await f.project(f.org, f.actor, draft)
      await select(f, p.id)
      const d = await saved(f.db, p.id)
      await paper(f, p.id)
      assert.equal(d.body.contractDetails.fields.parties.text, normalizeCustomerOffer(d.body).contractDetails.fields.parties.text)
      const complete = signingDraft()
      complete.contractParties.customers = [{ name: 'Buyer', personalNumber: '' }]
      complete.contractParties.email = 'buyer@example.test'
      const digital = await f.project(f.org, f.actor, normalizeCustomerOffer(complete))
      await select(f, digital.id)
      await online(f, digital)
    })
    await t.test('paper freeze locks new selections; released documents and their PDF/hash/snapshot stay unchanged after choosing another sender', async () => {
      const p = await f.project(), data = selection(f.sender)
      await select(f, p.id, data)
      const frozen = await paper(f, p.id)
      const before = (await f.db.query('select * from action_case_contract_signing_documents where id=$1', [frozen.id])).rows[0]
      await assert.rejects(select(f, p.id, selection(f.sender, 2)), /CUSTOMER_OFFER_LOCKED/)
      assert.deepEqual((await select(f, p.id, data)).rows[0].result, { saved: true, revision: 2 })
      await f.db.query("select write_contract_signing_document($1,$2,$3,'new_draft',$4::jsonb)", [f.org, p.id, f.actor, JSON.stringify({ id: frozen.id, revision: 2, confirmed: true })])
      await f.db.query("update organization_sender_profiles set name='Updated sender',version=2 where id=$1", [f.sender])
      assert.equal((await saved(f.db, p.id)).body.senderProfile.name, values().name)
      await select(f, p.id, selection(f.sender, 3, { profileVersion: 2 }))
      assert.equal((await saved(f.db, p.id)).body.senderProfile.name, 'Updated sender')
      const after = (await f.db.query('select * from action_case_contract_signing_documents where id=$1', [frozen.id])).rows[0]
      assert.ok(after.released_at)
      assert.deepEqual({ ...after, released_at: null }, before)
      await f.db.query('update organization_sender_profiles set name=$2,version=1 where id=$1', [f.sender, values().name])
    })
    await t.test('online publication freezes selected sender and Reply-To; pending/accepted versions block changes and withdrawn history is immutable', async () => {
      const p = await f.project()
      await select(f, p.id)
      const d = await saved(f.db, p.id), s = snapshot(d.body)
      await assert.rejects(online(f, p, { issuerName: 'Forged sender', snapshot: { ...s, issuerName: 'Forged sender' } }), /CUSTOMER_SENDER_IMMUTABLE/)
      await assert.rejects(online(f, p, { emailPayload: { to: 'buyer@example.test', replyTo: 'wrong@example.test' } }), /CUSTOMER_SENDER_IMMUTABLE/)
      const o = await online(f, p)
      const before = (await f.db.query('select * from action_case_customer_offers where id=$1', [o.id])).rows[0]
      await assert.rejects(select(f, p.id, selection(f.sender, 2)), /CUSTOMER_SENDER_WITHDRAW_FIRST/)
      await write(f.db, f.org, p.id, f.actor, 'withdraw', { id: o.id })
      await select(f, p.id, selection(f.sender, 2))
      const after = (await f.db.query('select * from action_case_customer_offers where id=$1', [o.id])).rows[0]
      assert.deepEqual({ ...after, status: 'published' }, before)
      const accepted = await online(f, p)
      await f.db.query("update action_case_customer_offers set status='accepted',accepted_at=now(),accepted_by='Buyer',accepted_total_ore=10000 where id=$1", [accepted.id])
      await assert.rejects(select(f, p.id, selection(f.sender, 3)), /CUSTOMER_OFFER_ACCEPTED/)
      assert.deepEqual((await f.db.query('select snapshot,email_payload from action_case_customer_offers where id=$1', [o.id])).rows[0], { snapshot: before.snapshot, email_payload: before.email_payload })
    })
    await t.test('logo snapshots require selected owned profile media and bounded embedded PNG; no-logo profile cannot accept arbitrary embedded media', async () => {
      const p = await f.project(), png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+kWZ0AAAAASUVORK5CYII='
      await assert.rejects(select(f, p.id, selection(f.sender), f.actor, f.org, png), /CUSTOMER_SENDER_MEDIA/)
      const logo = `organizations/${f.org}/logo-${randomUUID()}.png`
      await f.db.query('insert into storage.objects(bucket_id,name) values($1,$2)', ['property-media', logo])
      await f.db.query('select organization_sender_profile_save($1,$2,$3,1,$4::jsonb)', [f.actor, f.org, f.sender, JSON.stringify({ ...values(), logoPath: logo })])
      for (const image of [null, 'https://example.test/logo.png', 'data:image/svg+xml,<svg/>', `${png}${'a'.repeat(200000)}`]) {
        await assert.rejects(select(f, p.id, selection(f.sender, 1, { profileVersion: 2 }), f.actor, f.org, image), /CUSTOMER_SENDER_MEDIA/)
      }
      await select(f, p.id, selection(f.sender, 1, { profileVersion: 2 }), f.actor, f.org, png)
      const d = await saved(f.db, p.id)
      assert.equal(d.body.senderProfile.logoDataUrl, png)
      assert.equal(d.body.senderProfile.logoPath, logo)
      await f.db.query('update organization_sender_profiles set logo_path=null,version=1 where id=$1', [f.sender])
      assert.equal((await saved(f.db, p.id)).body.senderProfile.logoDataUrl, png)
    })
    await t.test('rerunning migration preserves all selected snapshots, request receipts and unrelated historical evidence', async () => {
      const before = await history()
      const bindings = (await f.db.query('select * from action_case_contract_senders order by action_case_id')).rows
      const receipts = (await f.db.query('select * from action_case_contract_sender_requests order by request_id')).rows
      await f.db.exec(senderMigration())
      assert.deepEqual(await history(), before)
      assert.deepEqual((await f.db.query('select * from action_case_contract_senders order by action_case_id')).rows, bindings)
      assert.deepEqual((await f.db.query('select * from action_case_contract_sender_requests order by request_id')).rows, receipts)
      assert.equal((await f.db.query('select snapshot from action_case_contract_signing_documents where id=$1', [legacyPaper.id])).rows[0].snapshot.senderProfile, undefined)
    })
  } finally { await f.db.close() }
})
