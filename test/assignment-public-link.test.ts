import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { isIP } from 'node:net'
import test from 'node:test'
import ts from 'typescript'

function load(file: string, dependencies: Record<string, unknown>) {
  const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const compiled = { exports: {} as Record<string, (...args: any[]) => Promise<any>> }
  new Function('require', 'module', 'exports', output)(
    (name: string) => {
      if (name in dependencies) return dependencies[name]
      if (name.startsWith('@/')) return new Proxy({}, {
        get: (_target, key) => () => { throw new Error(`Unexpected dependency: ${name}.${String(key)}`) },
      })
      throw new Error(`Unexpected import: ${name}`)
    }, compiled, compiled.exports,
  )
  return compiled.exports
}

const TOKEN = 'synthetic-assignment-token-for-tests'
const ORG = '11111111-1111-4111-8111-111111111111'
const ID = '22222222-2222-4222-8222-222222222222'
const terms = { version: 'test-v1', documentHash: 'a'.repeat(64), text: 'Synthetic terms', templateId: 'test' }
const hash = (token: string) => createHash('sha256').update(token).digest('hex')

function link(overrides: Record<string, unknown> = {}) {
  return {
    id: '33333333-3333-4333-8333-333333333333', org_id: ORG, assignment_id: ID,
    expires_at: '2099-01-01T00:00:00Z', used_at: null, revoked_at: null,
    terms_version: terms.version, issuer_identity_snapshot: null,
    assignments: { id: ID, status: 'sent', assignment_type: 'OB', responsible_profile_id: null,
      orderer_role: 'buyer', customer_email: 'test@example.test', price_amount: 100,
      preferred_date: '2099-01-01', preferred_time: '10:00', assignment_details: {} },
    ...overrides,
  }
}

function resolverHarness(results: Array<{ data: unknown; error: unknown }>) {
  const calls: Array<{ columns: string; filters: Array<[string, unknown]> }> = []
  const admin = { from(table: string) {
    assert.equal(table, 'assignment_links')
    const call = { columns: '', filters: [] as Array<[string, unknown]> }
    const query = {
      select(columns: string) { call.columns = columns; return query },
      eq(column: string, value: unknown) { call.filters.push([column, value]); return query },
      async maybeSingle() { calls.push(call); return results.shift() },
    }
    return query
  } }
  const server = load('src/lib/assignments/server.ts', {
    '@/lib/supabase/admin': { createSupabaseAdminClient: () => admin },
    '@/lib/assignments/tokens': { hashAssignmentToken: hash },
  })
  return { resolve: server.resolvePublicAssignmentByToken, calls }
}

test('public resolver selects the organization-scoped relationship and hashes the token', async () => {
  const row = link()
  const h = resolverHarness([{ data: row, error: null }])
  assert.equal((await h.resolve(TOKEN)).assignments.id, ID)
  assert.match(h.calls[0].columns, /assignments:assignments!assignment_links_org_assignment_fkey\(/)
  assert.deepEqual(h.calls[0].filters, [['token_hash', hash(TOKEN)]])
  assert.ok(!h.calls[0].columns.includes(TOKEN))
})

test('legacy issuer-column fallback retains the same organization-scoped relationship', async () => {
  const h = resolverHarness([
    { data: null, error: { code: '42703', message: 'issuer_identity_snapshot does not exist' } },
    { data: link(), error: null },
  ])
  assert.equal((await h.resolve(TOKEN)).assignments.id, ID)
  assert.equal(h.calls.length, 2)
  for (const call of h.calls) {
    assert.match(call.columns, /assignments!assignment_links_org_assignment_fkey\(/)
    assert.deepEqual(call.filters, [['token_hash', hash(TOKEN)]])
  }
  assert.ok(!h.calls[1].columns.includes('issuer_identity_snapshot'))
})

test('unknown links stay missing and unexpected database failures fail closed', async () => {
  assert.equal(await resolverHarness([{ data: null, error: null }]).resolve(TOKEN), null)
  const h = resolverHarness([{ data: null, error: { code: 'PGRST201', message: 'ambiguous relationship' } }])
  await assert.rejects(h.resolve(TOKEN), /ambiguous relationship/)
  assert.equal(h.calls.length, 1)
})

function routeHarness(row: ReturnType<typeof link> | null = link(), mailFails = false) {
  let consumed = false
  let acceptedCount = 0
  let mails = 0
  const writes: Array<[string, unknown]> = []
  const admin = { from(table: string) {
    const query = { update(value: unknown) { writes.push([table, value]); return query },
      eq() { return query }, then(resolve: (value: unknown) => unknown) { return Promise.resolve({ error: null }).then(resolve) } }
    return query
  } }
  const api = load('src/app/api/assignments/accept/[token]/route.ts', {
    'next/server': { NextResponse: { json: (data: unknown, init?: ResponseInit) => Response.json(data, init) } },
    'node:net': { isIP },
    '@/lib/supabase/admin': { createSupabaseAdminClient: () => admin },
    '@/lib/assignments/terms': {
      resolveAssignmentTermsRole: () => 'buyer', getAssignmentTermsDocument: () => terms,
      getAllAssignmentTermsDocuments: () => Object.fromEntries(['seller', 'buyer', 'apartment', 'technical', 'construction', 'constructionBusiness', 'constructionConsumer'].map(k => [k, terms])),
    },
    '@/lib/assignments/server': {
      resolvePublicAssignmentByToken: async () => row,
      consumeAssignmentToken: async () => {
        if (consumed || row?.used_at) throw new Error('token_already_used')
        if (row?.revoked_at || Date.parse(row?.expires_at ?? '') < Date.now()) throw new Error('token_not_valid_or_expired')
        consumed = true
        acceptedCount++
      },
      getAssignmentById: async () => row?.assignments,
      getProfileContact: async () => ({ email: 'inspector@example.test' }),
      sendAssignmentAcceptedNotice: async () => { mails++; if (mailFails) throw new Error('Synthetic mail failure') },
    },
  })
  const context = { params: Promise.resolve({ token: TOKEN }) }
  const body = { termsAccepted: true, termsVersion: terms.version, termsDocumentHash: terms.documentHash,
    customerEmail: 'test@example.test', preferredDate: '2099-01-01', preferredTime: '10:00',
    cadastralId: 'Test 1:1', propertyOwnerName: 'Test owner' }
  return {
    get: () => api.GET(new Request('https://example.test/accept/test'), context),
    post: (overrides: Record<string, unknown> = {}) => api.POST(new Request('https://example.test/accept/test', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...body, ...overrides }),
    }), context),
    counts: () => ({ acceptedCount, mails, writes: writes.length }),
  }
}

test('GET returns the expected assignment, terms and link states without accepting anything', async () => {
  for (const [overrides, state] of [
    [{}, 'open'], [{ used_at: '2026-09-01' }, 'used'], [{ revoked_at: '2026-09-01' }, 'revoked'],
    [{ expires_at: '2000-01-01' }, 'expired'], [{ terms_version: 'old' }, 'outdated'],
  ] as const) {
    const h = routeHarness(link(overrides))
    const response = await h.get()
    assert.equal(response.status, 200)
    const data = await response.json()
    assert.equal(data.state, state)
    assert.equal(data.assignment.id, ID)
    assert.equal(data.terms.version, terms.version)
    assert.deepEqual(h.counts(), { acceptedCount: 0, mails: 0, writes: 0 })
  }
  assert.equal((await routeHarness(null).get()).status, 404)
})

test('POST requires explicit consent and matching terms before consuming the link', async () => {
  const h = routeHarness()
  assert.equal((await h.post({ termsAccepted: false })).status, 400)
  assert.equal((await h.post({ termsVersion: 'wrong' })).status, 409)
  assert.equal((await h.post({ termsDocumentHash: 'b'.repeat(64) })).status, 409)
  assert.equal(h.counts().acceptedCount, 0)
})

test('POST delegates one-time acceptance to the token consumer and sends one confirmation', async () => {
  const h = routeHarness()
  const responses = await Promise.all([h.post(), h.post()])
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 409])
  assert.deepEqual(h.counts(), { acceptedCount: 1, mails: 1, writes: 1 })
})

test('POST rejects revoked and expired links without sending a confirmation', async () => {
  for (const overrides of [{ revoked_at: '2026-09-01' }, { expires_at: '2000-01-01' }]) {
    const h = routeHarness(link(overrides))
    assert.equal((await h.post()).status, 410)
    assert.equal(h.counts().mails, 0)
  }
})

test('a mail transport failure does not turn a saved acceptance into a failed acceptance', async () => {
  const h = routeHarness(link(), true)
  const response = await h.post()
  assert.equal(response.status, 200)
  assert.equal((await response.json()).confirmationEmailSent, false)
  assert.equal(h.counts().acceptedCount, 1)
})
