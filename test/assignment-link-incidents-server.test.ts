import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import ts from 'typescript'
import type * as Incidents from '../src/lib/assignments/linkIncidents'

function harness(options: { notify?: boolean; member?: boolean; mailFails?: boolean; dbFails?: boolean } = {}) {
  const mails: Array<Record<string, unknown>> = []
  const logs: unknown[] = []
  const queries: Array<{ table: string; filters: Array<[string, unknown]>; patch?: Record<string, unknown> }> = []
  const rpcs: unknown[] = []
  const admin = {
    async rpc(name: string, args: Record<string, unknown>) {
      rpcs.push({ name, args })
      return { error: options.dbFails ? { code: '08006', message: 'private failure synthetic-token' } : null,
        data: { id: 'incident-1', orgId: 'org-1', assignmentId: 'assignment-1', responsibleProfileId: 'profile-1', assignmentType: 'OB', notify: options.notify !== false } }
    },
    from(table: string) {
      const call = { table, filters: [] as Array<[string, unknown]>, patch: undefined as Record<string, unknown> | undefined }
      queries.push(call)
      const result = () => ({ error: options.dbFails ? { code: '08006' } : null,
        data: table === 'org_members' ? options.member === false ? null : { profile_id: 'profile-1' }
          : table === 'profiles' ? { email: 'inspector@example.test' } : [] })
      const query = {
        select() { return query }, update(patch: Record<string, unknown>) { call.patch = patch; return query },
        eq(k: string, v: unknown) { call.filters.push([k, v]); return query },
        in(k: string, v: unknown) { call.filters.push([k, v]); return query },
        is(k: string, v: unknown) { call.filters.push([k, v]); return query },
        order() { return query }, maybeSingle: async () => result(),
        then(resolve: (value: unknown) => unknown) { return Promise.resolve(result()).then(resolve) },
      }
      return query
    },
  }
  const deps: Record<string, unknown> = {
    '@/lib/supabase/admin': { createSupabaseAdminClient: () => admin },
    '@/lib/assignments/tokens': { hashAssignmentToken: () => 'synthetic-hash' },
    '@/lib/assignments/mailer': { sendAssignmentEmail: async (input: Record<string, unknown>) => {
      mails.push(input); if (options.mailFails) throw new Error('private transport error')
    } },
  }
  const output = ts.transpileModule(readFileSync(new URL('../src/lib/assignments/linkIncidents.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const compiled = { exports: {} }
  new Function('require', 'module', 'exports', 'console', 'process', output)(
    (name: string) => { if (!(name in deps)) throw Error(name); return deps[name] }, compiled, compiled.exports,
    { error: (...args: unknown[]) => logs.push(args) },
    { env: { APP_BASE_URL: 'https://example.test', ASSIGNMENTS_MAIL_FROM: 'Test <noreply@example.test>' } },
  )
  return { api: compiled.exports as typeof Incidents, mails, logs, queries, rpcs }
}
const input = { token: 'synthetic-token', reference: 'request-1', operation: 'open' as const, code: 'TEST_FAILURE' }

test('warning goes only to the responsible active member, with an internal URL and stable idempotency key', async () => {
  const h = harness()
  await h.api.recordPublicLinkFailure(input)
  assert.equal(h.mails.length, 1)
  assert.equal(h.mails[0].to, 'inspector@example.test')
  assert.equal(h.mails[0].idempotencyKey, 'assignment-link-incident-incident-1')
  assert.match(String(h.mails[0].text), /https:\/\/example.test\/ob\/assignments\/assignment-1/)
  assert.ok(!JSON.stringify(h.mails).includes(input.token))
  assert.deepEqual(h.queries[0].filters, [['org_id', 'org-1'], ['profile_id', 'profile-1'], ['is_active', true]])
  assert.equal(h.queries.at(-1)?.patch?.notification_state, 'sent')
})

test('duplicate claims and unavailable members cannot send mail', async () => {
  for (const options of [{ notify: false }, { member: false }]) {
    const h = harness(options)
    await h.api.recordPublicLinkFailure(input)
    assert.equal(h.mails.length, 0)
  }
})

test('storage or mail failure is fail-soft, observable, and does not leak tokens or raw errors', async () => {
  for (const options of [{ dbFails: true }, { mailFails: true }]) {
    const h = harness(options)
    await h.api.recordPublicLinkFailure(input)
    assert.ok(h.logs.length > 0)
    assert.ok(!JSON.stringify(h.logs).includes(input.token))
    assert.ok(!JSON.stringify(h.logs).includes('private'))
    if (options.mailFails) assert.equal(h.queries.at(-1)?.patch?.notification_state, 'failed')
  }
})

test('incident list is constrained to the authorized organization and assignment IDs', async () => {
  const h = harness()
  assert.equal((await h.api.listAssignmentLinkIssues('org-1', ['assignment-1'])).available, true)
  assert.deepEqual(h.queries[0].filters, [['org_id', 'org-1'], ['assignment_id', ['assignment-1']], ['resolved_at', null]])
  const failed = harness({ dbFails: true })
  assert.deepEqual(await failed.api.listAssignmentLinkIssues('org-1', ['assignment-1']), { available: false, items: [] })
  assert.equal(h.api.publicLinkErrorCode(new Error('private data')), 'PUBLIC_LINK_FAILURE')
})
