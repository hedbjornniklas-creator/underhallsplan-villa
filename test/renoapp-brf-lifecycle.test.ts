import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { PGlite } from '@electric-sql/pglite'
// @ts-expect-error Node's strip-types runner requires the TypeScript extension.
import { getBrfInviteState, getRenoAppReturnPath, normalizeBrfOrgNumber } from '../src/lib/renoapp/brfLifecycle.ts'

const db = new PGlite()
const actor = randomUUID(), board = randomUUID(), other = randomUUID()
const sql = (file: string) => readFileSync(new URL(`../docs/db/${file}`, import.meta.url), 'utf8')
const withoutCrypto = (value: string) => value.replace(/create extension if not exists pgcrypto;/gi, '')
const migration = [
  sql('2026-09-05_01_renoapp_brf_lifecycle.sql'),
  sql('2026-09-06_01_renoapp_approve_rejected_request.sql'),
  sql('2026-09-06_02_renoapp_separate_activation_and_user_invites.sql'),
].join('\n')
before(async () => {
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth; create table auth.users(id uuid primary key, email text);
    create table public.profiles(id uuid primary key, email text, full_name text, is_admin boolean default false);`)
  await db.exec(withoutCrypto(sql('2026-03-26_01_renoapp_mvp_foundation.sql').split('create table if not exists public.renovation_action_types')[0]))
  for (const file of ['2026-03-28_01_renoapp_brf_onboarding.sql', '2026-03-28_02_renoapp_brf_completion_fields.sql',
    '2026-03-28_03_renoapp_invite_full_name.sql', '2026-03-28_04_renoapp_public_apply_listing.sql', '2026-04-04_01_renoapp_brf_terms_acceptance.sql']) await db.exec(withoutCrypto(sql(file)))
  await db.exec(withoutCrypto(sql('2026-04-08_02_platform_access_foundation.sql').split('with renoapp_refs as')[0]))
  for (const [id, email] of [[actor, 'admin@example.test'], [board, 'board@example.test'], [other, 'other@example.test']]) {
    await db.query('insert into auth.users values($1,$2)', [id, email])
    await db.query('insert into profiles(id,email) values($1,$2)', [id, email])
  }
  await db.exec(migration)
})
after(async () => { await db.close() })

type Start = { brf: { id: string; slug: string }; inviteId: string; reused: boolean; request?: { status: string } }
async function start(org = '111111-1111', token = randomUUID(), requestId: string | null = null, key = randomUUID()) {
  const result = await db.query<{ result: Start }>('select renoapp_start_brf_onboarding($1,$2,$3,now()+interval \'7 days\',$4,$5) as result',
    [actor, { name: 'Test BRF', orgNumber: org, email: 'board@example.test', slug: 'test-brf', decision: 'approved', internalNote: 'PRIVATE', externalMessage: 'PUBLIC' }, token, requestId, key])
  return { ...result.rows[0].result, token, key }
}
const completion = (org: string) => ({ name: 'Aktiv BRF', orgNumber: org, propertyDesignation: 'Test 1:1', address: 'Gatan 1',
  postalCode: '123 45', city: 'Teststad', invoiceAddress: 'Gatan 1', invoiceEmail: 'invoice@example.test', primaryContactName: 'Testperson',
  primaryContactEmail: 'board@example.test', primaryContactPhone: '0700000000', publicApplyMode: 'listed', termsVersion: 'test-version',
  signatoryName: 'Behörig person', signatoryRole: 'Styrelseordförande', signatoryAuthorityConfirmed: true })
async function activate(created: Awaited<ReturnType<typeof start>>, org: string, email = 'board@example.test') {
  const memberToken = randomUUID()
  const users = [{ fullName: 'Board Person', email, tokenHash: memberToken, expiresAt: '2099-01-01T00:00:00.000Z' }]
  const result = await db.query<{ result: { reused: boolean; memberInvites: Array<{ id: string; email: string }> } }>(
    'select renoapp_activate_brf($1,$2,$3) as result', [created.token, completion(org), users])
  return { memberToken, ...result.rows[0].result }
}

test('manual create is idempotent and organizational duplicates are rejected', async () => {
  const initial = await start()
  const repeated = await start('111111-1111', randomUUID(), null, initial.key)
  assert.equal(repeated.brf.id, initial.brf.id)
  assert.equal(repeated.reused, true)
  await assert.rejects(start('1111111111'), /BRF_ORG_NUMBER_EXISTS/)
})

test('approval saves the request, BRF and invitation once and separates the two messages', async () => {
  const requestId = randomUUID()
  await db.query('insert into brf_requests(id,name,org_number,contact_name,contact_email) values($1,$2,$3,$4,$5)',
    [requestId, 'Requested BRF', '222222-2222', 'Board Person', 'board@example.test'])
  const approved = await start('ignored', randomUUID(), requestId)
  const repeated = await start('ignored', randomUUID(), requestId)
  assert.equal(approved.brf.id, repeated.brf.id)
  const row = (await db.query('select status,review_note,external_message,approved_brf_id from brf_requests where id=$1', [requestId])).rows[0]
  assert.deepEqual(row, { status: 'approved', review_note: 'PRIVATE', external_message: 'PUBLIC', approved_brf_id: approved.brf.id })
})

test('a rejected request can be approved later without creating duplicates', async () => {
  const requestId = randomUUID()
  await db.query('insert into brf_requests(id,name,org_number,contact_name,contact_email) values($1,$2,$3,$4,$5)',
    [requestId, 'Corrected BRF', '232323-2323', 'Board Person', 'board@example.test'])
  await db.query('select renoapp_start_brf_onboarding($1,$2,$3,now()+interval \'7 days\',$4,$5)',
    [actor, { decision: 'rejected', internalNote: 'Rejected first', externalMessage: 'Old rejection reason' }, randomUUID(), requestId, randomUUID()])
  assert.equal((await db.query<{ status: string }>('select status from brf_requests where id=$1', [requestId])).rows[0].status, 'rejected')

  const approved = await start('ignored', randomUUID(), requestId)
  const repeated = await start('ignored', randomUUID(), requestId)
  assert.equal(repeated.brf.id, approved.brf.id)
  assert.equal(repeated.reused, true)
  assert.equal((await db.query('select id from brf_associations where org_number=$1', ['232323-2323'])).rows.length, 1)
  assert.equal((await db.query('select id from renoapp_brf_events where request_id=$1 and kind=\'request_rejected\'', [requestId])).rows.length, 1)
  assert.equal((await db.query('select id from renoapp_brf_events where request_id=$1 and kind=\'request_approved\'', [requestId])).rows.length, 1)
  await assert.rejects(db.query('select renoapp_start_brf_onboarding($1,$2,$3,now()+interval \'7 days\',$4,$5)',
    [actor, { decision: 'rejected' }, randomUUID(), requestId, randomUUID()]), /BRF_REQUEST_ALREADY_REVIEWED/)
})

test('an invitation insert error rolls back the BRF and request decision; retry succeeds', async () => {
  const occupied = await start('333333-3333')
  const requestId = randomUUID()
  await db.query('insert into brf_requests(id,name,org_number,contact_name,contact_email) values($1,$2,$3,$4,$5)',
    [requestId, 'Rollback BRF', '444444-4444', 'Test', 'board@example.test'])
  await assert.rejects(start('ignored', occupied.token, requestId), /unique constraint/)
  assert.equal((await db.query('select id from brf_associations where org_number=$1', ['444444-4444'])).rows.length, 0)
  assert.equal((await db.query<{ status: string }>('select status from brf_requests where id=$1', [requestId])).rows[0].status, 'pending')
  await start('ignored', randomUUID(), requestId)
})

test('BRF activation needs no login, records the signatory and creates personal invitations atomically', async () => {
  const created = await start('555555-5555')
  const activationInvite = (await db.query<{ invite_kind: string }>('select invite_kind from brf_member_invites where id=$1', [created.inviteId])).rows[0]
  assert.equal(activationInvite.invite_kind, 'brf_activation')
  const activated = await activate(created, '555555-5555')
  assert.equal((await db.query('select id from brf_members where brf_id=$1', [created.brf.id])).rows.length, 0)
  const brf = (await db.query<{ onboarding_completed_at: string; onboarding_terms_accepted_by: string | null; onboarding_signatory_name: string;
    onboarding_signatory_role: string; onboarding_signatory_email: string; is_public_apply_enabled: boolean }>('select * from brf_associations where id=$1', [created.brf.id])).rows[0]
  assert.ok(brf.onboarding_completed_at)
  assert.equal(brf.onboarding_terms_accepted_by, null)
  assert.equal(brf.onboarding_signatory_name, 'Behörig person')
  assert.equal(brf.onboarding_signatory_role, 'Styrelseordförande')
  assert.equal(brf.onboarding_signatory_email, 'board@example.test')
  assert.equal(brf.is_public_apply_enabled, true)
  assert.equal(activated.memberInvites.length, 1)
  assert.equal((await db.query("select id from brf_member_invites where brf_id=$1 and invite_kind='member_access'", [created.brf.id])).rows.length, 1)
  const repeated = await db.query<{ result: { reused: boolean } }>('select renoapp_activate_brf($1,$2,$3) as result', [created.token, null, null])
  assert.equal(repeated.rows[0].result.reused, true)
  assert.equal((await db.query("select id from brf_member_invites where brf_id=$1 and invite_kind='member_access'", [created.brf.id])).rows.length, 1)

  await assert.rejects(db.query('select renoapp_accept_brf_invite($1,$2,$3)', [other, activated.memberToken, null]), /INVITE_EMAIL_MISMATCH/)
  await db.query('select renoapp_accept_brf_invite($1,$2,$3)', [board, activated.memberToken, null])
  assert.equal((await db.query('select id from platform_access_assignments where profile_id=$1 and scope_id=$2 and is_active', [board, created.brf.id])).rows.length, 1)
  await db.query('select renoapp_accept_brf_invite($1,$2,$3)', [board, activated.memberToken, null])
  assert.equal((await db.query('select id from brf_members where brf_id=$1', [created.brf.id])).rows.length, 1)
})

test('activation requires an authorized signatory and unique initial users', async () => {
  const created = await start('565656-5656')
  await assert.rejects(db.query('select renoapp_activate_brf($1,$2,$3)', [created.token,
    { ...completion('565656-5656'), signatoryAuthorityConfirmed: false },
    [{ fullName: 'Board Person', email: 'board@example.test', tokenHash: randomUUID(), expiresAt: '2099-01-01' }]]),
  /SIGNATORY_AUTHORITY_REQUIRED/)
  const duplicatedUsers = ['first', 'second'].map(name => ({ fullName: name, email: 'same@example.test', tokenHash: randomUUID(), expiresAt: '2099-01-01' }))
  await assert.rejects(db.query('select renoapp_activate_brf($1,$2,$3)', [created.token, completion('565656-5656'), duplicatedUsers]),
    /INITIAL_USER_DUPLICATE_EMAIL/)
  assert.equal((await db.query<{ onboarding_completed_at: string | null }>('select onboarding_completed_at from brf_associations where id=$1', [created.brf.id])).rows[0].onboarding_completed_at, null)
})

test('membership removal revokes normalized access, protects the last member and keeps an audit event', async () => {
  const created = await start('666666-6666')
  const activated = await activate(created, '666666-6666')
  await db.query('select renoapp_accept_brf_invite($1,$2,$3)', [board, activated.memberToken, null])
  await assert.rejects(db.query('select renoapp_remove_brf_member($1,$2,$3)', [actor, created.brf.id, board]), /CANNOT_REMOVE_LAST_MEMBER/)
  await db.query('insert into brf_members(brf_id,profile_id,role,is_active) values($1,$2,\'board\',true)', [created.brf.id, other])
  await db.query('select renoapp_remove_brf_member($1,$2,$3)', [actor, created.brf.id, board])
  assert.equal((await db.query('select id from platform_access_assignments where profile_id=$1 and scope_id=$2 and is_active', [board, created.brf.id])).rows.length, 0)
  assert.equal((await db.query('select id from renoapp_brf_events where brf_id=$1 and kind=\'member_removed\' and actor_profile_id=$2', [created.brf.id, actor])).rows.length, 1)
})

test('activation renewal replaces an expired token and revocation prevents activation', async () => {
  const created = await start('777777-7777')
  await db.query('update brf_member_invites set expires_at=now()-interval \'1 day\' where id=$1', [created.inviteId])
  await assert.rejects(db.query('select renoapp_activate_brf($1,$2,$3)', [created.token, completion('777777-7777'), []]), /INVITE_EXPIRED/)
  const token = randomUUID()
  await db.query('select renoapp_reissue_brf_activation($1,$2,$3,$4,now()+interval \'7 days\')',
    [actor, created.brf.id, created.inviteId, token])
  await assert.rejects(db.query('select renoapp_activate_brf($1,$2,$3)', [created.token, completion('777777-7777'), []]), /INVITE_NOT_FOUND/)
  await db.query('select renoapp_revoke_brf_invite($1,$2,$3)', [actor, created.brf.id, created.inviteId])
  await assert.rejects(db.query('select renoapp_activate_brf($1,$2,$3)', [token, completion('777777-7777'), []]), /INVITE_REVOKED/)
})

test('publishing requires activation and disabling applications keeps activation and memberships', async () => {
  const created = await start('888888-8888')
  await assert.rejects(db.query('select renoapp_update_brf($1,$2,$3)', [actor, created.brf.id, { is_public_apply_enabled: true }]), /BRF_ACTIVATION_REQUIRED/)
  const activated = await activate(created, '888888-8888')
  await db.query('select renoapp_accept_brf_invite($1,$2,$3)', [board, activated.memberToken, null])
  await db.query('select renoapp_update_brf($1,$2,$3)', [actor, created.brf.id, { is_public_apply_enabled: false, internal_note: 'Private' }])
  const row = (await db.query<{ onboarding_completed_at: string; is_public_apply_listed: boolean }>('select * from brf_associations where id=$1', [created.brf.id])).rows[0]
  assert.ok(row.onboarding_completed_at)
  assert.equal(row.is_public_apply_listed, false)
  assert.equal((await db.query('select id from brf_members where brf_id=$1 and is_active', [created.brf.id])).rows.length, 1)
})

test('migration is repeatable and does not restore explicitly disabled grants', async () => {
  const created = await start('999999-9999')
  const activated = await activate(created, '999999-9999')
  await db.query('select renoapp_accept_brf_invite($1,$2,$3)', [board, activated.memberToken, null])
  await db.query('update platform_access_assignments set is_active=false where scope_id=$1 and profile_id=$2', [created.brf.id, board])
  await db.exec(migration)
  assert.equal((await db.query('select id from platform_access_assignments where scope_id=$1 and profile_id=$2 and is_active', [created.brf.id, board])).rows.length, 0)
  await db.query('select renoapp_restore_brf_member($1,$2,$3)', [actor, created.brf.id, board])
  assert.equal((await db.query('select id from platform_access_assignments where scope_id=$1 and profile_id=$2 and is_active', [created.brf.id, board])).rows.length, 1)
  assert.equal((await db.query("select id from renoapp_brf_events where brf_id=$1 and kind='member_access_restored' and actor_profile_id=$2", [created.brf.id, actor])).rows.length, 1)
})

test('browser roles cannot execute lifecycle mutations or read internal history', async () => {
  await db.exec('set role authenticated')
  try {
    await assert.rejects(db.query('select renoapp_remove_brf_member($1,$2,$3)', [actor, randomUUID(), board]), /permission denied/)
    await assert.rejects(db.query('select * from renoapp_brf_events'), /permission denied/)
    await assert.rejects(db.query('select * from brf_member_invites'), /permission denied/)
    await assert.rejects(db.query('select * from brf_associations'), /permission denied/)
    await assert.rejects(db.query('select renoapp_restore_brf_member($1,$2,$3)', [actor, randomUUID(), board]), /permission denied/)
    await assert.rejects(db.query('select renoapp_activate_brf($1,$2,$3)', ['token', {}, []]), /permission denied/)
  } finally { await db.exec('reset role') }
})

test('invite states and login return routes preserve intent without external redirects', () => {
  assert.equal(getRenoAppReturnPath('/renoapp/invite/abc_DEF-123'), '/renoapp/invite/abc_DEF-123')
  for (const path of ['https://evil.test', '//evil.test', '/renoapp/app/\\evil', '/renoapp/invite/../../admin']) assert.equal(getRenoAppReturnPath(path), '/renoapp/app')
  assert.equal(normalizeBrfOrgNumber('1234567890'), '123456-7890')
  assert.equal(getBrfInviteState({ acceptedAt: null, revokedAt: null, expiresAt: '2026-01-01' }, Date.parse('2026-02-01')), 'expired')
})
