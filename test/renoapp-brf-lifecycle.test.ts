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
const migration = sql('2026-09-05_01_renoapp_brf_lifecycle.sql')
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
  primaryContactEmail: 'board@example.test', primaryContactPhone: '0700000000', publicApplyMode: 'listed', termsVersion: 'test-version' })

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

test('acceptance verifies identity and atomically grants access, records terms and activates the BRF', async () => {
  const created = await start('555555-5555')
  await assert.rejects(db.query('select renoapp_accept_brf_invite($1,$2,$3)', [other, created.token, completion('555555-5555')]), /INVITE_EMAIL_MISMATCH/)
  assert.equal((await db.query('select id from brf_members where brf_id=$1', [created.brf.id])).rows.length, 0)
  await db.query('select renoapp_accept_brf_invite($1,$2,$3)', [board, created.token, completion('555555-5555')])
  const brf = (await db.query<{ onboarding_completed_at: string; onboarding_terms_accepted_by: string; is_public_apply_enabled: boolean }>('select * from brf_associations where id=$1', [created.brf.id])).rows[0]
  assert.ok(brf.onboarding_completed_at)
  assert.equal(brf.onboarding_terms_accepted_by, board)
  assert.equal(brf.is_public_apply_enabled, true)
  assert.equal((await db.query('select id from platform_access_assignments where profile_id=$1 and scope_id=$2 and is_active', [board, created.brf.id])).rows.length, 1)
  await db.query('select renoapp_accept_brf_invite($1,$2,$3)', [board, created.token, null])
  assert.equal((await db.query('select id from brf_members where brf_id=$1', [created.brf.id])).rows.length, 1)
})

test('membership removal revokes normalized access, protects the last member and keeps an audit event', async () => {
  const created = await start('666666-6666')
  await db.query('select renoapp_accept_brf_invite($1,$2,$3)', [board, created.token, completion('666666-6666')])
  await assert.rejects(db.query('select renoapp_remove_brf_member($1,$2,$3)', [actor, created.brf.id, board]), /CANNOT_REMOVE_LAST_MEMBER/)
  await db.query('insert into brf_members(brf_id,profile_id,role,is_active) values($1,$2,\'board\',true)', [created.brf.id, other])
  await db.query('select renoapp_remove_brf_member($1,$2,$3)', [actor, created.brf.id, board])
  assert.equal((await db.query('select id from platform_access_assignments where profile_id=$1 and scope_id=$2 and is_active', [board, created.brf.id])).rows.length, 0)
  assert.equal((await db.query('select id from renoapp_brf_events where brf_id=$1 and kind=\'member_removed\' and actor_profile_id=$2', [created.brf.id, actor])).rows.length, 1)
})

test('renewal replaces an expired invite and revocation prevents acceptance', async () => {
  const created = await start('777777-7777')
  await db.query('update brf_member_invites set expires_at=now()-interval \'1 day\' where id=$1', [created.inviteId])
  const token = randomUUID()
  const issued = await db.query<{ id: string }>('select renoapp_issue_brf_invite($1,$2,$3,$4,$5,now()+interval \'7 days\',false) id',
    [actor, created.brf.id, 'board@example.test', 'Test', token])
  await assert.rejects(db.query('select renoapp_accept_brf_invite($1,$2,$3)', [board, created.token, completion('777777-7777')]), /INVITE_REVOKED/)
  await db.query('select renoapp_revoke_brf_invite($1,$2,$3)', [actor, created.brf.id, issued.rows[0].id])
  await assert.rejects(db.query('select renoapp_accept_brf_invite($1,$2,$3)', [board, token, completion('777777-7777')]), /INVITE_REVOKED/)
})

test('publishing requires activation and disabling applications keeps activation and memberships', async () => {
  const created = await start('888888-8888')
  await assert.rejects(db.query('select renoapp_update_brf($1,$2,$3)', [actor, created.brf.id, { is_public_apply_enabled: true }]), /BRF_ACTIVATION_REQUIRED/)
  await db.query('select renoapp_accept_brf_invite($1,$2,$3)', [board, created.token, completion('888888-8888')])
  await db.query('select renoapp_update_brf($1,$2,$3)', [actor, created.brf.id, { is_public_apply_enabled: false, internal_note: 'Private' }])
  const row = (await db.query<{ onboarding_completed_at: string; is_public_apply_listed: boolean }>('select * from brf_associations where id=$1', [created.brf.id])).rows[0]
  assert.ok(row.onboarding_completed_at)
  assert.equal(row.is_public_apply_listed, false)
  assert.equal((await db.query('select id from brf_members where brf_id=$1 and is_active', [created.brf.id])).rows.length, 1)
})

test('migration is repeatable and does not restore explicitly disabled grants', async () => {
  const created = await start('999999-9999')
  await db.query('select renoapp_accept_brf_invite($1,$2,$3)', [board, created.token, completion('999999-9999')])
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
  } finally { await db.exec('reset role') }
})

test('invite states and login return routes preserve intent without external redirects', () => {
  assert.equal(getRenoAppReturnPath('/renoapp/invite/abc_DEF-123'), '/renoapp/invite/abc_DEF-123')
  for (const path of ['https://evil.test', '//evil.test', '/renoapp/app/\\evil', '/renoapp/invite/../../admin']) assert.equal(getRenoAppReturnPath(path), '/renoapp/app')
  assert.equal(normalizeBrfOrgNumber('1234567890'), '123456-7890')
  assert.equal(getBrfInviteState({ acceptedAt: null, revokedAt: null, expiresAt: '2026-01-01' }, Date.parse('2026-02-01')), 'expired')
})
