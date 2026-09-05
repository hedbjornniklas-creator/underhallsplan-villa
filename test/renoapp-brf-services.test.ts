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

test('failed optional invitations do not turn completed onboarding into an error', async () => {
  const calls: string[] = []
  const admin = {
    from: (table: string) => query(table === 'brf_member_invites'
      ? { id: 'invite-id', brf_id: 'brf-id', email: 'board@example.test', full_name: 'Testperson', expires_at: '2099-01-01', accepted_at: null, revoked_at: null }
      : table === 'profiles' ? { id: 'board-id' } : { id: 'brf-id', name: 'Test BRF', slug: 'test-brf', onboarding_completed_at: null }),
    rpc: async (name: string) => {
      calls.push(name)
      return name === 'renoapp_accept_brf_invite' ? { data: { reused: false }, error: null } : { data: null, error: { message: 'Simulated invite failure' } }
    },
  }
  const result = await onboarding(admin, { id: 'board-id', email: 'board@example.test' }).acceptBrfInvite('token', {
    inviteUserName: 'Testperson', name: 'Test BRF', orgNumber: '123456-7890', address: 'Gatan 1',
    propertyDesignation: 'Test 1:1', postalCode: '123 45', city: 'Teststad', invoiceAddress: 'Gatan 1',
    invoiceEmail: 'invoice@example.test', primaryContactName: 'Testperson', primaryContactEmail: 'board@example.test',
    primaryContactPhone: '0701234567', publicApplyMode: 'listed', termsAccepted: true, termsVersion: 'test-version',
    additionalUsers: [{ name: 'Extra person', email: 'extra@example.test' }],
  })
  assert.equal(result.accepted, true)
  assert.equal(result.brfId, 'brf-id')
  assert.equal(result.additionalInviteWarnings.length, 1)
  assert.deepEqual(calls, ['renoapp_accept_brf_invite', 'renoapp_issue_brf_invite'])
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
