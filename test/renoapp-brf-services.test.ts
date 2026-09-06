import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import ts from 'typescript'
import type * as Onboarding from '../src/lib/renoapp/onboarding'
import type * as ActiveBrf from '../src/app/api/renoapp/app/active-brf/route'

const nodeRequire = createRequire(import.meta.url)
function loadSource<T>(file: string, dependencies: Record<string, unknown>): T {
  const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } })
  const compiledModule = { exports: {} }
  new Function('require', 'module', 'exports', compiled.outputText)((name: string) => {
    if (name in dependencies) return dependencies[name]
    if (name === 'node:crypto') return nodeRequire(name)
    throw new Error(`Unexpected dependency: ${name}`)
  }, compiledModule, compiledModule.exports)
  return compiledModule.exports as T
}

function query(data: unknown, writes: unknown[] = []) {
  const result = { data, error: null }
  const builder = {
    select: () => builder, eq: () => builder, in: () => builder, maybeSingle: async () => result,
    update: (value: unknown) => { writes.push(value); return builder },
    insert: (value: unknown) => { writes.push(value); return builder },
    upsert: (value: unknown) => { writes.push(value); return builder },
    then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve),
  }
  return builder
}

const identity = { userId: 'admin-id', profile: { id: 'admin-id' } }
function onboarding(admin: unknown, user: unknown = null, mail: (input: unknown) => Promise<void> = async () => {}) {
  return loadSource<typeof Onboarding>('src/lib/renoapp/onboarding.ts', {
    '@/lib/supabase/admin': { createSupabaseAdminClient: () => admin },
    '@/lib/supabase/server': { createSupabaseServerClient: () => ({ auth: { getUser: async () => ({ data: { user } }) } }) },
    '@/lib/assignments/mailer': { sendAssignmentEmail: mail },
    '@/lib/renoapp/brfTerms': { RENOAPP_BRF_TERMS_VERSION: 'test-version' },
    '@/lib/renoapp/brfAdminAccess': { requireBrfAdminContext: async () => identity },
    '@/lib/renoapp/brfLifecycle': { normalizeBrfOrgNumber: (value: string) => value },
  })
}

test('approval and rejection emails contain only the external message, including retry', async context => {
  const previous = process.env.ASSIGNMENTS_MAIL_FROM
  process.env.ASSIGNMENTS_MAIL_FROM = 'noreply@example.test'
  context.after(() => { if (previous === undefined) delete process.env.ASSIGNMENTS_MAIL_FROM; else process.env.ASSIGNMENTS_MAIL_FROM = previous })
  for (const action of ['approve', 'reject'] as const) {
    const emails: unknown[] = [], writes: unknown[] = []
    let replay = false
    const request = { id: 'request-1', name: 'Test BRF', contact_name: 'Testperson', contact_email: 'board@example.test', status: action === 'approve' ? 'approved' : 'rejected', review_note: 'PRIVATE-NOTE', external_message: 'EXTERNAL-MESSAGE' }
    const admin = {
      from: () => query(request, writes),
      rpc: async (_name: string, args: Record<string, unknown>) => {
        assert.equal((args.p_input as Record<string, unknown>).internalNote, 'PRIVATE-NOTE')
        return { data: { request, brf: action === 'approve' ? { id: 'brf-id', name: 'Test BRF', slug: 'test-brf' } : null, inviteId: 'invite-id', reused: replay }, error: null }
      },
    }
    const service = onboarding(admin, null, async input => { emails.push(input) })
    await service.reviewBrfRequest('request-1', { action, reviewNote: 'PRIVATE-NOTE', externalMessage: 'EXTERNAL-MESSAGE' }, 'https://example.test')
    assert.equal(emails.length, 1)
    assert.ok(JSON.stringify(emails).includes('EXTERNAL-MESSAGE'))
    assert.ok(!JSON.stringify(emails).includes('PRIVATE-NOTE'))
    if (action === 'approve') {
      assert.ok(JSON.stringify(emails).includes('aktivera föreningen'))
      assert.ok(!JSON.stringify(emails).includes('aktivera ditt styrelsekonto'))
    }
    replay = true
    await service.reviewBrfRequest('request-1', { action, reviewNote: 'PRIVATE-NOTE' }, 'https://example.test')
    assert.equal(emails.length, 1)
    if (action === 'reject') {
      await service.resendBrfRequestDecision('request-1', 'https://example.test')
      assert.equal(emails.length, 2)
      assert.ok(!JSON.stringify(emails).includes('PRIVATE-NOTE'))
    }
  }
})

test('approving a rejected request does not reuse the rejection message', async context => {
  const previous = process.env.ASSIGNMENTS_MAIL_FROM
  process.env.ASSIGNMENTS_MAIL_FROM = 'noreply@example.test'
  context.after(() => { if (previous === undefined) delete process.env.ASSIGNMENTS_MAIL_FROM; else process.env.ASSIGNMENTS_MAIL_FROM = previous })
  const emails: unknown[] = []
  const rejectedRequest = {
    id: 'request-1', name: 'Test BRF', contact_name: 'Testperson', contact_email: 'board@example.test',
    status: 'rejected', review_note: 'PRIVATE-NOTE', external_message: 'OLD-REJECTION-MESSAGE',
  }
  const approvedRequest = {
    ...rejectedRequest, status: 'approved', external_message: null, approved_brf_id: 'brf-id',
  }
  const admin = {
    from: () => query(rejectedRequest),
    rpc: async (_name: string, args: Record<string, unknown>) => {
      assert.equal((args.p_input as Record<string, unknown>).externalMessage, null)
      return {
        data: {
          request: approvedRequest,
          brf: { id: 'brf-id', name: 'Test BRF', slug: 'test-brf' },
          inviteId: 'invite-id',
          reused: false,
        },
        error: null,
      }
    },
  }
  const service = onboarding(admin, null, async input => { emails.push(input) })
  await service.reviewBrfRequest('request-1', {
    action: 'approve', reviewNote: 'PRIVATE-NOTE', externalMessage: 'OLD-REJECTION-MESSAGE',
  }, 'https://example.test')
  assert.equal(emails.length, 1)
  assert.ok(!JSON.stringify(emails).includes('OLD-REJECTION-MESSAGE'))
})

test('activation ignores the current login and reports personal invitation delivery failures', async context => {
  const previous = process.env.ASSIGNMENTS_MAIL_FROM
  process.env.ASSIGNMENTS_MAIL_FROM = 'noreply@example.test'
  context.after(() => { if (previous === undefined) delete process.env.ASSIGNMENTS_MAIL_FROM; else process.env.ASSIGNMENTS_MAIL_FROM = previous })
  const calls: string[] = []
  const admin = {
    from: (table: string) => query(table === 'brf_member_invites'
      ? { id: 'activation-id', brf_id: 'brf-id', email: 'contact@example.test', full_name: 'Kontakt', invite_kind: 'brf_activation', expires_at: '2099-01-01', accepted_at: null, revoked_at: null }
      : { id: 'brf-id', name: 'Test BRF', slug: 'test-brf', onboarding_completed_at: null }),
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push(name)
      assert.equal(name, 'renoapp_activate_brf')
      const users = args.p_users as Array<{ email: string }>
      assert.deepEqual(users.map(user => user.email), ['board@example.test', 'extra@example.test'])
      return { data: { reused: false, memberInvites: users.map((user, index) => ({ id: `member-invite-${index}`, email: user.email })) }, error: null }
    },
  }
  const result = await onboarding(admin, { id: 'wrong-user', email: 'wrong@example.test' }, async () => { throw new Error('Mail unavailable') }).acceptBrfInvite('token', {
    inviteUserName: 'Testperson', inviteUserEmail: 'board@example.test', name: 'Test BRF', orgNumber: '123456-7890', address: 'Gatan 1',
    propertyDesignation: 'Test 1:1', postalCode: '123 45', city: 'Teststad', invoiceAddress: 'Gatan 1',
    invoiceEmail: 'invoice@example.test', primaryContactName: 'Testperson', primaryContactEmail: 'board@example.test',
    primaryContactPhone: '0701234567', publicApplyMode: 'listed', termsAccepted: true, termsVersion: 'test-version',
    signatoryName: 'Firmatecknare', signatoryRole: 'Ordförande', signatoryAuthorityConfirmed: true,
    additionalUsers: [{ name: 'Extra person', email: 'extra@example.test' }],
  })
  assert.equal(result.accepted, true)
  assert.equal(result.brfId, 'brf-id')
  assert.equal(result.signedInViaExistingSession, false)
  assert.equal(result.additionalInviteWarnings.length, 2)
  assert.equal(result.portalInvites.length, 2)
  assert.deepEqual(calls, ['renoapp_activate_brf'])
})

test('a personal invitation reuses the matching HusHub account and rejects a different logged-in account', async () => {
  const rpcCalls: string[] = []
  const invite = { id: 'member-invite', brf_id: 'brf-id', email: 'board@example.test', full_name: 'Board Person',
    invite_kind: 'member_access', expires_at: '2099-01-01', accepted_at: null, revoked_at: null }
  const admin = {
    from: (table: string) => query(table === 'brf_member_invites' ? invite
      : table === 'profiles' ? { id: 'board-id' }
      : { id: 'brf-id', name: 'Test BRF', slug: 'test-brf', onboarding_completed_at: '2026-09-06' }),
    rpc: async (name: string) => { rpcCalls.push(name); return { data: { reused: false }, error: null } },
    auth: { admin: { createUser: async () => { throw new Error('Existing sessions must not create an account.') } } },
  }
  const matching = await onboarding(admin, { id: 'board-id', email: 'board@example.test', user_metadata: { full_name: 'Board Person' } })
    .acceptBrfInvite('token', {})
  assert.equal(matching.createdUser, false)
  assert.equal(matching.signedInViaExistingSession, true)
  assert.deepEqual(rpcCalls, ['renoapp_accept_brf_invite'])

  const wrongAdmin = { ...admin, rpc: async () => { throw new Error('The RPC must not run for the wrong account.') } }
  await assert.rejects(
    onboarding(wrongAdmin, { id: 'wrong-id', email: 'wrong@example.test' }).acceptBrfInvite('token', {}),
    /INVITE_EMAIL_MISMATCH/
  )
})

test('a personal invitation creates an account only when no matching account exists', async () => {
  const writes: unknown[] = []
  const createdInputs: Array<Record<string, unknown>> = []
  const invite = { id: 'member-invite', brf_id: 'brf-id', email: 'new@example.test', full_name: 'New Person',
    invite_kind: 'member_access', expires_at: '2099-01-01', accepted_at: null, revoked_at: null }
  const admin = {
    from: (table: string) => query(table === 'brf_member_invites' ? invite
      : table === 'profiles' ? null
      : { id: 'brf-id', name: 'Test BRF', slug: 'test-brf', onboarding_completed_at: '2026-09-06' }, writes),
    rpc: async () => ({ data: { reused: false }, error: null }),
    auth: { admin: { createUser: async (input: Record<string, unknown>) => {
      createdInputs.push(input)
      return { data: { user: { id: 'new-user-id', email: 'new@example.test' } }, error: null }
    } } },
  }
  const result = await onboarding(admin).acceptBrfInvite('token', { password: 'password123', inviteUserName: 'New Person' })
  assert.equal(result.createdUser, true)
  assert.equal(createdInputs[0]?.email, 'new@example.test')
  assert.equal(writes.length, 1)
})

test('active BRF selection requires a session and actual membership before setting a cookie', async () => {
  const cookies: unknown[] = []
  let mode = 'unauthorized'
  const route = loadSource<typeof ActiveBrf>('src/app/api/renoapp/app/active-brf/route.ts', {
    'next/headers': { cookies: async () => ({ set: (...args: unknown[]) => cookies.push(args) }) },
    'next/server': { NextResponse: { json: Response.json } },
    '@/lib/renoapp/server': { requireRenoAppViewerContext: async () => {
      if (mode === 'unauthorized') throw new Error('UNAUTHORIZED')
      return { brfs: [{ id: 'my-brf' }] }
    } },
  })
  const request = (brfId: string) => new Request('https://example.test/api', { method: 'POST', body: JSON.stringify({ brfId }) })
  assert.equal((await route.POST(request('my-brf'))).status, 401)
  mode = 'authenticated'
  assert.equal((await route.POST(request('other-brf'))).status, 403)
  assert.equal(cookies.length, 0)
  assert.equal((await route.POST(request('my-brf'))).status, 200)
  assert.equal(cookies.length, 1)
})

test('BRF administration uses the same module permission as the admin layout, without a board membership', async () => {
  let checked: unknown
  const service = loadSource<{ requireBrfAdminContext: () => Promise<{ userId: string }> }>('src/lib/renoapp/brfAdminAccess.ts', {
    '@/lib/access/server': { requireModuleAccess: async (input: unknown) => {
      checked = input
      return { identity: { userId: 'admin-id', profileId: 'admin-id', email: 'admin@example.test', fullName: 'Admin' } }
    } },
  })
  assert.equal((await service.requireBrfAdminContext()).userId, 'admin-id')
  assert.deepEqual(checked, { productKey: 'hushub_admin', moduleKey: 'renoapp_admin' })
})

test('board access does not fall back to old memberships or unlimited admin scope when normalized access is available', async () => {
  const assignments: unknown[] = []
  const service = loadSource<{ requireRenoAppViewerContext: () => Promise<{ activeBrfId: string; authorizedBrfIds: string[] }> }>('src/lib/renoapp/server.ts', {
    'next/headers': { cookies: async () => ({ get: () => ({ value: 'unrelated-brf' }) }) },
    '@/lib/access/server': { getCurrentUserPlatformAccessContext: async () => ({ normalizedAccessAvailable: true, assignments,
      identity: { userId: 'admin-id', profileId: 'admin-id', isLegacyAdmin: true } }) },
    '@/lib/supabase/admin': { createSupabaseAdminClient: () => ({ from: (table: string) => {
      assert.equal(table, 'brf_associations')
      return query([{ id: 'my-brf', name: 'My BRF', slug: 'my-brf' }])
    } }) },
    '@/lib/assignments/mailer': {}, '@/lib/renoapp/brfAdminAccess': {}, '@/lib/renoapp/onboarding': {},
  })
  await assert.rejects(service.requireRenoAppViewerContext(), /RENOAPP_MEMBERSHIP_REQUIRED/)
  assignments.push({ productKey: 'renoapp', moduleKey: 'board_portal', roleKey: 'board_member', scopeType: 'brf', scopeId: 'my-brf' })
  const context = await service.requireRenoAppViewerContext()
  assert.equal(context.activeBrfId, 'my-brf')
  assert.deepEqual(context.authorizedBrfIds, ['my-brf'])
})
